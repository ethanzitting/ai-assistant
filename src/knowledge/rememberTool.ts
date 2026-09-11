import * as v from "valibot";
import { storeEntity } from "@/knowledge/storeEntity.ts";
import { storeFact } from "@/knowledge/storeFact.ts";
import { storeRelationship } from "@/knowledge/storeRelationship.ts";
import {
  rememberInputSchema,
  type RememberItem,
} from "@/knowledge/rememberSchema.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import type { KnowledgeWriteResult } from "@/knowledge/knowledgeWriteResult.ts";

export const rememberTool: ToolDefinition = {
  schema: {
    name: "remember",
    description:
      `Store items into the knowledge graph. You may complete up to three successful calls per turn. A failed call does not consume the allowance, so correct its input and retry. Batch related entities, facts, and relationships when practical. For many items (>5), propose them to the user first and wait for approval before calling.

Pass an "items" array — each element is one of:

  { type: "entity", entity: { name: "Dr. Nguyen", type: "person", properties: { specialty: "neurology" } } }
  { type: "fact", fact: { entity_name: "Dana Whitfield", attribute: "diagnosis", value: "viral encephalitis" } }
  { type: "relationship", relationship: { entity_a_name: "Robin Whitfield", entity_b_name: "Dana Whitfield", type: "spouse" } }

Create entities BEFORE facts/relationships that reference them. Old fact values are superseded automatically. "Already known" or "already exists" means the data is persisted — never retry or rephrase.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["entity", "fact", "relationship"],
              },
              entity: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["person", "organization", "place", "account"],
                  },
                  properties: { type: "object" },
                },
                required: ["name", "type"],
              },
              fact: {
                type: "object",
                properties: {
                  entity_name: { type: "string" },
                  attribute: { type: "string" },
                  value: { type: "string" },
                },
                required: ["entity_name", "attribute", "value"],
              },
              relationship: {
                type: "object",
                properties: {
                  entity_a_name: { type: "string" },
                  entity_b_name: { type: "string" },
                  type: { type: "string" },
                },
                required: ["entity_a_name", "entity_b_name", "type"],
              },
            },
            required: ["type"],
          },
          minItems: 1,
          description:
            "Array of items to store. Order matters — create entities before referencing them in facts or relationships.",
        },
      },
      required: ["items"],
    },
  },
  handle: handleRemember,
};

async function handleRemember(
  input: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  const result = v.safeParse(rememberInputSchema, input);
  if (!result.success) {
    return {
      content: JSON.stringify({
        operation: "remember",
        changed: false,
        reason: "invalid_input",
        retryable: true,
        instruction: "Correct the listed input fields and retry now.",
        errors: formatValidationIssues(result.issues),
      }),
      isError: true,
    };
  }

  const results = [];
  for (const [index, item] of result.output.items.entries()) {
    try {
      const itemResult = await storeItem(item, traceId);
      results.push({
        index,
        type: item.type,
        status: itemResult.isError
          ? "failed"
          : itemResult.changed
          ? "changed"
          : "unchanged",
        reason: itemResult.reason,
        detail: itemResult.content,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        index,
        type: item.type,
        status: "failed",
        reason: "unexpected_error",
        detail: message,
      });
    }
  }

  const changedItems = results.filter((item) => item.status === "changed")
    .length;
  const unchangedItems = results.filter((item) => item.status === "unchanged")
    .length;
  const failedItems = results.filter((item) => item.status === "failed").length;

  return {
    content: JSON.stringify({
      operation: "remember",
      changed: changedItems > 0,
      requestedItems: results.length,
      changedItems,
      unchangedItems,
      failedItems,
      retryable: failedItems > 0,
      instruction: failedItems > 0
        ? "Retry only the failed items with corrected input."
        : undefined,
      results,
    }),
    isError: failedItems > 0,
  };
}

function storeItem(
  item: RememberItem,
  traceId: string,
): Promise<KnowledgeWriteResult> {
  switch (item.type) {
    case "entity":
      return storeEntity(item.entity, traceId);
    case "fact":
      return storeFact(item.fact, traceId);
    case "relationship":
      return storeRelationship(item.relationship, traceId);
    default:
      return Promise.resolve({
        content: `Unknown type: ${(item as Record<string, unknown>).type}`,
        changed: false,
        reason: "unknown_type",
        isError: true,
      });
  }
}

function formatValidationIssues(issues: v.BaseIssue<unknown>[]): string[] {
  return issues.map((issue) => {
    const path = issue.path
      ? issue.path.map((segment: v.IssuePathItem) => String(segment.key)).join(
        ".",
      )
      : "root";
    return `${path}: ${issue.message}`;
  });
}

import * as v from "valibot";
import { storeEntity } from "@/knowledge/storeEntity.ts";
import { storeFact } from "@/knowledge/storeFact.ts";
import { storeRelationship } from "@/knowledge/storeRelationship.ts";
import { rememberInputSchema, type RememberItem } from "@/knowledge/rememberSchema.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";

const ITEM_SCHEMA_HELP = `Each item in the array must have a "type" field and a corresponding nested object:

  { type: "entity", entity: { name, type, properties? } }
  { type: "fact", fact: { entity_name, attribute, value } }
  { type: "relationship", relationship: { entity_a_name, entity_b_name, type } }`;

export const rememberTool: ToolDefinition = {
  schema: {
    name: "remember",
    description: `Store items into the knowledge graph. You may call this ONCE per turn — a second call will be rejected and those items will be lost. Batch all entities, facts, and relationships into a single call. For many items (>5), propose them to the user first and wait for approval before calling.

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
                  type: { type: "string", enum: ["person", "organization", "place", "account"] },
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
          description: "Array of items to store. Order matters — create entities before referencing them in facts or relationships.",
        },
      },
      required: ["items"],
    },
  },
  handle: handleRemember,
};

async function handleRemember(input: Record<string, unknown>, traceId: string): Promise<ToolResult> {
  const result = v.safeParse(rememberInputSchema, input);
  if (!result.success) {
    return { content: formatValidationError(result.issues), isError: true };
  }

  const results: string[] = [];
  for (const item of result.output.items) {
    try {
      const itemResult = await storeItem(item, traceId);
      results.push(itemResult.isError ? `ERROR: ${itemResult.content}` : itemResult.content);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push(`ERROR: ${item.type} failed: ${message}`);
    }
  }

  const errorCount = results.filter((r) => r.startsWith("ERROR:")).length;
  const successCount = results.length - errorCount;
  if (errorCount > 0) {
    const summary = `${successCount} succeeded, ${errorCount} failed:`;
    return { content: `${summary}\n${results.join("\n")}`, isError: true };
  }

  return { content: results.join("\n") };
}

function storeItem(item: RememberItem, traceId: string): Promise<ToolResult> {
  switch (item.type) {
    case "entity":
      return storeEntity(item.entity, traceId);
    case "fact":
      return storeFact(item.fact, traceId);
    case "relationship":
      return storeRelationship(item.relationship, traceId);
    default:
      return Promise.resolve({ content: `Unknown type: ${(item as Record<string, unknown>).type}`, isError: true });
  }
}

function formatValidationError(issues: v.BaseIssue<unknown>[]): string {
  const details = issues.map((issue) => {
    const path = issue.path
      ? issue.path.map((segment: v.IssuePathItem) => String(segment.key)).join(".")
      : "root";
    return `${path}: ${issue.message}`;
  });

  return `Invalid remember input. ${ITEM_SCHEMA_HELP}

Errors: ${details.join("; ")}`;
}

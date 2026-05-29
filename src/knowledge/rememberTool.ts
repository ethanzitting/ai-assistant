import { storeEntity } from "@/knowledge/storeEntity.ts";
import { storeFact } from "@/knowledge/storeFact.ts";
import { storeRelationship } from "@/knowledge/storeRelationship.ts";
import { storePreference } from "@/knowledge/storePreference.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";

export const rememberTool: ToolDefinition = {
  schema: {
    name: "remember",
    description:
      "Store information from the conversation into the knowledge graph. Use for entities (people, places, orgs), facts about entities, relationships between entities, or user preferences.",
    input_schema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          enum: ["entity", "fact", "relationship", "preference"],
          description: "What kind of information to store",
        },
        entity: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["person", "organization", "place", "account"] },
            properties: { type: "object" },
          },
          description: "For type=entity: the entity to create or update",
        },
        fact: {
          type: "object",
          properties: {
            entity_name: { type: "string" },
            attribute: { type: "string" },
            value: { type: "string" },
          },
          description: "For type=fact: a fact about an entity",
        },
        relationship: {
          type: "object",
          properties: {
            entity_a_name: { type: "string" },
            entity_b_name: { type: "string" },
            type: { type: "string" },
          },
          description: "For type=relationship: a relationship between two entities",
        },
        preference: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: {},
          },
          description: "For type=preference: a user preference to store",
        },
      },
      required: ["type"],
    },
  },
  handle: handleRemember,
};

const VALID_DISCRIMINATORS = new Set(["entity", "fact", "relationship", "preference"]);

async function handleRemember(input: Record<string, unknown>): Promise<ToolResult> {
  const recordType = input.type as string;

  if (!VALID_DISCRIMINATORS.has(recordType)) {
    if (input.entity_a_name && input.entity_b_name) {
      return storeRelationship({
        entity_a_name: input.entity_a_name,
        entity_b_name: input.entity_b_name,
        type: recordType,
      });
    }
    return { content: `Unknown type: ${recordType}. Valid types: entity, fact, relationship, preference`, isError: true };
  }

  switch (recordType) {
    case "entity":
      return storeEntity(extractNested(input, "entity"));
    case "fact":
      return storeFact(extractNested(input, "fact"));
    case "relationship":
      return storeRelationship(extractRelationship(input));
    case "preference":
      return storePreference(extractNested(input, "preference"));
    default:
      return { content: `Unknown type: ${recordType}`, isError: true };
  }
}

function extractNested(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const nested = input[key];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  const { type: _, [key]: __, ...rest } = input;
  return rest;
}

function extractRelationship(input: Record<string, unknown>): Record<string, unknown> {
  const nested = input.relationship;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  const { type: _, relationship: relationshipType, ...rest } = input;
  if (typeof relationshipType === "string") {
    return { ...rest, type: relationshipType };
  }
  return rest;
}

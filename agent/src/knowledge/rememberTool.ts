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

async function handleRemember(input: Record<string, unknown>): Promise<ToolResult> {
  const recordType = input.type as string;

  switch (recordType) {
    case "entity":
      return storeEntity(input.entity as Record<string, unknown>);
    case "fact":
      return storeFact(input.fact as Record<string, unknown>);
    case "relationship":
      return storeRelationship(input.relationship as Record<string, unknown>);
    case "preference":
      return storePreference(input.preference as Record<string, unknown>);
    default:
      return { content: `Unknown type: ${recordType}`, isError: true };
  }
}

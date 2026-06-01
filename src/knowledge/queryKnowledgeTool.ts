import { searchEntities } from "@/knowledge/searchEntities.ts";
import { findCurrentFacts } from "@/knowledge/findCurrentFacts.ts";
import { findRelationships } from "@/knowledge/findRelationships.ts";
import { formatKnowledgeResults } from "@/knowledge/formatKnowledgeResults.ts";
import { queryKnowledgeInputSchema } from "@/knowledge/queryKnowledgeSchema.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export const queryKnowledgeTool: ToolDefinition = {
  schema: {
    name: "query_knowledge",
    description:
      "Search the knowledge graph for entities, facts, and relationships. Use for any question about people, places, organizations, or stored information.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Entity name or keyword(s) to search for. Use short terms — a person's name, place, or topic — not full sentences.",
        },
        entity_type: {
          type: "string",
          enum: ["person", "organization", "place", "account"],
          description: "Filter by entity type",
        },
        include_historical: {
          type: "boolean",
          description:
            "Include facts that are no longer current (have a valid_until date). Defaults to false.",
        },
      },
      required: ["query"],
    },
  },
  handle: handleQueryKnowledge,
};

async function handleQueryKnowledge(
  input: Record<string, unknown>,
  traceId: string,
): Promise<{ content: string; isError?: boolean }> {
  const parsed = parseToolInput(
    queryKnowledgeInputSchema,
    input,
    '{ query: "person name or keyword", entity_type?: "person"|"organization"|"place"|"account", include_historical?: true }',
  );
  if (!parsed.success) return parsed.error;

  const { query, entity_type: entityType, include_historical } = parsed.data;
  const shouldIncludeHistorical = include_historical ?? false;

  const matchingEntities = await searchEntities(query, entityType);
  await trace(traceId, "knowledge.query", {
    query,
    entityType,
    matchCount: matchingEntities.length,
  });

  if (matchingEntities.length === 0) {
    return { content: "No matching entities found." };
  }

  const entityIds = matchingEntities.map((entity) => entity.id);
  const facts = await findCurrentFacts(entityIds, shouldIncludeHistorical);
  const relationships = await findRelationships(entityIds);

  return { content: formatKnowledgeResults(matchingEntities, facts, relationships) };
}

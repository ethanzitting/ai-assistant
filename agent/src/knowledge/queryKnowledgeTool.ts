import { searchEntities } from "@/knowledge/searchEntities.ts";
import { findCurrentFacts } from "@/knowledge/findCurrentFacts.ts";
import { findRelationships } from "@/knowledge/findRelationships.ts";
import { formatKnowledgeResults } from "@/knowledge/formatKnowledgeResults.ts";
import type { ToolDefinition } from "@/tools/toolTypes.ts";

export const queryKnowledge: ToolDefinition = {
  schema: {
    name: "query_knowledge",
    description:
      "Search the knowledge graph for entities, facts, and relationships. Use for any question about people, places, organizations, or stored information.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Natural language question or search term",
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
): Promise<{ content: string; isError?: boolean }> {
  const searchQuery = input.query as string;
  const entityType = input.entity_type as string | undefined;
  const includeHistorical = (input.include_historical as boolean) ?? false;

  const matchingEntities = await searchEntities(searchQuery, entityType);
  if (matchingEntities.length === 0) {
    return { content: "No matching entities found." };
  }

  const entityIds = matchingEntities.map((entity) => entity.id);
  const facts = await findCurrentFacts(entityIds, includeHistorical);
  const relationships = await findRelationships(entityIds);

  return { content: formatKnowledgeResults(matchingEntities, facts, relationships) };
}

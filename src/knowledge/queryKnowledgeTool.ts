import { hybridSearch } from "@/knowledge/hybridSearch.ts";
import { findCurrentFacts } from "@/knowledge/findCurrentFacts.ts";
import { findRelationships } from "@/knowledge/findRelationships.ts";
import { formatKnowledgeResults } from "@/knowledge/formatKnowledgeResults.ts";
import { queryKnowledgeInputSchema } from "@/knowledge/queryKnowledgeSchema.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { MAX_FACTS_PER_ENTITY } from "@/embeddings/searchConfig.ts";
import type { ToolDefinition } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export const queryKnowledgeTool: ToolDefinition = {
  schema: {
    name: "query_knowledge",
    description:
      "Search the knowledge graph for entities, facts, and relationships about people, places, organizations, and the user's world. Semantic search — a natural-language question, a name, or topic keywords all work (e.g. \"Dana's medications\", \"who is Sam\"). Returns the most relevant facts per entity, not everything stored; for a complete picture of one entity, set include_all_facts: true rather than issuing many narrow queries. Always check existing knowledge before creating duplicates with remember.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "A natural-language question or keywords describing what you're looking for.",
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
        include_all_facts: {
          type: "boolean",
          description:
            "Set true when the user wants a complete picture of an entity (\"tell me everything about X\", \"what do you know about Y\"): returns every fact on each matched entity instead of only the query-relevant ones, which are otherwise capped per entity. One such call beats many narrow queries. Leave false for specific questions. Defaults to false.",
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
    '{ query: "natural-language question or keywords", entity_type?: "person"|"organization"|"place"|"account", include_historical?: true }',
  );
  if (!parsed.success) return parsed.error;

  const { query, entity_type: entityType, include_historical, include_all_facts } = parsed.data;
  const shouldIncludeHistorical = include_historical ?? false;
  const maxFactsPerEntity = include_all_facts ? Number.MAX_SAFE_INTEGER : MAX_FACTS_PER_ENTITY;

  const queryVector = await safeEmbed(query, "search-query");
  const { entities, relevantFactIds } = await hybridSearch(query, queryVector, entityType);

  await trace(traceId, "knowledge.query", {
    query,
    entityType,
    matchCount: entities.length,
    relevantFacts: relevantFactIds.size,
    semantic: queryVector !== null,
  });

  if (entities.length === 0) {
    return {
      content:
        `Nothing in the knowledge graph matches "${query}". Do not retry the same search — the information isn't stored. Try a different angle, or move on.`,
    };
  }

  const entityIds = entities.map((entity) => entity.id);
  const facts = await findCurrentFacts(entityIds, shouldIncludeHistorical);
  const relationships = await findRelationships(entityIds);

  const formatted = formatKnowledgeResults({
    entities,
    facts,
    relationships,
    relevantFactIds,
    maxFactsPerEntity,
  });
  return {
    content: `${formatted}\n\nFor original documents, photos, or transcripts, use search_archives.`,
  };
}

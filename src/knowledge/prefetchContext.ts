import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { hybridSearch } from "@/knowledge/hybridSearch.ts";
import { findCurrentFacts } from "@/knowledge/findCurrentFacts.ts";
import { searchArchivesByVector } from "@/archive/searchArchivesByVector.ts";
import { warn } from "@/logger.ts";
import type { EntityRecord } from "@/knowledge/searchEntities.ts";
import type { FactRecord } from "@/knowledge/findCurrentFacts.ts";
import type { ArchiveHit } from "@/archive/searchArchivesByVector.ts";

const ENTITY_LIMIT = 3;
const FACT_LIMIT = 5;
const ARCHIVE_LIMIT = 2;

export async function prefetchContext(userMessage: string): Promise<string | null> {
  try {
    return await buildPrefetch(userMessage);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    warn("prefetch", "Prefetch failed, continuing without context", { error: message });
    return null;
  }
}

async function buildPrefetch(userMessage: string): Promise<string | null> {
  const queryVector = await safeEmbed(userMessage, "search-query");

  const [knowledgeResult, archiveHits] = await Promise.all([
    hybridSearch(userMessage, queryVector),
    queryVector ? searchArchivesByVector(queryVector) : Promise.resolve([]),
  ]);

  const { entities, relevantFactIds } = knowledgeResult;

  if (entities.length === 0 && archiveHits.length === 0) return null;

  const topEntities = entities.slice(0, ENTITY_LIMIT);
  const remainingEntityCount = entities.length - topEntities.length;

  const topEntityIds = new Set(topEntities.map((entity) => entity.id));
  const facts = topEntityIds.size > 0
    ? await findCurrentFacts([...topEntityIds], false)
    : [];
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));

  // relevantFactIds preserves insertion order from hybridSearch (cosine distance ascending),
  // so iterating it yields facts in semantic relevance order, not DB alphabetical order.
  const topFacts: FactRecord[] = [];
  for (const factId of relevantFactIds) {
    if (topFacts.length >= FACT_LIMIT) break;
    const fact = factsById.get(factId);
    if (fact) topFacts.push(fact);
  }
  const remainingFactCount = Math.max(0, relevantFactIds.size - topFacts.length);

  const topArchives = archiveHits.slice(0, ARCHIVE_LIMIT);
  const remainingArchiveCount = archiveHits.length - topArchives.length;

  const entityNameById = new Map(entities.map((entity) => [entity.id, entity.name]));

  return formatPrefetch({
    topEntities,
    remainingEntityCount,
    topFacts,
    remainingFactCount,
    topArchives,
    remainingArchiveCount,
    entityNameById,
  });
}

interface PrefetchData {
  topEntities: EntityRecord[];
  remainingEntityCount: number;
  topFacts: FactRecord[];
  remainingFactCount: number;
  topArchives: ArchiveHit[];
  remainingArchiveCount: number;
  entityNameById: Map<string, string>;
}

function formatPrefetch(data: PrefetchData): string | null {
  const sections: string[] = [];

  if (data.topEntities.length > 0) {
    const labels = data.topEntities.map((entity) => `${entity.name} (${entity.type})`);
    let line = `Relevant entities: ${labels.join(", ")}`;
    if (data.remainingEntityCount > 0) {
      line += ` — ${data.remainingEntityCount} more may be relevant (query_knowledge)`;
    }
    sections.push(line);
  }

  if (data.topFacts.length > 0) {
    const lines = data.topFacts.map((fact) => {
      const entityName = data.entityNameById.get(fact.entity_id) ?? "unknown";
      return `- ${entityName} > ${fact.attribute}: ${fact.value}`;
    });
    let block = `Relevant facts:\n${lines.join("\n")}`;
    if (data.remainingFactCount > 0) {
      block += `\n— ${data.remainingFactCount} more facts may be relevant (query_knowledge)`;
    }
    sections.push(block);
  }

  if (data.topArchives.length > 0) {
    const labels = data.topArchives.map((hit) => {
      const label = hit.original_filename ?? hit.archived_file_id;
      return `${label} (${hit.source_type})`;
    });
    let line = `Relevant archives: ${labels.join(", ")}`;
    if (data.remainingArchiveCount > 0) {
      line += ` — ${data.remainingArchiveCount} more may be relevant (search_archives)`;
    }
    sections.push(line);
  }

  if (sections.length === 0) return null;

  return `[CONTEXT: Knowledge Graph Prefetch]\n${sections.join("\n\n")}\n[/CONTEXT]`;
}

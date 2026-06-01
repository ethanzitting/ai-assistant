import { db } from "@/db.ts";
import { searchEntities, type EntityRecord } from "@/knowledge/searchEntities.ts";
import { loadEntitiesByIds } from "@/knowledge/loadEntitiesByIds.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import {
  DISTANCE_THRESHOLD,
  ENTITY_MATCH_LIMIT,
  FACT_MATCH_LIMIT,
  MAX_ENTITIES,
} from "@/embeddings/searchConfig.ts";

export interface HybridSearchResult {
  // Entities ordered by relevance (fact matches first, then entity-vector, then keyword).
  // Loaded here so the relevance ordering is owned in one place and never crosses a module
  // boundary as an implicit "keep these ids in order" contract.
  entities: EntityRecord[];
  // Ids of facts that matched the query semantically — used to rank/filter facts in the result
  // so we surface the relevant ones instead of dumping every fact on an entity.
  relevantFactIds: Set<string>;
}

// Hybrid retrieval over the knowledge graph: a semantic leg over fact embeddings (the
// main signal — finds the facts actually relevant to the query), a semantic leg over
// entity embeddings (catches "tell me about X" with few facts), and a keyword leg
// (recall booster + fallback when embeddings are absent). queryVector is null when query
// embedding failed — then it degrades to keyword-only.
export async function hybridSearch(
  query: string,
  queryVector: number[] | null,
  entityType?: string,
): Promise<HybridSearchResult> {
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const relevantFactIds = new Set<string>();

  const addEntity = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  };

  if (queryVector) {
    const queryVectorLiteral = toVectorLiteral(queryVector);

    const factRows = entityType
      ? await db`
          SELECT f.id, f.entity_id
          FROM facts f JOIN entities e ON e.id = f.entity_id
          WHERE f.valid_until IS NULL AND f.embedding IS NOT NULL
            AND f.embedding_model = ${EMBEDDING_MODEL_TAG} AND e.type = ${entityType}
            AND (f.embedding <=> ${queryVectorLiteral}::vector) < ${DISTANCE_THRESHOLD}
          ORDER BY f.embedding <=> ${queryVectorLiteral}::vector
          LIMIT ${FACT_MATCH_LIMIT}`
      : await db`
          SELECT f.id, f.entity_id
          FROM facts f
          WHERE f.valid_until IS NULL AND f.embedding IS NOT NULL
            AND f.embedding_model = ${EMBEDDING_MODEL_TAG}
            AND (f.embedding <=> ${queryVectorLiteral}::vector) < ${DISTANCE_THRESHOLD}
          ORDER BY f.embedding <=> ${queryVectorLiteral}::vector
          LIMIT ${FACT_MATCH_LIMIT}`;

    for (const row of factRows) {
      relevantFactIds.add(row.id);
      addEntity(row.entity_id);
    }

    const entityRows = entityType
      ? await db`
          SELECT id FROM entities
          WHERE embedding IS NOT NULL AND embedding_model = ${EMBEDDING_MODEL_TAG} AND type = ${entityType}
            AND (embedding <=> ${queryVectorLiteral}::vector) < ${DISTANCE_THRESHOLD}
          ORDER BY embedding <=> ${queryVectorLiteral}::vector
          LIMIT ${ENTITY_MATCH_LIMIT}`
      : await db`
          SELECT id FROM entities
          WHERE embedding IS NOT NULL AND embedding_model = ${EMBEDDING_MODEL_TAG}
            AND (embedding <=> ${queryVectorLiteral}::vector) < ${DISTANCE_THRESHOLD}
          ORDER BY embedding <=> ${queryVectorLiteral}::vector
          LIMIT ${ENTITY_MATCH_LIMIT}`;

    for (const row of entityRows) addEntity(row.id);
  }

  // Keyword leg always runs — boosts recall and covers rows without embeddings.
  const keywordEntities = await searchEntities(query, entityType);
  for (const entity of keywordEntities) addEntity(entity.id);

  // Load in relevance order so the ordering invariant never leaves this module.
  const entities = await loadEntitiesByIds(orderedIds.slice(0, MAX_ENTITIES));
  return { entities, relevantFactIds };
}

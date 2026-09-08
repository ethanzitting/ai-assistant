import { db } from "@/db.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { EVENT_DEDUP_THRESHOLD } from "@/embeddings/searchConfig.ts";
import type { EventData } from "@/events/manageEventsSchema.ts";

interface DuplicateEvent {
  id: string;
  title: string;
  distance: number;
}

export async function findDuplicateEvent(
  event: EventData,
  embeddingLiteral: string,
): Promise<DuplicateEvent | null> {
  const anchorDate = event.dtstart ?? event.deadline;
  const rows = anchorDate
    ? await db`
        SELECT id, title, (embedding <=> ${embeddingLiteral}::vector) AS distance
        FROM events
        WHERE status = 'active' AND embedding IS NOT NULL
          AND embedding_model = ${EMBEDDING_MODEL_TAG}
          AND (embedding <=> ${embeddingLiteral}::vector) < ${EVENT_DEDUP_THRESHOLD}
          AND (
            (dtstart IS NOT NULL AND dtstart::date = ${anchorDate}::date)
            OR (deadline IS NOT NULL AND deadline::date = ${anchorDate}::date)
          )
        ORDER BY embedding <=> ${embeddingLiteral}::vector LIMIT 1
      `
    : await db`
        SELECT id, title, (embedding <=> ${embeddingLiteral}::vector) AS distance
        FROM events
        WHERE status = 'active' AND embedding IS NOT NULL
          AND embedding_model = ${EMBEDDING_MODEL_TAG}
          AND (embedding <=> ${embeddingLiteral}::vector) < ${EVENT_DEDUP_THRESHOLD}
          AND dtstart IS NULL AND deadline IS NULL
        ORDER BY embedding <=> ${embeddingLiteral}::vector LIMIT 1
      `;

  if (rows.length === 0) return null;
  return {
    id: rows[0].id,
    title: rows[0].title,
    distance: Number(rows[0].distance),
  };
}

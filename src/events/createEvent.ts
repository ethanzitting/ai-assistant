import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import type { EventData } from "@/events/manageEventsSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { EVENT_DEDUP_THRESHOLD } from "@/embeddings/searchConfig.ts";
import { trace } from "@/trace.ts";

export async function createEvent(
  event: EventData,
  traceId: string,
): Promise<ToolResult> {
  const embedding = await safeEmbed(event.title, "stored-document");
  const embeddingLiteral = embedding ? toVectorLiteral(embedding) : null;

  if (embeddingLiteral) {
    const duplicate = await findDuplicate(event, embeddingLiteral);
    if (duplicate) {
      await trace(traceId, "event.dedup", {
        existingId: duplicate.id,
        existingTitle: duplicate.title,
        distance: duplicate.distance,
      });
      return {
        content: `Event "${duplicate.title}" already exists on that date (id: ${duplicate.id}) — not created.`,
      };
    }
  }

  const recurrenceRule = event.recurrence_rule
    ? db.json(event.recurrence_rule as never)
    : null;

  const embeddingModel = embeddingLiteral ? EMBEDDING_MODEL_TAG : null;

  const result = await db`
    INSERT INTO events (title, type, priority, dtstart, dtend, deadline,
      lead_time_days, recurrence_rule, category, next_due_at,
      embedding, embedding_model)
    VALUES (
      ${event.title},
      ${event.type},
      ${event.priority ?? "medium"},
      ${event.dtstart ?? null},
      ${event.dtend ?? null},
      ${event.deadline ?? null},
      ${event.lead_time_days ?? null},
      ${recurrenceRule},
      ${event.category ?? null},
      ${computeNextDueAt(event)},
      ${embeddingLiteral}::vector,
      ${embeddingModel}
    )
    RETURNING id, title
  `;

  await trace(traceId, "db.insert", { table: "events", id: result[0].id, title: result[0].title });
  return { content: `Created event "${result[0].title}" (id: ${result[0].id}).` };
}

async function findDuplicate(
  event: EventData,
  embeddingLiteral: string,
): Promise<{ id: string; title: string; distance: number } | null> {
  const anchorDate = event.dtstart ?? event.deadline;

  const rows = anchorDate
    ? await db`
        SELECT id, title, (embedding <=> ${embeddingLiteral}::vector) AS distance
        FROM events
        WHERE status = 'active'
          AND embedding IS NOT NULL
          AND embedding_model = ${EMBEDDING_MODEL_TAG}
          AND (embedding <=> ${embeddingLiteral}::vector) < ${EVENT_DEDUP_THRESHOLD}
          AND (
            (dtstart IS NOT NULL AND dtstart::date = ${anchorDate}::date)
            OR (deadline IS NOT NULL AND deadline::date = ${anchorDate}::date)
          )
        ORDER BY embedding <=> ${embeddingLiteral}::vector
        LIMIT 1
      `
    : await db`
        SELECT id, title, (embedding <=> ${embeddingLiteral}::vector) AS distance
        FROM events
        WHERE status = 'active'
          AND embedding IS NOT NULL
          AND embedding_model = ${EMBEDDING_MODEL_TAG}
          AND (embedding <=> ${embeddingLiteral}::vector) < ${EVENT_DEDUP_THRESHOLD}
          AND dtstart IS NULL
          AND deadline IS NULL
        ORDER BY embedding <=> ${embeddingLiteral}::vector
        LIMIT 1
      `;

  if (rows.length === 0) return null;
  return { id: rows[0].id, title: rows[0].title, distance: Number(rows[0].distance) };
}

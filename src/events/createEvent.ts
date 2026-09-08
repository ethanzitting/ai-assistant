import { db } from "@/db.ts";
import { computeNextDueAt } from "@/events/computeNextDueAt.ts";
import { insertEventOccurrences } from "@/events/insertEventOccurrences.ts";
import type { EventData } from "@/events/manageEventsSchema.ts";
import { prepareEventData } from "@/events/prepareEventData.ts";
import { findDuplicateEvent } from "@/events/findDuplicateEvent.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import { trace } from "@/trace.ts";

export async function createEvent(
  event: EventData,
  traceId: string,
): Promise<ToolResult> {
  let prepared;
  try {
    prepared = prepareEventData(event);
  } catch (err: unknown) {
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }

  const embedding = await safeEmbed(prepared.title, "stored-document");
  const embeddingLiteral = embedding ? toVectorLiteral(embedding) : null;

  if (embeddingLiteral) {
    const duplicate = await findDuplicateEvent(prepared, embeddingLiteral);
    if (duplicate) {
      await trace(traceId, "event.dedup", {
        existingId: duplicate.id,
        existingTitle: duplicate.title,
        distance: duplicate.distance,
      });
      return {
        content:
          `Event "${duplicate.title}" already exists on that date (id: ${duplicate.id}) — not created.`,
      };
    }
  }

  const embeddingModel = embeddingLiteral ? EMBEDDING_MODEL_TAG : null;
  const eventAt = prepared.type === "deadline"
    ? prepared.deadline!
    : prepared.dtstart!;
  const nextDueAt = prepared.type === "fixed_recurring"
    ? computeNextDueAt(prepared.recurrence_rule!, eventAt, prepared.timezone)
    : null;

  let created!: { id: string; title: string };
  await db.begin(async (tx) => {
    const result = await tx`
      INSERT INTO events (title, type, priority, dtstart, dtend, deadline,
        lead_time_days, reminder_offsets_minutes, recurrence_rule, category,
        timezone, next_due_at, embedding, embedding_model)
      VALUES (
        ${prepared.title},
        ${prepared.type},
        ${prepared.priority ?? "medium"},
        ${prepared.dtstart ?? null},
        ${prepared.dtend ?? null},
        ${prepared.deadline ?? null},
        ${prepared.lead_time_days ?? null},
        ${tx.json(prepared.reminder_offsets_minutes as never)},
        ${
      prepared.recurrence_rule
        ? tx.json(prepared.recurrence_rule as never)
        : null
    },
        ${prepared.category ?? null},
        ${prepared.timezone},
        ${nextDueAt},
        ${embeddingLiteral}::vector,
        ${embeddingModel}
      )
      RETURNING id, title
    `;
    created = result[0] as { id: string; title: string };
    await insertEventOccurrences(
      tx,
      created.id,
      eventAt,
      prepared.reminder_offsets_minutes,
    );
  });

  await trace(traceId, "db.insert", {
    table: "events",
    id: created.id,
    title: created.title,
  });
  return {
    content: `Created reminder "${created.title}" (id: ${created.id}).`,
  };
}

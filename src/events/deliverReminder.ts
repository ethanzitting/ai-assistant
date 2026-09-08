import { db } from "@/db.ts";
import { persistMessage } from "@/conversationHistory.ts";
import type { ClaimedReminder } from "@/events/claimDueReminders.ts";
import type { ChatRow } from "@/telegram/chatRegistry.ts";
import { sendTelegramMessage } from "@/telegram/sendTelegramMessage.ts";
import { warn } from "@/logger.ts";
import { withRetry } from "@/retry/withRetry.ts";

export async function deliverReminder(
  reminder: ClaimedReminder,
  chat: ChatRow,
): Promise<boolean> {
  const text = formatReminder(reminder);

  try {
    await withRetry(() => sendTelegramMessage(chat.telegram_chat_id, text), {
      maxRetries: 2,
    });
  } catch (err: unknown) {
    await markFailed(reminder.id, err);
    return false;
  }

  await markDelivered(reminder);
  try {
    await persistMessage({
      role: "assistant",
      content: text,
      chatId: chat.id,
      metadata: {
        reminder: true,
        event_id: reminder.event_id,
        occurrence_id: reminder.occurrence_id,
      },
    });
  } catch (err: unknown) {
    warn("reminder", "Delivered reminder but could not persist conversation", {
      reminderId: reminder.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

function formatReminder(reminder: ClaimedReminder): string {
  const prefix = reminder.priority === "high" ? "🔥 Reminder" : "Reminder";
  if (reminder.offset_minutes === 0) return `${prefix}: ${reminder.title}`;

  const eventTime = new Intl.DateTimeFormat("en-US", {
    timeZone: reminder.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(reminder.event_at);
  return `${prefix}: ${reminder.title}\nDue ${eventTime}`;
}

async function markDelivered(reminder: ClaimedReminder): Promise<void> {
  await db.begin(async (tx) => {
    await tx`
      UPDATE reminders SET status = 'sent', sent_at = now(), claimed_at = NULL
      WHERE id = ${reminder.id}
    `;
    const resolveAfterDelivery = reminder.priority === "low" &&
      reminder.event_type !== "interval_recurring";
    await tx`
      UPDATE event_occurrences
      SET status = ${resolveAfterDelivery ? "resolved" : "unresolved"},
        notified_at = COALESCE(notified_at, now()),
        resolved_at = ${resolveAfterDelivery ? new Date() : null}
      WHERE id = ${reminder.occurrence_id} AND status <> 'resolved'
    `;

    if (resolveAfterDelivery) {
      await completeFinishedOneTimeEvent(tx, reminder.event_id);
    }

    if (reminder.priority === "high") {
      await tx`
        INSERT INTO reminders (event_id, occurrence_id, remind_at)
        SELECT ${reminder.event_id}, ${reminder.occurrence_id}, now() + interval '2 hours'
        FROM event_occurrences
        WHERE id = ${reminder.occurrence_id} AND status <> 'resolved'
        ON CONFLICT DO NOTHING
      `;
    }
  });
}

async function completeFinishedOneTimeEvent(
  sql: any,
  eventId: string,
): Promise<void> {
  await sql`
    UPDATE events e SET status = 'completed', last_completed_at = now()
    WHERE e.id = ${eventId} AND e.type IN ('fixed', 'deadline')
      AND NOT EXISTS (
        SELECT 1 FROM event_occurrences o
        WHERE o.event_id = e.id AND o.status IN ('pending', 'unresolved')
      )
  `;
}

async function markFailed(reminderId: string, err: unknown): Promise<void> {
  await db`
    UPDATE reminders
    SET status = 'pending', claimed_at = NULL, remind_at = now() + interval '5 minutes',
      last_error = ${err instanceof Error ? err.message : String(err)}
    WHERE id = ${reminderId}
  `;
}

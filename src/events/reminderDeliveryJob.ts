import { claimDueReminders } from "@/events/claimDueReminders.ts";
import { deliverReminder } from "@/events/deliverReminder.ts";
import { materializeDueRecurringEvents } from "@/events/materializeDueRecurringEvents.ts";
import { getPrivateChat } from "@/telegram/chatRegistry.ts";
import { getBotInstance } from "@/telegram/sendTelegramMessage.ts";
import { warn } from "@/logger.ts";

export async function reminderDeliveryJob(): Promise<Record<string, unknown>> {
  const materialized = await materializeDueRecurringEvents();
  const chat = await getPrivateChat();
  if (!chat || !getBotInstance()) {
    return { skipped: "telegram_unavailable", materialized };
  }

  const reminders = await claimDueReminders();
  let delivered = 0;
  for (const reminder of reminders) {
    try {
      if (await deliverReminder(reminder, chat)) delivered++;
    } catch (err: unknown) {
      warn("reminder", "Could not finish reminder delivery", {
        reminderId: reminder.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { claimed: reminders.length, delivered, materialized };
}

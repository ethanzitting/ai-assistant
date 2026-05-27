import { db } from "@/db.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";

export async function updateEvent(
  eventId: string,
  eventData: Record<string, unknown>,
): Promise<ToolResult> {
  const setClauses: string[] = [];
  const allowedFields = [
    "title", "type", "priority", "dtstart", "dtend",
    "deadline", "lead_time_days", "category", "status",
  ];

  for (const field of allowedFields) {
    if (field in eventData) {
      setClauses.push(field);
    }
  }

  if (setClauses.length === 0) {
    return { content: "No valid fields to update.", isError: true };
  }

  await db`
    UPDATE events SET
      title = COALESCE(${(eventData.title as string) ?? null}, title),
      priority = COALESCE(${(eventData.priority as string) ?? null}, priority),
      dtstart = COALESCE(${(eventData.dtstart as string) ?? null}, dtstart),
      dtend = COALESCE(${(eventData.dtend as string) ?? null}, dtend),
      deadline = COALESCE(${(eventData.deadline as string) ?? null}, deadline),
      category = COALESCE(${(eventData.category as string) ?? null}, category)
    WHERE id = ${eventId}
  `;

  return { content: `Updated event ${eventId}.` };
}

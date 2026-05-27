import type { ToolDefinition, ToolResult } from "@/tools/types.ts";
import {
  createEvent,
  updateEvent,
  listEvents,
  completeEvent,
  dropEvent,
} from "@/tools/event-operations.ts";

export const manageEvents: ToolDefinition = {
  schema: {
    name: "manage_events",
    description:
      "Create, update, list, complete, or drop events and reminders. Use for tasks like setting reminders, tracking deadlines, and managing recurring items.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "list", "complete", "drop"],
          description: "The action to perform",
        },
        event: {
          type: "object",
          properties: {
            title: { type: "string" },
            type: {
              type: "string",
              enum: ["fixed", "deadline", "fixed_recurring", "interval_recurring"],
            },
            priority: { type: "string", enum: ["high", "medium", "low"] },
            dtstart: { type: "string", description: "ISO 8601 datetime" },
            dtend: { type: "string", description: "ISO 8601 datetime" },
            deadline: { type: "string", description: "ISO 8601 datetime" },
            lead_time_days: { type: "number" },
            recurrence_rule: {
              type: "object",
              properties: {
                interval: { type: "number" },
                unit: { type: "string", enum: ["days", "weeks", "months"] },
                from_completion: { type: "boolean" },
              },
            },
            category: { type: "string" },
          },
          description: "Event details for create/update actions",
        },
        event_id: { type: "string", description: "Event ID for update/complete/drop" },
        filter: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["active", "completed", "missed", "dropped"] },
            type: { type: "string" },
            from: { type: "string", description: "ISO 8601 date — list events due after this" },
            to: { type: "string", description: "ISO 8601 date — list events due before this" },
          },
          description: "Filters for the list action",
        },
      },
      required: ["action"],
    },
  },
  handle: handleManageEvents,
};

async function handleManageEvents(input: Record<string, unknown>): Promise<ToolResult> {
  const action = input.action as string;
  const eventData = input.event as Record<string, unknown> | undefined;
  const eventId = input.event_id as string | undefined;
  const filter = input.filter as Record<string, unknown> | undefined;

  switch (action) {
    case "create":
      if (!eventData) return { content: "Missing event data for create.", isError: true };
      return createEvent(eventData);
    case "update":
      if (!eventId || !eventData) return { content: "Missing event_id or event data for update.", isError: true };
      return updateEvent(eventId, eventData);
    case "list":
      return listEvents(filter ?? {});
    case "complete":
      if (!eventId) return { content: "Missing event_id for complete.", isError: true };
      return completeEvent(eventId);
    case "drop":
      if (!eventId) return { content: "Missing event_id for drop.", isError: true };
      return dropEvent(eventId);
    default:
      return { content: `Unknown action: ${action}`, isError: true };
  }
}

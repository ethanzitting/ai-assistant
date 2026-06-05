import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { createEvent } from "@/events/createEvent.ts";
import { updateEvent } from "@/events/updateEvent.ts";
import { listEvents } from "@/events/listEvents.ts";
import { completeEvent } from "@/events/completeEvent.ts";
import { dropEvent } from "@/events/dropEvent.ts";
import { manageEventsInputSchema } from "@/events/manageEventsSchema.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";

export const manageEventsTool: ToolDefinition = {
  schema: {
    name: "manage_events",
    description:
      "Create, update, list, complete, or drop events and reminders. Use for setting reminders, tracking deadlines, and managing recurring items. Parse natural language dates from the user's messages into ISO 8601.",
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

const SCHEMA_HELP = `action="create":   { action: "create", event: { title, type, priority?, dtstart?, ... } }
action="update":   { action: "update", event_id: "...", event: { title?, priority?, ... } }
action="list":     { action: "list", filter?: { status?, from?, to? } }
action="complete": { action: "complete", event_id: "..." }
action="drop":     { action: "drop", event_id: "..." }`;

async function handleManageEvents(input: Record<string, unknown>, traceId: string): Promise<ToolResult> {
  const parsed = parseToolInput(manageEventsInputSchema, input, SCHEMA_HELP);
  if (!parsed.success) return parsed.error;

  const data = parsed.data;
  switch (data.action) {
    case "create":
      return createEvent(data.event, traceId);
    case "update":
      return updateEvent(data.event_id, data.event, traceId);
    case "list":
      return listEvents(data.filter ?? {});
    case "complete":
      return completeEvent(data.event_id, traceId);
    case "drop":
      return dropEvent(data.event_id, traceId);
  }
}

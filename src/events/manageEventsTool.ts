import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { createEvent } from "@/events/createEvent.ts";
import { updateEvent } from "@/events/updateEvent.ts";
import { listEvents } from "@/events/listEvents.ts";
import { completeEvent } from "@/events/completeEvent.ts";
import { dropEvent } from "@/events/dropEvent.ts";
import { dismissEvent } from "@/events/dismissEvent.ts";
import { eventToolResult } from "@/events/eventToolResult.ts";
import {
  type EventData,
  manageEventsInputSchema,
} from "@/events/manageEventsSchema.ts";
import { manageEventsToolSchema } from "@/events/manageEventsToolSchema.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";

export const manageEventsTool: ToolDefinition = {
  schema: manageEventsToolSchema,
  handle: handleManageEvents,
};

const SCHEMA_HELP =
  `create: { action: "create", event: {...} } or { action: "create", events: [...] }
update: { action: "update", event_id: "...", event: {...} }
list: { action: "list", filter?: {...} }
complete: { action: "complete", event_id: "..." } resolves the current occurrence
drop: { action: "drop", event_id: "..." } deletes future occurrences
dismiss: { action: "dismiss", event_id: "..." } clears a missed reminder`;

async function handleManageEvents(
  input: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  const parsed = parseToolInput(manageEventsInputSchema, input, SCHEMA_HELP);
  if (!parsed.success) {
    return eventToolResult({
      operation: "invalid",
      changed: false,
      reason: parsed.error.content,
    });
  }

  const data = parsed.data;
  switch (data.action) {
    case "create":
      return createEvents(data.event, data.events, traceId);
    case "update":
      return updateEvent(data.event_id, data.event, traceId);
    case "list":
      return listEvents(data.filter ?? {});
    case "complete":
      return completeEvent(data.event_id, traceId);
    case "drop":
      return dropEvent(data.event_id, traceId);
    case "dismiss":
      return dismissEvent(data.event_id, traceId);
  }
}

async function createEvents(
  event: EventData | undefined,
  events: EventData[] | undefined,
  traceId: string,
): Promise<ToolResult> {
  const requested = events ?? (event ? [event] : []);
  if (requested.length === 0) {
    return eventToolResult({
      operation: "create",
      changed: false,
      reason: "missing_event",
    });
  }

  const results: ToolResult[] = [];
  for (const item of requested) results.push(await createEvent(item, traceId));
  const itemResults = results.map((result) =>
    JSON.parse(result.content) as Record<string, unknown>
  );
  return eventToolResult({
    operation: "create",
    changed: results.some((result) => !result.isError),
    results: itemResults,
    reason: results.every((result) => result.isError)
      ? "no_event_created"
      : undefined,
  });
}

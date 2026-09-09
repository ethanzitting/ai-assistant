import type { ToolResult } from "@/tools/toolTypes.ts";

type EventOperation =
  | "create"
  | "update"
  | "list"
  | "complete"
  | "drop"
  | "dismiss"
  | "invalid";

interface EventToolResultArgs {
  operation: EventOperation;
  changed: boolean;
  eventId?: string;
  title?: string;
  status?: string;
  reason?: string;
  events?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
}

export function eventToolResult(args: EventToolResultArgs): ToolResult {
  const { reason, ...result } = args;
  return {
    content: JSON.stringify(reason ? { ...result, reason } : result),
    isError: Boolean(reason),
  };
}

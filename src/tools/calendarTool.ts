import type { ToolDefinition } from "@/tools/toolTypes.ts";

export const calendarTool: ToolDefinition = {
  schema: {
    name: "get_calendar",
    description:
      "Fetch calendar events for a date range from the locally synced Google Calendar data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        start_date: {
          type: "string",
          description: "Start of range (ISO 8601 date)",
        },
        end_date: {
          type: "string",
          description: "End of range (ISO 8601 date)",
        },
      },
      required: ["start_date", "end_date"],
    },
  },
  handle: async () => ({
    content:
      "Calendar sync is not yet configured (Version 2). No calendar data available.",
  }),
};

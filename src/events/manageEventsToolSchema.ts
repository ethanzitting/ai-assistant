const eventInputSchema = {
  type: "object" as const,
  properties: {
    title: { type: "string" },
    type: {
      type: "string",
      enum: ["fixed", "deadline", "fixed_recurring", "interval_recurring"],
    },
    priority: { type: "string", enum: ["high", "medium", "low"] },
    dtstart: {
      type: "string",
      description:
        "ISO date or datetime. A date without a time becomes 8:00 AM.",
    },
    dtend: { type: "string", description: "ISO 8601 datetime" },
    deadline: {
      type: "string",
      description:
        "ISO date or datetime. A date without a time becomes 8:00 AM.",
    },
    lead_time_days: { type: "number" },
    reminder_offsets_minutes: {
      type: "array",
      items: { type: "integer", minimum: 0 },
      description:
        "Independent deadline alerts this many minutes beforehand. Use 0 for the deadline itself.",
    },
    timezone: {
      type: "string",
      description: "IANA zone; defaults to America/Chicago.",
    },
    recurrence_rule: {
      type: "object",
      properties: {
        interval: { type: "integer", minimum: 1 },
        unit: { type: "string", enum: ["days", "weeks", "months", "years"] },
        from_completion: { type: "boolean" },
        monthly_weekday: {
          type: "object",
          properties: {
            ordinal: { type: "integer", enum: [1, 2, 3, 4, -1] },
            weekday: {
              type: "string",
              enum: [
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
              ],
            },
          },
          required: ["ordinal", "weekday"],
        },
        business_day: {
          type: "string",
          enum: ["first", "last"],
          description:
            "First or last Monday-Friday of the month; holidays are not excluded.",
        },
      },
      required: ["interval", "unit"],
    },
    category: { type: "string" },
  },
};

export const manageEventsToolSchema = {
  name: "manage_events",
  description:
    "Create, update, list, resolve, or delete reminders. Never create without a date; ask when unclear. Date-only values fire at 8:00 AM. Complete resolves only the current occurrence. Drop deletes the future series.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "list", "complete", "drop"],
      },
      event: eventInputSchema,
      events: {
        type: "array",
        items: { ...eventInputSchema, required: ["title", "type"] },
        description: "Batch for creating more than one reminder.",
      },
      event_id: {
        type: "string",
        description: "Event ID for update/complete/drop",
      },
      filter: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "completed", "missed", "dropped"],
          },
          type: { type: "string" },
          from: {
            type: "string",
            description: "ISO date; list reminders after this",
          },
          to: {
            type: "string",
            description: "ISO date; list reminders before this",
          },
        },
      },
    },
    required: ["action"],
  },
};

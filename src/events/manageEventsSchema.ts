import * as v from "valibot";

const nonEmptyString = () => v.pipe(v.string(), v.trim(), v.nonEmpty());
const positiveInteger = () => v.pipe(v.number(), v.integer(), v.minValue(1));
const nonNegativeInteger = () => v.pipe(v.number(), v.integer(), v.minValue(0));

const weekdaySchema = v.picklist([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const recurrenceRuleSchema = v.object({
  interval: positiveInteger(),
  unit: v.picklist(["days", "weeks", "months", "years"]),
  from_completion: v.optional(v.boolean()),
  monthly_weekday: v.optional(v.object({
    ordinal: v.picklist([1, 2, 3, 4, -1]),
    weekday: weekdaySchema,
  })),
  business_day: v.optional(v.picklist(["first", "last"])),
});

const eventDataSchema = v.object({
  title: nonEmptyString(),
  type: v.picklist([
    "fixed",
    "deadline",
    "fixed_recurring",
    "interval_recurring",
  ]),
  priority: v.optional(v.picklist(["high", "medium", "low"])),
  dtstart: v.optional(v.string()),
  dtend: v.optional(v.string()),
  deadline: v.optional(v.string()),
  lead_time_days: v.optional(nonNegativeInteger()),
  reminder_offsets_minutes: v.optional(v.array(nonNegativeInteger())),
  recurrence_rule: v.optional(recurrenceRuleSchema),
  category: v.optional(v.string()),
  timezone: v.optional(nonEmptyString()),
});

const createAction = v.object({
  action: v.literal("create"),
  event: v.optional(eventDataSchema),
  events: v.optional(v.array(eventDataSchema)),
});

const updateAction = v.object({
  action: v.literal("update"),
  event_id: nonEmptyString(),
  event: v.partial(eventDataSchema),
});

const listAction = v.object({
  action: v.literal("list"),
  filter: v.optional(v.object({
    status: v.optional(
      v.picklist(["active", "completed", "missed", "dropped"]),
    ),
    type: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  })),
});

const completeAction = v.object({
  action: v.literal("complete"),
  event_id: nonEmptyString(),
});

const dropAction = v.object({
  action: v.literal("drop"),
  event_id: nonEmptyString(),
});

export const manageEventsInputSchema = v.variant("action", [
  createAction,
  updateAction,
  listAction,
  completeAction,
  dropAction,
]);

export type ManageEventsInput = v.InferOutput<typeof manageEventsInputSchema>;
export type EventData = v.InferOutput<typeof eventDataSchema>;
export type EventDataPartial = v.InferOutput<typeof updateAction>["event"];
export type EventFilter = NonNullable<
  v.InferOutput<typeof listAction>["filter"]
>;
export type RecurrenceRule = v.InferOutput<typeof recurrenceRuleSchema>;

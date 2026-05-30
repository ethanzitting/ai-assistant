import * as v from "valibot";

const nonEmptyString = () => v.pipe(v.string(), v.trim(), v.nonEmpty());

const entityInput = v.object({
  type: v.literal("entity"),
  entity: v.object({
    name: nonEmptyString(),
    type: v.picklist(["person", "organization", "place", "account"]),
    properties: v.optional(v.record(v.string(), v.unknown())),
  }),
});

const factInput = v.object({
  type: v.literal("fact"),
  fact: v.object({
    entity_name: nonEmptyString(),
    attribute: nonEmptyString(),
    value: nonEmptyString(),
  }),
});

const relationshipInput = v.object({
  type: v.literal("relationship"),
  relationship: v.object({
    entity_a_name: nonEmptyString(),
    entity_b_name: nonEmptyString(),
    type: nonEmptyString(),
  }),
});

const preferenceInput = v.object({
  type: v.literal("preference"),
  preference: v.object({
    key: nonEmptyString(),
    value: v.unknown(),
  }),
});

const rememberItemSchema = v.variant("type", [
  entityInput,
  factInput,
  relationshipInput,
  preferenceInput,
]);

export const rememberInputSchema = v.object({
  items: v.pipe(v.array(rememberItemSchema), v.minLength(1)),
});

export type RememberItem = v.InferOutput<typeof rememberItemSchema>;
export type RememberInput = v.InferOutput<typeof rememberInputSchema>;
export type EntityInput = v.InferOutput<typeof entityInput>["entity"];
export type FactInput = v.InferOutput<typeof factInput>["fact"];
export type RelationshipInput = v.InferOutput<typeof relationshipInput>["relationship"];
export type PreferenceInput = v.InferOutput<typeof preferenceInput>["preference"];

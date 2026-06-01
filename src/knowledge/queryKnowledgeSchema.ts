import * as v from "valibot";

export const queryKnowledgeInputSchema = v.object({
  query: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  entity_type: v.optional(v.picklist(["person", "organization", "place", "account"])),
  include_historical: v.optional(v.boolean()),
});

export type QueryKnowledgeInput = v.InferOutput<typeof queryKnowledgeInputSchema>;

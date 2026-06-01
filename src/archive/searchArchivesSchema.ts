import * as v from "valibot";
import { SOURCE_TYPES } from "@/archive/sourceTypes.ts";

export const searchArchivesInputSchema = v.object({
  query: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  source_type: v.optional(v.picklist(SOURCE_TYPES)),
});

export type SearchArchivesInput = v.InferOutput<typeof searchArchivesInputSchema>;

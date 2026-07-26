// Stamped onto every archived_files row we describe, mirroring the embedding_model stamp on
// embedded rows: descriptions from different models aren't equivalent, so the tag is what lets
// the backfill re-describe only what's stale when this value changes.
export const VISION_MODEL = "claude-opus-4-6";

// Retrieval tuning knobs, grouped so recall/precision can be adjusted in one place.
// Genuinely local constants stay with their code (chunk sizes in chunkText, excerpt
// length in the archive tool) — only the dials you'd co-tune live here.

// Cosine-distance cutoff for treating a vector hit as relevant. pgvector's <=> returns
// 0 (identical) .. 2 (opposite); related pairs sit well below this. Tune against real
// data — too tight drops good hits, too loose returns noise.
export const DISTANCE_THRESHOLD = 0.75;

// query_knowledge
export const FACT_MATCH_LIMIT = 25; // top fact-vector hits considered
export const ENTITY_MATCH_LIMIT = 5; // top entity-vector hits considered
export const MAX_ENTITIES = 12; // max entities returned across all legs
export const MAX_FACTS_PER_ENTITY = 10; // facts shown per entity before "…and N more"

// search_archives
export const ARCHIVE_RESULT_LIMIT = 6; // max passages returned

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

// storeFact semantic dedup: when creating a *new* attribute, a fact within this cosine
// distance of an existing fact on the same entity is treated as a near-duplicate (the
// medication_droperidol / med_droperidol / medications_droperidol drift) and skipped.
//
// Calibrated against real data on a heavily-polluted entity: pure renames clustered at
// 0.023–0.035, the next genuinely-distinct fact was 0.096, and different medications
// (Haldol, Benadryl, Risperidone, Ativan) sat at 0.12–0.14. So 0.06 lands in the gap —
// it catches the renames with headroom while never merging distinct facts. Bias tight: a
// missed dedup costs one redundant attribute; a false match silently drops real info.
// Re-check against fresh data if the embedding model changes.
export const SEMANTIC_DEDUP_THRESHOLD = 0.06;

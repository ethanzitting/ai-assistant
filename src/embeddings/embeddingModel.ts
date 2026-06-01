// Embedding model identity, recorded on every stored vector so search can refuse
// to compare vectors produced by different models (which are not comparable).
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 1536;
export const EMBEDDING_MODEL_TAG = `${EMBEDDING_MODEL}@${EMBEDDING_DIMS}`;

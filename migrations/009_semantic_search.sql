-- Semantic search over the knowledge graph and archived files.
-- Embeddings: gemini-embedding-001 @ 1536 dims (MRL, L2-normalized), cosine distance.

-- Knowledge graph embeddings
ALTER TABLE entities ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE entities ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE facts    ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE facts    ADD COLUMN IF NOT EXISTS embedding_model TEXT;

CREATE INDEX IF NOT EXISTS idx_entities_embedding
  ON entities USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_facts_embedding
  ON facts USING hnsw (embedding vector_cosine_ops);

-- Archive index: permanent, natural-language-searchable store of originals' text.
-- No tier/partition columns — the hot/warm/cold lifecycle and summaries belong to
-- a future active/working store, not this append-only archive.
CREATE TABLE IF NOT EXISTS document_chunks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    archived_file_id UUID NOT NULL REFERENCES archived_files(id),
    chunk_index      INTEGER NOT NULL DEFAULT 0,
    content          TEXT NOT NULL,
    embedding        vector(1536),
    embedding_model  TEXT,
    source_type      TEXT NOT NULL,
    metadata         JSONB DEFAULT '{}',
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
  ON document_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_document_chunks_archived_file
  ON document_chunks(archived_file_id);

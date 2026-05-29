CREATE TABLE IF NOT EXISTS archived_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL,
    b2_path TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT,
    file_size_bytes BIGINT,
    sha256 TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archived_files_source_type ON archived_files(source_type);
CREATE INDEX IF NOT EXISTS idx_archived_files_created_at ON archived_files(created_at);

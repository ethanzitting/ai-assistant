ALTER TABLE archived_files ADD COLUMN IF NOT EXISTS telegram_file_id   TEXT;
ALTER TABLE archived_files ADD COLUMN IF NOT EXISTS ocr_text           TEXT;
ALTER TABLE archived_files ADD COLUMN IF NOT EXISTS vision_description TEXT;
ALTER TABLE archived_files ADD COLUMN IF NOT EXISTS vision_model       TEXT;

CREATE INDEX IF NOT EXISTS idx_archived_files_telegram_file_id
  ON archived_files(telegram_file_id);

-- archiveFile() builds b2_path as archive/YYYY/MM/{source_type}/{unix_ts}_{label}.{ext} and
-- passes the Telegram file_id as the label, so the id is recoverable from the path. This is
-- the only source that covers every row: chunk and conversation metadata both have gaps.
-- The capture starts after the timestamp separator because file_ids are base64url and may
-- themselves contain underscores.
UPDATE archived_files
SET telegram_file_id = substring(b2_path from '/[0-9]+_(.+)\.[A-Za-z0-9]+$')
WHERE telegram_file_id IS NULL
  AND source_type IN ('photo', 'document');

-- Photo chunks currently hold exactly the OCR text and nothing else. Lifting it onto the
-- file row before the vision backfill rewrites those chunks is what makes re-indexing
-- idempotent: afterwards a chunk holds description + OCR combined, so reading OCR back out
-- of a chunk would compound it on every subsequent run. MUST run before the vision backfill.
UPDATE archived_files af
SET ocr_text = dc.content
FROM document_chunks dc
WHERE dc.archived_file_id = af.id
  AND dc.chunk_index = 0
  AND af.source_type = 'photo'
  AND af.ocr_text IS NULL;

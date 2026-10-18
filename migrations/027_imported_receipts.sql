ALTER TABLE transaction_receipts
    ALTER COLUMN archived_file_id DROP NOT NULL;

ALTER TABLE transaction_receipts
    ADD COLUMN source            TEXT NOT NULL DEFAULT 'telegram_photo',
    ADD COLUMN source_receipt_id TEXT,
    ADD COLUMN source_url        TEXT,
    ADD COLUMN subtotal          NUMERIC(12,2),
    ADD COLUMN tax               NUMERIC(12,2),
    ADD COLUMN raw_data          JSONB;

ALTER TABLE transaction_receipts
    ADD CONSTRAINT transaction_receipts_source_check
        CHECK (length(source) > 0),
    ADD CONSTRAINT transaction_receipts_content_check
        CHECK (archived_file_id IS NOT NULL OR source_receipt_id IS NOT NULL);

CREATE UNIQUE INDEX transaction_receipts_source_id_unique
    ON transaction_receipts (source, source_receipt_id)
    WHERE source_receipt_id IS NOT NULL;

CREATE TABLE transaction_receipt_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id  UUID NOT NULL REFERENCES transaction_receipts(id) ON DELETE CASCADE,
    line_index  INTEGER NOT NULL CHECK (line_index >= 0),
    name        TEXT NOT NULL,
    quantity    NUMERIC(12,4),
    unit_price  NUMERIC(12,4),
    line_total  NUMERIC(12,2),
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (receipt_id, line_index)
);

CREATE INDEX transaction_receipt_items_receipt
    ON transaction_receipt_items (receipt_id, line_index);

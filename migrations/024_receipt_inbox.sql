CREATE TABLE transaction_receipts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    archived_file_id UUID NOT NULL UNIQUE REFERENCES archived_files(id),
    transaction_id   UUID REFERENCES transactions(id),
    merchant_name    TEXT,
    receipt_total    NUMERIC(12,2) NOT NULL,
    purchase_date    DATE,
    status           TEXT NOT NULL DEFAULT 'unmatched'
                     CHECK (status IN ('unmatched', 'awaiting_confirmation', 'confirmed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    matched_at       TIMESTAMPTZ,
    confirmed_at     TIMESTAMPTZ
);

CREATE INDEX idx_receipts_unmatched ON transaction_receipts (receipt_total)
    WHERE status = 'unmatched';

CREATE INDEX idx_receipts_transaction ON transaction_receipts (transaction_id);

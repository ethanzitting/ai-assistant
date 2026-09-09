UPDATE scheduled_jobs
SET name = 'categorization_batches'
WHERE name = 'categorization_prompts';

DROP TABLE categorization_prompts;

CREATE TABLE categorization_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_message_id BIGINT UNIQUE,
    sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

CREATE TABLE categorization_batch_items (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       UUID NOT NULL REFERENCES categorization_batches(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    label          TEXT NOT NULL,
    answered_at    TIMESTAMPTZ,
    UNIQUE (batch_id, label)
);

CREATE UNIQUE INDEX idx_batch_items_open_transaction
    ON categorization_batch_items (transaction_id) WHERE answered_at IS NULL;

CREATE INDEX idx_batch_items_batch ON categorization_batch_items (batch_id);

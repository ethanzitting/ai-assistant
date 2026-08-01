CREATE TABLE IF NOT EXISTS scheduled_jobs (
    name             TEXT PRIMARY KEY,
    interval_seconds INTEGER NOT NULL,
    next_run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_run_at      TIMESTAMPTZ,
    enabled          BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS job_runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name    TEXT NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status      TEXT NOT NULL DEFAULT 'running',
    detail      JSONB NOT NULL DEFAULT '{}',
    error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_recent ON job_runs (job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS plaid_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id             TEXT NOT NULL UNIQUE,
    institution_name    TEXT,
    transactions_cursor TEXT,
    last_synced_at      TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plaid_account_id  TEXT NOT NULL UNIQUE,
    item_id           TEXT NOT NULL REFERENCES plaid_items(item_id),
    name              TEXT NOT NULL,
    official_name     TEXT,
    mask              TEXT,
    type              TEXT NOT NULL,
    subtype           TEXT,
    current_balance   NUMERIC(14,2),
    available_balance NUMERIC(14,2),
    credit_limit      NUMERIC(14,2),
    currency_code     TEXT,
    balance_as_of     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS category_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_type  TEXT NOT NULL,
    match_value TEXT NOT NULL,
    category    TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (match_type, match_value)
);

-- Plaid signs amounts so that a POSITIVE amount is money that LEAVES the account, and a negative
-- amount is money arriving. That inverts most people's intuition, and it is stored unchanged
-- because every other Plaid field agrees with it. A spending total therefore SUMs to a positive
-- number once transaction_type = 'expense' filters out the inflows.
CREATE TABLE IF NOT EXISTS transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plaid_transaction_id    TEXT UNIQUE,
    account_id              UUID NOT NULL REFERENCES accounts(id),
    posted_date             DATE NOT NULL,
    authorized_date         DATE,
    amount                  NUMERIC(12,2) NOT NULL,
    currency_code           TEXT,
    description             TEXT NOT NULL,
    merchant_name           TEXT,
    plaid_category_primary  TEXT,
    plaid_category_detailed TEXT,
    category                TEXT,
    category_source         TEXT,
    transaction_type        TEXT NOT NULL DEFAULT 'expense',
    payment_channel         TEXT,
    pending                 BOOLEAN NOT NULL DEFAULT false,
    source                  TEXT NOT NULL DEFAULT 'plaid',
    properties              JSONB NOT NULL DEFAULT '{}',
    removed_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_posted_date
    ON transactions (posted_date) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_category
    ON transactions (category, posted_date) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions (merchant_name);

INSERT INTO scheduled_jobs (name, interval_seconds)
VALUES ('plaid_sync', 21600)
ON CONFLICT (name) DO NOTHING;

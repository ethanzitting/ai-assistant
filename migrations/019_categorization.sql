-- The closed category list. Referenced by NAME rather than id, because categories.name is UNIQUE
-- and every existing query already compares category as text — so a foreign key buys referential
-- integrity without touching a single query file. ON UPDATE CASCADE on each referencing column
-- then makes a rename a one-line UPDATE instead of a migration across three tables.
CREATE TABLE IF NOT EXISTS categories (
    id         SMALLSERIAL PRIMARY KEY,   -- small so it fits Telegram's 64-byte callback payload
    name       TEXT NOT NULL UNIQUE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    active     BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO categories (name, sort_order) VALUES
    ('Rent', 1),
    ('Household Items', 2),
    ('Renters Insurance', 3),
    ('Utility: Electricity', 4),
    ('Utility: Internet', 5),
    ('Utility: Water', 6),
    ('Utility: Natural Gas', 7),
    ('Groceries', 8),
    ('Restaurants', 9),
    ('Supplements', 10),
    ('Health Insurance', 11),
    ('Gym Subscription', 12),
    ('Counseling', 13),
    ('Haircuts', 14),
    ('Toiletries', 15),
    ('Clothing', 16),
    ('Car Payments', 17),
    ('Car Insurance', 18),
    ('Parking', 19),
    ('Car Fuel', 20),
    ('Car Maintenance', 21),
    ('Home Maintenance', 22),
    ('Pet Food', 23),
    ('Pet Items', 24),
    ('Vet Bills', 25),
    ('Cell Phone Connection', 26),
    ('Entertainment', 27),
    ('Donations', 28),
    ('Gifts', 29),
    ('Core Software', 30),
    ('Fun Money', 31)
ON CONFLICT (name) DO NOTHING;

-- Inactive so it is never offered as a button, but a real row so the foreign key accepts it.
INSERT INTO categories (name, sort_order, active) VALUES ('Unsorted', 999, false)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS people (name TEXT PRIMARY KEY);
INSERT INTO people (name) VALUES ('Ethan'), ('Betsy') ON CONFLICT (name) DO NOTHING;

-- Plaid's guesses are discarded rather than mapped onto the new list. plaid_category_primary is
-- retained on every row, so a mapping could still be reconstructed if this is ever regretted.
-- category_source becomes NULL because nothing chose these values — they are merely not yet sorted.
UPDATE transactions SET category = 'Unsorted', category_source = NULL;

-- Existing rules referenced Plaid's vocabulary, which no longer exists.
DELETE FROM category_rules;

ALTER TABLE transactions
    ADD CONSTRAINT transactions_category_fk
    FOREIGN KEY (category) REFERENCES categories(name) ON UPDATE CASCADE;

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS person TEXT REFERENCES people(name) ON UPDATE CASCADE;

-- Only rows ingested after this lands are ever prompted about: the user declined a historical
-- pass, and without this the first night would queue two years of transactions.
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS needs_category BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_transactions_needs_category
    ON transactions (posted_date) WHERE needs_category AND removed_at IS NULL;

-- policy 'auto' applies the category silently; 'ask' prompts on every posted charge and therefore
-- carries no default category of its own.
ALTER TABLE category_rules
    ADD COLUMN IF NOT EXISTS policy TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE category_rules
    ADD CONSTRAINT category_rules_policy_check CHECK (policy IN ('auto', 'ask'));
ALTER TABLE category_rules ALTER COLUMN category DROP NOT NULL;
ALTER TABLE category_rules
    ADD CONSTRAINT category_rules_category_fk
    FOREIGN KEY (category) REFERENCES categories(name) ON UPDATE CASCADE;
ALTER TABLE category_rules
    ADD CONSTRAINT category_rules_auto_needs_category
    CHECK (policy = 'ask' OR category IS NOT NULL);

CREATE TABLE IF NOT EXISTS transaction_splits (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    category       TEXT NOT NULL REFERENCES categories(name) ON UPDATE CASCADE,
    person         TEXT REFERENCES people(name) ON UPDATE CASCADE,
    amount         NUMERIC(12,2) NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_txn
    ON transaction_splits (transaction_id);

CREATE TABLE IF NOT EXISTS categorization_prompts (
    id                  BIGSERIAL PRIMARY KEY,
    transaction_id      UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    telegram_message_id BIGINT,
    sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    answered_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prompts_unanswered
    ON categorization_prompts (sent_at) WHERE answered_at IS NULL;

-- One row per split part, or a single row when a transaction has none. Every spending query reads
-- this instead of transactions, so none of them has to know what a split is.
--
-- WARNING: count(*) over this view counts PARTS, not charges. Callers reporting a transaction
-- count must use count(DISTINCT id).
CREATE OR REPLACE VIEW transaction_categories AS
SELECT t.id,
       t.account_id,
       t.posted_date,
       t.transaction_type,
       t.merchant_name,
       t.description,
       t.pending,
       t.removed_at,
       COALESCE(s.category, t.category) AS category,
       COALESCE(s.person,   t.person)   AS person,
       COALESCE(s.amount,   t.amount)   AS amount
FROM transactions t
LEFT JOIN transaction_splits s ON s.transaction_id = t.id;

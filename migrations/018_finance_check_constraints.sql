-- Constrain only the columns a query filters on. A bad transaction_type does not raise an error on
-- its own: it silently drops the row out of every spending total, and the total still looks
-- plausible. These turn that silent wrong answer into a loud write failure.
--
-- source is deliberately left open — nothing filters on it, so a new ingest path (receipt OCR, CSV)
-- should not need a migration to name itself.

ALTER TABLE transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (transaction_type IN ('expense', 'income', 'transfer'));

ALTER TABLE transactions
    ADD CONSTRAINT transactions_category_source_check
    CHECK (category_source IS NULL OR category_source IN ('plaid', 'rule', 'manual'));

ALTER TABLE category_rules
    ADD CONSTRAINT category_rules_match_type_check
    CHECK (match_type IN ('merchant', 'description_contains'));

ALTER TABLE job_runs
    ADD CONSTRAINT job_runs_status_check
    CHECK (status IN ('running', 'ok', 'failed'));

ALTER TABLE plaid_items
    ADD CONSTRAINT plaid_items_status_check
    CHECK (status IN ('active', 'login_required'));

CREATE TABLE finance_audits (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CHECK (start_date <= end_date)
);

CREATE UNIQUE INDEX idx_finance_audits_one_active
    ON finance_audits ((true)) WHERE status = 'active';

CREATE TABLE finance_audit_items (
    audit_id                 UUID NOT NULL REFERENCES finance_audits(id) ON DELETE CASCADE,
    transaction_id           UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    original_category        TEXT NOT NULL,
    original_category_source TEXT,
    original_needs_category  BOOLEAN NOT NULL,
    PRIMARY KEY (audit_id, transaction_id)
);

CREATE INDEX idx_finance_audit_items_transaction
    ON finance_audit_items (transaction_id);

CREATE TABLE transaction_category_changes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    audit_id            UUID REFERENCES finance_audits(id) ON DELETE SET NULL,
    old_category        TEXT NOT NULL,
    new_category        TEXT NOT NULL,
    old_category_source TEXT,
    new_category_source TEXT,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transaction_category_changes_transaction
    ON transaction_category_changes (transaction_id, changed_at DESC);

CREATE OR REPLACE FUNCTION record_transaction_category_change()
RETURNS TRIGGER AS $$
DECLARE
    active_audit_id UUID;
BEGIN
    IF OLD.category IS NOT DISTINCT FROM NEW.category
       AND OLD.category_source IS NOT DISTINCT FROM NEW.category_source THEN
        RETURN NEW;
    END IF;

    SELECT i.audit_id INTO active_audit_id
    FROM finance_audit_items i
    JOIN finance_audits a ON a.id = i.audit_id
    WHERE i.transaction_id = NEW.id AND a.status = 'active'
    LIMIT 1;

    INSERT INTO transaction_category_changes (
        transaction_id, audit_id, old_category, new_category,
        old_category_source, new_category_source
    ) VALUES (
        NEW.id, active_audit_id, OLD.category, NEW.category,
        OLD.category_source, NEW.category_source
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transaction_category_change_log
AFTER UPDATE OF category, category_source ON transactions
FOR EACH ROW EXECUTE FUNCTION record_transaction_category_change();

UPDATE transactions
SET needs_category = false, updated_at = now()
WHERE needs_category
  AND (transaction_type <> 'expense' OR category <> 'Unsorted');

UPDATE categorization_batch_items i
SET answered_at = now()
FROM transactions t
WHERE t.id = i.transaction_id
  AND i.answered_at IS NULL
  AND NOT t.needs_category;

UPDATE categorization_batches b
SET completed_at = now()
WHERE b.completed_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM categorization_batch_items i
      WHERE i.batch_id = b.id AND i.answered_at IS NULL
  );

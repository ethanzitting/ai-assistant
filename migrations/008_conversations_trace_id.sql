ALTER TABLE conversations ADD COLUMN IF NOT EXISTS trace_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_trace_id ON conversations(trace_id);

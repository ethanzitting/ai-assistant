CREATE TABLE IF NOT EXISTS engine_trace (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    step TEXT NOT NULL,
    detail JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engine_trace_trace_id ON engine_trace(trace_id);
CREATE INDEX IF NOT EXISTS idx_engine_trace_created_at ON engine_trace(created_at);

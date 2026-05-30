#!/usr/bin/env bash
set -euo pipefail

CONTAINER=$(docker compose ps -q postgres 2>/dev/null || true)
if [ -z "$CONTAINER" ]; then
    echo "Error: Postgres container is not running. Start it with 'make dev' or 'make up' first."
    exit 1
fi

DB_USER="${POSTGRES_USER}"
DB_NAME="${POSTGRES_DB}"

run_sql() {
    docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

resolve_trace_id() {
    local input="$1"
    if [ "$input" = "last" ]; then
        run_sql -t -A <<'SQL'
SELECT trace_id FROM engine_trace ORDER BY created_at DESC LIMIT 1;
SQL
    else
        echo "$input"
    fi
}

TRACE_ID="${1:-}"
SUBCOMMAND="${2:-}"

# Resolve "last" to actual trace_id
if [ "$TRACE_ID" = "last" ] || ([ -n "$TRACE_ID" ] && [ "$TRACE_ID" != "errors" ] && [ "$TRACE_ID" != "cost" ] && [ "$TRACE_ID" != "search" ] && ! [[ "$TRACE_ID" =~ ^[0-9]+$ ]]); then
    if [ "$TRACE_ID" = "last" ]; then
        TRACE_ID=$(resolve_trace_id "last" | tr -d '[:space:]')
        if [ -z "$TRACE_ID" ]; then
            echo "No traces found."
            exit 1
        fi
    fi
fi

# ── Global subcommands (no trace_id) ──────────────────────────────

if [ -z "$TRACE_ID" ]; then
    LIMIT="${SUBCOMMAND:-10}"
    if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
        echo "Error: LIMIT must be a positive integer, got '$LIMIT'"
        exit 1
    fi
    run_sql -v limit="$LIMIT" <<'SQL'
SELECT
    left(trace_id, 8) AS trace,
    to_char(MIN(created_at), 'YYYY-MM-DD HH24:MI:SS') AS started,
    left(MIN(CASE WHEN step = 'user.message' THEN detail->>'text' END), 60) AS message,
    COUNT(*) AS steps,
    COUNT(*) FILTER (WHERE step = 'tool.called') AS tools,
    EXTRACT(MILLISECONDS FROM MAX(created_at) - MIN(created_at))::int || 'ms' AS duration
FROM engine_trace
GROUP BY trace_id
ORDER BY MIN(created_at) DESC
LIMIT :limit;
SQL
    exit 0
fi

if [ "$TRACE_ID" = "errors" ]; then
    LIMIT="${SUBCOMMAND:-20}"
    run_sql -v limit="$LIMIT" <<'SQL'
SELECT
    left(t.trace_id, 8) AS trace,
    to_char(t.created_at, 'YYYY-MM-DD HH24:MI:SS') AS time,
    t.detail->>'name' AS tool,
    left(t.detail->>'content', 100) AS error
FROM engine_trace t
WHERE t.step = 'tool.result' AND (t.detail->>'isError')::boolean = true
ORDER BY t.created_at DESC
LIMIT :limit;
SQL
    exit 0
fi

if [ "$TRACE_ID" = "cost" ]; then
    LIMIT="${SUBCOMMAND:-20}"
    run_sql -v limit="$LIMIT" <<'SQL'
SELECT
    left(trace_id, 8) AS trace,
    to_char(MIN(created_at), 'YYYY-MM-DD HH24:MI:SS') AS started,
    SUM((detail->>'inputTokens')::int) FILTER (WHERE step = 'claude.response') AS input_tok,
    SUM((detail->>'outputTokens')::int) FILTER (WHERE step = 'claude.response') AS output_tok,
    SUM((detail->>'cacheReadTokens')::int) FILTER (WHERE step = 'claude.response') AS cache_tok,
    COUNT(*) FILTER (WHERE step = 'claude.response') AS api_calls
FROM engine_trace
WHERE step IN ('claude.response', 'event.received')
GROUP BY trace_id
ORDER BY MIN(created_at) DESC
LIMIT :limit;
SQL
    exit 0
fi

if [ "$TRACE_ID" = "search" ]; then
    QUERY="${SUBCOMMAND}"
    if [ -z "$QUERY" ]; then
        echo "Usage: make trace search <text>"
        exit 1
    fi
    run_sql -v query="%${QUERY}%" <<'SQL'
SELECT
    left(trace_id, 8) AS trace,
    to_char(created_at, 'HH24:MI:SS') AS time,
    step,
    left(detail->>'text', 120) AS match
FROM engine_trace
WHERE step IN ('user.message', 'response.delivered', 'assistant.intermediate')
  AND detail->>'text' ILIKE :'query'
ORDER BY created_at DESC
LIMIT 20;
SQL
    exit 0
fi

# ── Per-trace subcommands ─────────────────────────────────────────

if [ "$SUBCOMMAND" = "replay" ]; then
    run_sql -t -A -v tid="$TRACE_ID" <<'SQL'
WITH ordered AS (
    SELECT step, detail, created_at,
           ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM engine_trace
    WHERE trace_id = :'tid'
),
summary AS (
    SELECT
        MIN(created_at) AS started,
        EXTRACT(MILLISECONDS FROM MAX(created_at) - MIN(created_at))::int AS duration_ms,
        COUNT(*) AS total_steps,
        COUNT(*) FILTER (WHERE step = 'tool.called') AS tool_count,
        COUNT(*) FILTER (WHERE step LIKE 'db.%') AS db_ops
    FROM ordered
)
SELECT
    E'\n━━━ Trace ' || left(:'tid', 8) || ' ━━━ ' ||
    to_char(s.started, 'YYYY-MM-DD HH24:MI:SS') ||
    ' ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' || E'\n' ||

    COALESCE(E'\nUSER: ' || (SELECT detail->>'text' FROM ordered WHERE step = 'user.message' LIMIT 1) || E'\n', '') ||

    COALESCE(
        E'\n── Tools (' || s.tool_count || ' calls) ' || repeat('─', 40) || E'\n\n' ||
        (SELECT string_agg(
            '  [' || sub.tool_num || '] ' || sub.tool_name || '(' ||
            left(sub.tool_input::text, 80) || ')' || E'\n' ||
            '      → ' ||
            CASE
                WHEN sub.is_error THEN 'ERROR: ' || left(sub.result_content, 100)
                WHEN length(sub.result_content) > 120 THEN left(sub.result_content, 120) || '...'
                ELSE COALESCE(sub.result_content, '(no content)')
            END || E'\n',
            E'\n' ORDER BY sub.rn
        )
        FROM (
            SELECT
                c.rn,
                ROW_NUMBER() OVER (ORDER BY c.rn) AS tool_num,
                c.detail->>'name' AS tool_name,
                c.detail->'input' AS tool_input,
                r.detail->>'content' AS result_content,
                COALESCE((r.detail->>'isError')::boolean, false) AS is_error
            FROM ordered c
            LEFT JOIN ordered r ON r.rn = c.rn + 1 AND r.step = 'tool.result'
            WHERE c.step = 'tool.called'
        ) sub),
        ''
    ) ||

    COALESCE(E'\nJARVIS: ' || (SELECT detail->>'text' FROM ordered WHERE step = 'response.delivered' ORDER BY created_at DESC LIMIT 1) || E'\n', '') ||

    E'\n━━━ ' || s.duration_ms || 'ms | ' ||
    s.total_steps || ' steps | ' ||
    s.tool_count || ' tools | ' ||
    s.db_ops || ' db ops ━━━━━━━━━━━━━━━━━━' || E'\n'

FROM summary s;
SQL
    exit 0
fi

if [ "$SUBCOMMAND" = "tools" ]; then
    run_sql -t -A -v tid="$TRACE_ID" <<'SQL'
WITH ordered AS (
    SELECT step, detail, created_at,
           ROW_NUMBER() OVER (ORDER BY created_at) AS rn
    FROM engine_trace
    WHERE trace_id = :'tid'
)
SELECT
    E'\n[' || ROW_NUMBER() OVER (ORDER BY c.rn) || '] ' ||
    (c.detail->>'name') || E'\n' ||
    '    Input:  ' || jsonb_pretty(c.detail->'input') || E'\n' ||
    '    Output: ' ||
    CASE
        WHEN COALESCE((r.detail->>'isError')::boolean, false) THEN 'ERROR: '
        ELSE ''
    END ||
    COALESCE(r.detail->>'content', '(no content)') || E'\n'
FROM ordered c
LEFT JOIN ordered r ON r.rn = c.rn + 1 AND r.step = 'tool.result'
WHERE c.step = 'tool.called'
ORDER BY c.rn;
SQL
    exit 0
fi

# ── Step detail view (named step) ─────────────────────────────────

if [ -n "$SUBCOMMAND" ] && ! [[ "$SUBCOMMAND" =~ ^[0-9]+$ ]]; then
    run_sql -t -A -v tid="$TRACE_ID" -v step="$SUBCOMMAND" <<'SQL'
SELECT jsonb_pretty(detail)
FROM engine_trace
WHERE trace_id = :'tid' AND step = :'step'
ORDER BY created_at ASC;
SQL
    exit 0
fi

# ── Default: trace detail view ────────────────────────────────────

run_sql -v tid="$TRACE_ID" <<'SQL'
SELECT
    to_char(created_at, 'HH24:MI:SS.MS') AS time,
    step,
    CASE
        WHEN length(detail::text) > 120 THEN left(detail::text, 120) || '...'
        ELSE detail::text
    END AS detail
FROM engine_trace
WHERE trace_id = :'tid'
ORDER BY created_at ASC;
SQL

run_sql -t -A -v tid="$TRACE_ID" <<'SQL'

SELECT
    'Total: ' ||
    EXTRACT(MILLISECONDS FROM MAX(created_at) - MIN(created_at))::int || 'ms' ||
    ' | Steps: ' || COUNT(*) ||
    ' | Tools: ' || COUNT(*) FILTER (WHERE step = 'tool.called') ||
    ' | DB writes: ' || COUNT(*) FILTER (WHERE step LIKE 'db.%')
FROM engine_trace
WHERE trace_id = :'tid';
SQL

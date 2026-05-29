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

TRACE_ID="${1:-}"
STEP_OR_LIMIT="${2:-5}"

if [ -z "$TRACE_ID" ]; then
    # Summary view: show recent traces
    LIMIT="$STEP_OR_LIMIT"
    if ! [[ "$LIMIT" =~ ^[0-9]+$ ]]; then
        echo "Error: LIMIT must be a positive integer, got '$LIMIT'"
        exit 1
    fi
    run_sql -v limit="$LIMIT" <<'SQL'
SELECT
    trace_id AS trace,
    to_char(MIN(created_at), 'YYYY-MM-DD HH24:MI:SS') AS started,
    COUNT(*) AS steps,
    COUNT(*) FILTER (WHERE step LIKE 'tool.%') AS tools,
    COUNT(*) FILTER (WHERE step LIKE 'db.%') AS db_ops,
    EXTRACT(MILLISECONDS FROM MAX(created_at) - MIN(created_at))::int || 'ms' AS duration
FROM engine_trace
GROUP BY trace_id
ORDER BY MIN(created_at) DESC
LIMIT :limit;
SQL
elif [ -n "$STEP_OR_LIMIT" ] && ! [[ "$STEP_OR_LIMIT" =~ ^[0-9]+$ ]]; then
    # Step detail view: show full detail for one step
    run_sql -t -A -v tid="$TRACE_ID" -v step="$STEP_OR_LIMIT" <<'SQL'
SELECT jsonb_pretty(detail)
FROM engine_trace
WHERE trace_id = :'tid' AND step = :'step'
ORDER BY created_at ASC;
SQL
else
    # Trace detail view: show all steps for one trace
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

    # Print summary footer
    run_sql -t -A -v tid="$TRACE_ID" <<'SQL'

SELECT
    'Total: ' ||
    EXTRACT(MILLISECONDS FROM MAX(created_at) - MIN(created_at))::int || 'ms' ||
    ' | Steps: ' || COUNT(*) ||
    ' | Tools: ' || COUNT(*) FILTER (WHERE step LIKE 'tool.%') ||
    ' | DB writes: ' || COUNT(*) FILTER (WHERE step LIKE 'db.%')
FROM engine_trace
WHERE trace_id = :'tid';
SQL
fi

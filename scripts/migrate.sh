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

run_sql_quiet() {
    docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo ""
}

# Create migrations tracking table
run_sql <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
);
SQL

# Run pending migrations in order
for file in migrations/*.sql; do
    [ -f "$file" ] || continue
    version=$(basename "$file")
    applied=$(run_sql_quiet "SELECT 1 FROM schema_migrations WHERE version = '$version'")
    if [ "$applied" != "1" ]; then
        echo "Applying $version..."
        run_sql < "$file"
        run_sql_quiet "INSERT INTO schema_migrations (version) VALUES ('$version')" > /dev/null
        echo "  Done."
    else
        echo "Skipping $version (already applied)"
    fi
done

echo "All migrations applied."

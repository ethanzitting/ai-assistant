.PHONY: dev up down logs db migrate reembed backfill-archives prune-duplicates prune-duplicates-apply consolidate-facts consolidate-facts-apply backup test trace

dev:
	op run --env-file=.env.tpl -- docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

up:
	op run --env-file=.env.tpl -- docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

db:
	docker compose exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

migrate:
	op run --env-file=.env.tpl -- ./scripts/migrate.sh

reembed:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/reembed.ts

backfill-archives:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/backfill/archives.ts

prune-duplicates:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/pruneDuplicates.ts

prune-duplicates-apply:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/pruneDuplicates.ts --apply

consolidate-facts:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/consolidateFacts.ts

consolidate-facts-apply:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/consolidateFacts.ts --apply

backup:
	@echo "Backup not yet implemented (Phase 8)"

test:
	deno test src/tests/

trace:
	op run --env-file=.env.tpl -- ./scripts/trace.sh $(filter-out $@,$(MAKECMDGOALS))

%:
	@:

.PHONY: dev up down logs db migrate backup test

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

backup:
	@echo "Backup not yet implemented (Phase 8)"

test:
	cd core && deno test src/tests/

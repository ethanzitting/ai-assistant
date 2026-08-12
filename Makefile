.PHONY: dev deploy up down logs db migrate reembed reindex-photos sync-transactions reclassify-transactions plaid-link backfill-archives prune-duplicates prune-duplicates-apply consolidate-facts consolidate-facts-apply backup test trace

# Jarvis runs on ezbox. Every target below drives ezbox's Docker daemon over SSH, which is why
# DOCKER_CONTEXT is exported rather than passed as a --context flag: the variable also reaches
# scripts/migrate.sh and scripts/trace.sh, so both work against ezbox with no change of their own.
# `op run` stays here on the Mac, so no secret ever lands on that host's disk.
# Override for a local stack: `DOCKER_CONTEXT=$(LOCAL_DOCKER_CONTEXT) JARVIS_ROOT=. make up`
DOCKER_CONTEXT ?= ezbox
export DOCKER_CONTEXT

# Docker Desktop's context on this Mac, used only by `make dev`.
LOCAL_DOCKER_CONTEXT ?= desktop-linux

# The repo path on the DOCKER HOST — a bind mount source is resolved by the daemon, not by the
# compose CLI. See docker-compose.dev.yml.
JARVIS_ROOT ?= /opt/ai-assistant
export JARVIS_ROOT

# Resolved by the `Host ezbox` block in ~/.ssh/config, which is where the address and user live.
EZBOX := ezbox

# ezbox runs the hot-reload overlay permanently: it is the one and only stack, and it is also where
# development happens. A save under /opt/ai-assistant/src restarts the agent — and kills any turn
# in flight, losing that Telegram message.
COMPOSE_FILES := -f docker-compose.yml -f docker-compose.dev.yml

# Recreate the containers on ezbox. Only needed for a compose, Dockerfile, or env change — a plain
# code edit under $(JARVIS_ROOT)/src is picked up by hot reload with no deploy at all.
#
# Note which tree is which: the IMAGE is built from this Mac's working tree, because the compose
# CLI sends its own build context to the remote daemon, while the RUNNING code is ezbox's
# $(JARVIS_ROOT)/src through the bind mount. Keep the two in sync through git, or a later change to
# the mount would swap in code you have not seen.
deploy:
	ssh $(EZBOX) 'git -C $(JARVIS_ROOT) pull --ff-only'
	op run --env-file=.env.tpl -- docker compose $(COMPOSE_FILES) up --build -d

# A local stack on the Mac. WARNING: it polls the same Telegram token as ezbox. Telegram answers
# 409 and drops messages if both run, so stop ezbox first.
dev:
	DOCKER_CONTEXT=$(LOCAL_DOCKER_CONTEXT) JARVIS_ROOT=. op run --env-file=.env.tpl -- docker compose $(COMPOSE_FILES) up --build

up:
	op run --env-file=.env.tpl -- docker compose $(COMPOSE_FILES) up --build -d

down:
	docker compose $(COMPOSE_FILES) down

logs:
	docker compose logs -f

db:
	docker compose exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

migrate:
	op run --env-file=.env.tpl -- ./scripts/migrate.sh

reembed:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/reembed.ts

reindex-photos:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/reindexPhotos.ts

sync-transactions:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/syncTransactions.ts

reclassify-transactions:
	docker compose exec agent deno run --allow-net --allow-env --allow-read src/maintenance/reclassifyTransactions.ts

plaid-link:
	op run --env-file=.env.tpl -- deno run --allow-net --allow-env scripts/plaid-link.ts

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
	deno test --allow-env src/tests/*.ts

trace:
	op run --env-file=.env.tpl -- ./scripts/trace.sh $(filter-out $@,$(MAKECMDGOALS))

%:
	@:

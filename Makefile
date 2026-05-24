.PHONY: dev-infra dev-infra-down dev-migrate dev-backend dev-frontend dev-logs prod prod-down help

dev-infra:
	docker-compose -f docker-compose.dev.yml up -d
	@echo "Infrastructure ready — db :5433, redis :6379"

dev-infra-down:
	docker-compose -f docker-compose.dev.yml down

dev-migrate:
	@export $$(grep -v '^#' .env.dev | xargs) && \
		.venv/bin/alembic upgrade head

dev-backend:
	@export $$(grep -v '^#' .env.dev | xargs) && \
		.venv/bin/uvicorn backend.main:app \
			--host 0.0.0.0 \
			--port 3301 \
			--reload \
			--reload-dir backend

dev-backend-test:
	@export $$(grep -v '^#' .env.dev | xargs) && \
		AGENTS_CONFIG=agents_config.test.yaml \
		.venv/bin/uvicorn backend.main:app \
			--host 0.0.0.0 \
			--port 3301 \
			--reload \
			--reload-dir backend

dev-frontend:
	cd frontend && PORT=3300 NEXT_PUBLIC_API_URL=http://localhost:3301 npm run dev

dev-logs:
	docker-compose -f docker-compose.dev.yml logs -f

prod:
	docker-compose up --build

prod-down:
	docker-compose down

help:
	@echo "Dev:  make dev-infra | dev-migrate | dev-backend | dev-frontend"
	@echo "Prod: make prod | prod-down"

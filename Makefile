.DEFAULT_GOAL := help
.PHONY: help install install-local dev build start lint lint-fix format format-check fmt check typecheck typecheck-tests test test-watch coverage verify clean docker-build docker-up docker-down docker-logs

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

install-local: ## Set up .env, install deps, and build for a local run
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example: fill in your secrets.")
	npm install
	npm run build
	@echo "Done. Run 'make start' (prod) or 'make dev' to launch on http://localhost:4000"

dev: ## Run the dev server (http://localhost:4000)
	npm run dev

build: ## Production build
	npm run build

start: ## Run the production build
	npm run start

## ---- Code format & quality ----

format: ## Auto-format all files with Prettier
	npm run format

format-check: ## Check formatting without writing
	npm run format:check

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint and auto-fix
	npm run lint:fix

typecheck: ## TypeScript type check (no emit)
	npm run typecheck

typecheck-tests: ## Type-check the test suite (separate tsconfig)
	npm run typecheck:tests

test: ## Run the test suite once
	npm run test

test-watch: ## Run the test suite in watch mode
	npm run test:watch

coverage: ## Run the test suite with a coverage report
	npm run test:coverage

fmt: format lint-fix typecheck ## Format, lint --fix, and type-check in one go

check: format-check lint typecheck typecheck-tests test ## CI-style: verify format, lint, types, and tests (no writes)

verify: check ## Alias for check

## ---- Docker ----

docker-build: ## Build the Docker image
	docker compose build

docker-up: ## Build and start the container in the background
	docker compose up -d --build

docker-down: ## Stop and remove the container (data kept)
	docker compose down

docker-logs: ## Tail container logs
	docker compose logs -f

clean: ## Remove build artifacts
	rm -rf .next

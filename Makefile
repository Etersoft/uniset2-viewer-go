.PHONY: build run test js-tests js-tests-multi coverage clean app demo test-integration clickhouse-up clickhouse-down

# Generate app.js from source modules
app:
	cd ui && go run concat.go

# Go build (depends on app.js generation)
build: app
	go build -mod=vendor -o uniset-panel ./cmd/server

# Run for development (connects to UniSet servers at 9090 and 9191)
# Usage: make run UNISET_URLS="http://localhost:9090 http://localhost:9191"
UNISET_URLS ?= http://localhost:9090 http://localhost:9191
ADDR ?= :8000
run:
	go run -mod=vendor ./cmd/server $(addprefix --uniset-url ,$(UNISET_URLS)) --addr $(ADDR)

# Go unit tests
test:
	go test -mod=vendor -v ./internal/...

# Test coverage
coverage:
	go test -mod=vendor -coverprofile=coverage.out ./internal/...
	go tool cover -func=coverage.out | tail -1

# E2E tests with Playwright in Docker (all tests)
js-tests:
	docker compose up --build --abort-on-container-exit --exit-code-from e2e
	docker compose down
	docker compose -f docker-compose.multi.yml up --build --abort-on-container-exit --exit-code-from e2e-multi
	docker compose -f docker-compose.multi.yml down

# E2E tests with Playwright in Docker (multi-server)
js-tests-multi:
	docker compose -f docker-compose.multi.yml up --build --abort-on-container-exit --exit-code-from e2e-multi
	docker compose -f docker-compose.multi.yml down

# All E2E tests
js-tests-all: js-tests js-tests-multi

# Clean
clean:
	rm -f uniset-panel
	docker compose down -v --rmi local 2>/dev/null || true
	docker compose -f docker-compose.multi.yml down -v --rmi local 2>/dev/null || true

# Demo mode with diesel generator simulator
# Starts demo-mock-server and demo-viewer on http://localhost:8001
demo:
	docker compose --profile demo up --build demo-mock-server demo-viewer

# Start ClickHouse for integration tests
clickhouse-up:
	docker compose up -d clickhouse
	@echo "Waiting for ClickHouse to be ready..."
	@docker compose exec clickhouse clickhouse-client --query "SELECT 1" > /dev/null 2>&1 || sleep 5
	@echo "ClickHouse is ready"

# Stop ClickHouse
clickhouse-down:
	docker compose stop clickhouse
	docker compose rm -f clickhouse

# Integration tests (requires ClickHouse running)
# Usage: make clickhouse-up && make test-integration && make clickhouse-down
test-integration:
	CLICKHOUSE_URL="clickhouse://localhost:9000/uniset" go test -mod=vendor -tags=integration -v ./internal/journal/...

.PHONY: build run test js-tests js-tests-multi coverage clean

# Go build
build:
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
	docker-compose up --build --abort-on-container-exit --exit-code-from e2e
	docker-compose down
	docker-compose -f docker-compose.multi.yml up --build --abort-on-container-exit --exit-code-from e2e-multi
	docker-compose -f docker-compose.multi.yml down

# E2E tests with Playwright in Docker (multi-server)
js-tests-multi:
	docker-compose -f docker-compose.multi.yml up --build --abort-on-container-exit --exit-code-from e2e-multi
	docker-compose -f docker-compose.multi.yml down

# All E2E tests
js-tests-all: js-tests js-tests-multi

# Clean
clean:
	rm -f uniset-panel
	docker-compose down -v --rmi local 2>/dev/null || true
	docker-compose -f docker-compose.multi.yml down -v --rmi local 2>/dev/null || true

# Claude Code Guidelines

## Testing

E2E тесты (Playwright) запускаются через docker-compose:

```bash
# Запуск всех тестов
make js-tests

# Перед запуском остановить dev-профиль (если запущен)
docker-compose --profile dev down
```

Не запускать тесты напрямую через `npx playwright test` — это может вызвать проблемы с окружением и портами.

## Development Server

```bash
# Запуск dev-сервера
docker-compose up dev-viewer -d --build

# Dev-сервер доступен на http://localhost:8000
# Подключается к реальным UniSet2 серверам на портах 9090, 9191, 9292, 9393, 9494, 9595, 9696
```

ВАЖНО: Запускать именно `docker-compose up dev-viewer`, а не `docker-compose --profile dev up`, чтобы избежать конфликта портов между сервисами dev-viewer и viewer (оба используют порт 8000).

## Build

```bash
# Сборка бинарника
go build -o uniset2-viewer-go ./cmd/server

# Сборка через make
make build
```

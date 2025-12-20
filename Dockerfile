FROM golang:1.23.5-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app

COPY go.mod go.sum ./
COPY vendor/ vendor/

COPY . .

RUN go build -mod=vendor -o uniset-panel ./cmd/server

FROM alpine:3.19

RUN apk add --no-cache curl

WORKDIR /app

COPY --from=builder /app/uniset-panel .
COPY --from=builder /app/ui/static ./ui/static/
COPY --from=builder /app/config ./config/

EXPOSE 8000

ENV UNISET_URL=http://localhost:9393
ENV PORT=8000

CMD ./uniset-panel --port ${PORT} --uniset-url ${UNISET_URL}

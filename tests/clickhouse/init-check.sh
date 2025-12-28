#!/bin/bash
# Script to check if ClickHouse is ready and init database if needed
# Used in healthcheck to ensure init scripts are run

# First check if ClickHouse is responding
if ! clickhouse-client --query "SELECT 1" > /dev/null 2>&1; then
    exit 1
fi

# Check if our table exists, if not - run init
if ! clickhouse-client --query "SELECT 1 FROM uniset.dict_messages_src LIMIT 1" > /dev/null 2>&1; then
    echo "Database not initialized, running init scripts..."
    clickhouse-client --multiquery < /docker-entrypoint-initdb.d/01-init.sql
    clickhouse-client --multiquery < /docker-entrypoint-initdb.d/02-seed.sql
fi

# Final check that everything is ready
clickhouse-client --query "SELECT count() FROM uniset.dict_messages_src" > /dev/null 2>&1

#!/bin/bash
# Script to generate test data for ClickHouse journal
# Usage: ./generate-data.sh [host] [count]

HOST="${1:-localhost}"
COUNT="${2:-100}"

echo "Generating $COUNT messages to ClickHouse at $HOST..."

clickhouse-client --host "$HOST" --query "
INSERT INTO uniset.main_messages_src (timestamp, value, name, message, mtype, mgroup, mcode)
SELECT
    now() - INTERVAL number SECOND,
    rand() % 100,
    concat('Sensor_', toString(number % 10)),
    concat('Generated message #', toString(number)),
    multiIf(
        number % 6 = 0, 'Alarm',
        number % 6 = 1, 'Warning',
        number % 6 = 2, 'Normal',
        number % 6 = 3, 'Emergancy',
        number % 6 = 4, 'Cauton',
        'Blocking'
    ),
    multiIf(
        number % 4 = 0, 'Environment',
        number % 4 = 1, 'Control',
        number % 4 = 2, 'Safety',
        'System'
    ),
    concat(substring('AWNEBC', (number % 6) + 1, 1), lpad(toString(number), 3, '0'))
FROM numbers($COUNT);
"

echo "Done. Total messages:"
clickhouse-client --host "$HOST" --query "SELECT count() FROM uniset.main_messages_src"

-- Create database
CREATE DATABASE IF NOT EXISTS uniset;

-- Dictionary source table for messages
CREATE TABLE IF NOT EXISTS uniset.dict_messages_src
(
    id UInt32,
    sensorname String,
    value Float64,
    message String,
    mtype String,
    mgroup String,
    mcode String
) ENGINE = MergeTree()
ORDER BY id;

-- Main history table (data is inserted here)
CREATE TABLE IF NOT EXISTS uniset.main_history
(
    timestamp DateTime64(9,'UTC') DEFAULT now(),
    value Float64 Codec(DoubleDelta, LZ4),
    uniset_hid UInt32 Default murmurHash2_32(name),
    name_hid UInt64 Default cityHash64(name),
    node_hid UInt64 Default cityHash64(nodename),
    producer_hid UInt64 Default cityHash64(producer),
    nodename LowCardinality(String),
    name LowCardinality(String),
    producer LowCardinality(String),
    tags Nested(
        name LowCardinality(String),
        value LowCardinality(String)
    )
) ENGINE = MergeTree
PARTITION BY toStartOfDay(timestamp)
PRIMARY KEY(timestamp,name_hid)
ORDER BY (timestamp,name_hid)
TTL toStartOfDay(timestamp) + INTERVAL 180 DAY;

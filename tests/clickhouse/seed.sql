-- Populate dictionary source table with correct hash IDs
-- Hash is computed as: murmurHash2_32(concat(sensorname, toString(toInt64(value))))
INSERT INTO uniset.dict_messages_src (id, sensorname, value, message, mtype, mgroup, mcode)
SELECT
    murmurHash2_32(concat(sensorname, toString(toInt64(value)))) as id,
    sensorname, value, message, mtype, mgroup, mcode
FROM (
    SELECT 'Temperature_Sensor1' as sensorname, 100 as value, 'Temperature exceeded threshold' as message, 'Alarm' as mtype, 'Environment' as mgroup, 'A001' as mcode
    UNION ALL SELECT 'Temperature_Sensor1', 98, 'Temperature high', 'Warning', 'Environment', 'W002'
    UNION ALL SELECT 'Temperature_Sensor1', 99, 'Temperature critical', 'Alarm', 'Environment', 'A001'
    UNION ALL SELECT 'Temperature_Sensor1', 85, 'Temperature normalized', 'Normal', 'Environment', 'N002'
    UNION ALL SELECT 'Pressure_Sensor1', 45, 'Pressure level warning', 'Warning', 'Environment', 'W001'
    UNION ALL SELECT 'Pressure_Sensor1', 30, 'Pressure low', 'Warning', 'Environment', 'W003'
    UNION ALL SELECT 'Pressure_Sensor1', 50, 'Pressure restored', 'Normal', 'Environment', 'N003'
    UNION ALL SELECT 'Valve_Control1', 0, 'Valve opened', 'Normal', 'Control', 'N001'
    UNION ALL SELECT 'Valve_Control1', 1, 'Valve closed', 'Normal', 'Control', 'N001'
    UNION ALL SELECT 'Motor_Control1', 1, 'Motor started', 'Normal', 'Control', 'N004'
    UNION ALL SELECT 'Motor_Control1', 0, 'Motor stopped', 'Normal', 'Control', 'N005'
    UNION ALL SELECT 'Emergency_Stop', 1, 'Emergency stop activated', 'Emergancy', 'Safety', 'E001'
    UNION ALL SELECT 'Emergency_Stop', 0, 'Emergency stop released', 'Normal', 'Safety', 'N007'
    UNION ALL SELECT 'Level_Sensor1', 75, 'Level caution', 'Cauton', 'Process', 'C001'
    UNION ALL SELECT 'Level_Sensor1', 50, 'Level normal', 'Normal', 'Process', 'N008'
    UNION ALL SELECT 'System_Block', 1, 'System blocking initiated', 'Blocking', 'System', 'B001'
    UNION ALL SELECT 'System_Block', 0, 'System unblocked', 'Normal', 'System', 'N009'
    UNION ALL SELECT 'Power_Sensor1', 120, 'Power overload', 'Alarm', 'Power', 'A002'
    UNION ALL SELECT 'Power_Sensor1', 100, 'Power normalized', 'Normal', 'Power', 'N006'
    UNION ALL SELECT 'Door_Sensor1', 1, 'Door opened', 'Warning', 'Security', 'W004'
    UNION ALL SELECT 'Door_Sensor1', 0, 'Door closed', 'Normal', 'Security', 'N010'
);

-- Test messages for Sensor_0 to Sensor_9 with values 0-5
INSERT INTO uniset.dict_messages_src (id, sensorname, value, message, mtype, mgroup, mcode)
SELECT
    murmurHash2_32(concat(concat('Sensor_', toString(s)), toString(v))) as id,
    concat('Sensor_', toString(s)) as sensorname,
    v as value,
    concat('Test message Sensor_', toString(s), ' value ', toString(v)) as message,
    multiIf(v = 0, 'Alarm', v = 1, 'Warning', v = 2, 'Normal', v = 3, 'Emergancy', v = 4, 'Cauton', 'Blocking') as mtype,
    multiIf(s % 4 = 0, 'Environment', s % 4 = 1, 'Control', s % 4 = 2, 'Safety', 'System') as mgroup,
    concat(substring('AWNEBC', v + 1, 1), lpad(toString(s), 3, '0')) as mcode
FROM (SELECT number AS s FROM numbers(10)) AS sensors
CROSS JOIN (SELECT number AS v FROM numbers(6)) AS vals;

-- Create dictionary from source table
CREATE DICTIONARY IF NOT EXISTS uniset.dict_messages (
    id UInt32,
    sensorname String,
    value Float64,
    message String,
    mtype String,
    mgroup String,
    mcode String
)
PRIMARY KEY id
SOURCE(CLICKHOUSE(HOST 'localhost' PORT 9000 USER 'default' TABLE 'dict_messages_src' DB 'uniset'))
LIFETIME(MIN 30 MAX 60)
LAYOUT(HASHED());

-- Create materialized view for messages
CREATE MATERIALIZED VIEW IF NOT EXISTS uniset.main_messages_src
ENGINE = MergeTree
PRIMARY KEY (timestamp, name_hid, msg_hid)
AS SELECT
    timestamp,
    value,
    name,
    name_hid,
    uniset_hid,
    murmurHash2_32(concat(name, toString(toInt64(value)))) AS msg_hid,
    dictGetOrDefault('uniset.dict_messages', 'message', msg_hid, '') AS message,
    dictGetOrDefault('uniset.dict_messages', 'mtype', msg_hid, '') AS mtype,
    dictGetOrDefault('uniset.dict_messages', 'mgroup', msg_hid, '') AS mgroup,
    dictGetOrDefault('uniset.dict_messages', 'mcode', msg_hid, '') AS mcode
FROM uniset.main_history
WHERE dictGetOrDefault('uniset.dict_messages', 'message', murmurHash2_32(concat(name, toString(toInt64(value)))), '') != '';

-- Recent messages
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 5 MINUTE, 100, 'Temperature_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 4 MINUTE, 45, 'Pressure_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 3 MINUTE, 0, 'Valve_Control1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 2 MINUTE, 1, 'Emergency_Stop', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 1 MINUTE, 75, 'Level_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now(), 1, 'System_Block', 'node1', 'test');

-- Historical data
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 1 HOUR, 98, 'Temperature_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 55 MINUTE, 99, 'Temperature_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 50 MINUTE, 85, 'Temperature_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 2 HOUR, 30, 'Pressure_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 105 MINUTE, 50, 'Pressure_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 3 HOUR, 1, 'Motor_Control1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 150 MINUTE, 0, 'Motor_Control1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 4 HOUR, 120, 'Power_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 235 MINUTE, 100, 'Power_Sensor1', 'node1', 'test');
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) VALUES (now() - INTERVAL 5 HOUR, 1, 'Door_Sensor1', 'node1', 'test');

-- Batch insert for pagination testing
INSERT INTO uniset.main_history (timestamp, value, name, nodename, producer) SELECT now() - INTERVAL number SECOND, number % 6, concat('Sensor_', toString(number % 10)), 'node1', 'test' FROM numbers(100);

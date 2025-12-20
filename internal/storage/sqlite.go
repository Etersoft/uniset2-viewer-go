package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

type sqliteStorage struct {
	db *sql.DB
}

func NewSQLiteStorage(dbPath string) (Storage, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := createTables(db); err != nil {
		db.Close()
		return nil, err
	}

	// Миграция: добавление колонки server_id если её нет
	if err := migrateAddServerID(db); err != nil {
		db.Close()
		return nil, err
	}

	return &sqliteStorage{db: db}, nil
}

func createTables(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL DEFAULT 'default',
			object_name TEXT NOT NULL,
			variable_name TEXT NOT NULL,
			value TEXT NOT NULL,
			timestamp DATETIME NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_history_lookup
			ON history(server_id, object_name, variable_name, timestamp);
	`)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	return nil
}

// migrateAddServerID добавляет колонку server_id к существующей таблице
func migrateAddServerID(db *sql.DB) error {
	// Проверяем, есть ли уже колонка server_id
	rows, err := db.Query("PRAGMA table_info(history)")
	if err != nil {
		return fmt.Errorf("check table info: %w", err)
	}
	defer rows.Close()

	hasServerID := false
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dfltValue interface{}
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dfltValue, &pk); err != nil {
			return fmt.Errorf("scan column info: %w", err)
		}
		if name == "server_id" {
			hasServerID = true
			break
		}
	}

	if !hasServerID {
		// Добавляем колонку server_id со значением по умолчанию
		_, err := db.Exec(`ALTER TABLE history ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default'`)
		if err != nil {
			return fmt.Errorf("add server_id column: %w", err)
		}

		// Обновляем индекс
		_, err = db.Exec(`DROP INDEX IF EXISTS idx_history_lookup`)
		if err != nil {
			return fmt.Errorf("drop old index: %w", err)
		}
		_, err = db.Exec(`CREATE INDEX idx_history_lookup ON history(server_id, object_name, variable_name, timestamp)`)
		if err != nil {
			return fmt.Errorf("create new index: %w", err)
		}
	}

	return nil
}

func (s *sqliteStorage) Save(serverID, objectName, variableName string, value interface{}, timestamp time.Time) error {
	if serverID == "" {
		serverID = DefaultServerID
	}

	valueJSON, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("marshal value: %w", err)
	}

	_, err = s.db.Exec(
		`INSERT INTO history (server_id, object_name, variable_name, value, timestamp) VALUES (?, ?, ?, ?, ?)`,
		serverID, objectName, variableName, string(valueJSON), timestamp,
	)
	if err != nil {
		return fmt.Errorf("insert: %w", err)
	}

	return nil
}

func (s *sqliteStorage) GetHistory(serverID, objectName, variableName string, from, to time.Time) (*VariableHistory, error) {
	if serverID == "" {
		serverID = DefaultServerID
	}

	rows, err := s.db.Query(
		`SELECT value, timestamp FROM history
		 WHERE server_id = ? AND object_name = ? AND variable_name = ? AND timestamp >= ? AND timestamp <= ?
		 ORDER BY timestamp ASC`,
		serverID, objectName, variableName, from, to,
	)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	return scanPoints(rows, serverID, objectName, variableName)
}

func (s *sqliteStorage) GetLatest(serverID, objectName, variableName string, count int) (*VariableHistory, error) {
	if serverID == "" {
		serverID = DefaultServerID
	}

	rows, err := s.db.Query(
		`SELECT value, timestamp FROM (
			SELECT value, timestamp FROM history
			WHERE server_id = ? AND object_name = ? AND variable_name = ?
			ORDER BY timestamp DESC
			LIMIT ?
		) ORDER BY timestamp ASC`,
		serverID, objectName, variableName, count,
	)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	return scanPoints(rows, serverID, objectName, variableName)
}

func scanPoints(rows *sql.Rows, serverID, objectName, variableName string) (*VariableHistory, error) {
	var points []DataPoint
	for rows.Next() {
		var valueJSON string
		var timestamp time.Time
		if err := rows.Scan(&valueJSON, &timestamp); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}

		var value interface{}
		if err := json.Unmarshal([]byte(valueJSON), &value); err != nil {
			return nil, fmt.Errorf("unmarshal value: %w", err)
		}

		points = append(points, DataPoint{
			Timestamp: timestamp,
			Value:     value,
		})
	}

	return &VariableHistory{
		ServerID:     serverID,
		ObjectName:   objectName,
		VariableName: variableName,
		Points:       points,
	}, nil
}

func (s *sqliteStorage) Cleanup(olderThan time.Time) error {
	_, err := s.db.Exec(`DELETE FROM history WHERE timestamp < ?`, olderThan)
	if err != nil {
		return fmt.Errorf("delete: %w", err)
	}
	return nil
}

func (s *sqliteStorage) Close() error {
	return s.db.Close()
}

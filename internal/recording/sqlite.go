package recording

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// SQLiteBackend implements Backend interface for SQLite storage
type SQLiteBackend struct {
	mu     sync.RWMutex
	db     *sql.DB
	dbPath string
}

// NewSQLiteBackend creates a new SQLite backend
func NewSQLiteBackend(dbPath string) *SQLiteBackend {
	return &SQLiteBackend{
		dbPath: dbPath,
	}
}

// Open initializes the SQLite database
func (s *SQLiteBackend) Open() error {
	// Use WAL mode and busy_timeout for better concurrency
	dsn := s.dbPath + "?_journal_mode=WAL&_busy_timeout=5000"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}

	if err := s.createTables(db); err != nil {
		db.Close()
		return err
	}

	s.db = db
	return nil
}

func (s *SQLiteBackend) createTables(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS recording (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			server_id TEXT NOT NULL,
			object_name TEXT NOT NULL,
			variable_name TEXT NOT NULL,
			value TEXT NOT NULL,
			timestamp DATETIME NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_recording_lookup
			ON recording(server_id, object_name, variable_name, timestamp);
		CREATE INDEX IF NOT EXISTS idx_recording_timestamp
			ON recording(timestamp);

		CREATE TABLE IF NOT EXISTS servers (
			server_id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			updated_at DATETIME NOT NULL
		);
	`)
	if err != nil {
		return fmt.Errorf("create tables: %w", err)
	}
	return nil
}

// SaveServer saves or updates server info in the reference table
func (s *SQLiteBackend) SaveServer(info ServerInfo) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("database not open")
	}

	updatedAt := time.Now().UTC().Format(time.RFC3339Nano)

	_, err := s.db.Exec(`
		INSERT INTO servers (server_id, name, url, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(server_id) DO UPDATE SET
			name = excluded.name,
			url = excluded.url,
			updated_at = excluded.updated_at
	`, info.ServerID, info.Name, info.URL, updatedAt)

	if err != nil {
		return fmt.Errorf("save server: %w", err)
	}
	return nil
}

// GetServers returns all servers from the reference table
func (s *SQLiteBackend) GetServers() ([]ServerInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("database not open")
	}

	rows, err := s.db.Query(`SELECT server_id, name, url, updated_at FROM servers ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("query servers: %w", err)
	}
	defer rows.Close()

	var servers []ServerInfo
	for rows.Next() {
		var info ServerInfo
		if err := rows.Scan(&info.ServerID, &info.Name, &info.URL, &info.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan server: %w", err)
		}
		servers = append(servers, info)
	}

	return servers, nil
}

// Close closes the database connection
func (s *SQLiteBackend) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// Save stores a single data record
func (s *SQLiteBackend) Save(record DataRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("database not open")
	}

	valueJSON, err := json.Marshal(record.Value)
	if err != nil {
		return fmt.Errorf("marshal value: %w", err)
	}

	// Format timestamp as RFC3339Nano string for consistent storage and retrieval
	timestampStr := record.Timestamp.UTC().Format(time.RFC3339Nano)

	_, err = s.db.Exec(
		`INSERT INTO recording (server_id, object_name, variable_name, value, timestamp) VALUES (?, ?, ?, ?, ?)`,
		record.ServerID, record.ObjectName, record.VariableName, string(valueJSON), timestampStr,
	)
	if err != nil {
		return fmt.Errorf("insert: %w", err)
	}

	return nil
}

// SaveBatch stores multiple records in a single transaction
func (s *SQLiteBackend) SaveBatch(records []DataRecord) error {
	if len(records) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db == nil {
		return fmt.Errorf("database not open")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO recording (server_id, object_name, variable_name, value, timestamp) VALUES (?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare statement: %w", err)
	}
	defer stmt.Close()

	for _, record := range records {
		valueJSON, err := json.Marshal(record.Value)
		if err != nil {
			return fmt.Errorf("marshal value: %w", err)
		}
		// Format timestamp as RFC3339Nano string for consistent storage and retrieval
		timestampStr := record.Timestamp.UTC().Format(time.RFC3339Nano)
		_, err = stmt.Exec(record.ServerID, record.ObjectName, record.VariableName, string(valueJSON), timestampStr)
		if err != nil {
			return fmt.Errorf("exec insert: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

// GetHistory retrieves records matching the filter
func (s *SQLiteBackend) GetHistory(filter ExportFilter) ([]DataRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.db == nil {
		return nil, fmt.Errorf("database not open")
	}

	query := `SELECT server_id, object_name, variable_name, value, timestamp FROM recording WHERE 1=1`
	args := []interface{}{}

	if filter.From != nil {
		query += ` AND timestamp >= ?`
		args = append(args, filter.From.UTC().Format(time.RFC3339Nano))
	}
	if filter.To != nil {
		query += ` AND timestamp <= ?`
		args = append(args, filter.To.UTC().Format(time.RFC3339Nano))
	}
	if filter.ServerID != "" {
		query += ` AND server_id = ?`
		args = append(args, filter.ServerID)
	}
	if filter.ObjectName != "" {
		query += ` AND object_name = ?`
		args = append(args, filter.ObjectName)
	}

	query += ` ORDER BY timestamp ASC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	var records []DataRecord
	for rows.Next() {
		var record DataRecord
		var valueJSON string
		if err := rows.Scan(&record.ServerID, &record.ObjectName, &record.VariableName, &valueJSON, &record.Timestamp); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		if err := json.Unmarshal([]byte(valueJSON), &record.Value); err != nil {
			return nil, fmt.Errorf("unmarshal value: %w", err)
		}
		records = append(records, record)
	}

	return records, nil
}

// GetStats returns storage statistics
func (s *SQLiteBackend) GetStats() (Stats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var stats Stats

	if s.db == nil {
		return stats, fmt.Errorf("database not open")
	}

	// Count records
	err := s.db.QueryRow(`SELECT COUNT(*) FROM recording`).Scan(&stats.RecordCount)
	if err != nil {
		return stats, fmt.Errorf("count records: %w", err)
	}

	// Get file size
	fileInfo, err := os.Stat(s.dbPath)
	if err == nil {
		stats.SizeBytes = fileInfo.Size()
	}

	// Get oldest and newest records
	if stats.RecordCount > 0 {
		var oldestStr, newestStr string
		err = s.db.QueryRow(`SELECT MIN(timestamp), MAX(timestamp) FROM recording`).Scan(&oldestStr, &newestStr)
		if err != nil {
			return stats, fmt.Errorf("get time bounds: %w", err)
		}
		// Parse timestamps from SQLite format
		if oldestStr != "" {
			if t, err := time.Parse(time.RFC3339Nano, oldestStr); err == nil {
				stats.OldestRecord = t
			} else if t, err := time.Parse("2006-01-02T15:04:05.999999999Z07:00", oldestStr); err == nil {
				stats.OldestRecord = t
			} else if t, err := time.Parse("2006-01-02 15:04:05", oldestStr); err == nil {
				stats.OldestRecord = t
			}
		}
		if newestStr != "" {
			if t, err := time.Parse(time.RFC3339Nano, newestStr); err == nil {
				stats.NewestRecord = t
			} else if t, err := time.Parse("2006-01-02T15:04:05.999999999Z07:00", newestStr); err == nil {
				stats.NewestRecord = t
			} else if t, err := time.Parse("2006-01-02 15:04:05", newestStr); err == nil {
				stats.NewestRecord = t
			}
		}
	}

	return stats, nil
}

// Cleanup removes oldest records to maintain maxRecords limit
func (s *SQLiteBackend) Cleanup(maxRecords int64) error {
	// Get current count
	var count int64
	err := s.db.QueryRow(`SELECT COUNT(*) FROM recording`).Scan(&count)
	if err != nil {
		return fmt.Errorf("count records: %w", err)
	}

	// If within limit, nothing to do
	threshold := int64(float64(maxRecords) * 1.1) // 10% buffer
	if count <= threshold {
		return nil
	}

	// Delete oldest 10% records
	deleteCount := count - maxRecords
	if deleteCount < int64(float64(maxRecords)*0.1) {
		deleteCount = int64(float64(maxRecords) * 0.1)
	}

	_, err = s.db.Exec(`
		DELETE FROM recording
		WHERE id IN (
			SELECT id FROM recording
			ORDER BY timestamp ASC
			LIMIT ?
		)
	`, deleteCount)
	if err != nil {
		return fmt.Errorf("delete old records: %w", err)
	}

	return nil
}

// Clear removes all records
func (s *SQLiteBackend) Clear() error {
	_, err := s.db.Exec(`DELETE FROM recording`)
	if err != nil {
		return fmt.Errorf("clear: %w", err)
	}

	// Vacuum to reclaim space
	_, err = s.db.Exec(`VACUUM`)
	if err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}

	return nil
}

// ExportRaw writes the SQLite database file to the writer
func (s *SQLiteBackend) ExportRaw(w io.Writer) error {
	// Close and reopen to ensure all data is flushed
	if s.db != nil {
		// Checkpoint to ensure WAL is flushed
		_, _ = s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
	}

	file, err := os.Open(s.dbPath)
	if err != nil {
		return fmt.Errorf("open db file: %w", err)
	}
	defer file.Close()

	_, err = io.Copy(w, file)
	if err != nil {
		return fmt.Errorf("copy db file: %w", err)
	}

	return nil
}

// DBPath returns the database file path
func (s *SQLiteBackend) DBPath() string {
	return s.dbPath
}

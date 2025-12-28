package journal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
)

const (
	defaultTable    = "main_messages_src"
	defaultDatabase = "uniset"
)

// Client клиент для работы с журналом в ClickHouse
type Client struct {
	conn     driver.Conn
	info     JournalInfo
	urlStr   string
	database string
	table    string
}

// NewClient создаёт нового клиента для журнала
// URL формат: clickhouse://host:port/database?table=xxx&name=Name
func NewClient(urlStr string) (*Client, error) {
	u, err := url.Parse(urlStr)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	// Извлекаем параметры
	query := u.Query()
	table := query.Get("table")
	if table == "" {
		table = defaultTable
	}
	name := query.Get("name")

	// Извлекаем database из пути
	database := strings.TrimPrefix(u.Path, "/")
	if database == "" {
		database = defaultDatabase
	}

	// Генерируем имя если не указано
	if name == "" {
		name = fmt.Sprintf("%s@%s", database, u.Host)
	}

	// Генерируем ID
	hash := sha256.Sum256([]byte(urlStr))
	id := hex.EncodeToString(hash[:4])

	// Убираем наши параметры из URL для clickhouse
	query.Del("table")
	query.Del("name")
	u.RawQuery = query.Encode()

	// Создаём подключение
	opts, err := clickhouse.ParseDSN(u.String())
	if err != nil {
		return nil, fmt.Errorf("failed to parse DSN: %w", err)
	}

	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to open connection: %w", err)
	}

	// Проверяем подключение
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := conn.Ping(ctx); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to ping: %w", err)
	}

	return &Client{
		conn:     conn,
		urlStr:   urlStr,
		database: database,
		table:    table,
		info: JournalInfo{
			ID:       id,
			Name:     name,
			Database: database,
			Table:    table,
			Status:   "connected",
		},
	}, nil
}

// Info возвращает информацию о журнале
func (c *Client) Info() JournalInfo {
	return c.info
}

// ID возвращает ID журнала
func (c *Client) ID() string {
	return c.info.ID
}

// Query выполняет запрос сообщений с фильтрами
func (c *Client) Query(ctx context.Context, params QueryParams) (*MessagesResponse, error) {
	// Строим WHERE условия
	var conditions []string
	var args []interface{}

	if !params.From.IsZero() {
		conditions = append(conditions, "timestamp >= ?")
		args = append(args, params.From)
	}
	if !params.To.IsZero() {
		conditions = append(conditions, "timestamp <= ?")
		args = append(args, params.To)
	}
	if len(params.MTypes) > 0 {
		placeholders := make([]string, len(params.MTypes))
		for i, t := range params.MTypes {
			placeholders[i] = "?"
			args = append(args, t)
		}
		conditions = append(conditions, fmt.Sprintf("mtype IN (%s)", strings.Join(placeholders, ",")))
	}
	if len(params.MGroups) > 0 {
		placeholders := make([]string, len(params.MGroups))
		for i, g := range params.MGroups {
			placeholders[i] = "?"
			args = append(args, g)
		}
		conditions = append(conditions, fmt.Sprintf("mgroup IN (%s)", strings.Join(placeholders, ",")))
	}
	if params.Search != "" {
		conditions = append(conditions, "(message ILIKE ? OR name ILIKE ?)")
		searchPattern := "%" + params.Search + "%"
		args = append(args, searchPattern, searchPattern)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Лимит и смещение
	limit := params.Limit
	if limit <= 0 {
		limit = 100
	}
	offset := params.Offset
	if offset < 0 {
		offset = 0
	}

	// Сначала получаем общее количество
	countQuery := fmt.Sprintf("SELECT count() FROM %s.%s %s", c.database, c.table, whereClause)
	var total uint64
	if err := c.conn.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count query failed: %w", err)
	}

	// Затем получаем данные
	dataQuery := fmt.Sprintf(`
		SELECT timestamp, value, name, message, mtype, mgroup, mcode
		FROM %s.%s
		%s
		ORDER BY timestamp DESC
		LIMIT %d OFFSET %d
	`, c.database, c.table, whereClause, limit, offset)

	rows, err := c.conn.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("data query failed: %w", err)
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		if err := rows.Scan(&msg.Timestamp, &msg.Value, &msg.Name, &msg.Message, &msg.MType, &msg.MGroup, &msg.MCode); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}
		messages = append(messages, msg)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows error: %w", err)
	}

	return &MessagesResponse{
		Messages: messages,
		Total:    int(total),
		Offset:   offset,
		Limit:    limit,
	}, nil
}

// GetLatest возвращает последние сообщения
func (c *Client) GetLatest(ctx context.Context, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 100
	}

	query := fmt.Sprintf(`
		SELECT timestamp, value, name, message, mtype, mgroup, mcode
		FROM %s.%s
		ORDER BY timestamp DESC
		LIMIT %d
	`, c.database, c.table, limit)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		if err := rows.Scan(&msg.Timestamp, &msg.Value, &msg.Name, &msg.Message, &msg.MType, &msg.MGroup, &msg.MCode); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}
		messages = append(messages, msg)
	}

	return messages, rows.Err()
}

// GetNewMessages возвращает новые сообщения после указанного времени
func (c *Client) GetNewMessages(ctx context.Context, since time.Time, limit int) ([]Message, error) {
	if limit <= 0 {
		limit = 100
	}

	query := fmt.Sprintf(`
		SELECT timestamp, value, name, message, mtype, mgroup, mcode
		FROM %s.%s
		WHERE timestamp > ?
		ORDER BY timestamp ASC
		LIMIT %d
	`, c.database, c.table, limit)

	rows, err := c.conn.Query(ctx, query, since)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		if err := rows.Scan(&msg.Timestamp, &msg.Value, &msg.Name, &msg.Message, &msg.MType, &msg.MGroup, &msg.MCode); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}
		messages = append(messages, msg)
	}

	return messages, rows.Err()
}

// GetMTypes возвращает список уникальных типов сообщений
func (c *Client) GetMTypes(ctx context.Context) ([]string, error) {
	query := fmt.Sprintf(`
		SELECT DISTINCT mtype
		FROM %s.%s
		WHERE mtype != ''
		ORDER BY mtype
	`, c.database, c.table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var types []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}
		types = append(types, t)
	}

	return types, rows.Err()
}

// GetMGroups возвращает список уникальных групп сообщений
func (c *Client) GetMGroups(ctx context.Context) ([]string, error) {
	query := fmt.Sprintf(`
		SELECT DISTINCT mgroup
		FROM %s.%s
		WHERE mgroup != ''
		ORDER BY mgroup
	`, c.database, c.table)

	rows, err := c.conn.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var groups []string
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			return nil, fmt.Errorf("scan failed: %w", err)
		}
		groups = append(groups, g)
	}

	return groups, rows.Err()
}

// Close закрывает соединение
func (c *Client) Close() error {
	return c.conn.Close()
}

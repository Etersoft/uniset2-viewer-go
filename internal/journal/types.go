package journal

import (
	"time"
)

// Message представляет одно сообщение из журнала
type Message struct {
	Timestamp time.Time `json:"timestamp"`
	Value     float64   `json:"value"`
	Name      string    `json:"name"`    // имя датчика
	Message   string    `json:"message"` // текст сообщения
	MType     string    `json:"mtype"`   // тип: Alarm, Emergancy, Normal, Warning, Cauton, Blocking
	MGroup    string    `json:"mgroup,omitempty"`
	MCode     string    `json:"mcode,omitempty"`
}

// QueryParams параметры запроса сообщений
type QueryParams struct {
	From    time.Time // начало периода
	To      time.Time // конец периода
	MTypes  []string  // фильтр по типам сообщений
	MGroups []string  // фильтр по группам
	Search  string    // текстовый поиск
	Limit   int       // лимит записей
	Offset  int       // смещение для пагинации
}

// JournalInfo информация о журнале для API
type JournalInfo struct {
	ID       string `json:"id"`       // уникальный ID (hash от URL)
	Name     string `json:"name"`     // человекочитаемое имя
	Database string `json:"database"` // база данных
	Table    string `json:"table"`    // таблица
	Status   string `json:"status"`   // connected, error, connecting
}

// MessagesResponse ответ API со списком сообщений
type MessagesResponse struct {
	Messages []Message `json:"messages"`
	Total    int       `json:"total"`  // общее количество (для пагинации)
	Offset   int       `json:"offset"` // текущее смещение
	Limit    int       `json:"limit"`  // лимит
}

// SSEMessage событие для SSE
type SSEMessage struct {
	JournalID string    `json:"journalId"`
	Messages  []Message `json:"messages"`
}

package uniset

import "encoding/json"

// ObjectList список имён объектов из /api/v01/list
type ObjectList []string

// Timer информация о таймере
type Timer struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Msec     int64  `json:"msec"`
	TimeLeft int64  `json:"timeleft"`
	Tick     int64  `json:"tick"`
}

// Sensor информация о сенсоре
type Sensor struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

// LogServer информация о лог-сервере
type LogServer struct {
	Host  string `json:"host"`
	Port  int    `json:"port"`
	State string `json:"state"`
}

// IOVar переменная ввода/вывода
type IOVar struct {
	ID      int64       `json:"id"`
	Name    string      `json:"name"`
	Value   interface{} `json:"value"`
	Comment string      `json:"comment,omitempty"`
	VarType string      `json:"vartype,omitempty"`
}

// IOData входы и выходы объекта
type IOData struct {
	In  map[string]IOVar `json:"in,omitempty"`
	Out map[string]IOVar `json:"out,omitempty"`
}

// ObjectInfo информация об объекте
type ObjectInfo struct {
	ID                    int64  `json:"id"`
	Name                  string `json:"name"`
	IsActive              bool   `json:"isActive"`
	LostMessages          int64  `json:"lostMessages"`
	MaxSizeOfMessageQueue int64  `json:"maxSizeOfMessageQueue"`
	MsgCount              int64  `json:"msgCount"`
	ObjectType            string `json:"objectType"`
}

// ObjectData данные объекта из /api/v01/{ObjectName}
type ObjectData struct {
	Name       string                 `json:"-"`
	LogServer  *LogServer             `json:"LogServer,omitempty"`
	Timers     map[string]interface{} `json:"Timers,omitempty"`
	Variables  map[string]interface{} `json:"Variables,omitempty"`
	Statistics map[string]interface{} `json:"Statistics,omitempty"`
	IO         *IOData                `json:"io,omitempty"`
	Object     *ObjectInfo            `json:"object,omitempty"`
	// Дополнительные пользовательские поля на верхнем уровне
	Extra map[string]interface{} `json:"-"`
	// Сырые данные для fallback рендерера (все поля из JSON)
	RawData map[string]json.RawMessage `json:"-"`
}

// HelpCommand команда из справки
type HelpCommand struct {
	Name       string          `json:"name"`
	Desc       string          `json:"desc"`
	Parameters []HelpParameter `json:"parameters,omitempty"`
}

// HelpParameter параметр команды
type HelpParameter struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
}

// HelpResponse ответ от /api/v01/{ObjectName}/help
type HelpResponse struct {
	Help []HelpCommand `json:"help"`
}

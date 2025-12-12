package uniset

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// OPCUAStatusResponse содержит данные из /status
type OPCUAStatusResponse struct {
	Result string                 `json:"result"`
	Error  string                 `json:"error,omitempty"`
	Status map[string]interface{} `json:"status,omitempty"`
}

// OPCUAParamsResponse содержит данные из /getparam или /setparam
type OPCUAParamsResponse struct {
	Result  string                 `json:"result"`
	Error   string                 `json:"error,omitempty"`
	Params  map[string]interface{} `json:"params,omitempty"`
	Updated map[string]interface{} `json:"updated,omitempty"`
}

// OPCUASensorsResponse содержит список сенсоров
type OPCUASensorsResponse struct {
	Result  string                   `json:"result"`
	Error   string                   `json:"error,omitempty"`
	Sensors []map[string]interface{} `json:"sensors,omitempty"`
	Total   int                      `json:"total,omitempty"`
	Limit   int                      `json:"limit,omitempty"`
	Offset  int                      `json:"offset,omitempty"`
}

// OPCUASensorResponse содержит детали сенсора
type OPCUASensorResponse struct {
	Result string                 `json:"result"`
	Error  string                 `json:"error,omitempty"`
	Sensor map[string]interface{} `json:"sensor,omitempty"`
	Query  map[string]interface{} `json:"query,omitempty"`
}

// OPCUADiagnosticsResponse содержит диагностическую информацию
type OPCUADiagnosticsResponse struct {
	Result           string                   `json:"result"`
	Error            string                   `json:"error,omitempty"`
	Summary          map[string]interface{}   `json:"summary,omitempty"`
	LastErrors       []map[string]interface{} `json:"lastErrors,omitempty"`
	ErrorHistoryMax  int                      `json:"errorHistoryMax,omitempty"`
	ErrorHistorySize int                      `json:"errorHistorySize,omitempty"`
}

// OPCUAControlResponse содержит результат take/releaseControl
type OPCUAControlResponse struct {
	Result       string `json:"result"`
	Error        string `json:"error,omitempty"`
	Message      string `json:"message,omitempty"`
	PreviousMode int    `json:"previousMode,omitempty"`
	CurrentMode  int    `json:"currentMode,omitempty"`
}

func ensureOPCUAResult(result, errMsg string) error {
	if result == "" || strings.EqualFold(result, "OK") {
		return nil
	}
	if errMsg != "" {
		return fmt.Errorf("%s", errMsg)
	}
	return fmt.Errorf("request failed: %s", result)
}

// GetOPCUAStatus возвращает статус OPCUAExchange
func (c *Client) GetOPCUAStatus(objectName string) (*OPCUAStatusResponse, error) {
	data, err := c.doGet(fmt.Sprintf("%s/status", objectName))
	if err != nil {
		return nil, err
	}

	var resp OPCUAStatusResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetOPCUAParams читает выбранные параметры
func (c *Client) GetOPCUAParams(objectName string, params []string) (*OPCUAParamsResponse, error) {
	if len(params) == 0 {
		return nil, fmt.Errorf("at least one param is required")
	}

	values := url.Values{}
	for _, p := range params {
		values.Add("name", p)
	}

	path := fmt.Sprintf("%s/getparam?%s", objectName, values.Encode())
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUAParamsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// SetOPCUAParams устанавливает параметры
func (c *Client) SetOPCUAParams(objectName string, params map[string]interface{}) (*OPCUAParamsResponse, error) {
	if len(params) == 0 {
		return nil, fmt.Errorf("at least one param is required")
	}

	values := url.Values{}
	for k, v := range params {
		values.Set(k, fmt.Sprint(v))
	}

	path := fmt.Sprintf("%s/setparam?%s", objectName, values.Encode())
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUAParamsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetOPCUASensors возвращает список сенсоров
// search - текстовый поиск по имени
func (c *Client) GetOPCUASensors(objectName, search string, limit, offset int) (*OPCUASensorsResponse, error) {
	values := url.Values{}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	if search != "" {
		values.Set("search", search)
	}

	path := fmt.Sprintf("%s/sensors", objectName)
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUASensorsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetOPCUASensor возвращает детали конкретного сенсора
func (c *Client) GetOPCUASensor(objectName string, sensorID int64) (*OPCUASensorResponse, error) {
	path := fmt.Sprintf("%s/sensor?id=%d", objectName, sensorID)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUASensorResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetOPCUADiagnostics возвращает диагностику
func (c *Client) GetOPCUADiagnostics(objectName string) (*OPCUADiagnosticsResponse, error) {
	path := fmt.Sprintf("%s/diagnostics", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUADiagnosticsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// TakeOPCUAControl включает HTTP-контроль
func (c *Client) TakeOPCUAControl(objectName string) (*OPCUAControlResponse, error) {
	path := fmt.Sprintf("%s/takeControl", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUAControlResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// ReleaseOPCUAControl отключает HTTP-контроль
func (c *Client) ReleaseOPCUAControl(objectName string) (*OPCUAControlResponse, error) {
	path := fmt.Sprintf("%s/releaseControl", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp OPCUAControlResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureOPCUAResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

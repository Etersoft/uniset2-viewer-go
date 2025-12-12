package uniset

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

// MBStatusResponse содержит данные из /status
type MBStatusResponse struct {
	Result string                 `json:"result"`
	Error  string                 `json:"error,omitempty"`
	Status map[string]interface{} `json:"status,omitempty"`
}

// MBParamsResponse содержит данные из /getparam или /setparam
type MBParamsResponse struct {
	Result  string                 `json:"result"`
	Error   string                 `json:"error,omitempty"`
	Params  map[string]interface{} `json:"params,omitempty"`
	Updated map[string]interface{} `json:"updated,omitempty"`
	Unknown []string               `json:"unknown,omitempty"`
}

// MBRegister содержит информацию о регистре (датчике)
type MBRegister struct {
	ID        int64                  `json:"id"`
	Name      string                 `json:"name"`
	IOType    string                 `json:"iotype"`
	Value     int64                  `json:"value"`
	VType     string                 `json:"vtype"`
	Device    map[string]interface{} `json:"device"`
	Register  map[string]interface{} `json:"register"`
	NBit      int                    `json:"nbit"`
	Mask      int                    `json:"mask"`
	Precision int                    `json:"precision"`
}

// MBRegistersResponse содержит список регистров (датчиков)
type MBRegistersResponse struct {
	Result    string                   `json:"result"`
	Error     string                   `json:"error,omitempty"`
	Registers []map[string]interface{} `json:"registers,omitempty"`
	Total     int                      `json:"total,omitempty"`
	Count     int                      `json:"count,omitempty"`
	Limit     int                      `json:"limit,omitempty"`
	Offset    int                      `json:"offset,omitempty"`
}

// MBDevice содержит информацию об устройстве (slave)
type MBDevice struct {
	Addr     int    `json:"addr"`
	Respond  bool   `json:"respond"`
	DType    string `json:"dtype"`
	RegCount int    `json:"regCount"`
	Mode     int    `json:"mode"`
	SafeMode int    `json:"safeMode"`
}

// MBDevicesResponse содержит список устройств
type MBDevicesResponse struct {
	Result  string                   `json:"result"`
	Error   string                   `json:"error,omitempty"`
	Devices []map[string]interface{} `json:"devices,omitempty"`
	Count   int                      `json:"count,omitempty"`
}

// MBModeResponse содержит информацию о режиме работы
type MBModeResponse struct {
	Result    string   `json:"result"`
	Error     string   `json:"error,omitempty"`
	Mode      string   `json:"mode,omitempty"`
	ModeID    int      `json:"mode_id,omitempty"`
	Supported []string `json:"supported,omitempty"`
}

func ensureMBResult(result, errMsg string) error {
	if result == "" || strings.EqualFold(result, "OK") {
		return nil
	}
	if errMsg != "" {
		return fmt.Errorf("%s", errMsg)
	}
	return fmt.Errorf("request failed: %s", result)
}

// GetMBStatus возвращает статус ModbusMaster
func (c *Client) GetMBStatus(objectName string) (*MBStatusResponse, error) {
	data, err := c.doGet(fmt.Sprintf("%s/status", objectName))
	if err != nil {
		return nil, err
	}

	var resp MBStatusResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetMBParams читает выбранные параметры
func (c *Client) GetMBParams(objectName string, params []string) (*MBParamsResponse, error) {
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

	var resp MBParamsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// SetMBParams устанавливает параметры
func (c *Client) SetMBParams(objectName string, params map[string]interface{}) (*MBParamsResponse, error) {
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

	var resp MBParamsResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetMBRegisters возвращает список регистров (датчиков)
// search - текстовый поиск по имени
func (c *Client) GetMBRegisters(objectName, search, iotype string, limit, offset int) (*MBRegistersResponse, error) {
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
	if iotype != "" {
		values.Set("iotype", iotype)
	}

	path := fmt.Sprintf("%s/registers", objectName)
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBRegistersResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetMBDevices возвращает список устройств (slaves)
func (c *Client) GetMBDevices(objectName string) (*MBDevicesResponse, error) {
	path := fmt.Sprintf("%s/devices", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBDevicesResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetMBMode возвращает текущий режим работы
func (c *Client) GetMBMode(objectName string) (*MBModeResponse, error) {
	path := fmt.Sprintf("%s/mode?get", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBModeResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetMBModeSupported возвращает список поддерживаемых режимов
func (c *Client) GetMBModeSupported(objectName string) (*MBModeResponse, error) {
	path := fmt.Sprintf("%s/mode?supported=1", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBModeResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// SetMBMode устанавливает режим работы
func (c *Client) SetMBMode(objectName, mode string) (*MBModeResponse, error) {
	path := fmt.Sprintf("%s/mode?set=%s", objectName, url.QueryEscape(mode))
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBModeResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// MBControlResponse содержит ответ на takeControl/releaseControl
type MBControlResponse struct {
	Result            string `json:"result"`
	Error             string `json:"error,omitempty"`
	HTTPControlActive int    `json:"httpControlActive,omitempty"`
}

// TakeMBControl перехватывает управление через HTTP
func (c *Client) TakeMBControl(objectName string) (*MBControlResponse, error) {
	path := fmt.Sprintf("%s/takeControl", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBControlResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	// Не проверяем ensureMBResult, т.к. result может быть ERROR если httpControlAllow=0
	return &resp, nil
}

// ReleaseMBControl возвращает управление
func (c *Client) ReleaseMBControl(objectName string) (*MBControlResponse, error) {
	path := fmt.Sprintf("%s/releaseControl", objectName)
	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBControlResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetMBRegisterValues получает значения конкретных регистров по ID
// GET /{objectName}/registers?ids=id1,id2,id3
func (c *Client) GetMBRegisterValues(objectName string, registerIDs string) (*MBRegistersResponse, error) {
	path := fmt.Sprintf("%s/registers?ids=%s", objectName, registerIDs)

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var resp MBRegistersResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureMBResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

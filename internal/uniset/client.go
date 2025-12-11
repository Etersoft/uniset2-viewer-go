package uniset

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const apiVersion = "v2"

type Client struct {
	baseURL    string
	httpClient *http.Client
	Supplier   string // supplier name for set/freeze/unfreeze operations
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL:  baseURL,
		Supplier: "TestProc", // default supplier
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// NewClientWithSupplier creates a new client with custom supplier
func NewClientWithSupplier(baseURL, supplier string) *Client {
	return &Client{
		baseURL:  baseURL,
		Supplier: supplier,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) doGet(path string) ([]byte, error) {
	url := fmt.Sprintf("%s/api/%s/%s", c.baseURL, apiVersion, path)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("request %s failed: %w", url, err)
	}

	body, readErr := io.ReadAll(resp.Body)
	resp.Body.Close()
	if readErr != nil {
		return nil, fmt.Errorf("read response from %s failed: %w", url, readErr)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: status %d (%s)", url, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	return body, nil
}

// GetObjectList возвращает список доступных объектов
func (c *Client) GetObjectList() (ObjectList, error) {
	data, err := c.doGet("list")
	if err != nil {
		return nil, err
	}

	var result ObjectList
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return result, nil
}

// GetObjectData возвращает данные объекта
// Гибридный подход: парсим только нужные серверу поля, остальное — raw для UI
func (c *Client) GetObjectData(objectName string) (*ObjectData, error) {
	data, err := c.doGet(objectName)
	if err != nil {
		return nil, err
	}

	// Ответ имеет структуру {"ObjectName": {...}, "object": {...}}
	// Но для некоторых объектов (например UniSetActivator) есть только "object"
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	var result ObjectData
	result.Name = objectName
	result.RawData = raw

	// Извлекаем поле "object" с информацией об объекте (id, objectType и т.д.)
	if objectInfo, exists := raw["object"]; exists {
		var info ObjectInfo
		if err := json.Unmarshal(objectInfo, &info); err == nil {
			// Некоторые объекты возвращают extensionsType - нормализуем в extensionType
			if info.ExtensionType == "" && info.ExtensionsType != "" {
				info.ExtensionType = info.ExtensionsType
			}
			if info.ExtensionsType != "" && info.ExtensionType == info.ExtensionsType {
				info.ExtensionsType = ""
			}
			result.Object = &info
		}
	}

	// Пробуем найти данные объекта по имени — там находятся Variables, IO, LogServer
	if objData, ok := raw[objectName]; ok {
		// Парсим только нужные серверу поля
		var serverFields struct {
			LogServer *LogServer             `json:"LogServer,omitempty"`
			Variables map[string]interface{} `json:"Variables,omitempty"`
			IO        *IOData                `json:"io,omitempty"`
		}
		if err := json.Unmarshal(objData, &serverFields); err == nil {
			result.LogServer = serverFields.LogServer
			result.Variables = serverFields.Variables
			result.IO = serverFields.IO
		}
	}

	return &result, nil
}

// GetObjectHelp возвращает справку по командам объекта
func (c *Client) GetObjectHelp(objectName string) (*HelpResponse, error) {
	data, err := c.doGet(fmt.Sprintf("%s/help", objectName))
	if err != nil {
		return nil, err
	}

	var result HelpResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return &result, nil
}

// SMSensor описывает датчик из SharedMemory
type SMSensor struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Value    int64  `json:"value"`
	Blocked  bool   `json:"blocked"`
	Frozen   bool   `json:"frozen"`
	ReadOnly bool   `json:"readonly"`
}

// SMSensorsResponse ответ от SM /sensors endpoint
type SMSensorsResponse struct {
	Count   int        `json:"count"`
	Sensors []SMSensor `json:"sensors"`
}

// GetSMSensors возвращает список датчиков из SharedMemory
func (c *Client) GetSMSensors() (*SMSensorsResponse, error) {
	data, err := c.doGet("SharedMemory/sensors")
	if err != nil {
		return nil, err
	}

	var result SMSensorsResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return &result, nil
}

// === IONotifyController API ===

// IONCSensor описывает датчик из IONotifyController с полными данными
type IONCSensor struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Value       int64  `json:"value"`
	RealValue   int64  `json:"real_value"`
	DefaultVal  int64  `json:"default_val"`
	Blocked     bool   `json:"blocked"`
	Frozen      bool   `json:"frozen"`
	ReadOnly    bool   `json:"readonly"`
	Undefined   bool   `json:"undefined"`
	DBIgnore    bool   `json:"dbignore"`
	NChanges    int64  `json:"nchanges"`
	TVSec       int64  `json:"tv_sec"`
	TVNsec      int64  `json:"tv_nsec"`
	Calibration struct {
		CMax      float64 `json:"cmax"`
		CMin      float64 `json:"cmin"`
		RMax      float64 `json:"rmax"`
		RMin      float64 `json:"rmin"`
		Precision int     `json:"precision"`
	} `json:"calibration"`
}

// IONCSensorsResponse ответ от IONotifyController /sensors endpoint
type IONCSensorsResponse struct {
	Count   int          `json:"count"`
	Size    int          `json:"size"`
	Object  *ObjectInfo  `json:"object"`
	Sensors []IONCSensor `json:"sensors"`
}

// IONCConsumer описывает подписчика на датчик
type IONCConsumer struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Node string `json:"node"`
}

// IONCConsumersResponse ответ от IONotifyController /consumers endpoint
type IONCConsumersResponse struct {
	Object  *ObjectInfo `json:"object"`
	Sensors []struct {
		Sensor struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
		} `json:"sensor"`
		Consumers []IONCConsumer `json:"consumers"`
	} `json:"sensors"`
}

// IONCLostConsumersResponse ответ от IONotifyController /lost endpoint
type IONCLostConsumersResponse struct {
	Object        *ObjectInfo    `json:"object"`
	LostConsumers []IONCConsumer `json:"lost consumers"`
}

// GetIONCSensors возвращает список датчиков из IONotifyController объекта
// GET /{objectName}/sensors?offset=N&limit=M&filter=text
func (c *Client) GetIONCSensors(objectName string, offset, limit int, filter string) (*IONCSensorsResponse, error) {
	values := url.Values{}
	if offset > 0 {
		values.Set("offset", strconv.Itoa(offset))
	}
	if limit > 0 {
		values.Set("limit", strconv.Itoa(limit))
	}
	if filter != "" {
		values.Set("filter", filter)
	}

	path := fmt.Sprintf("%s/sensors", objectName)
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var result IONCSensorsResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return &result, nil
}

// GetIONCSensorValues получает значения конкретных датчиков
// GET /{objectName}/get?id1,name2,id3
func (c *Client) GetIONCSensorValues(objectName string, sensors string) (*IONCSensorsResponse, error) {
	path := fmt.Sprintf("%s/get?%s", objectName, sensors)

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var result IONCSensorsResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return &result, nil
}

// SetIONCSensorValue устанавливает значение датчика
// GET /api/v2/{objectName}/set?supplier={supplier}&id=value
func (c *Client) SetIONCSensorValue(objectName string, sensorID int64, value int64) error {
	path := fmt.Sprintf("%s/set?supplier=%s&%d=%d", objectName, c.Supplier, sensorID, value)

	_, err := c.doGet(path)
	return err
}

// FreezeIONCSensor замораживает датчик
// GET /api/v2/{objectName}/freeze?supplier={supplier}&id=value
func (c *Client) FreezeIONCSensor(objectName string, sensorID int64, value int64) error {
	path := fmt.Sprintf("%s/freeze?supplier=%s&%d=%d", objectName, c.Supplier, sensorID, value)

	_, err := c.doGet(path)
	return err
}

// UnfreezeIONCSensor размораживает датчик
// GET /api/v2/{objectName}/unfreeze?supplier={supplier}&id
func (c *Client) UnfreezeIONCSensor(objectName string, sensorID int64) error {
	path := fmt.Sprintf("%s/unfreeze?supplier=%s&%d", objectName, c.Supplier, sensorID)

	_, err := c.doGet(path)
	return err
}

// GetIONCConsumers возвращает список подписчиков на датчики
// GET /{objectName}/consumers?sensor1,sensor2
func (c *Client) GetIONCConsumers(objectName string, sensors string) (*IONCConsumersResponse, error) {
	path := fmt.Sprintf("%s/consumers?%s", objectName, sensors)

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var result IONCConsumersResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return &result, nil
}

// GetIONCLostConsumers возвращает список потерянных подписчиков
// GET /{objectName}/lost
func (c *Client) GetIONCLostConsumers(objectName string) (*IONCLostConsumersResponse, error) {
	path := fmt.Sprintf("%s/lost", objectName)

	data, err := c.doGet(path)
	if err != nil {
		return nil, err
	}

	var result IONCLostConsumersResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}

	return &result, nil
}

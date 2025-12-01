package uniset

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const apiVersion = "v01"

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) doGet(path string) ([]byte, error) {
	url := fmt.Sprintf("%s/api/%s/%s", c.baseURL, apiVersion, path)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body failed: %w", err)
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

	// Пробуем найти данные объекта по имени
	if objData, ok := raw[objectName]; ok {
		if err := json.Unmarshal(objData, &result); err != nil {
			return nil, fmt.Errorf("unmarshal object data failed: %w", err)
		}
	}

	// Извлекаем поле "object" с информацией об объекте (id, objectType и т.д.)
	if objectInfo, exists := raw["object"]; exists {
		var info ObjectInfo
		if err := json.Unmarshal(objectInfo, &info); err == nil {
			result.Object = &info
		}
	}

	// Сохраняем сырые данные для fallback рендерера
	result.RawData = raw

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

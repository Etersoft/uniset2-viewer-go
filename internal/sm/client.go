package sm

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SensorValue представляет значение датчика из SM
type SensorValue struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Value     int64  `json:"value"`
	RealValue float64 `json:"real_value"`
	TVSec     int64  `json:"tv_sec"`
	TVNsec    int64  `json:"tv_nsec"`
	Error     string `json:"error,omitempty"`
}

// GetResponse ответ от SM /get endpoint
type GetResponse struct {
	Object  json.RawMessage `json:"object"`
	Sensors []SensorValue   `json:"sensors"`
}

// Client клиент для работы с SharedMemory API
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient создает новый SM клиент
func NewClient(baseURL string) *Client {
	// Убираем trailing slash
	baseURL = strings.TrimSuffix(baseURL, "/")

	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// GetValues получает значения датчиков по именам или ID
// sensors - список имен или ID датчиков через запятую
func (c *Client) GetValues(sensors []string) (map[string]SensorValue, error) {
	if len(sensors) == 0 {
		return make(map[string]SensorValue), nil
	}

	// Формируем URL: /api/v01/SharedMemory/get?name1,name2,id3&shortInfo
	query := strings.Join(sensors, ",")
	url := fmt.Sprintf("%s/api/v01/SharedMemory/get?%s&shortInfo", c.baseURL, query)

	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("SM request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("SM returned status %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read SM response failed: %w", err)
	}

	var result GetResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("unmarshal SM response failed: %w", err)
	}

	// Преобразуем в map по имени
	values := make(map[string]SensorValue, len(result.Sensors))
	for _, s := range result.Sensors {
		if s.Error == "" {
			values[s.Name] = s
		}
	}

	return values, nil
}

// GetValue получает значение одного датчика
func (c *Client) GetValue(sensor string) (*SensorValue, error) {
	values, err := c.GetValues([]string{sensor})
	if err != nil {
		return nil, err
	}

	if v, ok := values[sensor]; ok {
		return &v, nil
	}

	return nil, fmt.Errorf("sensor %s not found", sensor)
}

// IsAvailable проверяет доступность SM
func (c *Client) IsAvailable() bool {
	url := fmt.Sprintf("%s/api/v01/SharedMemory/", c.baseURL)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// ConfigFile представляет структуру YAML файла конфигурации
type ConfigFile struct {
	Servers         []ServerConfig   `yaml:"servers"`
	UI              *UIConfig        `yaml:"ui,omitempty"`
	LogStream       *LogStreamConfig `yaml:"logStream,omitempty"`
	SensorBatchSize int              `yaml:"sensorBatchSize,omitempty"` // Макс. датчиков в одном запросе (default: 300)
}

// LoadFromYAML загружает полную конфигурацию из YAML файла
func LoadFromYAML(path string) (*ConfigFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var configFile ConfigFile
	if err := yaml.Unmarshal(data, &configFile); err != nil {
		return nil, fmt.Errorf("failed to parse YAML: %w", err)
	}

	// Валидация: каждый сервер должен иметь URL
	for i, srv := range configFile.Servers {
		if srv.URL == "" {
			return nil, fmt.Errorf("server at index %d has no URL", i)
		}
	}

	return &configFile, nil
}

// LoadServersFromYAML загружает конфигурацию серверов из YAML файла (для обратной совместимости)
func LoadServersFromYAML(path string) ([]ServerConfig, error) {
	configFile, err := LoadFromYAML(path)
	if err != nil {
		return nil, err
	}
	return configFile.Servers, nil
}

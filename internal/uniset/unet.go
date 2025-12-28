package uniset

import (
	"encoding/json"
	"fmt"
)

// UNetStatusResponse содержит статус UNetExchange
type UNetStatusResponse struct {
	Result string                 `json:"result"`
	Error  string                 `json:"error,omitempty"`
	Status map[string]interface{} `json:"status,omitempty"`
}

// UNetReceiversResponse содержит список receivers
type UNetReceiversResponse struct {
	Result    string                   `json:"result"`
	Error     string                   `json:"error,omitempty"`
	Receivers []map[string]interface{} `json:"receivers,omitempty"`
}

// UNetSendersResponse содержит список senders
type UNetSendersResponse struct {
	Result  string                 `json:"result"`
	Error   string                 `json:"error,omitempty"`
	Senders map[string]interface{} `json:"senders,omitempty"`
}

// GetUNetStatus возвращает статус UNetExchange
func (c *Client) GetUNetStatus(objectName string) (*UNetStatusResponse, error) {
	data, err := c.doGet(fmt.Sprintf("%s/status", objectName))
	if err != nil {
		return nil, err
	}

	var resp UNetStatusResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetUNetReceivers возвращает список receivers UNetExchange
func (c *Client) GetUNetReceivers(objectName string) (*UNetReceiversResponse, error) {
	data, err := c.doGet(fmt.Sprintf("%s/receivers", objectName))
	if err != nil {
		return nil, err
	}

	var resp UNetReceiversResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetUNetSenders возвращает список senders UNetExchange
func (c *Client) GetUNetSenders(objectName string) (*UNetSendersResponse, error) {
	data, err := c.doGet(fmt.Sprintf("%s/senders", objectName))
	if err != nil {
		return nil, err
	}

	var resp UNetSendersResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal failed: %w", err)
	}
	if err := ensureResult(resp.Result, resp.Error); err != nil {
		return nil, err
	}
	return &resp, nil
}

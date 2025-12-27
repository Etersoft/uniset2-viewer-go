package poller

import (
	"strings"
	"testing"
)

func TestBuildIDQuery(t *testing.T) {
	tests := []struct {
		name     string
		ids      []int64
		expected string
	}{
		{"empty", []int64{}, ""},
		{"single", []int64{1}, "1"},
		{"two", []int64{1, 2}, "1,2"},
		{"multiple", []int64{1, 2, 3, 4, 5}, "1,2,3,4,5"},
		{"large ids", []int64{1000000, 2000000, 3000000}, "1000000,2000000,3000000"},
		{"negative ids", []int64{-1, -2, -3}, "-1,-2,-3"},
		{"mixed", []int64{1, -2, 3, -4}, "1,-2,3,-4"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := BuildIDQuery(tt.ids)
			if got != tt.expected {
				t.Errorf("BuildIDQuery(%v) = %q, want %q", tt.ids, got, tt.expected)
			}
		})
	}
}

func TestBuildIDQueryNoTrailingComma(t *testing.T) {
	query := BuildIDQuery([]int64{1, 2, 3})
	if strings.HasSuffix(query, ",") {
		t.Error("query should not end with comma")
	}
	if strings.HasPrefix(query, ",") {
		t.Error("query should not start with comma")
	}
}

func TestBuildIDQueryLargeSlice(t *testing.T) {
	// Test with a large number of IDs
	ids := make([]int64, 1000)
	for i := range ids {
		ids[i] = int64(i + 1)
	}

	query := BuildIDQuery(ids)

	// Should have 999 commas for 1000 elements
	commaCount := strings.Count(query, ",")
	if commaCount != 999 {
		t.Errorf("expected 999 commas, got %d", commaCount)
	}

	// Should start with 1
	if !strings.HasPrefix(query, "1,") {
		t.Errorf("expected to start with '1,', got %q", query[:5])
	}

	// Should end with 1000
	if !strings.HasSuffix(query, ",1000") {
		parts := strings.Split(query, ",")
		t.Errorf("expected to end with '1000', got %q", parts[len(parts)-1])
	}
}

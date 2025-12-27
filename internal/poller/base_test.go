package poller

import (
	"fmt"
	"testing"
	"time"
)

// MockItem for testing BasePoller
type MockItem struct {
	ID    int64
	Value int64
}

// MockUpdate for testing BasePoller
type MockUpdate struct {
	ObjectName string
	Item       MockItem
	Timestamp  time.Time
}

// MockFetcher implements ItemFetcher for testing
type MockFetcher struct {
	items     map[string][]MockItem
	fetchErr  error
	callCount int
}

func (f *MockFetcher) FetchItems(objectName string, ids []int64) ([]MockItem, error) {
	f.callCount++
	if f.fetchErr != nil {
		return nil, f.fetchErr
	}
	items, ok := f.items[objectName]
	if !ok {
		return nil, nil
	}
	// Filter by IDs
	result := make([]MockItem, 0)
	for _, item := range items {
		for _, id := range ids {
			if item.ID == id {
				result = append(result, item)
				break
			}
		}
	}
	return result, nil
}

func (f *MockFetcher) GetItemID(item MockItem) int64 {
	return item.ID
}

func (f *MockFetcher) GetValueHash(item MockItem) string {
	return fmt.Sprintf("%d", item.Value)
}

func TestNewBasePoller(t *testing.T) {
	fetcher := &MockFetcher{}
	callback := func(updates []MockUpdate) {}
	makeUpdate := func(objectName string, item MockItem, ts time.Time) MockUpdate {
		return MockUpdate{ObjectName: objectName, Item: item, Timestamp: ts}
	}

	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second,
		100,
		fetcher,
		makeUpdate,
		callback,
		"Test",
	)

	if bp == nil {
		t.Fatal("NewBasePoller returned nil")
	}
	if bp.interval != time.Second {
		t.Errorf("interval = %v, want %v", bp.interval, time.Second)
	}
	if bp.batchSize != 100 {
		t.Errorf("batchSize = %d, want 100", bp.batchSize)
	}
	if bp.subscriptions == nil {
		t.Error("subscriptions should not be nil")
	}
	if bp.lastValues == nil {
		t.Error("lastValues should not be nil")
	}
}

func TestBasePollerSubscribe(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	// Subscribe to some IDs
	bp.Subscribe("Object1", []int64{1, 2, 3})

	subs := bp.GetSubscriptions("Object1")
	if len(subs) != 3 {
		t.Errorf("len(subs) = %d, want 3", len(subs))
	}

	// Subscribe to more IDs (including duplicates)
	bp.Subscribe("Object1", []int64{3, 4, 5})
	subs = bp.GetSubscriptions("Object1")
	if len(subs) != 5 {
		t.Errorf("len(subs) after second subscribe = %d, want 5", len(subs))
	}
}

func TestBasePollerUnsubscribe(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2, 3, 4, 5})
	bp.Unsubscribe("Object1", []int64{2, 4})

	subs := bp.GetSubscriptions("Object1")
	if len(subs) != 3 {
		t.Errorf("len(subs) after unsubscribe = %d, want 3", len(subs))
	}

	// Check specific IDs
	subsMap := make(map[int64]bool)
	for _, id := range subs {
		subsMap[id] = true
	}
	if subsMap[2] || subsMap[4] {
		t.Error("IDs 2 and 4 should have been unsubscribed")
	}
	if !subsMap[1] || !subsMap[3] || !subsMap[5] {
		t.Error("IDs 1, 3, 5 should still be subscribed")
	}
}

func TestBasePollerUnsubscribeAll(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2, 3})
	bp.Subscribe("Object2", []int64{4, 5})

	bp.UnsubscribeAll("Object1")

	subs1 := bp.GetSubscriptions("Object1")
	if len(subs1) != 0 {
		t.Errorf("Object1 should have 0 subscriptions after UnsubscribeAll, got %d", len(subs1))
	}

	subs2 := bp.GetSubscriptions("Object2")
	if len(subs2) != 2 {
		t.Errorf("Object2 should still have 2 subscriptions, got %d", len(subs2))
	}
}

func TestBasePollerGetAllSubscriptions(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2})
	bp.Subscribe("Object2", []int64{3, 4, 5})

	all := bp.GetAllSubscriptions()
	if len(all) != 2 {
		t.Errorf("len(all) = %d, want 2", len(all))
	}
	if len(all["Object1"]) != 2 {
		t.Errorf("len(Object1) = %d, want 2", len(all["Object1"]))
	}
	if len(all["Object2"]) != 3 {
		t.Errorf("len(Object2) = %d, want 3", len(all["Object2"]))
	}
}

func TestBasePollerSubscriptionCount(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	if bp.SubscriptionCount() != 0 {
		t.Errorf("initial count = %d, want 0", bp.SubscriptionCount())
	}

	bp.Subscribe("Object1", []int64{1, 2, 3})
	if bp.SubscriptionCount() != 3 {
		t.Errorf("count after subscribe = %d, want 3", bp.SubscriptionCount())
	}

	bp.Subscribe("Object2", []int64{4, 5})
	if bp.SubscriptionCount() != 5 {
		t.Errorf("count after second subscribe = %d, want 5", bp.SubscriptionCount())
	}

	bp.Unsubscribe("Object1", []int64{2})
	if bp.SubscriptionCount() != 4 {
		t.Errorf("count after unsubscribe = %d, want 4", bp.SubscriptionCount())
	}
}

func TestBasePollerSetServerID(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.SetServerID("server123")

	bp.mu.RLock()
	defer bp.mu.RUnlock()
	if bp.serverID != "server123" {
		t.Errorf("serverID = %q, want %q", bp.serverID, "server123")
	}
}

func TestBasePollerStartStop(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		50*time.Millisecond, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Start()
	time.Sleep(100 * time.Millisecond)
	bp.Stop()

	// Should not panic and should exit cleanly
}

func TestBasePollerGetSubscriptionsEmpty(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	subs := bp.GetSubscriptions("NonExistent")
	if subs != nil {
		t.Errorf("expected nil for non-existent object, got %v", subs)
	}
}

func TestBasePollerUnsubscribeNonExistent(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	// Should not panic
	bp.Unsubscribe("NonExistent", []int64{1, 2, 3})
	bp.UnsubscribeAll("NonExistent")
}

func TestBasePollerSetRecordingManager(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	// SetRecordingManager with nil should not panic
	bp.SetRecordingManager(nil)

	bp.mu.RLock()
	if bp.recordingMgr != nil {
		t.Error("recordingMgr should be nil")
	}
	bp.mu.RUnlock()
}

func TestBasePollerSetToDataRecord(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	// SetToDataRecord with nil should not panic
	bp.SetToDataRecord(nil)

	bp.mu.RLock()
	if bp.toDataRecord != nil {
		t.Error("toDataRecord should be nil")
	}
	bp.mu.RUnlock()
}

func TestBasePollerSaveToRecordingNoManager(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	// Should not panic when recordingMgr is nil
	bp.saveToRecording([]MockUpdate{{ObjectName: "Test"}})
}

func TestBasePollerSaveToRecordingEmptyBatch(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	// Empty batch should return early
	bp.saveToRecording([]MockUpdate{})
}

func TestBasePollerHasValueChanged(t *testing.T) {
	fetcher := &MockFetcher{
		items: map[string][]MockItem{
			"Object1": {{ID: 1, Value: 100}, {ID: 2, Value: 200}},
		},
	}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{ObjectName: objectName, Item: item, Timestamp: ts}
		},
		nil, "Test",
	)

	item := MockItem{ID: 1, Value: 100}

	// First call should return true (new value)
	if !bp.hasValueChanged("Object1", item) {
		t.Error("first call should return true (new value)")
	}

	// Same value should return false
	if bp.hasValueChanged("Object1", item) {
		t.Error("same value should return false")
	}

	// Changed value should return true
	item.Value = 200
	if !bp.hasValueChanged("Object1", item) {
		t.Error("changed value should return true")
	}
}

func TestBasePollerUpdateLastValue(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	item := MockItem{ID: 1, Value: 42}
	bp.updateLastValue("Object1", item)

	bp.mu.RLock()
	defer bp.mu.RUnlock()

	if bp.lastValues["Object1"] == nil {
		t.Fatal("lastValues[Object1] should not be nil")
	}
	if bp.lastValues["Object1"][1] != "42" {
		t.Errorf("lastValues[Object1][1] = %q, want %q", bp.lastValues["Object1"][1], "42")
	}
}

func TestBasePollerPollObject(t *testing.T) {
	fetcher := &MockFetcher{
		items: map[string][]MockItem{
			"Object1": {{ID: 1, Value: 100}, {ID: 2, Value: 200}, {ID: 3, Value: 300}},
		},
	}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{ObjectName: objectName, Item: item, Timestamp: ts}
		},
		nil, "Test",
	)

	items, err := bp.pollObject("Object1", []int64{1, 2})
	if err != nil {
		t.Fatalf("pollObject failed: %v", err)
	}
	if len(items) != 2 {
		t.Errorf("len(items) = %d, want 2", len(items))
	}
}

func TestBasePollerPollObjectBatched(t *testing.T) {
	fetcher := &MockFetcher{
		items: map[string][]MockItem{
			"Object1": {
				{ID: 1, Value: 100},
				{ID: 2, Value: 200},
				{ID: 3, Value: 300},
				{ID: 4, Value: 400},
				{ID: 5, Value: 500},
			},
		},
	}
	// Small batch size to trigger batching
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 2, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{ObjectName: objectName, Item: item, Timestamp: ts}
		},
		nil, "Test",
	)

	items, err := bp.pollObject("Object1", []int64{1, 2, 3, 4, 5})
	if err != nil {
		t.Fatalf("pollObject failed: %v", err)
	}
	if len(items) != 5 {
		t.Errorf("len(items) = %d, want 5", len(items))
	}
	// Should have made 3 fetch calls (2+2+1)
	if fetcher.callCount != 3 {
		t.Errorf("callCount = %d, want 3", fetcher.callCount)
	}
}

func TestBasePollerPollObjectBatchedWithError(t *testing.T) {
	fetcher := &MockFetcher{
		fetchErr: fmt.Errorf("fetch error"),
	}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 2, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	_, err := bp.pollObject("Object1", []int64{1, 2, 3, 4, 5})
	if err == nil {
		t.Error("expected error when all batches fail")
	}
}

func TestBasePollerForceEmitAll(t *testing.T) {
	fetcher := &MockFetcher{
		items: map[string][]MockItem{
			"Object1": {{ID: 1, Value: 100}, {ID: 2, Value: 200}},
		},
	}

	var receivedUpdates []MockUpdate
	callback := func(updates []MockUpdate) {
		receivedUpdates = append(receivedUpdates, updates...)
	}

	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{ObjectName: objectName, Item: item, Timestamp: ts}
		},
		callback, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2})

	bp.ForceEmitAll()

	if len(receivedUpdates) != 2 {
		t.Errorf("len(receivedUpdates) = %d, want 2", len(receivedUpdates))
	}
}

func TestBasePollerForceEmitAllEmpty(t *testing.T) {
	fetcher := &MockFetcher{}

	callbackCalled := false
	callback := func(updates []MockUpdate) {
		callbackCalled = true
	}

	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		callback, "Test",
	)

	// No subscriptions
	bp.ForceEmitAll()

	if callbackCalled {
		t.Error("callback should not be called for empty subscriptions")
	}
}

func TestBasePollerForceEmitAllWithFetchError(t *testing.T) {
	fetcher := &MockFetcher{
		fetchErr: fmt.Errorf("fetch error"),
	}

	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2})

	// Should not panic on fetch error
	bp.ForceEmitAll()
}

func TestBasePollerPollWithCallback(t *testing.T) {
	fetcher := &MockFetcher{
		items: map[string][]MockItem{
			"Object1": {{ID: 1, Value: 100}},
		},
	}

	var receivedUpdates []MockUpdate
	callback := func(updates []MockUpdate) {
		receivedUpdates = append(receivedUpdates, updates...)
	}

	bp := NewBasePoller[MockItem, MockUpdate](
		50*time.Millisecond, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{ObjectName: objectName, Item: item, Timestamp: ts}
		},
		callback, "Test",
	)

	bp.Subscribe("Object1", []int64{1})

	// Manual poll
	bp.poll()

	if len(receivedUpdates) != 1 {
		t.Errorf("len(receivedUpdates) = %d, want 1", len(receivedUpdates))
	}

	// Second poll with same value should not trigger callback
	prevLen := len(receivedUpdates)
	bp.poll()

	if len(receivedUpdates) != prevLen {
		t.Error("callback should not be called for unchanged values")
	}
}

func TestBasePollerPollWithFetchError(t *testing.T) {
	fetcher := &MockFetcher{
		fetchErr: fmt.Errorf("fetch error"),
	}

	callbackCalled := false
	callback := func(updates []MockUpdate) {
		callbackCalled = true
	}

	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		callback, "Test",
	)

	bp.Subscribe("Object1", []int64{1})

	// Should not panic on fetch error
	bp.poll()

	if callbackCalled {
		t.Error("callback should not be called on fetch error")
	}
}

func TestBasePollerUnsubscribeRemovesLastValues(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2, 3})

	// Set some lastValues
	bp.mu.Lock()
	bp.lastValues["Object1"] = map[int64]string{1: "100", 2: "200", 3: "300"}
	bp.mu.Unlock()

	// Unsubscribe one
	bp.Unsubscribe("Object1", []int64{2})

	bp.mu.RLock()
	_, exists := bp.lastValues["Object1"][2]
	bp.mu.RUnlock()

	if exists {
		t.Error("lastValues[Object1][2] should have been removed")
	}
}

func TestBasePollerUnsubscribeAllRemovesObject(t *testing.T) {
	fetcher := &MockFetcher{}
	bp := NewBasePoller[MockItem, MockUpdate](
		time.Second, 100, fetcher,
		func(objectName string, item MockItem, ts time.Time) MockUpdate {
			return MockUpdate{}
		},
		nil, "Test",
	)

	bp.Subscribe("Object1", []int64{1, 2, 3})
	bp.Subscribe("Object1", []int64{})            // Ensure unsubscribe removes all
	bp.Unsubscribe("Object1", []int64{1, 2, 3}) // Remove all one by one

	bp.mu.RLock()
	_, exists := bp.subscriptions["Object1"]
	bp.mu.RUnlock()

	if exists {
		t.Error("Object1 should be removed when all IDs are unsubscribed")
	}
}

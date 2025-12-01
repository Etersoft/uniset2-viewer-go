package storage

import (
	"testing"
	"time"
)

func TestMemoryStorageSaveAndGetLatest(t *testing.T) {
	store := NewMemoryStorage()
	defer store.Close()

	now := time.Now()

	// Сохраняем несколько точек
	for i := 0; i < 5; i++ {
		err := store.Save("TestObj", "var1", i*10, now.Add(time.Duration(i)*time.Second))
		if err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// Получаем последние 3 точки
	history, err := store.GetLatest("TestObj", "var1", 3)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if history.ObjectName != "TestObj" {
		t.Errorf("expected ObjectName=TestObj, got %s", history.ObjectName)
	}

	if history.VariableName != "var1" {
		t.Errorf("expected VariableName=var1, got %s", history.VariableName)
	}

	if len(history.Points) != 3 {
		t.Fatalf("expected 3 points, got %d", len(history.Points))
	}

	// Проверяем что это последние точки (20, 30, 40)
	if history.Points[0].Value != 20 {
		t.Errorf("expected first point value=20, got %v", history.Points[0].Value)
	}
	if history.Points[2].Value != 40 {
		t.Errorf("expected last point value=40, got %v", history.Points[2].Value)
	}
}

func TestMemoryStorageGetHistory(t *testing.T) {
	store := NewMemoryStorage()
	defer store.Close()

	base := time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC)

	// Сохраняем точки с интервалом в минуту
	for i := 0; i < 10; i++ {
		err := store.Save("TestObj", "var1", i, base.Add(time.Duration(i)*time.Minute))
		if err != nil {
			t.Fatalf("Save failed: %v", err)
		}
	}

	// Запрашиваем диапазон от 3-й до 7-й минуты
	from := base.Add(3 * time.Minute)
	to := base.Add(7 * time.Minute)

	history, err := store.GetHistory("TestObj", "var1", from, to)
	if err != nil {
		t.Fatalf("GetHistory failed: %v", err)
	}

	if len(history.Points) != 5 {
		t.Fatalf("expected 5 points (3,4,5,6,7), got %d", len(history.Points))
	}

	if history.Points[0].Value != 3 {
		t.Errorf("expected first value=3, got %v", history.Points[0].Value)
	}
	if history.Points[4].Value != 7 {
		t.Errorf("expected last value=7, got %v", history.Points[4].Value)
	}
}

func TestMemoryStorageCleanup(t *testing.T) {
	store := NewMemoryStorage()
	defer store.Close()

	now := time.Now()
	old := now.Add(-2 * time.Hour)

	// Сохраняем старые данные
	store.Save("TestObj", "var1", 100, old)
	store.Save("TestObj", "var1", 101, old.Add(time.Minute))

	// Сохраняем новые данные
	store.Save("TestObj", "var1", 200, now)
	store.Save("TestObj", "var1", 201, now.Add(time.Minute))

	// Очищаем данные старше 1 часа
	err := store.Cleanup(now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("Cleanup failed: %v", err)
	}

	// Должны остаться только новые данные
	history, err := store.GetLatest("TestObj", "var1", 10)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if len(history.Points) != 2 {
		t.Fatalf("expected 2 points after cleanup, got %d", len(history.Points))
	}

	if history.Points[0].Value != 200 {
		t.Errorf("expected value=200, got %v", history.Points[0].Value)
	}
}

func TestMemoryStorageMultipleVariables(t *testing.T) {
	store := NewMemoryStorage()
	defer store.Close()

	now := time.Now()

	store.Save("Obj1", "var1", 10, now)
	store.Save("Obj1", "var2", 20, now)
	store.Save("Obj2", "var1", 30, now)

	h1, _ := store.GetLatest("Obj1", "var1", 10)
	h2, _ := store.GetLatest("Obj1", "var2", 10)
	h3, _ := store.GetLatest("Obj2", "var1", 10)

	if len(h1.Points) != 1 || h1.Points[0].Value != 10 {
		t.Error("Obj1:var1 mismatch")
	}
	if len(h2.Points) != 1 || h2.Points[0].Value != 20 {
		t.Error("Obj1:var2 mismatch")
	}
	if len(h3.Points) != 1 || h3.Points[0].Value != 30 {
		t.Error("Obj2:var1 mismatch")
	}
}

func TestMemoryStorageEmptyHistory(t *testing.T) {
	store := NewMemoryStorage()
	defer store.Close()

	history, err := store.GetLatest("NonExistent", "var", 10)
	if err != nil {
		t.Fatalf("GetLatest failed: %v", err)
	}

	if len(history.Points) != 0 {
		t.Errorf("expected empty history, got %d points", len(history.Points))
	}
}

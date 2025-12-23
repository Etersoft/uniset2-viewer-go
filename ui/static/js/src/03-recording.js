// ========== Recording Functions ==========

// State for recording
const recordingState = {
    enabled: false,
    isRecording: false,
    recordCount: 0,
    sizeBytes: 0,
    statusPollInterval: null
};

// Format bytes to human readable
function formatBytes(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

// Format number with abbreviation
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
}

// Initialize recording UI
function initRecordingUI() {
    const statusEl = document.getElementById('recording-status');
    const toggleBtn = document.getElementById('recording-toggle-btn');
    const downloadBtn = document.getElementById('recording-download-btn');
    const dropdownMenu = document.getElementById('recording-dropdown-menu');

    if (!statusEl) return;

    // Toggle recording button
    toggleBtn?.addEventListener('click', async () => {
        try {
            const endpoint = recordingState.isRecording ? '/api/recording/stop' : '/api/recording/start';
            const response = await fetch(endpoint, { method: 'POST' });
            if (response.ok) {
                await updateRecordingStatus();
            } else {
                console.error('Recording toggle failed:', response.status);
            }
        } catch (err) {
            console.error('Recording toggle error:', err);
        }
    });

    // Download dropdown toggle
    downloadBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownMenu?.classList.toggle('hidden');
    });

    // Close dropdown on outside click
    document.addEventListener('click', () => {
        dropdownMenu?.classList.add('hidden');
    });

    // Dropdown menu items
    dropdownMenu?.addEventListener('click', async (e) => {
        const item = e.target.closest('.recording-dropdown-item');
        if (!item) return;

        e.stopPropagation();
        dropdownMenu.classList.add('hidden');

        const format = item.dataset.format;
        const action = item.dataset.action;

        if (action === 'clear') {
            if (confirm('Clear all recording data?\n\nThis will delete all recorded history and cannot be undone.')) {
                try {
                    const response = await fetch('/api/recording/clear', { method: 'DELETE' });
                    if (response.ok) {
                        await updateRecordingStatus();
                    }
                } catch (err) {
                    console.error('Clear recording error:', err);
                }
            }
            return;
        }

        if (format) {
            // Download export file
            let url;
            switch (format) {
                case 'sqlite':
                    url = '/api/export/database';
                    break;
                case 'csv':
                    url = '/api/export/csv';
                    break;
                case 'json':
                    url = '/api/export/json';
                    break;
            }
            if (url) {
                window.location.href = url;
            }
        }
    });

    // Initial status fetch
    updateRecordingStatus();

    // Start polling for status updates (every 5 seconds)
    recordingState.statusPollInterval = setInterval(updateRecordingStatus, 5000);
}

// Update recording status from API
async function updateRecordingStatus() {
    try {
        const response = await fetch('/api/recording/status');
        if (!response.ok) {
            // API not available - hide UI
            recordingState.enabled = false;
            updateRecordingUI();
            return;
        }

        const data = await response.json();
        // Check if recording is configured on server
        recordingState.enabled = data.configured === true;
        recordingState.isRecording = data.isRecording || false;
        recordingState.recordCount = data.recordCount || 0;
        recordingState.sizeBytes = data.sizeBytes || 0;

        updateRecordingUI();
    } catch (err) {
        // API error - hide UI
        recordingState.enabled = false;
        updateRecordingUI();
    }
}

// Update recording UI based on state
function updateRecordingUI() {
    const statusEl = document.getElementById('recording-status');
    const badge = document.getElementById('recording-badge');
    const toggleBtn = document.getElementById('recording-toggle-btn');

    if (!statusEl) return;

    // Show/hide entire recording section
    if (!recordingState.enabled) {
        statusEl.classList.add('hidden');
        return;
    }
    statusEl.classList.remove('hidden');

    // Update recording state
    if (recordingState.isRecording) {
        statusEl.classList.add('recording');
        toggleBtn.textContent = 'Stop';
        toggleBtn.title = 'Stop recording';
        badge.classList.remove('hidden');
        badge.textContent = `${formatNumber(recordingState.recordCount)} / ${formatBytes(recordingState.sizeBytes)}`;
    } else {
        statusEl.classList.remove('recording');
        toggleBtn.textContent = 'Record';
        toggleBtn.title = 'Start recording';
        // Show badge if there's data
        if (recordingState.recordCount > 0) {
            badge.classList.remove('hidden');
            badge.textContent = `${formatNumber(recordingState.recordCount)} / ${formatBytes(recordingState.sizeBytes)}`;
        } else {
            badge.classList.add('hidden');
        }
    }
}

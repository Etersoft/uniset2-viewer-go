import { test, expect } from '@playwright/test';

test.describe('Journal API Tests', () => {

  test('should return journals list from API', async ({ request }) => {
    const response = await request.get('/api/journals');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('should have at least one journal configured', async ({ request }) => {
    const response = await request.get('/api/journals');
    expect(response.ok()).toBeTruthy();

    const journals = await response.json();
    expect(journals.length).toBeGreaterThan(0);
  });

  test('journal should have required fields', async ({ request }) => {
    const response = await request.get('/api/journals');
    const journals = await response.json();

    expect(journals.length).toBeGreaterThan(0);

    const journal = journals[0];
    expect(journal).toHaveProperty('id');
    expect(journal).toHaveProperty('name');
    expect(journal).toHaveProperty('status');
    expect(journal.status).toBe('connected');
  });

  test('should return messages from journal', async ({ request }) => {
    // First get the journal list
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    expect(journals.length).toBeGreaterThan(0);

    const journalId = journals[0].id;

    // Get messages from the journal
    const messagesResponse = await request.get(`/api/journals/${journalId}/messages`);
    expect(messagesResponse.ok()).toBeTruthy();

    const data = await messagesResponse.json();
    expect(data).toHaveProperty('messages');
    expect(data).toHaveProperty('total');
    expect(Array.isArray(data.messages)).toBeTruthy();
  });

  test('messages should have required fields', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    const messagesResponse = await request.get(`/api/journals/${journalId}/messages?limit=10`);
    const data = await messagesResponse.json();

    expect(data.messages.length).toBeGreaterThan(0);

    const message = data.messages[0];
    expect(message).toHaveProperty('timestamp');
    expect(message).toHaveProperty('value');
    expect(message).toHaveProperty('name');
    expect(message).toHaveProperty('message');
    expect(message).toHaveProperty('mtype');
  });

  test('should support pagination with limit and offset', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    // Get first page
    const page1Response = await request.get(`/api/journals/${journalId}/messages?limit=5&offset=0`);
    const page1 = await page1Response.json();

    // Get second page
    const page2Response = await request.get(`/api/journals/${journalId}/messages?limit=5&offset=5`);
    const page2 = await page2Response.json();

    expect(page1.messages.length).toBeLessThanOrEqual(5);
    expect(page2.messages.length).toBeLessThanOrEqual(5);

    // Messages should be different
    if (page1.messages.length > 0 && page2.messages.length > 0) {
      expect(page1.messages[0].timestamp).not.toBe(page2.messages[0].timestamp);
    }
  });

  test('should return message types list', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    const mtypesResponse = await request.get(`/api/journals/${journalId}/mtypes`);
    expect(mtypesResponse.ok()).toBeTruthy();

    const mtypes = await mtypesResponse.json();
    expect(Array.isArray(mtypes)).toBeTruthy();
    expect(mtypes.length).toBeGreaterThan(0);

    // Should contain standard message types
    const standardTypes = ['Alarm', 'Warning', 'Normal', 'Emergancy', 'Cauton', 'Blocking'];
    for (const mtype of mtypes) {
      expect(standardTypes).toContain(mtype);
    }
  });

  test('should return message groups list', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    const mgroupsResponse = await request.get(`/api/journals/${journalId}/mgroups`);
    expect(mgroupsResponse.ok()).toBeTruthy();

    const mgroups = await mgroupsResponse.json();
    expect(Array.isArray(mgroups)).toBeTruthy();
    expect(mgroups.length).toBeGreaterThan(0);
  });

  test('should filter messages by mtype', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    // Filter by Alarm type
    const response = await request.get(`/api/journals/${journalId}/messages?mtype=Alarm&limit=50`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // All returned messages should be Alarm type
    for (const msg of data.messages) {
      expect(msg.mtype).toBe('Alarm');
    }
  });

  test('should filter messages by mgroup', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    // Get available groups first
    const mgroupsResponse = await request.get(`/api/journals/${journalId}/mgroups`);
    const mgroups = await mgroupsResponse.json();

    if (mgroups.length > 0) {
      const testGroup = mgroups[0];

      const response = await request.get(`/api/journals/${journalId}/messages?mgroup=${encodeURIComponent(testGroup)}&limit=50`);
      expect(response.ok()).toBeTruthy();

      const data = await response.json();

      // All returned messages should be from the specified group
      for (const msg of data.messages) {
        expect(msg.mgroup).toBe(testGroup);
      }
    }
  });

  test('should filter messages by time range', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    // Get messages from last hour
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const response = await request.get(
      `/api/journals/${journalId}/messages?from=${hourAgo.toISOString()}&to=${now.toISOString()}&limit=100`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // All messages should be within the time range
    for (const msg of data.messages) {
      const msgTime = new Date(msg.timestamp);
      expect(msgTime.getTime()).toBeGreaterThanOrEqual(hourAgo.getTime());
      expect(msgTime.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  test('should return 404 for non-existent journal', async ({ request }) => {
    const response = await request.get('/api/journals/nonexistent123/messages');
    expect(response.status()).toBe(404);
  });

  test('should support text search in messages', async ({ request }) => {
    const journalsResponse = await request.get('/api/journals');
    const journals = await journalsResponse.json();
    const journalId = journals[0].id;

    // Search for messages containing "Temperature"
    const response = await request.get(`/api/journals/${journalId}/messages?search=Temperature&limit=50`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // If messages found, they should contain the search term
    for (const msg of data.messages) {
      const hasMatch = msg.name.toLowerCase().includes('temperature') ||
                       msg.message.toLowerCase().includes('temperature');
      expect(hasMatch).toBeTruthy();
    }
  });

});

test.describe('Journal UI Tests', () => {

  test('should display Journals view switcher', async ({ page }) => {
    await page.goto('/');

    // Wait for the page to load
    await page.waitForSelector('.view-switcher');

    // Check that Journals button exists
    const journalsBtn = page.locator('.view-btn[data-view="journals"]');
    await expect(journalsBtn).toBeVisible();
  });

  test('should switch to Journals view', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Click on Journals button
    await page.click('.view-btn[data-view="journals"]');

    // Wait for journals view to appear
    await page.waitForSelector('#journals-view.active', { state: 'visible' });

    // Check that journals list is visible
    const journalsList = page.locator('#journals-list');
    await expect(journalsList).toBeVisible();
  });

  test('should display journal in sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Switch to Journals view
    await page.click('.view-btn[data-view="journals"]');
    await page.waitForSelector('#journals-view.active', { state: 'visible' });

    // Wait for journals to load
    await page.waitForTimeout(1000);

    // Check that there is at least one journal item
    const journalItems = page.locator('#journals-list .journal-item');
    const count = await journalItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should open journal tab on click', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Switch to Journals view
    await page.click('.view-btn[data-view="journals"]');
    await page.waitForSelector('#journals-view.active', { state: 'visible' });

    // Wait for journals to load
    await page.waitForTimeout(1000);

    // Click on first journal
    await page.click('#journals-list .journal-item:first-child');

    // Wait for journal panel to appear
    await page.waitForSelector('.journal-panel', { state: 'visible', timeout: 5000 });

    // Check that journal table is visible
    const journalTable = page.locator('.journal-table');
    await expect(journalTable).toBeVisible();
  });

  test('should display messages in journal table', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Switch to Journals view and open first journal
    await page.click('.view-btn[data-view="journals"]');
    await page.waitForSelector('#journals-view.active', { state: 'visible' });
    await page.waitForTimeout(1000);
    await page.click('#journals-list .journal-item:first-child');

    // Wait for messages to load
    await page.waitForSelector('.journal-table tbody tr', { timeout: 10000 });

    // Check that there are messages
    const rows = page.locator('.journal-table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should have filter controls', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Open journal
    await page.click('.view-btn[data-view="journals"]');
    await page.waitForSelector('#journals-view.active', { state: 'visible' });
    await page.waitForTimeout(1000);
    await page.click('#journals-list .journal-item:first-child');
    await page.waitForSelector('.journal-panel', { state: 'visible' });

    // Check filter controls exist
    await expect(page.locator('.journal-filters')).toBeVisible();
    await expect(page.locator('.journal-select').first()).toBeVisible();  // mtype select
    await expect(page.locator('.journal-search')).toBeVisible();
  });

  test('should filter messages by type', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Open journal
    await page.click('.view-btn[data-view="journals"]');
    await page.waitForSelector('#journals-view.active', { state: 'visible' });
    await page.waitForTimeout(1000);
    await page.click('#journals-list .journal-item:first-child');
    await page.waitForSelector('.journal-table tbody tr', { timeout: 10000 });

    // Select "Alarm" filter from first select (mtype) - filters apply immediately on change
    await page.locator('.journal-select').first().selectOption('Alarm');

    // Wait for table to update
    await page.waitForTimeout(1000);

    // Check that all visible rows are Alarm type
    const rows = page.locator('.journal-table tbody tr');
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const badge = rows.nth(i).locator('.journal-badge');
      const text = await badge.textContent();
      expect(text).toBe('Alarm');
    }
  });

  test('should have pause/resume button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.view-switcher');

    // Open journal
    await page.click('.view-btn[data-view="journals"]');
    await page.waitForSelector('#journals-view.active', { state: 'visible' });
    await page.waitForTimeout(1000);
    await page.click('#journals-list .journal-item:first-child');
    await page.waitForSelector('.journal-panel', { state: 'visible' });

    // Check pause button exists
    const pauseBtn = page.locator('.journal-pause-btn');
    await expect(pauseBtn).toBeVisible();
  });

});

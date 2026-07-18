import { expect, test } from '@playwright/test';

const TEST_URL = '/?testMode=1&profile=clean&seed=phase-0-smoke'
  + '&traffic=12&pedestrians=16&time=9.25&weather=rain'
  + '&mission=mission_executive&diagnostics=1&quality=low';

test('boots a deterministic clean profile without runtime or UI errors', async ({ page }) => {
  const pageErrors = [];
  const rejectedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => rejectedRequests.push({
    url: request.url(),
    reason: request.failure()?.errorText || 'unknown'
  }));

  await page.addInitScript(() => {
    window.__SMOKE_ERRORS__ = { uncaught: [], rejected: [] };
    window.addEventListener('error', event => {
      window.__SMOKE_ERRORS__.uncaught.push(event.error?.message || event.message);
    });
    window.addEventListener('unhandledrejection', event => {
      window.__SMOKE_ERRORS__.rejected.push(event.reason?.message || String(event.reason));
    });
  });

  const response = await page.goto(TEST_URL, { waitUntil: 'domcontentloaded' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready', {
    timeout: 60_000
  });
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
  await expect(page.locator('#fatal-error-panel')).toHaveCount(0);

  const indexedDbAvailable = await page.evaluate(async () => {
    const request = indexedDB.open('metropulse-phase0-smoke', 1);
    return new Promise(resolve => {
      request.onupgradeneeded = () => request.result.createObjectStore('probe');
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        request.result.close();
        indexedDB.deleteDatabase('metropulse-phase0-smoke');
        resolve(true);
      };
    });
  });
  expect(indexedDbAvailable).toBe(true);

  const initial = await page.evaluate(() => window.__METROPULSE_TEST__.snapshot());
  expect(initial.testMode.seed).toBe('phase-0-smoke');
  expect(initial.testMode.weather).toBe('rain');
  expect(initial.testMode.missionId).toBe('mission_executive');
  expect(initial.state.mode).toBe('MANAGEMENT');
  expect(initial.entities.vehicles).toBeGreaterThanOrEqual(12);
  expect(initial.entities.pedestrians).toBe(16);
  expect(initial.entities.physicsBodies).toBeGreaterThan(0);
  expect(initial.performance.renderer).not.toBeNull();
  expect(initial.features.aircraft).toBe(false);
  expect(initial.features.rocketLaunch).toBe(false);
  expect(initial.features.eastSideDevelopment).toBe(false);

  await page.keyboard.press('m');
  await expect(page.locator('#current-mode-label')).toHaveText('CITY EDITOR');
  const builder = await page.evaluate(() => window.__METROPULSE_TEST__.snapshot());
  expect(builder.state.mode).toBe('BUILDER');
  expect(builder.controlledEntity).toBeNull();

  await page.evaluate(() => window.__METROPULSE_TEST__.setTime(18.5));
  await page.evaluate(() => window.__METROPULSE_TEST__.setWeather('mist'));
  const mission = await page.evaluate(() => (
    window.__METROPULSE_TEST__.selectMission('mission_executive')
  ));
  expect(mission.id).toBe('mission_executive');

  await page.waitForTimeout(1_100);
  const errors = await page.evaluate(() => ({
    bridge: window.__METROPULSE_TEST__.getErrors(),
    early: window.__SMOKE_ERRORS__
  }));
  expect(errors.bridge.uncaught).toEqual([]);
  expect(errors.bridge.rejected).toEqual([]);
  expect(errors.early.uncaught).toEqual([]);
  expect(errors.early.rejected).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(rejectedRequests).toEqual([]);

  await expect(page.locator('[data-feature="aircraft"]')).toBeHidden();
  await expect(page.locator('#btn-launch-rocket')).toBeHidden();
  await expect(page.locator('[data-camera="rocket"]')).toBeHidden();
  await expect(page.locator('[data-feature="eastSideDevelopment"]')).toBeHidden();
  await expect(page.locator('#development-diagnostics')).toContainText('STATE BUILDER');
});

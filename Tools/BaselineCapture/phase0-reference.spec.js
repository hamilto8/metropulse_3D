import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import {
  REFERENCE_REVISION,
  REFERENCE_SEED,
  stableStringify
} from './baseline-fixtures.mjs';

const evidenceDirectory = path.resolve('docs/port_evidence/phase0/browser');
const screenshotDirectory = path.join(evidenceDirectory, 'screenshots');
const testUrl = `/?testMode=1&profile=clean&seed=${REFERENCE_SEED}`
  + '&traffic=12&pedestrians=16&time=9.25&weather=clear'
  + '&mission=mission_executive&diagnostics=1&quality=low';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function selectTelemetry(snapshot) {
  return {
    state: snapshot.state,
    scheduler: snapshot.scheduler,
    controlledEntity: snapshot.controlledEntity,
    activeMission: snapshot.activeMission,
    entities: snapshot.entities,
    performance: snapshot.performance,
    features: snapshot.features,
    testMode: snapshot.testMode,
    save: snapshot.save,
    alerts: snapshot.alerts
  };
}

test('captures the Godot port browser reference atlas and telemetry', async ({ page, browser, browserName }) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const scenarios = [];
  const capture = async (id, configuration = {}) => {
    await page.waitForTimeout(120);
    const fileName = `${id}.png`;
    const filePath = path.join(screenshotDirectory, fileName);
    await page.screenshot({ path: filePath, animations: 'disabled' });
    const snapshot = await page.evaluate(() => window.__METROPULSE_TEST__?.snapshot?.() || null);
    scenarios.push({
      id,
      screenshot: `screenshots/${fileName}`,
      configuration,
      telemetry: snapshot ? selectTelemetry(snapshot) : null
    });
  };

  await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#boot-screen')).toBeVisible();
  await capture('boot-menu', { profile: 'clean', worldInstantiated: false });
  await page.locator('#btn-boot-new-game').click();
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready', { timeout: 60_000 });
  await capture('new-game-management', { state: 'MANAGEMENT', time: 9.25, weather: 'clear' });

  const times = {
    dawn: 6.25,
    day: 13,
    dusk: 18.5,
    night: 23
  };
  for (const [timeLabel, time] of Object.entries(times)) {
    for (const weather of ['clear', 'mist', 'rain', 'thunderstorm']) {
      await page.evaluate(({ time, weather }) => {
        window.__METROPULSE_TEST__.setTime(time);
        window.__METROPULSE_TEST__.setWeather(weather);
      }, { time, weather });
      await capture(`management-${timeLabel}-${weather}`, {
        state: 'MANAGEMENT', time, timeLabel, weather
      });
    }
  }

  await page.evaluate(() => window.__METROPULSE_TEST__.enterState('BUILDER'));
  await capture('builder-empty', { state: 'BUILDER', tool: 'none' });
  const preview = await page.evaluate(() => {
    const editor = window.app.cityEditorSystem;
    editor.selectBuilding('CYBERCAFE');
    const spec = editor.selectedSpec;
    for (let x = -170; x <= 790; x += 10) {
      for (let z = -370; z <= 370; z += 10) {
        const y = window.app.cityBuilder.getHillHeight(x, z);
        const validation = editor.getPlacementValidation({ spec, rotationY: 0, x, y, z });
        if (!validation.valid) continue;
        editor.currentHit = { x, y, z, valid: true, validation };
        editor.publishPlacementValidation(validation);
        editor.ghostGroup?.position?.set?.(x, y, z);
        return { x, y, z, cost: spec.cost };
      }
    }
    return null;
  });
  expect(preview).not.toBeNull();
  await capture('builder-placement-preview', { state: 'BUILDER', tool: 'PLACE', specId: 'CYBERCAFE', preview });
  expect(await page.evaluate(() => window.app.cityEditorSystem.placeSelectedBuilding())).toBe(true);
  await capture('builder-valid-placement', { state: 'BUILDER', tool: 'PLACE', specId: 'CYBERCAFE', preview });

  await page.evaluate(() => window.__METROPULSE_TEST__.enterState('STREET_ON_FOOT'));
  await capture('street-on-foot', { state: 'STREET_ON_FOOT' });
  await page.evaluate(() => window.__METROPULSE_TEST__.prepareCombat());
  await capture('street-on-foot-bat', { state: 'STREET_ON_FOOT', inventory: 'baseball-bat' });

  await page.evaluate(() => window.__METROPULSE_TEST__.enterState('STREET_VEHICLE'));
  await capture('street-vehicle', { state: 'STREET_VEHICLE' });
  await page.evaluate(() => {
    window.__METROPULSE_TEST__.setWeather('clear');
    return window.__METROPULSE_TEST__.primeGameplayClocks();
  });
  await capture('heat-police', { state: 'STREET_VEHICLE', heat: true });
  await page.evaluate(() => window.__METROPULSE_TEST__.clearGameplayClockFixture());

  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-menu')).toBeVisible();
  await capture('pause-menu', { state: 'PAUSED' });
  await page.locator('#btn-open-settings').click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await capture('settings', { state: 'PAUSED', modal: 'SETTINGS' });
  await page.locator('#btn-settings-back').click();
  await page.locator('#btn-resume-game').click();

  const alert = await page.evaluate(() => window.__METROPULSE_TEST__.publishAlertFixture('STREET_WAYPOINT'));
  await capture('structured-alert', { state: 'STREET_VEHICLE', alertId: alert.id });

  await page.evaluate(() => window.__METROPULSE_TEST__.openDialogue('mission_executive'));
  await expect(page.locator('#dialogue-overlay')).toBeVisible();
  await capture('mission-offer-dialogue', { missionId: 'mission_executive', phase: 'BRIEFING' });

  // Reload a clean deterministic session because the offer capture intentionally
  // leaves the lifecycle in BRIEFING.
  await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#btn-boot-new-game').click();
  await expect(page.locator('body')).toHaveAttribute('data-app-state', 'ready', { timeout: 60_000 });
  await page.evaluate(() => window.__METROPULSE_TEST__.startMission('mission_executive'));
  await capture('mission-active-hud', { missionId: 'mission_executive', phase: 'ACTIVE' });
  await page.evaluate(() => window.__METROPULSE_TEST__.resolveMission('FAILURE'));
  await capture('mission-failure-result', { missionId: 'mission_executive', phase: 'RESULT', outcome: 'FAILURE' });
  await page.evaluate(() => window.__METROPULSE_TEST__.retryMission());
  await capture('mission-retry', { missionId: 'mission_executive', phase: 'ACTIVE', attempt: 2 });
  await page.evaluate(() => window.__METROPULSE_TEST__.resolveMission('SUCCESS'));
  await capture('mission-success-result', { missionId: 'mission_executive', phase: 'RESULT', outcome: 'SUCCESS' });
  await page.locator('#btn-result-history').click();
  await capture('mission-result-history', { missionId: 'mission_executive', modal: 'RESULT_HISTORY' });
  await page.locator('#btn-result-history-close').click();
  await page.evaluate(() => window.__METROPULSE_TEST__.acknowledgeMissionResult());

  await page.evaluate(async () => {
    await window.app.saveService.saveNow({ reason: 'phase0-browser-reference-a' });
    await window.app.saveService.saveNow({ reason: 'phase0-browser-reference-b' });
  });
  await capture('saved-city', { state: 'MANAGEMENT', saveSlots: ['current', 'recovery'] });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#btn-boot-continue')).toBeVisible();
  await expect(page.locator('#btn-boot-recover')).toBeVisible();
  await capture('boot-continue-recover', { profile: 'saved', worldInstantiated: false });

  for (const scenario of scenarios) {
    const bytes = await readFile(path.join(evidenceDirectory, scenario.screenshot));
    scenario.sha256 = sha256(bytes);
  }
  const userAgent = await page.evaluate(() => navigator.userAgent);
  const manifest = {
    schemaVersion: 1,
    referenceRevision: REFERENCE_REVISION,
    captureCommand: 'PLAYWRIGHT_CHANNEL=chrome npm run baseline:capture:browser',
    browserName,
    browserVersion: browser.version(),
    userAgent,
    viewport: { width: 1280, height: 720 },
    url: testUrl,
    scenarios
  };
  await writeFile(path.join(evidenceDirectory, 'manifest.json'), stableStringify(manifest), 'utf8');
});

import { expect, test } from '@playwright/test';

const TEST_URL = '/?testMode=1&profile=clean&seed=phase-0-smoke'
  + '&traffic=12&pedestrians=16&time=9.25&weather=rain'
  + '&mission=mission_executive&diagnostics=1&quality=low';

test('boots a deterministic clean profile without runtime or UI errors', async ({ page }) => {
  test.setTimeout(90_000);
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
  await expect(page.locator('#primary-interaction-prompt')).toHaveCount(1);
  await expect(page.locator('#mission-available-prompt, #vehicle-enter-prompt')).toHaveCount(0);

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
  expect(initial.scheduler.owner).toBe('SimulationScheduler');
  expect(initial.scheduler.clockPolicy).toBe('CITY');
  expect(initial.scheduler.cityStep).toBe(1);
  expect(initial.scheduler.paused).toBe(false);
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

  // Regression for the obstructed editor camera plus the P1.2 ownership soak.
  // Each cycle covers management -> pedestrian -> vehicle -> pedestrian ->
  // management -> builder -> management using the real runtime coordinator.
  const soak = await page.evaluate(() => window.__METROPULSE_TEST__.runTransitionSoak(50));
  expect(soak.cycles).toBe(50);
  expect(soak.after.state.mode).toBe('MANAGEMENT');
  expect(soak.after.state.activeTransition).toBeNull();
  expect(soak.after.controlledEntity).toBeNull();
  expect(soak.after.entities.physicsBodies).toBe(soak.before.entities.physicsBodies);
  expect(soak.after.entities.sceneObjects).toBe(soak.before.entities.sceneObjects);
  expect(soak.cameraClear).toBe(true);
  expect(soak.inputSuspended).toBe(false);
  expect(soak.heldActionCount).toBe(0);

  // P1.5 acceptance: one prompt owner advertises the same deterministic
  // interaction that keyboard input resolves.
  await page.evaluate(() => window.__METROPULSE_TEST__.enterState('STREET_VEHICLE'));
  const primaryPrompt = page.locator('#primary-interaction-prompt');
  await expect(primaryPrompt).toBeVisible();
  await expect(primaryPrompt).toHaveAttribute('data-interaction-kind', 'VEHICLE_EXIT');
  await expect(page.locator('.primary-interaction-prompt:not(.hidden)')).toHaveCount(1);
  await page.keyboard.press('e');
  await expect.poll(async () => (
    await page.evaluate(() => window.__METROPULSE_TEST__.snapshot().state.mode)
  )).toBe('MANAGEMENT');

  // P1.4 acceptance: Escape creates one true pause from every gameplay state,
  // preserves the exact resume target, and keeps only UI/render clocks live.
  await page.keyboard.down('w');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-menu')).toBeVisible();
  await expect(page.locator('#primary-interaction-prompt')).toBeHidden();
  await expect(page.locator('#btn-resume-game')).toBeFocused();
  const managementPausedBefore = await page.evaluate(() => window.__METROPULSE_TEST__.pauseProbe());
  expect(managementPausedBefore.snapshot.state.mode).toBe('PAUSED');
  expect(managementPausedBefore.snapshot.state.resumeState).toBe('MANAGEMENT');
  expect(managementPausedBefore.snapshot.scheduler.clockPolicy).toBe('PAUSED');
  expect(managementPausedBefore.heldKeys).toEqual([]);
  await page.waitForTimeout(250);
  const managementPausedAfter = await page.evaluate(() => window.__METROPULSE_TEST__.pauseProbe());
  for (const clock of ['GAMEPLAY_REAL_TIME', 'PHYSICS_FIXED', 'CITY_LOGICAL']) {
    expect(managementPausedAfter.snapshot.scheduler.clocks[clock].elapsed)
      .toBe(managementPausedBefore.snapshot.scheduler.clocks[clock].elapsed);
  }
  expect(managementPausedAfter.snapshot.scheduler.clocks.UI.elapsed)
    .toBeGreaterThan(managementPausedBefore.snapshot.scheduler.clocks.UI.elapsed);
  expect(managementPausedAfter.snapshot.scheduler.clocks.RENDER.elapsed)
    .toBeGreaterThan(managementPausedBefore.snapshot.scheduler.clocks.RENDER.elapsed);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause-menu')).toBeHidden();

  const assertPauseRoundTrip = async (state, controlledType = null) => {
    await page.evaluate(target => window.__METROPULSE_TEST__.enterState(target), state);
    await page.keyboard.press('Escape');
    const paused = await page.evaluate(() => window.__METROPULSE_TEST__.snapshot());
    expect(paused.state.mode).toBe('PAUSED');
    expect(paused.state.resumeState).toBe(state);
    if (controlledType) expect(paused.controlledEntity?.type).toBe(controlledType);
    await page.locator('#btn-resume-game').click();
    const resumed = await page.evaluate(() => window.__METROPULSE_TEST__.snapshot());
    expect(resumed.state.mode).toBe(state);
    if (controlledType) expect(resumed.controlledEntity?.type).toBe(controlledType);
  };

  await assertPauseRoundTrip('BUILDER');
  await expect(page.locator('.city-editor-wrapper')).toBeVisible();
  await assertPauseRoundTrip('STREET_ON_FOOT', 'PEDESTRIAN');
  await assertPauseRoundTrip('STREET_VEHICLE', 'VEHICLE');
  await assertPauseRoundTrip('RESULT');

  // Combat input is quarantined while paused even when a click is dispatched
  // directly to the world canvas underneath the modal.
  await page.evaluate(() => window.__METROPULSE_TEST__.prepareCombat());
  await page.keyboard.press('Escape');
  await page.locator('#canvas-container canvas').dispatchEvent('click');
  expect((await page.evaluate(() => window.__METROPULSE_TEST__.pauseProbe())).swingTimer).toBe(0);
  await page.keyboard.press('Escape');

  // Dialogue owns a modal pause hold. A pause-menu hold may nest above it;
  // closing either one cannot prematurely resume the other.
  await page.evaluate(() => window.__METROPULSE_TEST__.openDialogue('mission_executive'));
  await expect(page.locator('#dialogue-overlay')).toBeVisible();
  await expect(page.locator('#primary-interaction-prompt')).toBeHidden();
  let dialogue = await page.evaluate(() => window.__METROPULSE_TEST__.snapshot());
  expect(dialogue.state.mode).toBe('PAUSED');
  expect(dialogue.pause.reasons).toEqual(['DIALOGUE']);
  await page.evaluate(() => window.__METROPULSE_TEST__.openPauseMenu());
  await expect(page.locator('#pause-menu')).toBeVisible();
  await page.locator('#btn-resume-game').click();
  dialogue = await page.evaluate(() => window.__METROPULSE_TEST__.snapshot());
  expect(dialogue.state.mode).toBe('PAUSED');
  expect(dialogue.pause.reasons).toEqual(['DIALOGUE']);
  await page.evaluate(() => window.__METROPULSE_TEST__.closeDialogue());
  await expect(page.locator('#dialogue-overlay')).toBeHidden();
  expect((await page.evaluate(() => window.__METROPULSE_TEST__.snapshot())).state.mode)
    .toBe('STREET_VEHICLE');

  // Named gameplay clocks and Mayhem state remain bit-for-bit stable while
  // real UI time continues to pass.
  await page.evaluate(() => window.__METROPULSE_TEST__.setMayhem(true));
  await page.evaluate(() => window.__METROPULSE_TEST__.primeGameplayClocks());
  await page.keyboard.press('Escape');
  const clockProbeBefore = await page.evaluate(() => window.__METROPULSE_TEST__.pauseProbe());
  await page.waitForTimeout(350);
  const clockProbeAfter = await page.evaluate(() => window.__METROPULSE_TEST__.pauseProbe());
  expect(clockProbeAfter.missionTime).toBe(clockProbeBefore.missionTime);
  expect(clockProbeAfter.heatEscapeTime).toBe(clockProbeBefore.heatEscapeTime);
  expect(clockProbeAfter.weatherTime).toBe(clockProbeBefore.weatherTime);
  expect(clockProbeAfter.treasury).toBe(clockProbeBefore.treasury);
  expect(clockProbeAfter.rocketCountdown).toBe(clockProbeBefore.rocketCountdown);
  expect(clockProbeAfter.controlledPosition).toEqual(clockProbeBefore.controlledPosition);
  expect(clockProbeAfter.snapshot.state.mode).toBe('PAUSED');
  expect(clockProbeAfter.snapshot.state.resumeState).toBe('STREET_VEHICLE');
  expect(clockProbeAfter.snapshot.state.lastTransition.effects.heat.to).toBe('PRESERVE_FROZEN');
  expect(clockProbeAfter.snapshot.pause.reasons).toEqual(['MENU']);
  await page.evaluate(() => window.__METROPULSE_TEST__.clearGameplayClockFixture());
  await page.keyboard.press('Escape');
  expect((await page.evaluate(() => window.__METROPULSE_TEST__.snapshot())).state.mode)
    .toBe('STREET_VEHICLE');
  expect((await page.evaluate(() => window.__METROPULSE_TEST__.snapshot())).state.lastTransition.status)
    .toBe('COMMITTED');
  await page.evaluate(() => window.__METROPULSE_TEST__.setMayhem(false));
  await page.evaluate(() => window.__METROPULSE_TEST__.enterState('MANAGEMENT'));

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
  await expect(page.locator('#development-diagnostics')).toContainText('STATE MANAGEMENT');
});

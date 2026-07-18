/**
 * Installs deterministic browser-test controls only when test mode is active.
 * The bridge exposes domain operations and snapshots, never mutable app state.
 */
export function installBrowserTestBridge(app, diagnostics, errorMonitor) {
  if (!app.runtimeConfig?.test || typeof window === 'undefined') return null;

  const bridge = Object.freeze({
    version: 1,
    snapshot: () => diagnostics.snapshot(),
    getErrors: () => Object.freeze({
      uncaught: [...errorMonitor.uncaught],
      rejected: [...errorMonitor.rejected]
    }),
    setTime: value => app.timeManager?.setTime?.(value),
    setWeather: value => app.environment?.setWeather?.(value),
    selectMission: missionId => {
      const mission = app.missionSystem?.missions?.find(candidate => candidate.id === missionId);
      if (!mission) throw new RangeError(`Unknown mission: ${missionId}`);
      app.missionSystem.testMissionId = mission.id;
      return Object.freeze({ id: mission.id, type: mission.missionType || mission.objectiveType });
    }
  });

  Object.defineProperty(window, '__METROPULSE_TEST__', {
    configurable: true,
    enumerable: false,
    value: bridge,
    writable: false
  });
  return bridge;
}


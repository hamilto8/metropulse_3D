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
    },
    runTransitionSoak: (cycles = 50) => {
      const cycleCount = Math.max(1, Math.min(100, Math.trunc(Number(cycles) || 0)));
      const coordinator = app.transitionCoordinator;
      if (!coordinator) throw new Error('TransitionCoordinator is unavailable');
      if (app.gameManager?.state !== 'MANAGEMENT') {
        coordinator.transitionTo('MANAGEMENT', {
          reason: 'browser-soak-setup',
          source: 'BrowserTestBridge'
        });
      }
      const before = diagnostics.snapshot();
      let lastPedestrian = null;
      let lastVehicle = null;

      for (let index = 0; index < cycleCount; index += 1) {
        const pedestrian = (app.pedestrianSystem?.pedestrians || []).find(candidate => (
          candidate?.mesh?.parent && !candidate.knockedDown && !candidate.userControlled
        ));
        const vehicle = (app.trafficSystem?.vehicles || []).find(candidate => (
          candidate?.mesh?.parent && !candidate.crashed && !candidate.isDestroyed && !candidate.userControlled
        ));
        if (!pedestrian || !vehicle) throw new Error(`Transition soak lacks an entity at cycle ${index + 1}`);
        const vehicleStart = vehicle.mesh.position.clone();

        coordinator.transitionTo('STREET_ON_FOOT', {
          reason: 'browser-soak-on-foot',
          source: 'BrowserTestBridge',
          target: pedestrian,
          control: { action: 'ACQUIRE', kind: 'PEDESTRIAN', entity: pedestrian }
        });
        coordinator.transitionTo('STREET_VEHICLE', {
          reason: 'browser-soak-enter-vehicle',
          source: 'BrowserTestBridge',
          target: vehicle,
          control: {
            action: 'ACQUIRE',
            kind: 'VEHICLE',
            entity: vehicle,
            source: 'pedestrian',
            pedestrian
          }
        });
        const horizontalDrift = Math.hypot(
          vehicle.mesh.position.x - vehicleStart.x,
          vehicle.mesh.position.z - vehicleStart.z
        );
        if (horizontalDrift > 0.001) throw new Error(`Vehicle transform drifted during cycle ${index + 1}`);

        coordinator.transitionTo('STREET_ON_FOOT', {
          reason: 'browser-soak-exit-vehicle',
          source: 'BrowserTestBridge',
          target: vehicle,
          control: { action: 'EXIT_VEHICLE', kind: 'PEDESTRIAN', sourceVehicle: vehicle }
        });
        const exitPedestrian = app.pedestrianSystem?.controlledPedestrian;
        if (!exitPedestrian?.mesh?.position) throw new Error(`Vehicle exit orphaned control at cycle ${index + 1}`);
        if (exitPedestrian.mesh.position.distanceTo(vehicle.mesh.position) > 5) {
          throw new Error(`Vehicle exit transform was not preserved at cycle ${index + 1}`);
        }

        coordinator.transitionTo('MANAGEMENT', {
          reason: 'browser-soak-management',
          source: 'BrowserTestBridge'
        });
        coordinator.transitionTo('BUILDER', {
          reason: 'browser-soak-builder',
          source: 'BrowserTestBridge'
        });
        coordinator.transitionTo('MANAGEMENT', {
          reason: 'browser-soak-builder-exit',
          source: 'BrowserTestBridge'
        });
        lastPedestrian = exitPedestrian;
        lastVehicle = vehicle;
      }

      const after = diagnostics.snapshot();
      const cameraInspection = app.transitionRuntime?.cameraClearance?.inspect?.(
        app.sceneManager.camera.position,
        { ignore: [lastPedestrian, lastVehicle].filter(Boolean) }
      );
      return Object.freeze({
        cycles: cycleCount,
        before,
        after,
        cameraClear: cameraInspection?.clear ?? null,
        inputSuspended: Boolean(app.inputManager?.isInputSuspended),
        heldActionCount: Object.values(app.inputManager?.keys || {}).filter(Boolean).length
      });
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

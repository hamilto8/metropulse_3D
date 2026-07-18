/**
 * Installs deterministic browser-test controls only when test mode is active.
 * The bridge exposes domain operations and snapshots, never mutable app state.
 */
export function installBrowserTestBridge(app, diagnostics, errorMonitor) {
  if (!app.runtimeConfig?.test || typeof window === 'undefined') return null;

  const ensureManagement = () => {
    app.dialogueOverlay?.hide?.();
    app.pauseManager?.closeMenu?.({ source: 'BrowserTestBridge' });
    if (app.gameManager?.state === 'MANAGEMENT') return;
    app.transitionCoordinator.transitionTo('MANAGEMENT', {
      reason: 'browser-pause-setup',
      source: 'BrowserTestBridge'
    });
  };

  const enterState = destination => {
    const coordinator = app.transitionCoordinator;
    if (!['MANAGEMENT', 'BUILDER', 'STREET_ON_FOOT', 'STREET_VEHICLE', 'RESULT'].includes(destination)) {
      throw new RangeError(`Unsupported browser-test state: ${String(destination)}`);
    }
    ensureManagement();
    if (destination === 'MANAGEMENT') return diagnostics.snapshot();
    if (destination === 'BUILDER') {
      coordinator.transitionTo('BUILDER', { reason: 'browser-pause-builder', source: 'BrowserTestBridge' });
      return diagnostics.snapshot();
    }

    const pedestrian = (app.pedestrianSystem?.pedestrians || []).find(candidate => (
      candidate?.mesh?.parent && !candidate.knockedDown && !candidate.userControlled
    ));
    const vehicle = (app.trafficSystem?.vehicles || []).find(candidate => (
      candidate?.mesh?.parent && !candidate.crashed && !candidate.isDestroyed && !candidate.userControlled
    ));
    if (!pedestrian || !vehicle) throw new Error('Pause acceptance setup lacks a usable entity.');

    if (destination === 'STREET_ON_FOOT' || destination === 'RESULT') {
      coordinator.transitionTo('STREET_ON_FOOT', {
        reason: 'browser-pause-on-foot',
        source: 'BrowserTestBridge',
        control: { action: 'ACQUIRE', kind: 'PEDESTRIAN', entity: pedestrian }
      });
      if (destination === 'RESULT') {
        coordinator.transitionTo('RESULT', {
          reason: 'browser-pause-result',
          source: 'BrowserTestBridge'
        });
      }
    } else {
      coordinator.transitionTo('STREET_VEHICLE', {
        reason: 'browser-pause-driving',
        source: 'BrowserTestBridge',
        control: { action: 'ACQUIRE', kind: 'VEHICLE', entity: vehicle, source: 'camera' }
      });
    }
    return diagnostics.snapshot();
  };

  const pauseProbe = () => {
    const controlled = app.trafficSystem?.controlledVehicle
      || app.pedestrianSystem?.controlledPedestrian
      || app.aircraftSystem?.controlledAircraft;
    const position = controlled?.mesh?.position;
    return Object.freeze({
      snapshot: diagnostics.snapshot(),
      missionTime: app.missionSystem?.timeRemaining ?? null,
      heatEscapeTime: app.pedestrianSystem?.escapeTimer ?? null,
      weatherTime: app.environment?.weatherCycleTimer ?? null,
      treasury: app.economySystem?.treasury ?? app.economySystem?.cash ?? null,
      rocketCountdown: app.rocketCountdown,
      controlledPosition: position ? Object.freeze({ x: position.x, y: position.y, z: position.z }) : null,
      swingTimer: app.pedestrianSystem?.controlledPedestrian?.swingTimer ?? null,
      heldKeys: Object.freeze(Object.entries(app.inputManager?.keys || {})
        .filter(([, held]) => held)
        .map(([key]) => key))
    });
  };

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
    missionLifecycle: () => app.missionSystem?.lifecycle?.snapshot?.() || null,
    startMission: missionId => {
      ensureManagement();
      const mission = app.missionSystem?.missions?.find(candidate => candidate.id === missionId);
      if (!mission) throw new RangeError(`Unknown mission: ${missionId}`);
      const vehicle = (app.trafficSystem?.vehicles || []).find(candidate => (
        candidate?.mesh?.parent
        && candidate.vType === mission.vehicleType
        && !candidate.crashed
        && !candidate.isDestroyed
        && !candidate.userControlled
      ));
      if (!vehicle) throw new Error(`No ${mission.vehicleType} vehicle is available for ${missionId}`);
      app.transitionCoordinator.transitionTo('STREET_VEHICLE', {
        reason: 'browser-mission-start',
        source: 'BrowserTestBridge',
        target: vehicle,
        control: { action: 'ACQUIRE', kind: 'VEHICLE', entity: vehicle, source: 'mission-test' }
      });
      vehicle.mesh.position.set(mission.pickup.x, vehicle.mesh.position.y, mission.pickup.z);
      if (vehicle.physicsBody?.position) {
        vehicle.physicsBody.position.x = mission.pickup.x;
        vehicle.physicsBody.position.z = mission.pickup.z;
      }
      app.missionSystem.triggerCooldown = 0;
      if (!app.missionSystem.startMission(mission)) throw new Error(`Could not start ${missionId}`);
      return app.missionSystem.lifecycle.snapshot();
    },
    resolveMission: outcome => {
      const success = String(outcome).toUpperCase() === 'SUCCESS';
      const committed = success
        ? app.missionSystem.completeMission()
        : app.missionSystem.failMission('timeout');
      if (!committed) throw new Error('Mission result did not commit');
      return app.missionSystem.lifecycle.snapshot();
    },
    retryMission: () => {
      if (!app.missionSystem.retryMission()) throw new Error('Mission retry was rejected');
      return app.missionSystem.lifecycle.snapshot();
    },
    acknowledgeMissionResult: () => {
      if (!app.missionSystem.acknowledgeResult()) throw new Error('Mission result acknowledgement was rejected');
      return app.missionSystem.lifecycle.snapshot();
    },
    enterState,
    openPauseMenu: () => app.pauseManager?.openMenu?.({ source: 'BrowserTestBridge' }),
    closePauseMenu: () => app.pauseManager?.closeMenu?.({ source: 'BrowserTestBridge' }),
    openDialogue: missionId => {
      enterState('STREET_VEHICLE');
      const mission = app.missionSystem?.missions?.find(candidate => candidate.id === missionId);
      if (!mission) throw new RangeError(`Unknown mission: ${missionId}`);
      app.missionSystem.lifecycle.prepare(mission.id);
      app.missionSystem.lifecycle.beginBriefing();
      app.dialogueOverlay.showMissionDialogue(mission, app.missionSystem);
      return pauseProbe();
    },
    closeDialogue: () => app.dialogueOverlay?.hide?.(),
    prepareCombat: () => {
      enterState('STREET_ON_FOOT');
      const pedestrian = app.pedestrianSystem?.controlledPedestrian;
      if (!pedestrian) throw new Error('Combat pause setup lacks a controlled pedestrian.');
      pedestrian.hasBaseballBat = true;
      pedestrian.swingTimer = 0;
      return pauseProbe();
    },
    primeGameplayClocks: () => {
      enterState('STREET_VEHICLE');
      const mission = app.missionSystem?.missions?.[0];
      let controlledVehicle = app.trafficSystem?.controlledVehicle;
      if (controlledVehicle?.vType !== mission.vehicleType) {
        app.transitionCoordinator.transitionTo('MANAGEMENT', {
          reason: 'browser-clock-matching-vehicle',
          source: 'BrowserTestBridge'
        });
        const matchingVehicle = (app.trafficSystem?.vehicles || []).find(candidate => (
          candidate?.mesh?.parent
          && candidate.vType === mission.vehicleType
          && !candidate.crashed
          && !candidate.isDestroyed
          && !candidate.userControlled
        ));
        if (!matchingVehicle) throw new Error(`Clock fixture lacks a ${mission.vehicleType} vehicle`);
        app.transitionCoordinator.transitionTo('STREET_VEHICLE', {
          reason: 'browser-clock-matching-vehicle',
          source: 'BrowserTestBridge',
          target: matchingVehicle,
          control: { action: 'ACQUIRE', kind: 'VEHICLE', entity: matchingVehicle, source: 'clock-test' }
        });
        controlledVehicle = matchingVehicle;
      }
      app.missionSystem.testLifecycleBeforeClock = app.missionSystem.lifecycle.serialize();
      app.missionSystem.lifecycle.prepare(mission.id);
      app.missionSystem.lifecycle.beginBriefing();
      app.missionSystem.lifecycle.accept({
        baseTimeLimit: 42,
        baseReward: app.missionSystem.getBasePayout(mission)
      });
      app.missionSystem.lifecycle.beginExecution();
      app.missionSystem.activeMission = mission;
      app.missionSystem.activeVehicle = controlledVehicle;
      app.missionSystem.timeRemaining = 42;
      app.missionSystem.initialTimeLimit = 42;
      app.missionSystem.basePayout = app.missionSystem.getBasePayout(mission);
      app.missionSystem.payout = app.missionSystem.basePayout;
      app.missionSystem.routePoints = mission.dropoff ? [mission.dropoff] : [];
      app.missionSystem.routeIndex = 0;
      if (mission.dropoff) app.missionSystem.setNavigationTarget(mission.dropoff);
      app.pedestrianSystem.isWanted = true;
      app.pedestrianSystem.escapeTimer = 3.5;
      return pauseProbe();
    },
    clearGameplayClockFixture: () => {
      app.missionSystem.activeMission = null;
      app.missionSystem.activeVehicle = null;
      app.missionSystem.lifecycle.restore(
        app.missionSystem.testLifecycleBeforeClock,
        { contentRegistry: app.contentRegistry }
      );
      app.missionSystem.testLifecycleBeforeClock = null;
      app.pedestrianSystem.isWanted = false;
      app.pedestrianSystem.escapeTimer = 0;
      return pauseProbe();
    },
    setMayhem: enabled => app.uiManager?.setMayhem?.(Boolean(enabled), 'BrowserTestBridge'),
    alerts: () => app.alertService?.snapshot?.() || null,
    serviceSnapshot: () => app.cityServiceModel?.snapshot?.() || null,
    mobilitySnapshot: () => app.trafficProductivityModel?.snapshot?.() || null,
    setBridgePriority: enabled => {
      app.trafficSystem?.toggleBridgePriority?.(Boolean(enabled));
      app.trafficProductivityModel?.update?.(0, { force: true, reason: 'BROWSER_TEST_POLICY' });
      return app.trafficProductivityModel?.snapshot?.() || null;
    },
    refreshMobility: () => app.trafficProductivityModel?.update?.(1, { force: true, reason: 'BROWSER_TEST_REFRESH' }),
    mobilityPresentation: () => Object.freeze({
      metrics: app.trafficSystem?.getCongestionMetrics?.() || null,
      streetStatus: app.mobilityStreetFeedbackSystem?.group?.userData?.streetStatus || null,
      priorityMarkers: app.mobilityStreetFeedbackSystem?.priorityMarkers?.filter(marker => marker.visible).length || 0,
      disruptionMarkers: app.mobilityStreetFeedbackSystem?.disruptionMarkers?.filter(marker => marker.visible).length || 0
    }),
    missionTrafficImpact: missionId => {
      const mission = app.missionSystem?.missions?.find(candidate => candidate.id === missionId);
      if (!mission) throw new RangeError(`Unknown mission: ${missionId}`);
      return app.trafficProductivityModel?.getMissionImpact?.(mission) || null;
    },
    reportServiceIncident: () => app.incidentResponseService?.reportIncident?.({
      id: 'browser-service-relay',
      type: 'ENERGY_RELAY_DAMAGE',
      title: 'Acceptance relay damaged',
      cause: 'A deterministic relay strike created a local outage and debris field.',
      targetId: 'browser-relay',
      infrastructureId: 'browser-relay',
      districtId: 'PRIMARY_BRIDGE_CORRIDOR',
      service: 'power',
      severity: 5,
      cleanupCost: 1_000,
      repairCost: 2_000,
      coverageMultiplier: 0.35,
      position: { x: 205, z: 18 },
      influenceRadius: 90
    }),
    scheduleServiceResponse: incidentId => app.incidentResponseService?.scheduleResponse?.(incidentId),
    serviceWorkOrders: () => app.incidentResponseService?.getWorkOrders?.() || [],
    enterServiceWork: workOrderId => {
      const order = app.incidentResponseService?.getWorkOrder?.(workOrderId);
      if (!order?.position) throw new Error(`Street work order is unavailable: ${workOrderId}`);
      enterState('STREET_ON_FOOT');
      const pedestrian = app.pedestrianSystem?.controlledPedestrian;
      if (!pedestrian?.mesh?.position) throw new Error('Service work setup lacks a controlled pedestrian.');
      pedestrian.mesh.position.set(
        order.position.x,
        (app.cityBuilder?.getHillHeight?.(order.position.x, order.position.z) || 0) + 1,
        order.position.z
      );
      return Object.freeze({ workOrder: order, snapshot: diagnostics.snapshot() });
    },
    publishAlertFixture: (actionType = 'STREET_WAYPOINT') => app.alertService?.publish?.({
      dedupeKey: `browser-fixture:${actionType}`,
      type: 'SYSTEM',
      severity: 'WARNING',
      title: 'Browser acceptance incident',
      cause: 'A deterministic test incident requires player attention.',
      location: { label: 'Acceptance sector', position: { x: 160, y: 0, z: 24 } },
      duration: { kind: 'UNTIL_RESOLVED' },
      recommendation: 'Use the supplied alert action and verify the destination.',
      relatedEntityIds: ['browser-acceptance-incident'],
      focusAction: { type: actionType, position: { x: 160, y: 0, z: 24 } }
    }),
    resolveAlert: id => app.alertService?.resolve?.(id, 'Browser acceptance incident resolved'),
    alertActionProbe: () => Object.freeze({
      waypoint: app.alertActionController?.getWaypoint?.() || null,
      cameraTarget: app.sceneManager?.controls?.target
        ? Object.freeze({
            x: app.sceneManager.controls.target.x,
            y: app.sceneManager.controls.target.y,
            z: app.sceneManager.controls.target.z
          })
        : null,
      state: app.gameManager?.state || null
    }),
    pauseProbe,
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

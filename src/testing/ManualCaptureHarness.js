const MANUAL_CAPTURE_PARAMETER = 'manualCapture';
const VEHICLE_TYPES = Object.freeze(['SEDAN', 'SPORTS', 'BUS', 'TRUCK', 'MOTORBIKE']);
const VEHICLE_CONDITIONS = Object.freeze(['flat', 'turn', 'bridge', 'rain', 'collision', 'reset']);

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function positionOf(entity) {
  const position = entity?.physicsVehicle?.chassisBody?.position || entity?.mesh?.position;
  return position ? { x: round(position.x), y: round(position.y), z: round(position.z) } : null;
}

function distanceXZ(a, b) {
  if (!a || !b) return null;
  return round(Math.hypot(a.x - b.x, a.z - b.z));
}

function selectedDiagnostics(snapshot) {
  return {
    state: snapshot?.state || null,
    controlledEntity: snapshot?.controlledEntity || null,
    mission: snapshot?.mission || null,
    save: snapshot?.save || null,
    entities: snapshot?.entities || null,
    performance: snapshot?.performance || null,
    alerts: snapshot?.alerts || null,
    testMode: snapshot?.testMode || null
  };
}

function findVehicle(app, type, excluded = null) {
  return (app.trafficSystem?.vehicles || []).find(vehicle => (
    vehicle !== excluded
    && vehicle?.mesh?.parent
    && vehicle.vType === type
    && !vehicle.crashed
    && !vehicle.isDestroyed
    && !vehicle.userControlled
  ));
}

function setVehiclePose(app, vehicle, { x, z, yaw = 0 }) {
  const terrainY = app.cityBuilder?.getHillHeight?.(x, z) || 0;
  const physics = vehicle?.physicsVehicle;
  const body = physics?.chassisBody;
  if (body) {
    const rideHeight = Math.max(1.15, Number(physics.meshOffset || 0) + 0.7);
    body.position.set(x, terrainY + rideHeight, z);
    body.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.aabbNeedsUpdate = true;
    body.wakeUp?.();
    physics.syncMesh?.();
  } else if (vehicle?.mesh) {
    vehicle.mesh.position.set(x, terrainY, z);
    vehicle.mesh.rotation.set(0, yaw, 0);
  }
  if (vehicle?.physicsBody?.position) {
    vehicle.physicsBody.position.set(x, terrainY + 1.05, z);
    vehicle.physicsBody.aabbNeedsUpdate = true;
  }
  return positionOf(vehicle);
}

async function holdInputs(app, inputs, milliseconds) {
  for (const input of inputs) app.inputManager?.pressedInputs?.add?.(input);
  await delay(milliseconds);
  for (const input of inputs) app.inputManager?.pressedInputs?.delete?.(input);
  app.inputManager?.clearTransientInputState?.({ quarantine: false });
  await delay(140);
}

function findValidPlacement(app, editor, { startX = -160, startZ = -340, exclude = null } = {}) {
  const spec = editor.selectedSpec;
  for (let x = startX; x <= 780; x += 10) {
    for (let z = startZ; z <= 340; z += 10) {
      const y = app.cityBuilder?.getHillHeight?.(x, z) || 0;
      const validation = editor.getPlacementValidation({
        spec,
        rotationY: editor.rotationY,
        x,
        y,
        z,
        ignoreBuilding: exclude,
        ignorePlayer: true
      });
      if (validation.valid) return { x, y, z, validation };
    }
  }
  throw new Error(`No valid ${spec?.id || 'building'} placement was available.`);
}

function prepareUserBuilding(app, bridge, offset = 0) {
  bridge.enterState('BUILDER');
  const editor = app.cityEditorSystem;
  if (!editor.selectBuilding('CYBERCAFE')) throw new Error('CYBERCAFE could not be selected.');
  const candidate = findValidPlacement(app, editor, { startX: -160 + offset });
  editor.currentHit = { ...candidate, valid: true };
  editor.ghostGroup?.position?.set?.(candidate.x, candidate.y, candidate.z);
  if (!editor.placeSelectedBuilding()) throw new Error('Capture building placement failed.');
  const building = app.buildingFactory?.buildings?.at?.(-1);
  if (!building?.isUserPlaced) throw new Error('Placed capture building was not retained.');
  editor.selectedStructure = building;
  editor.selectedSpec = building.spec;
  return { editor, building, candidate };
}

async function stageBuilderScenario(app, bridge, scenarioId) {
  const serial = Number(app.buildingFactory?.buildings?.filter?.(item => item?.isUserPlaced)?.length || 0);
  const { editor, building } = prepareUserBuilding(app, bridge, serial * 20);
  const before = { position: { ...building.plot }, rotationY: round(building.group.rotation.y) };

  if (scenarioId === 'builder-move') {
    editor.setTool('MOVE');
    editor.selectedStructure = building;
    const target = findValidPlacement(app, editor, { startX: before.position.x + 30, startZ: before.position.z, exclude: building });
    editor.currentHit = { ...target, valid: true };
    if (!editor.moveSelectedStructureToCurrentHit()) throw new Error('Builder move did not commit.');
  } else if (scenarioId === 'builder-rotate') {
    editor.setTool('ROTATE');
    editor.selectedStructure = building;
    if (editor.rotateSelection() === false) throw new Error('Builder rotation did not commit.');
  } else {
    editor.setTool('DELETE');
    const world = building.group.getWorldPosition(building.group.position.clone());
    editor.camera.position.set(world.x + 42, world.y + 48, world.z + 42);
    editor.camera.lookAt(world);
    editor.camera.updateProjectionMatrix();
    editor.camera.updateMatrixWorld(true);
    if (app.sceneManager?.controls?.target) {
      app.sceneManager.controls.target.copy(world);
      app.sceneManager.controls.update?.();
    }
    editor.camera.updateMatrixWorld(true);
    app.sceneManager?.scene?.updateMatrixWorld?.(true);
    building.group.updateWorldMatrix?.(true, true);
    const projected = world.clone().project(editor.camera);
    editor.mouse.set(projected.x, projected.y);
    if (!editor.performDeleteAtMouse()) throw new Error('Builder demolition did not commit.');
  }
  await delay(180);
  return {
    tool: editor.toolMode,
    before,
    after: building.isDestroyed
      ? { destroyed: true }
      : { destroyed: false, position: { ...building.plot }, rotationY: round(building.group.rotation.y) }
  };
}

function setPedestrianPose(app, pedestrian, x, z, yaw = 0) {
  const y = app.cityBuilder?.getHillHeight?.(x, z) || 0;
  pedestrian.mesh.position.set(x, y, z);
  pedestrian.mesh.rotation.set(0, yaw, 0);
  return positionOf(pedestrian);
}

async function stagePedestrianScenario(app, bridge, scenarioId) {
  bridge.enterState('STREET_ON_FOOT');
  const system = app.pedestrianSystem;
  const pedestrian = system?.controlledPedestrian;
  if (!pedestrian) throw new Error('No controlled pedestrian is available.');

  if (scenarioId === 'on-foot-collision') {
    const building = (app.buildingFactory?.buildings || []).find(item => item?.plot && !item.isDestroyed);
    if (!building) throw new Error('No collision building is available.');
    const depth = building.plot.depth || 30;
    setPedestrianPose(app, pedestrian, building.plot.x, building.plot.z - depth * 0.5 - 0.8, 0);
    const before = positionOf(pedestrian);
    await holdInputs(app, ['KeyW'], 700);
    const after = positionOf(pedestrian);
    return { obstacle: building.name || building.id, before, after, displacement: distanceXZ(before, after) };
  }

  if (scenarioId === 'on-foot-jump') {
    const groundY = app.cityBuilder?.getHillHeight?.(pedestrian.mesh.position.x, pedestrian.mesh.position.z) || 0;
    system.triggerPedestrianJump();
    await delay(170);
    return { groundY: round(groundY), position: positionOf(pedestrian), isJumping: pedestrian.isJumping, jumpVelocity: round(pedestrian.jumpVelocity) };
  }

  if (scenarioId === 'on-foot-bat-impact') {
    pedestrian.hasBaseballBat = true;
    pedestrian.swingTimer = 0;
    const vehicle = (app.trafficSystem?.vehicles || []).find(item => item?.mesh?.parent && !item.crashed && !item.isDestroyed);
    if (!vehicle) throw new Error('No bat-impact vehicle is available.');
    const base = positionOf(pedestrian);
    pedestrian.mesh.rotation.set(0, 0, 0);
    setVehiclePose(app, vehicle, { x: base.x, z: base.z + 3, yaw: 0 });
    vehicle.mesh.rotation.set(0, 0, 0);
    vehicle.isParked = true;
    vehicle.speed = 0;
    vehicle.targetSpeed = 0;
    vehicle.batHits = 0;
    app.sceneManager?.startFollowTarget?.(pedestrian);
    await delay(220);
    system.swingBaseballBat();
    await delay(70);
    return { target: vehicle.vType, batHits: vehicle.batHits || 0, swingTimer: round(pedestrian.swingTimer), position: positionOf(pedestrian) };
  }

  if (scenarioId === 'on-foot-hijack') {
    const vehicle = findVehicle(app, 'SEDAN') || (app.trafficSystem?.vehicles || []).find(item => item?.mesh?.parent && !item.userControlled);
    if (!vehicle) throw new Error('No hijack vehicle is available.');
    const base = positionOf(pedestrian);
    setVehiclePose(app, vehicle, { x: base.x + 1.3, z: base.z, yaw: 0 });
    pedestrian.mesh.rotation.set(0, Math.PI / 2, 0);
    app.sceneManager?.startFollowTarget?.(pedestrian);
    await delay(220);
    if (!system.beginHijack(pedestrian, vehicle)) throw new Error('Hijack transition did not begin.');
    await delay(150);
    return {
      target: vehicle.vType,
      transition: system.hijackTransition ? {
        elapsed: round(system.hijackTransition.elapsed),
        duration: round(system.hijackTransition.duration)
      } : null,
      position: positionOf(pedestrian)
    };
  }

  const vehicle = findVehicle(app, 'SEDAN') || (app.trafficSystem?.vehicles || []).find(item => item?.mesh?.parent && !item.userControlled);
  if (!vehicle) throw new Error('No exit vehicle is available.');
  const exitSourcePedestrian = pedestrian;
  bridge.enterState('MANAGEMENT');
  app.transitionCoordinator.transitionTo('STREET_ON_FOOT', {
    reason: 'phase0-manual-exit-approach',
    source: 'ManualCaptureHarness',
    target: exitSourcePedestrian,
    control: { action: 'ACQUIRE', kind: 'PEDESTRIAN', entity: exitSourcePedestrian }
  });
  app.transitionCoordinator.transitionTo('STREET_VEHICLE', {
    reason: 'phase0-manual-exit-setup',
    source: 'ManualCaptureHarness',
    target: vehicle,
    control: { action: 'ACQUIRE', kind: 'VEHICLE', entity: vehicle, source: 'pedestrian', pedestrian: exitSourcePedestrian }
  });
  const vehiclePosition = positionOf(vehicle);
  app.transitionCoordinator.transitionTo('STREET_ON_FOOT', {
    reason: 'phase0-manual-exit',
    source: 'ManualCaptureHarness',
    target: vehicle,
    control: { action: 'EXIT_VEHICLE', kind: 'PEDESTRIAN', sourceVehicle: vehicle }
  });
  await delay(150);
  const exited = app.pedestrianSystem?.controlledPedestrian;
  return { vehiclePosition, pedestrianPosition: positionOf(exited), exitDistance: distanceXZ(vehiclePosition, positionOf(exited)) };
}

async function acquireVehicle(app, bridge, type) {
  bridge.enterState('MANAGEMENT');
  if (app.pedestrianSystem) {
    app.pedestrianSystem.isWanted = false;
    app.pedestrianSystem.escapeTimer = 0;
    app.pedestrianSystem.clearPoliceResponse?.();
    app.pedestrianSystem.resolveCrimeIncident?.();
    app.pedestrianSystem.updateWantedHud?.();
  }
  const vehicle = findVehicle(app, type);
  if (!vehicle) throw new Error(`No usable ${type} vehicle is available.`);
  app.transitionCoordinator.transitionTo('STREET_VEHICLE', {
    reason: 'phase0-manual-vehicle',
    source: 'ManualCaptureHarness',
    target: vehicle,
    control: { action: 'ACQUIRE', kind: 'VEHICLE', entity: vehicle, source: 'camera' }
  });
  await delay(100);
  return vehicle;
}

async function stageVehicleScenario(app, bridge, scenarioId) {
  const [, type, condition] = /^vehicle-([A-Z_]+)-(flat|turn|bridge|rain|collision|reset)$/.exec(scenarioId) || [];
  if (!VEHICLE_TYPES.includes(type) || !VEHICLE_CONDITIONS.includes(condition)) throw new Error(`Unknown vehicle scenario ${scenarioId}.`);
  const vehicle = await acquireVehicle(app, bridge, type);
  app.environment?.setDynamicWeather?.(false);
  app.environment?.setWeather?.(condition === 'rain' ? 'rain' : 'clear');

  const poses = {
    flat: { x: -125, z: -50, yaw: Math.PI / 2 },
    turn: { x: -100, z: -75, yaw: 0 },
    bridge: { x: 125, z: 3.5, yaw: Math.PI / 2 },
    rain: { x: -125, z: 50, yaw: Math.PI / 2 },
    collision: { x: -100, z: -75, yaw: 0 },
    reset: { x: -100, z: 50, yaw: 0 }
  };
  const before = setVehiclePose(app, vehicle, poses[condition]);
  await delay(120);
  let obstacle = null;
  let obstacleBefore = null;
  let contactResolved = null;
  let resetTilt = null;

  if (condition === 'turn') {
    await holdInputs(app, ['KeyW', 'KeyA'], 850);
  } else if (condition === 'collision') {
    obstacle = (app.trafficSystem?.vehicles || []).find(item => item !== vehicle && item?.mesh?.parent && !item.userControlled);
    if (!obstacle) throw new Error('No collision target is available.');
    const targetY = app.cityBuilder?.getHillHeight?.(-100, -71.5) || 0;
    obstacle.mesh.position.set(-100, targetY, -71.5);
    obstacle.speed = 0;
    obstacle.targetSpeed = 0;
    obstacle.isParked = true;
    if (obstacle.physicsBody?.position) {
      obstacle.physicsBody.position.set(-100, targetY + 1.05, -71.5);
      obstacle.physicsBody.velocity?.set?.(0, 0, 0);
      obstacle.physicsBody.aabbNeedsUpdate = true;
    }
    obstacleBefore = positionOf(obstacle);
    contactResolved = app.trafficSystem?.resolveUserVehicleContact?.(vehicle, obstacle) || false;
    if (!contactResolved) {
      obstacle.mesh.position.set(vehicle.mesh.position.x, vehicle.mesh.position.y, vehicle.mesh.position.z);
      if (obstacle.physicsBody?.position) {
        obstacle.physicsBody.position.set(vehicle.mesh.position.x, vehicle.mesh.position.y + 1.05, vehicle.mesh.position.z);
        obstacle.physicsBody.aabbNeedsUpdate = true;
      }
      obstacleBefore = positionOf(obstacle);
      contactResolved = app.trafficSystem?.resolveUserVehicleContact?.(vehicle, obstacle) || false;
    }
    await holdInputs(app, ['KeyW'], 320);
  } else if (condition === 'reset') {
    const body = vehicle.physicsVehicle?.chassisBody;
    if (!body) throw new Error('Reset scenario lacks a physics chassis.');
    body.quaternion.set(0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4));
    vehicle.physicsVehicle.syncMesh?.();
    resetTilt = { before: round(vehicle.mesh.rotation.z) };
    await delay(90);
    body.quaternion.set(0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4));
    vehicle.physicsVehicle.resetPosition();
    vehicle.physicsVehicle.syncMesh?.();
    resetTilt.after = round(vehicle.mesh.rotation.z);
    await delay(120);
  } else {
    await holdInputs(app, ['KeyW'], condition === 'bridge' ? 950 : 750);
  }

  const after = positionOf(vehicle);
  return {
    type,
    condition,
    weather: app.environment?.weatherMode || app.environment?.currentWeather || (condition === 'rain' ? 'rain' : 'clear'),
    before,
    after,
    displacement: distanceXZ(before, after),
    speedKmh: round(vehicle.physicsVehicle?.speedKmH || 0),
    steering: round(vehicle.physicsVehicle?.currentSteering || 0),
    obstacle: obstacle ? { type: obstacle.vType, distance: distanceXZ(after, positionOf(obstacle)) } : null,
    collision: obstacle ? {
      resolved: Boolean(contactResolved),
      obstacleBefore,
      obstacleAfter: positionOf(obstacle),
      obstacleDisplacement: distanceXZ(obstacleBefore, positionOf(obstacle)),
      bumpCooldown: round(vehicle.bumpCooldown || 0)
    } : null,
    resetTilt
  };
}

async function stageMissionScenario(app, bridge, scenarioId) {
  if (scenarioId === 'race-checkpoint' || scenarioId === 'minimap-composition') {
    bridge.startMission('mission_sports_trial');
    const mission = app.missionSystem;
    const vehicle = mission.activeVehicle;
    const target = mission.routePoints[0];
    setVehiclePose(app, vehicle, { x: target.x, z: target.z, yaw: 0 });
    mission.update(0.05);
    await delay(130);
    return {
      missionId: mission.activeMission?.id,
      routeIndex: mission.routeIndex,
      routeLength: mission.routePoints.length,
      target: mission.getNavigationTarget?.() || null,
      minimapVisible: !document.getElementById('minimap-hud')?.classList?.contains?.('hidden')
    };
  }

  if (scenarioId === 'sabotage-hold') {
    bridge.startMission('mission_police_robbery');
    const mission = app.missionSystem;
    const vehicle = mission.activeVehicle;
    setVehiclePose(app, vehicle, { x: mission.activeMission.dropoff.x, z: mission.activeMission.dropoff.z, yaw: 0 });
    vehicle.speed = 0;
    if (!mission.handleActionKey()) throw new Error('Sabotage interaction did not begin.');
    mission.update(1.25);
    await delay(100);
    return {
      missionId: mission.activeMission?.id,
      sabotageActive: mission.sabotageActive,
      sabotageProgress: round(mission.sabotageProgress),
      sabotageDuration: mission.activeMission?.sabotageDuration
    };
  }

  if (scenarioId === 'police-pursuit') {
    bridge.enterState('STREET_ON_FOOT');
    const pedestrian = app.pedestrianSystem?.controlledPedestrian;
    app.pedestrianSystem?.reportCrime?.(pedestrian?.mesh?.position, 'Phase 0 manual pursuit capture');
    await delay(350);
    const police = (app.trafficSystem?.vehicles || []).filter(vehicle => vehicle?.isPolice);
    return { wanted: app.pedestrianSystem?.isWanted, escapeTimer: round(app.pedestrianSystem?.escapeTimer || 0), policeResponding: police.length };
  }

  if (scenarioId === 'recovery-restore') {
    bridge.enterState('MANAGEMENT');
    app.timeManager?.setTime?.(7.25);
    await app.saveService.saveNow({ reason: 'phase0-manual-recovery-base' });
    app.timeManager?.setTime?.(19.5);
    await app.saveService.saveNow({ reason: 'phase0-manual-recovery-current' });
    app.timeManager?.setTime?.(23);
    const recovered = await app.saveService.repository.promoteRecovery();
    if (!app.saveService.restore(recovered, { deferRuntime: false })) throw new Error('Recovery save was not applied.');
    app.uiManager?.addAlert?.('↺ Recovery save applied for Phase 0 review.', 'success');
    await delay(160);
    return { applied: true, restoredTime: round(app.timeManager?.timeVal), savedAt: recovered.metadata?.savedAt, saveStatus: app.saveService.getStatus() };
  }

  throw new Error(`Unknown mission/manual scenario ${scenarioId}.`);
}

function scenarioIds() {
  return [
    'builder-move', 'builder-rotate', 'builder-demolish',
    'on-foot-collision', 'on-foot-jump', 'on-foot-bat-impact', 'on-foot-hijack', 'on-foot-exit',
    ...VEHICLE_TYPES.flatMap(type => VEHICLE_CONDITIONS.map(condition => `vehicle-${type}-${condition}`)),
    'race-checkpoint', 'sabotage-hold', 'minimap-composition', 'police-pursuit', 'recovery-restore'
  ];
}

/** Installs an off-canvas, semantic control surface only for explicit manual capture sessions. */
export function installManualCaptureHarness(app, diagnostics, bridge) {
  if (!app?.runtimeConfig?.test || !bridge || typeof document === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get(MANUAL_CAPTURE_PARAMETER) !== '1') return null;

  const root = document.createElement('div');
  root.id = 'phase0-manual-capture-harness';
  root.setAttribute('aria-label', 'Phase 0 manual capture controls');
  root.style.cssText = 'position:fixed;left:0;top:0;width:210px;max-height:100vh;overflow:auto;opacity:.001;z-index:2147483647';
  const output = document.createElement('output');
  output.id = 'phase0-manual-capture-output';
  root.appendChild(output);

  const stage = async scenarioId => {
    document.body.dataset.phase0Scenario = scenarioId;
    document.body.dataset.phase0Status = 'running';
    delete document.body.dataset.phase0Telemetry;
    try {
      let details;
      if (scenarioId.startsWith('builder-')) details = await stageBuilderScenario(app, bridge, scenarioId);
      else if (scenarioId.startsWith('on-foot-')) details = await stagePedestrianScenario(app, bridge, scenarioId);
      else if (scenarioId.startsWith('vehicle-')) details = await stageVehicleScenario(app, bridge, scenarioId);
      else details = await stageMissionScenario(app, bridge, scenarioId);
      const telemetry = {
        schemaVersion: 1,
        scenarioId,
        capturedAt: new Date().toISOString(),
        details,
        diagnostics: selectedDiagnostics(diagnostics.snapshot())
      };
      const serialized = JSON.stringify(telemetry);
      output.value = serialized;
      output.textContent = serialized;
      document.body.dataset.phase0Telemetry = serialized;
      document.body.dataset.phase0Status = 'passed';
      return telemetry;
    } catch (error) {
      const failure = JSON.stringify({ scenarioId, error: error?.message || String(error) });
      output.value = failure;
      output.textContent = failure;
      document.body.dataset.phase0Telemetry = failure;
      document.body.dataset.phase0Status = 'failed';
      throw error;
    }
  };

  for (const scenarioId of scenarioIds()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.phase0ScenarioControl = scenarioId;
    button.setAttribute('aria-label', `Stage ${scenarioId}`);
    button.textContent = scenarioId;
    button.addEventListener('click', () => {
      // Failure is communicated through data-phase0-status/telemetry. Swallow
      // the event-handler promise so a bad capture setup does not trip the
      // application's global unhandled-rejection safety path.
      void stage(scenarioId).catch(() => {});
    });
    root.appendChild(button);
  }
  document.body.appendChild(root);
  document.body.dataset.phase0Harness = 'ready';
  return Object.freeze({ ids: scenarioIds(), stage });
}

import * as THREE from 'three';
import { CONTROL_KINDS, GAME_STATES } from '../core/GameManager.js';
import { PAUSE_REASONS } from '../core/PauseManager.js';
import { getBuildingSpec } from '../world/BuildingCatalog.js';
import { SaveValidationError } from './SaveSchema.js';

const STABLE_STATES = new Set([
  GAME_STATES.MANAGEMENT,
  GAME_STATES.BUILDER,
  GAME_STATES.STREET_ON_FOOT,
  GAME_STATES.STREET_VEHICLE,
  GAME_STATES.RESULT,
  GAME_STATES.PAUSED
]);

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SaveValidationError('must be an object.', { path });
  }
  return value;
}

function version1(value, path) {
  record(value, path);
  if (value.version !== 1) throw new SaveValidationError('has an unsupported feature version.', { path: `${path}.version` });
  return value;
}

function finite(value, path) {
  if (!Number.isFinite(value)) throw new SaveValidationError('must be finite.', { path });
  return value;
}

function vector(value, path) {
  if (!Array.isArray(value) || value.length !== 3) throw new SaveValidationError('must be a 3D vector.', { path });
  value.forEach((item, index) => finite(item, `${path}[${index}]`));
  return value;
}

function serializeOptional(owner, fallback = {}) {
  return owner?.serialize?.() ?? { version: 1, values: structuredClone(fallback) };
}

function controlledDescriptor(app) {
  const candidates = [
    [CONTROL_KINDS.VEHICLE, app.trafficSystem?.controlledVehicle, app.trafficSystem?.vehicles],
    [CONTROL_KINDS.PEDESTRIAN, app.pedestrianSystem?.controlledPedestrian, app.pedestrianSystem?.pedestrians],
    [CONTROL_KINDS.AIRCRAFT, app.aircraftSystem?.controlledAircraft, app.aircraftSystem?.aircraft ? [app.aircraftSystem.aircraft] : []]
  ];
  const [kind, entity, collection] = candidates.find(([, candidate]) => candidate) || [];
  if (!entity?.mesh) return null;
  let contentId = entity.persistenceId || entity.interactionId;
  if (!contentId) {
    const index = Math.max(0, collection?.indexOf?.(entity) ?? 0);
    const type = entity.vType || entity.pType || entity.type || 'entity';
    contentId = `${String(kind).toLowerCase()}:${type}:${index}`;
    entity.persistenceId = contentId;
  }
  return {
    kind,
    contentId,
    typeId: entity.vType || entity.pType || entity.type,
    position: entity.mesh.position.toArray(),
    rotation: [entity.mesh.rotation.x, entity.mesh.rotation.y, entity.mesh.rotation.z],
    speed: Number.isFinite(entity.speed) ? entity.speed : 0,
    inventory: { baseballBat: Boolean(entity.hasBaseballBat) }
  };
}

function serializeMission(app) {
  const system = app.missionSystem;
  const active = system?.activeMission
    ? {
        contentId: system.activeMission.id,
        state: system.state,
        timeRemaining: system.timeRemaining,
        initialTimeLimit: system.initialTimeLimit,
        basePayout: system.basePayout,
        payout: system.payout,
        routeIndex: system.routeIndex,
        raceElapsed: system.raceElapsed,
        sabotageProgress: system.sabotageProgress,
        sabotageActive: system.sabotageActive
      }
    : null;
  return {
    version: 1,
    completedMissionIds: [...(system?.narrativeState?.completedMissionIds || [])],
    dialogueChoices: structuredClone(system?.narrativeState?.dialogueChoices || []),
    chronologyStep: system?.narrativeState?.chronologyStep || 0,
    runCounts: [...(system?.missionRunCounts || new Map()).entries()],
    active
  };
}

function serializeAlerts(app) {
  const nodes = app.uiManager?.alertFeedList?.querySelectorAll?.('.alert-item') || [];
  return {
    version: 1,
    items: [...nodes].slice(0, 7).map(node => ({
      time: node.querySelector?.('.alert-time')?.textContent || 'LIVE',
      message: node.querySelector?.('.alert-msg')?.textContent || '',
      type: [...node.classList].find(name => name.startsWith('alert-') && name !== 'alert-item')?.slice(6) || 'info'
    })).filter(item => item.message)
  };
}

export function captureGameState(app) {
  const game = app.gameManager?.snapshot?.() || {};
  return {
    game: {
      version: 1,
      state: STABLE_STATES.has(game.state) ? game.state : GAME_STATES.MANAGEMENT,
      resumeState: game.state === GAME_STATES.PAUSED ? game.resumeState : null,
      mayhemEnabled: Boolean(game.mayhemEnabled)
    },
    economy: app.economySystem.serialize(),
    world: app.cityEditorSystem.serializeWorldEdits(),
    player: { version: 1, controlled: controlledDescriptor(app) },
    timeWeather: {
      version: 1,
      time: app.timeManager?.timeVal ?? 8,
      playing: app.timeManager?.isPlaying ?? true,
      speed: app.timeManager?.speed ?? 10,
      weather: app.environment?.weatherMode || 'clear'
    },
    missions: serializeMission(app),
    factions: serializeOptional(app.factionSystem, app.factions || {}),
    progression: serializeOptional(app.progressionSystem, app.progression || {}),
    heat: {
      version: 1,
      wanted: Boolean(app.pedestrianSystem?.isWanted),
      escapeTimer: Math.max(0, app.pedestrianSystem?.escapeTimer || 0),
      activeIncidentId: app.pedestrianSystem?.activeCrimeIncidentId || null
    },
    settings: { version: 1, values: structuredClone(app.settings || {}), heatmap: Boolean(app.trafficHeatmapEnabled) },
    bindings: { version: 1, overrides: structuredClone(app.inputManager?.bindingOverrides || {}) },
    alerts: serializeAlerts(app)
  };
}

export function validateGameState(data) {
  const game = version1(data.game, 'save.data.game');
  if (!STABLE_STATES.has(game.state)) throw new SaveValidationError('is not a restorable state.', { path: 'save.data.game.state' });
  if (typeof game.mayhemEnabled !== 'boolean') throw new SaveValidationError('must be boolean.', { path: 'save.data.game.mayhemEnabled' });
  if (game.state === GAME_STATES.PAUSED && !STABLE_STATES.has(game.resumeState)) {
    throw new SaveValidationError('must identify a stable resume state.', { path: 'save.data.game.resumeState' });
  }
  if (game.state === GAME_STATES.PAUSED && game.resumeState === GAME_STATES.PAUSED) {
    throw new SaveValidationError('cannot resume to PAUSED.', { path: 'save.data.game.resumeState' });
  }
  version1(data.player, 'save.data.player');
  const controlled = data.player.controlled;
  if (controlled != null) {
    record(controlled, 'save.data.player.controlled');
    if (![CONTROL_KINDS.VEHICLE, CONTROL_KINDS.PEDESTRIAN, CONTROL_KINDS.AIRCRAFT].includes(controlled.kind)) {
      throw new SaveValidationError('has an unsupported control kind.', { path: 'save.data.player.controlled.kind' });
    }
    if (typeof controlled.contentId !== 'string' || typeof controlled.typeId !== 'string') {
      throw new SaveValidationError('requires stable contentId and typeId strings.', { path: 'save.data.player.controlled' });
    }
    vector(controlled.position, 'save.data.player.controlled.position');
    vector(controlled.rotation, 'save.data.player.controlled.rotation');
    finite(controlled.speed, 'save.data.player.controlled.speed');
    const [x, y, z] = controlled.position;
    if (x < -1_000 || x > 1_500 || z < -1_000 || z > 1_000 || y < -100 || y > 2_000) {
      throw new SaveValidationError('is outside the supported world bounds.', { path: 'save.data.player.controlled.position' });
    }
  }
  if ([GAME_STATES.STREET_ON_FOOT, GAME_STATES.STREET_VEHICLE, GAME_STATES.RESULT].includes(game.state === GAME_STATES.PAUSED ? game.resumeState : game.state) && !controlled) {
    throw new SaveValidationError('street and result states require a controlled entity.', { path: 'save.data.player.controlled' });
  }
  version1(data.economy, 'save.data.economy');
  const world = version1(data.world, 'save.data.world');
  if (!Array.isArray(world.buildings) || !Array.isArray(world.zones || [])) throw new SaveValidationError('requires building and zone arrays.', { path: 'save.data.world' });
  for (const [index, building] of world.buildings.entries()) {
    record(building, `save.data.world.buildings[${index}]`);
    if (!getBuildingSpec(building.specId)) throw new SaveValidationError('references an unknown stable building ID.', { path: `save.data.world.buildings[${index}].specId` });
    finite(building.plot?.x, `save.data.world.buildings[${index}].plot.x`);
    finite(building.plot?.z, `save.data.world.buildings[${index}].plot.z`);
  }
  for (const [index, zone] of (world.zones || []).entries()) {
    record(zone, `save.data.world.zones[${index}]`);
    if (typeof zone.key !== 'string' || !zone.key.trim()) {
      throw new SaveValidationError('requires a stable zone key.', { path: `save.data.world.zones[${index}].key` });
    }
    finite(zone.x, `save.data.world.zones[${index}].x`);
    finite(zone.z, `save.data.world.zones[${index}].z`);
  }
  const timeWeather = version1(data.timeWeather, 'save.data.timeWeather');
  finite(timeWeather.time, 'save.data.timeWeather.time');
  finite(timeWeather.speed, 'save.data.timeWeather.speed');
  if (typeof timeWeather.playing !== 'boolean' || typeof timeWeather.weather !== 'string') throw new SaveValidationError('has invalid time/weather fields.', { path: 'save.data.timeWeather' });
  const missions = version1(data.missions, 'save.data.missions');
  if (!Array.isArray(missions.completedMissionIds) || !Array.isArray(missions.dialogueChoices) || !Array.isArray(missions.runCounts)) throw new SaveValidationError('has invalid mission collections.', { path: 'save.data.missions' });
  if (missions.active != null) {
    if (typeof missions.active.contentId !== 'string') throw new SaveValidationError('requires a stable mission content ID.', { path: 'save.data.missions.active.contentId' });
    for (const name of ['timeRemaining', 'initialTimeLimit', 'basePayout', 'payout', 'routeIndex', 'raceElapsed', 'sabotageProgress']) {
      if (!Number.isFinite(missions.active[name]) || missions.active[name] < 0) {
        throw new SaveValidationError('must be a non-negative finite number.', { path: `save.data.missions.active.${name}` });
      }
    }
    if (typeof missions.active.sabotageActive !== 'boolean') {
      throw new SaveValidationError('must be boolean.', { path: 'save.data.missions.active.sabotageActive' });
    }
  }
  for (const name of ['factions', 'progression', 'heat', 'settings', 'bindings', 'alerts']) version1(data[name], `save.data.${name}`);
  if (typeof data.heat.wanted !== 'boolean' || !Number.isFinite(data.heat.escapeTimer) || data.heat.escapeTimer < 0) {
    throw new SaveValidationError('has invalid wanted state or escape timer.', { path: 'save.data.heat' });
  }
  record(data.settings.values, 'save.data.settings.values');
  record(data.bindings.overrides, 'save.data.bindings.overrides');
  if (!Array.isArray(data.alerts.items)) throw new SaveValidationError('must be an array.', { path: 'save.data.alerts.items' });
  for (const [index, item] of data.alerts.items.entries()) {
    record(item, `save.data.alerts.items[${index}]`);
    if (typeof item.message !== 'string' || typeof item.type !== 'string') {
      throw new SaveValidationError('requires message and type strings.', { path: `save.data.alerts.items[${index}]` });
    }
  }
  return true;
}

export function validateGameReferences(app, data) {
  const activeMissionId = data.missions.active?.contentId;
  if (activeMissionId && !app.missionSystem?.missions?.some(mission => mission.id === activeMissionId)) {
    throw new SaveValidationError(`unknown mission content ID ${activeMissionId}.`, {
      path: 'save.data.missions.active.contentId'
    });
  }
  const descriptor = data.player.controlled;
  if (descriptor) {
    const collection = entityCollection(app, descriptor.kind);
    const available = collection.some(entity => (
      (entity.persistenceId || entity.interactionId) === descriptor.contentId
      || (entity.vType || entity.pType || entity.type) === descriptor.typeId
    ));
    if (!available) {
      throw new SaveValidationError(`controlled content ID ${descriptor.contentId} is unavailable.`, {
        path: 'save.data.player.controlled.contentId'
      });
    }
  }
  app.factionSystem?.validateSerialized?.(data.factions);
  app.progressionSystem?.validateSerialized?.(data.progression);
  return true;
}

export function restoreWorld(app, world) {
  const report = { restoredBuildings: 0, skippedBuildings: 0, clearedScenery: 0 };
  for (const saved of world.buildings) {
    const spec = getBuildingSpec(saved.specId);
    const plot = saved.plot;
    const inBounds = plot.x >= -190 && plot.x <= 810 && plot.z >= -390 && plot.z <= 390;
    if (!spec || !inBounds) {
      report.skippedBuildings += 1;
      if (saved.economyId) app.economySystem?.removeBuilding?.(saved.economyId);
      continue;
    }
    const rotationY = Number.isFinite(saved.rotationY) ? saved.rotationY : 0;
    const quarterTurns = Math.abs(Math.round(rotationY / (Math.PI / 2))) % 2;
    const safePlot = {
      x: plot.x,
      y: app.cityBuilder?.getHillHeight?.(plot.x, plot.z) || 0,
      z: plot.z,
      width: quarterTurns === 0 ? spec.footprint.width : spec.footprint.depth,
      depth: quarterTurns === 0 ? spec.footprint.depth : spec.footprint.width
    };
    const editor = app.cityEditorSystem;
    const valid = editor?.isPlacementValid?.({ spec, rotationY, ...safePlot, allowCountrysideReplacement: true, ignorePlayer: true }) ?? true;
    if (!valid) {
      report.skippedBuildings += 1;
      if (saved.economyId) app.economySystem?.removeBuilding?.(saved.economyId);
      continue;
    }
    const building = app.buildingFactory.placeUserBuilding(safePlot, spec, rotationY);
    const rect = editor?.getPlacementRect?.(safePlot.x, safePlot.z, 2, spec, rotationY);
    if (rect) report.clearedScenery += app.cityBuilder?.removeCountrysideSceneryOverlapping?.(rect)?.length || 0;
    Object.assign(building.plot, safePlot);
    building.economyId = saved.economyId || building.economyId;
    editor?.reserveUserBuildingId?.(building.economyId);
    if (app.physicsWorld && !['ROAD_SEGMENT', 'PARK_PLAZA'].includes(spec.generatorType)) {
      const height = spec.height || 30;
      building.physicsBody = app.physicsWorld.addStaticBoxCollider(
        new THREE.Vector3(safePlot.x, safePlot.y + height * 0.5, safePlot.z),
        new THREE.Vector3(Math.max(1, safePlot.width - 2), height, Math.max(1, safePlot.depth - 2))
      );
    }
    if (spec.generatorType === 'ROAD_SEGMENT') app.trafficSystem?.registerRoadSegment?.(building, spec);
    report.restoredBuildings += 1;
  }
  app.cityEditorSystem.restoreZoneParcels(world.zones || []);
  return Object.freeze(report);
}

function restoreMissionProgress(app, mission) {
  const system = app.missionSystem;
  if (!system) return;
  system.narrativeState.completedMissionIds = new Set(mission.completedMissionIds);
  system.narrativeState.dialogueChoices = structuredClone(mission.dialogueChoices);
  system.narrativeState.chronologyStep = Math.max(0, Math.trunc(mission.chronologyStep || 0));
  system.missionRunCounts = new Map(mission.runCounts.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && Number.isInteger(entry[1]) && entry[1] >= 0));
}

export function restoreStaticGameState(app, data) {
  app.economySystem.restore(data.economy);
  const worldReport = restoreWorld(app, data.world);
  app.timeManager?.setTime?.(data.timeWeather.time);
  app.timeManager?.setPlaying?.(data.timeWeather.playing);
  app.timeManager?.setSpeed?.(data.timeWeather.speed);
  app.environment?.setWeather?.(data.timeWeather.weather);
  app.environment?.setDynamicWeather?.(true);
  restoreMissionProgress(app, data.missions);
  app.factionSystem?.restore?.(data.factions);
  app.progressionSystem?.restore?.(data.progression);
  app.settings = structuredClone(data.settings.values || {});
  app.inputManager.bindingOverrides = structuredClone(data.bindings.overrides || {});
  app.trafficHeatmapEnabled = Boolean(data.settings.heatmap);
  app.trafficHeatmapSystem?.setVisible?.(app.trafficHeatmapEnabled);
  if (app.uiManager?.heatmapToggle) app.uiManager.heatmapToggle.checked = app.trafficHeatmapEnabled;
  return worldReport;
}

function entityCollection(app, kind) {
  if (kind === CONTROL_KINDS.VEHICLE) return app.trafficSystem?.vehicles || [];
  if (kind === CONTROL_KINDS.PEDESTRIAN) return app.pedestrianSystem?.pedestrians || [];
  if (kind === CONTROL_KINDS.AIRCRAFT) return app.aircraftSystem?.aircraft ? [app.aircraftSystem.aircraft] : [];
  return [];
}

function resolveEntity(app, descriptor) {
  if (!descriptor) return null;
  const collection = entityCollection(app, descriptor.kind);
  const exact = collection.find(entity => (entity.persistenceId || entity.interactionId) === descriptor.contentId);
  const compatible = exact || collection.find(entity => (entity.vType || entity.pType || entity.type) === descriptor.typeId);
  if (!compatible?.mesh) throw new SaveValidationError(`saved controlled entity ${descriptor.contentId} is unavailable.`, { path: 'save.data.player.controlled' });
  compatible.persistenceId = descriptor.contentId;
  compatible.mesh.position.fromArray(descriptor.position);
  compatible.mesh.rotation.set(...descriptor.rotation);
  compatible.speed = descriptor.speed;
  compatible.hasBaseballBat = Boolean(descriptor.inventory?.baseballBat);
  return compatible;
}

function transitionToSavedState(app, game, descriptor, entity) {
  const desired = game.state === GAME_STATES.PAUSED ? game.resumeState : game.state;
  const common = { reason: 'save-restore', source: 'SaveService', target: entity };
  if (desired === GAME_STATES.STREET_ON_FOOT) {
    app.transitionCoordinator.transitionTo(desired, { ...common, control: { action: 'ACQUIRE', kind: CONTROL_KINDS.PEDESTRIAN, entity } });
  } else if (desired === GAME_STATES.STREET_VEHICLE) {
    app.transitionCoordinator.transitionTo(desired, { ...common, control: { action: 'ACQUIRE', kind: descriptor.kind, entity, source: 'restore' } });
  } else if (desired === GAME_STATES.RESULT) {
    const streetState = descriptor.kind === CONTROL_KINDS.PEDESTRIAN
      ? GAME_STATES.STREET_ON_FOOT
      : GAME_STATES.STREET_VEHICLE;
    app.transitionCoordinator.transitionTo(streetState, {
      ...common,
      control: { action: 'ACQUIRE', kind: descriptor.kind, entity, source: 'restore' }
    });
    app.transitionCoordinator.transitionTo(GAME_STATES.RESULT, common);
  } else if (desired !== GAME_STATES.MANAGEMENT) {
    app.transitionCoordinator.transitionTo(desired, common);
  }
  app.gameManager.setMayhem(game.mayhemEnabled, 'save-restore');
  app.funMode = game.mayhemEnabled;
  app.uiManager?.renderMayhemState?.(game.mayhemEnabled);
  if (game.state === GAME_STATES.PAUSED) app.pauseManager.acquire(PAUSE_REASONS.SYSTEM, { source: 'SaveService' });
}

function restoreActiveMission(app, saved) {
  if (!saved) return;
  const system = app.missionSystem;
  const mission = system?.missions?.find(candidate => candidate.id === saved.contentId);
  if (!mission) throw new SaveValidationError(`unknown mission content ID ${saved.contentId}.`, { path: 'save.data.missions.active.contentId' });
  system.activeMission = mission;
  system.activeVehicle = app.trafficSystem?.controlledVehicle || null;
  system.state = 'IN_PROGRESS';
  system.timeRemaining = Math.max(0, saved.timeRemaining || 0);
  system.initialTimeLimit = Math.max(system.timeRemaining, saved.initialTimeLimit || 0);
  system.basePayout = Math.max(0, saved.basePayout || 0);
  system.payout = Math.max(0, saved.payout || 0);
  const objective = mission.missionType || mission.objectiveType || 'DELIVERY';
  system.routePoints = objective === 'RACE' ? [...mission.checkpoints, mission.dropoff] : (mission.dropoff ? [mission.dropoff] : []);
  system.routeIndex = Math.min(Math.max(0, Math.trunc(saved.routeIndex || 0)), Math.max(0, system.routePoints.length - 1));
  system.raceElapsed = Math.max(0, saved.raceElapsed || 0);
  system.sabotageProgress = Math.max(0, saved.sabotageProgress || 0);
  system.sabotageActive = Boolean(saved.sabotageActive);
  const target = system.routePoints[system.routeIndex];
  if (target) {
    system.setNavigationTarget(target);
    if (objective !== 'SURVIVAL') system.createDestinationBeacon(target);
  }
  const ring = system.pickupRings.find(item => item.mission.id === mission.id);
  if (ring) ring.group.visible = false;
  system.hudEl?.classList?.remove?.('hidden');
}

function restoreAlerts(app, alerts) {
  for (const item of [...alerts.items].reverse().slice(-7)) {
    app.uiManager?.addAlert?.(item.message, item.type);
  }
}

export function restoreRuntimeGameState(app, data) {
  const descriptor = data.player.controlled;
  const entity = resolveEntity(app, descriptor);
  transitionToSavedState(app, data.game, descriptor, entity);
  app.pedestrianSystem.isWanted = data.heat.wanted;
  app.pedestrianSystem.escapeTimer = Math.max(0, data.heat.escapeTimer || 0);
  app.pedestrianSystem.activeCrimeIncidentId = data.heat.activeIncidentId || null;
  restoreActiveMission(app, data.missions.active);
  restoreAlerts(app, data.alerts);
  return true;
}

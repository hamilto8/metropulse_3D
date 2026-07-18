import * as THREE from 'three';
import { CONTROL_KINDS, GAME_STATES } from '../core/GameManager.js';
import { PAUSE_REASONS } from '../core/PauseManager.js';
import { getBuildingSpec } from '../world/BuildingCatalog.js';
import { SaveValidationError } from './SaveSchema.js';
import { SETTINGS_SCHEMA_VERSION, validateSettingsDocument } from '../settings/SettingsSchema.js';
import { CONTENT_TYPES, getProductionContentRegistry } from '../data/GameDataValidator.js';
import { WORLD_BOUNDS } from '../data/ContentDefinitions.js';
import {
  createEmptyMissionOutcomeState,
  validateMissionOutcomeState
} from '../missions/MissionOutcomeService.js';
import { validateMissionLifecycleState } from '../missions/MissionLifecycleController.js';
import { validateAlertState } from '../alerts/AlertService.js';

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

function finiteInRange(value, path, min, max) {
  finite(value, path);
  if (value < min || value > max) {
    throw new SaveValidationError(`must be between ${min} and ${max}.`, { path });
  }
  return value;
}

function stableString(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SaveValidationError('must be a non-empty stable ID string.', { path });
  }
  return value.trim();
}

function knownContent(registry, type, id, path) {
  const stableId = stableString(id, path);
  if (!registry.has(type, stableId)) {
    throw new SaveValidationError(`references unknown ${type} content ID ${stableId}.`, { path });
  }
  return stableId;
}

function uniqueContentIds(values, path, registry, type) {
  if (!Array.isArray(values)) throw new SaveValidationError('must be an array.', { path });
  const ids = new Set();
  values.forEach((value, index) => {
    const id = knownContent(registry, type, value, `${path}[${index}]`);
    if (ids.has(id)) throw new SaveValidationError(`duplicates stable content ID ${id}.`, { path: `${path}[${index}]` });
    ids.add(id);
  });
  return ids;
}

function vector(value, path) {
  if (!Array.isArray(value) || value.length !== 3) throw new SaveValidationError('must be a 3D vector.', { path });
  value.forEach((item, index) => finite(item, `${path}[${index}]`));
  return value;
}

function sameRecord(left, right) {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
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
  const active = candidates.find(([, candidate]) => candidate)
    || (app.missionSystem?.lifecycle?.phase === 'RESULT' && app.missionSystem?.activeVehicle
      ? [CONTROL_KINDS.VEHICLE, app.missionSystem.activeVehicle, app.trafficSystem?.vehicles]
      : null);
  const [kind, entity, collection] = active || [];
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
        // Retained for v1 save readers; detailed lifecycle phase is persisted
        // separately under missions.lifecycle.
        state: 'IN_PROGRESS',
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
    contracts: app.missionOutcomeService?.serialize?.() ?? null,
    lifecycle: system?.lifecycle?.serialize?.() ?? null,
    active
  };
}

function serializeAlerts(app) {
  if (app.alertService?.serialize) return app.alertService.serialize();
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
  const outcomeSnapshot = app.missionOutcomeService?.snapshot?.() ?? null;
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
    factions: serializeOptional(app.factionSystem, outcomeSnapshot?.factions ?? app.factions ?? {}),
    progression: serializeOptional(app.progressionSystem, outcomeSnapshot?.progression ?? app.progression ?? {}),
    heat: {
      version: 1,
      wanted: Boolean(app.pedestrianSystem?.isWanted),
      escapeTimer: Math.max(0, app.pedestrianSystem?.escapeTimer || 0),
      activeIncidentId: app.pedestrianSystem?.activeCrimeIncidentId || null
    },
    settings: { version: 1, values: app.settingsStore?.getSettings?.() || structuredClone(app.settings || {}), heatmap: Boolean(app.trafficHeatmapEnabled) },
    bindings: { version: 1, overrides: app.settingsStore?.getBindingOverrides?.() || {} },
    alerts: serializeAlerts(app)
  };
}

export function validateGameState(data, {
  contentRegistry = getProductionContentRegistry()
} = {}) {
  record(data, 'save.data');
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
    stableString(controlled.contentId, 'save.data.player.controlled.contentId');
    stableString(controlled.typeId, 'save.data.player.controlled.typeId');
    vector(controlled.position, 'save.data.player.controlled.position');
    vector(controlled.rotation, 'save.data.player.controlled.rotation');
    finite(controlled.speed, 'save.data.player.controlled.speed');
    const [x, y, z] = controlled.position;
    if (
      x < WORLD_BOUNDS.minX || x > WORLD_BOUNDS.maxX
      || z < WORLD_BOUNDS.minZ || z > WORLD_BOUNDS.maxZ
      || y < WORLD_BOUNDS.minY || y > WORLD_BOUNDS.maxY
    ) {
      throw new SaveValidationError('is outside the supported world bounds.', { path: 'save.data.player.controlled.position' });
    }
  }
  if ([GAME_STATES.STREET_ON_FOOT, GAME_STATES.STREET_VEHICLE, GAME_STATES.RESULT].includes(game.state === GAME_STATES.PAUSED ? game.resumeState : game.state) && !controlled) {
    throw new SaveValidationError('street and result states require a controlled entity.', { path: 'save.data.player.controlled' });
  }
  version1(data.economy, 'save.data.economy');
  const world = version1(data.world, 'save.data.world');
  if (!Array.isArray(world.buildings) || !Array.isArray(world.zones || [])) throw new SaveValidationError('requires building and zone arrays.', { path: 'save.data.world' });
  const economyIds = new Set();
  for (const [index, building] of world.buildings.entries()) {
    record(building, `save.data.world.buildings[${index}]`);
    knownContent(contentRegistry, CONTENT_TYPES.BUILDING, building.specId, `save.data.world.buildings[${index}].specId`);
    const buildingSpec = contentRegistry.get(CONTENT_TYPES.BUILDING, building.specId);
    if (building.economyId != null) {
      const economyId = stableString(building.economyId, `save.data.world.buildings[${index}].economyId`);
      if (economyIds.has(economyId)) throw new SaveValidationError(`duplicates stable building instance ID ${economyId}.`, { path: `save.data.world.buildings[${index}].economyId` });
      economyIds.add(economyId);
    }
    record(building.plot, `save.data.world.buildings[${index}].plot`);
    finiteInRange(building.plot.x, `save.data.world.buildings[${index}].plot.x`, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    finiteInRange(building.plot.z, `save.data.world.buildings[${index}].plot.z`, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    if (building.plot.width != null) finiteInRange(building.plot.width, `save.data.world.buildings[${index}].plot.width`, 0.001, 200);
    if (building.plot.depth != null) finiteInRange(building.plot.depth, `save.data.world.buildings[${index}].plot.depth`, 0.001, 200);
    finite(building.rotationY, `save.data.world.buildings[${index}].rotationY`);
    const width = building.plot.width ?? buildingSpec.footprint.width;
    const depth = building.plot.depth ?? buildingSpec.footprint.depth;
    const cosine = Math.abs(Math.cos(building.rotationY));
    const sine = Math.abs(Math.sin(building.rotationY));
    const halfX = (width * cosine + depth * sine) * 0.5;
    const halfZ = (width * sine + depth * cosine) * 0.5;
    if (
      building.plot.x - halfX < WORLD_BOUNDS.minX || building.plot.x + halfX > WORLD_BOUNDS.maxX
      || building.plot.z - halfZ < WORLD_BOUNDS.minZ || building.plot.z + halfZ > WORLD_BOUNDS.maxZ
    ) {
      throw new SaveValidationError('places its footprint outside supported world bounds.', {
        path: `save.data.world.buildings[${index}].plot`
      });
    }
  }
  const zoneKeys = new Set();
  for (const [index, zone] of (world.zones || []).entries()) {
    record(zone, `save.data.world.zones[${index}]`);
    const key = stableString(zone.key, `save.data.world.zones[${index}].key`);
    if (zoneKeys.has(key)) throw new SaveValidationError(`duplicates stable zone key ${key}.`, { path: `save.data.world.zones[${index}].key` });
    zoneKeys.add(key);
    knownContent(contentRegistry, CONTENT_TYPES.ZONE, zone.zoneType, `save.data.world.zones[${index}].zoneType`);
    finiteInRange(zone.x, `save.data.world.zones[${index}].x`, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    finiteInRange(zone.z, `save.data.world.zones[${index}].z`, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    finite(zone.happinessModifier, `save.data.world.zones[${index}].happinessModifier`);
    finite(zone.landValueModifier, `save.data.world.zones[${index}].landValueModifier`);
  }
  const timeWeather = version1(data.timeWeather, 'save.data.timeWeather');
  finiteInRange(timeWeather.time, 'save.data.timeWeather.time', 0, 24);
  finiteInRange(timeWeather.speed, 'save.data.timeWeather.speed', 0, 1_000);
  if (typeof timeWeather.playing !== 'boolean') throw new SaveValidationError('must be boolean.', { path: 'save.data.timeWeather.playing' });
  knownContent(contentRegistry, CONTENT_TYPES.WEATHER, timeWeather.weather, 'save.data.timeWeather.weather');
  const missions = version1(data.missions, 'save.data.missions');
  if (!Array.isArray(missions.completedMissionIds) || !Array.isArray(missions.dialogueChoices) || !Array.isArray(missions.runCounts)) throw new SaveValidationError('has invalid mission collections.', { path: 'save.data.missions' });
  uniqueContentIds(missions.completedMissionIds, 'save.data.missions.completedMissionIds', contentRegistry, CONTENT_TYPES.MISSION);
  const runMissionIds = new Set();
  missions.runCounts.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new SaveValidationError('must be a [missionId, count] pair.', { path: `save.data.missions.runCounts[${index}]` });
    const missionId = knownContent(contentRegistry, CONTENT_TYPES.MISSION, entry[0], `save.data.missions.runCounts[${index}][0]`);
    if (runMissionIds.has(missionId)) throw new SaveValidationError(`duplicates mission run count for ${missionId}.`, { path: `save.data.missions.runCounts[${index}][0]` });
    runMissionIds.add(missionId);
    if (!Number.isInteger(entry[1]) || entry[1] < 0) throw new SaveValidationError('must be a non-negative integer.', { path: `save.data.missions.runCounts[${index}][1]` });
  });
  missions.dialogueChoices.forEach((choice, index) => {
    const path = `save.data.missions.dialogueChoices[${index}]`;
    record(choice, path);
    const missionId = knownContent(contentRegistry, CONTENT_TYPES.MISSION, choice.missionId, `${path}.missionId`);
    const nodeId = stableString(choice.nodeId, `${path}.nodeId`);
    const next = stableString(choice.next, `${path}.next`);
    if (!contentRegistry.hasDialogueNode(missionId, nodeId)) throw new SaveValidationError(`references unknown dialogue node ${missionId}:${nodeId}.`, { path: `${path}.nodeId` });
    if (!contentRegistry.hasDialogueNode(missionId, next)) throw new SaveValidationError(`references unknown dialogue node ${missionId}:${next}.`, { path: `${path}.next` });
    if (typeof choice.choice !== 'string' || !choice.choice.trim()) throw new SaveValidationError('must be a non-empty string.', { path: `${path}.choice` });
    const authoredNode = contentRegistry.get(CONTENT_TYPES.MISSION, missionId).dialogueTree[nodeId];
    if (!(authoredNode.choices || []).some(authored => (
      authored.label === choice.choice && authored.next === next
    ))) {
      throw new SaveValidationError('does not match an authored dialogue choice.', { path });
    }
  });
  if (!Number.isInteger(missions.chronologyStep) || missions.chronologyStep < 0) throw new SaveValidationError('must be a non-negative integer.', { path: 'save.data.missions.chronologyStep' });
  if (missions.contracts != null) {
    try {
      validateMissionOutcomeState(missions.contracts, { contentRegistry });
    } catch (error) {
      throw new SaveValidationError(error.message, { path: 'save.data.missions.contracts' });
    }
  }
  if (missions.lifecycle != null) {
    try {
      validateMissionLifecycleState(missions.lifecycle, { contentRegistry });
    } catch (error) {
      throw new SaveValidationError(error.message, { path: 'save.data.missions.lifecycle' });
    }
    if (missions.active && missions.lifecycle.selectedMissionId !== missions.active.contentId) {
      throw new SaveValidationError('must reference the same mission as the active execution snapshot.', {
        path: 'save.data.missions.lifecycle.selectedMissionId'
      });
    }
  }
  if (missions.active != null) {
    record(missions.active, 'save.data.missions.active');
    knownContent(contentRegistry, CONTENT_TYPES.MISSION, missions.active.contentId, 'save.data.missions.active.contentId');
    const mission = contentRegistry.get(CONTENT_TYPES.MISSION, missions.active.contentId);
    if (missions.active.state !== 'IN_PROGRESS') {
      throw new SaveValidationError('must be IN_PROGRESS while an active mission is persisted.', {
        path: 'save.data.missions.active.state'
      });
    }
    for (const name of ['timeRemaining', 'initialTimeLimit', 'basePayout', 'payout', 'routeIndex', 'raceElapsed', 'sabotageProgress']) {
      if (!Number.isFinite(missions.active[name]) || missions.active[name] < 0) {
        throw new SaveValidationError('must be a non-negative finite number.', { path: `save.data.missions.active.${name}` });
      }
    }
    if (typeof missions.active.sabotageActive !== 'boolean') {
      throw new SaveValidationError('must be boolean.', { path: 'save.data.missions.active.sabotageActive' });
    }
    if (!Number.isInteger(missions.active.routeIndex)) {
      throw new SaveValidationError('must be an integer.', { path: 'save.data.missions.active.routeIndex' });
    }
    const routeLength = (mission.missionType === 'RACE' ? mission.checkpoints.length : 0) + 1;
    if (missions.active.routeIndex >= routeLength) {
      throw new SaveValidationError(`exceeds authored route length ${routeLength}.`, {
        path: 'save.data.missions.active.routeIndex'
      });
    }
    if (mission.missionType !== 'RACE' && missions.active.routeIndex !== 0) {
      throw new SaveValidationError('must remain zero for a non-race mission.', {
        path: 'save.data.missions.active.routeIndex'
      });
    }
    if (mission.missionType !== 'SABOTAGE' && (missions.active.sabotageActive || missions.active.sabotageProgress !== 0)) {
      throw new SaveValidationError('contains sabotage state for a non-sabotage mission.', {
        path: 'save.data.missions.active.sabotageProgress'
      });
    }
    if (mission.missionType === 'SABOTAGE' && missions.active.sabotageProgress > mission.sabotageDuration) {
      throw new SaveValidationError(`exceeds authored sabotage duration ${mission.sabotageDuration}.`, {
        path: 'save.data.missions.active.sabotageProgress'
      });
    }
  }
  for (const name of ['factions', 'progression', 'heat', 'settings', 'bindings']) version1(data[name], `save.data.${name}`);
  record(data.factions.values, 'save.data.factions.values');
  for (const [factionId, reputation] of Object.entries(data.factions.values)) {
    knownContent(contentRegistry, CONTENT_TYPES.FACTION, factionId, `save.data.factions.values.${factionId}`);
    const definition = contentRegistry.get(CONTENT_TYPES.FACTION, factionId);
    finiteInRange(
      reputation,
      `save.data.factions.values.${factionId}`,
      definition.minReputation,
      definition.maxReputation
    );
  }
  record(data.progression.values, 'save.data.progression.values');
  for (const [progressionId, unlocked] of Object.entries(data.progression.values)) {
    knownContent(contentRegistry, CONTENT_TYPES.PROGRESSION, progressionId, `save.data.progression.values.${progressionId}`);
    if (typeof unlocked !== 'boolean') throw new SaveValidationError('must be boolean.', { path: `save.data.progression.values.${progressionId}` });
  }
  if (missions.contracts != null) {
    if (!sameRecord(missions.contracts.state.factions, data.factions.values)) {
      throw new SaveValidationError('must match the authoritative mission outcome faction view.', {
        path: 'save.data.factions.values'
      });
    }
    if (!sameRecord(missions.contracts.state.progression, data.progression.values)) {
      throw new SaveValidationError('must match the authoritative mission outcome progression view.', {
        path: 'save.data.progression.values'
      });
    }
  }
  if (typeof data.heat.wanted !== 'boolean' || !Number.isFinite(data.heat.escapeTimer) || data.heat.escapeTimer < 0) {
    throw new SaveValidationError('has invalid wanted state or escape timer.', { path: 'save.data.heat' });
  }
  record(data.settings.values, 'save.data.settings.values');
  record(data.bindings.overrides, 'save.data.bindings.overrides');
  try {
    normalizeSavedSettings(data.settings.values, data.bindings.overrides);
  } catch (error) {
    throw new SaveValidationError(error.message, { path: 'save.data.settings.values' });
  }
  try {
    validateAlertState(data.alerts, { allowLegacy: true });
  } catch (error) {
    throw new SaveValidationError(error.message, { path: 'save.data.alerts' });
  }
  return true;
}

function normalizeSavedSettings(values, bindings = {}) {
  if (values?.cameraSensitivity) {
    return validateSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: values,
      bindings
    }, { allowMigration: false });
  }
  const migrated = validateSettingsDocument({
    version: 1,
    reducedMotion: values?.reducedMotion,
    textScale: values?.textScale
  });
  if (bindings && Object.keys(bindings).length > 0) {
    return validateSettingsDocument({
      version: SETTINGS_SCHEMA_VERSION,
      settings: migrated.settings,
      bindings
    }, { allowMigration: false });
  }
  return migrated;
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
    const inBounds = plot.x >= WORLD_BOUNDS.minX && plot.x <= WORLD_BOUNDS.maxX
      && plot.z >= WORLD_BOUNDS.minZ && plot.z <= WORLD_BOUNDS.maxZ;
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
  if (mission.lifecycle) {
    if (!system.lifecycle?.restoreProgress) {
      throw new SaveValidationError('runtime mission lifecycle owner is unavailable.', {
        path: 'save.data.missions.lifecycle'
      });
    }
    system.lifecycle.restoreProgress(mission.lifecycle.progress);
    system.pendingLifecycleRestore = structuredClone(mission.lifecycle);
    return;
  }
  if (!system.lifecycle?.restoreProgress) {
    system.narrativeState = {
      completedMissionIds: new Set(mission.completedMissionIds),
      dialogueChoices: structuredClone(mission.dialogueChoices),
      chronologyStep: Math.max(0, Math.trunc(mission.chronologyStep || 0))
    };
    system.missionRunCounts = new Map(mission.runCounts);
    return;
  }
  system.lifecycle.restoreProgress({
    completedMissionIds: mission.completedMissionIds,
    dialogueChoices: mission.dialogueChoices,
    chronologyStep: Math.max(0, Math.trunc(mission.chronologyStep || 0)),
    runCounts: mission.runCounts.filter(entry => (
      Array.isArray(entry)
      && typeof entry[0] === 'string'
      && Number.isInteger(entry[1])
      && entry[1] >= 0
    ))
  });
}

export function restoreStaticGameState(app, data) {
  app.economySystem.restore(data.economy);
  app.missionOutcomeService?.restore?.(data.missions.contracts ?? createEmptyMissionOutcomeState({
    factions: data.factions.values,
    progression: data.progression.values
  }));
  const worldReport = restoreWorld(app, data.world);
  app.timeManager?.setTime?.(data.timeWeather.time);
  app.timeManager?.setPlaying?.(data.timeWeather.playing);
  app.timeManager?.setSpeed?.(data.timeWeather.speed);
  app.environment?.setWeather?.(data.timeWeather.weather);
  app.environment?.setDynamicWeather?.(true);
  restoreMissionProgress(app, data.missions);
  app.factionSystem?.restore?.(data.factions);
  app.progressionSystem?.restore?.(data.progression);
  const savedPreferences = normalizeSavedSettings(data.settings.values, data.bindings.overrides);
  app.settingsStore?.replace?.(savedPreferences, { source: 'save-restore' });
  app.settings = app.settingsStore?.getSettings?.() || structuredClone(savedPreferences.settings);
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
  if (system.pendingLifecycleRestore) {
    system.lifecycle.restore(system.pendingLifecycleRestore, { contentRegistry: app.contentRegistry });
    system.pendingLifecycleRestore = null;
  }
  if (!system.lifecycle?.hasActiveRun) {
    // Legacy v1 saves predate the complete lifecycle. Re-enter through the
    // controller so the restored execution has one authoritative owner.
    system.lifecycle.prepare(mission.id);
    system.lifecycle.beginBriefing();
    system.lifecycle.accept({
      baseTimeLimit: Math.max(saved.initialTimeLimit || saved.timeRemaining || mission.timeLimit, 0.001),
      baseReward: Math.max(saved.basePayout || saved.payout || 0, 0)
    });
    system.lifecycle.beginExecution();
  }
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
  if (target && system.state !== 'RESULT') {
    system.setNavigationTarget(target);
    if (objective !== 'SURVIVAL') system.createDestinationBeacon(target);
  }
  const ring = system.pickupRings.find(item => item.mission.id === mission.id);
  if (ring) ring.group.visible = false;
  system.hudEl?.classList?.remove?.('hidden');
  if (system.state === 'RESULT') {
    const resolution = system.lifecycle.snapshot().run.resolution;
    system.presentMissionResult({
      success: resolution?.outcome === 'SUCCESS',
      satisfaction: resolution?.satisfaction ?? null,
      transition: false
    });
  }
}

function restoreAlerts(app, alerts) {
  if (app.alertService?.restore) {
    app.alertService.restore(alerts);
    return;
  }
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

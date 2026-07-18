import * as THREE from 'three';
import { getBuildingSpec } from '../world/BuildingCatalog.js';

export const SAVE_KEY = 'metropulse3d:city-session:v1';

export class PersistenceSystem {
  constructor(app, { storage, debounceMs = 5_000 } = {}) {
    this.app = app;
    if (storage !== undefined) {
      this.storage = storage;
    } else {
      try {
        this.storage = globalThis.localStorage;
      } catch {
        this.storage = null;
      }
    }
    this.debounceMs = debounceMs;
    this.timer = null;
    this.restoring = false;
    this.lastError = null;
    this.lastRestoreReport = null;
    this.status = this.storage ? 'IDLE' : 'UNAVAILABLE';
    this.lastSavedAt = null;

    this.unsubscribeEconomy = app.economySystem?.subscribe?.(() => this.scheduleSave()) || null;
    this.unsubscribeGame = app.gameManager?.subscribe?.(() => this.scheduleSave()) || null;
    this.onPageHide = () => this.saveNow();
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.saveNow();
    };
    window.addEventListener('pagehide', this.onPageHide);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  createSnapshot() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      economy: this.app.economySystem.serialize(),
      world: this.app.cityEditorSystem.serializeWorldEdits(),
      mission: {
        completedMissionIds: [...(this.app.missionSystem?.narrativeState?.completedMissionIds || [])],
        dialogueChoices: structuredClone(this.app.missionSystem?.narrativeState?.dialogueChoices || []),
        chronologyStep: this.app.missionSystem?.narrativeState?.chronologyStep || 0,
        runCounts: [...(this.app.missionSystem?.missionRunCounts || new Map()).entries()]
      },
      settings: {
        time: this.app.timeManager?.timeVal,
        timePlaying: this.app.timeManager?.isPlaying,
        timeSpeed: this.app.timeManager?.speed,
        weather: this.app.environment?.weatherMode,
        mayhem: this.app.features?.isEnabled?.('persistentMayhem')
          ? Boolean(this.app.funMode)
          : false,
        heatmap: Boolean(this.app.trafficHeatmapEnabled)
      }
    };
  }

  scheduleSave() {
    if (this.restoring || !this.storage) return false;
    if (this.timer) return true;
    this.status = 'SCHEDULED';
    this.timer = setTimeout(() => this.saveNow(), this.debounceMs);
    return true;
  }

  saveNow() {
    if (this.restoring || !this.storage) return false;
    clearTimeout(this.timer);
    this.timer = null;
    this.status = 'SAVING';
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.createSnapshot()));
      this.lastError = null;
      this.lastSavedAt = new Date().toISOString();
      this.status = 'SAVED';
      return true;
    } catch (error) {
      this.lastError = error;
      this.status = 'ERROR';
      console.warn('MetroPulse could not save the city session.', error);
      return false;
    }
  }

  restore() {
    if (!this.storage) return false;
    this.status = 'LOADING';
    let parsed;
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      if (!raw) {
        this.status = 'IDLE';
        return false;
      }
      parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1) throw new Error('Unsupported city save version');
    } catch (error) {
      this.lastError = error;
      this.status = 'ERROR';
      console.warn('MetroPulse ignored an invalid saved city session.', error);
      return false;
    }

    this.restoring = true;
    try {
      this.app.economySystem.restore(parsed.economy);
      this.restoreWorld(parsed.world);
      this.restoreMission(parsed.mission);
      this.restoreSettings(parsed.settings);
      this.lastError = null;
      this.status = 'IDLE';
      this.app.uiManager?.addAlert?.('💾 Saved city session restored.', 'success');
      return true;
    } catch (error) {
      this.lastError = error;
      this.status = 'ERROR';
      console.warn('MetroPulse could not restore the saved city session.', error);
      return false;
    } finally {
      this.restoring = false;
    }
  }

  restoreWorld(world = {}) {
    if (world?.version !== 1 || !Array.isArray(world.buildings)) return false;
    const report = { restoredBuildings: 0, skippedBuildings: 0, clearedScenery: 0 };
    for (const saved of world.buildings) {
      const spec = getBuildingSpec(saved.specId);
      const plot = saved.plot;
      const validCoordinates = plot && Number.isFinite(plot.x) && Number.isFinite(plot.z);
      const inBounds = validCoordinates
        && plot.x >= -190 && plot.x <= 810
        && plot.z >= -390 && plot.z <= 390;
      if (!spec || !inBounds) {
        report.skippedBuildings += 1;
        if (saved.economyId) this.app.economySystem?.removeBuilding?.(saved.economyId);
        continue;
      }
      const rotationY = Number.isFinite(saved.rotationY) ? saved.rotationY : 0;
      const quarterTurns = Math.abs(Math.round(rotationY / (Math.PI / 2))) % 2;
      const safePlot = {
        x: plot.x,
        y: this.app.cityBuilder?.getHillHeight?.(plot.x, plot.z) || 0,
        z: plot.z,
        width: quarterTurns === 0 ? spec.footprint.width : spec.footprint.depth,
        depth: quarterTurns === 0 ? spec.footprint.depth : spec.footprint.width
      };
      const editor = this.app.cityEditorSystem;
      const placementRect = editor?.getPlacementRect?.(
        safePlot.x,
        safePlot.z,
        2,
        spec,
        rotationY
      );
      const isValid = editor?.isPlacementValid?.({
        spec,
        rotationY,
        x: safePlot.x,
        z: safePlot.z,
        y: safePlot.y,
        allowCountrysideReplacement: true,
        ignorePlayer: true
      }) ?? true;
      if (!isValid) {
        report.skippedBuildings += 1;
        if (saved.economyId) this.app.economySystem?.removeBuilding?.(saved.economyId);
        continue;
      }

      const building = this.app.buildingFactory.placeUserBuilding(safePlot, spec, rotationY);
      if (placementRect) {
        const removed = this.app.cityBuilder?.removeCountrysideSceneryOverlapping?.(placementRect) || [];
        report.clearedScenery += removed.length;
      }
      building.plot.width = safePlot.width;
      building.plot.depth = safePlot.depth;
      building.economyId = saved.economyId || building.economyId;
      this.app.cityEditorSystem?.reserveUserBuildingId?.(building.economyId);
      if (this.app.physicsWorld && spec.generatorType !== 'ROAD_SEGMENT' && spec.generatorType !== 'PARK_PLAZA') {
        const height = spec.height || 30;
        building.physicsBody = this.app.physicsWorld.addStaticBoxCollider(
          new THREE.Vector3(safePlot.x, safePlot.y + height * 0.5, safePlot.z),
          new THREE.Vector3(Math.max(1, safePlot.width - 2), height, Math.max(1, safePlot.depth - 2))
        );
      }
      if (spec.generatorType === 'ROAD_SEGMENT') {
        this.app.trafficSystem?.registerRoadSegment?.(building, spec);
      }
      report.restoredBuildings += 1;
    }
    this.app.cityEditorSystem.restoreZoneParcels(world.zones || []);
    this.lastRestoreReport = Object.freeze(report);
    return true;
  }

  restoreMission(mission = {}) {
    const system = this.app.missionSystem;
    if (!system) return;
    system.narrativeState.completedMissionIds = new Set(Array.isArray(mission.completedMissionIds) ? mission.completedMissionIds : []);
    system.narrativeState.dialogueChoices = Array.isArray(mission.dialogueChoices) ? structuredClone(mission.dialogueChoices) : [];
    system.narrativeState.chronologyStep = Number.isInteger(mission.chronologyStep) ? Math.max(0, mission.chronologyStep) : 0;
    const runCounts = Array.isArray(mission.runCounts)
      ? mission.runCounts.filter(entry => (
        Array.isArray(entry)
        && typeof entry[0] === 'string'
        && Number.isInteger(entry[1])
        && entry[1] >= 0
      ))
      : [];
    system.missionRunCounts = new Map(runCounts);
  }

  restoreSettings(settings = {}) {
    if (Number.isFinite(settings.time)) this.app.timeManager?.setTime?.(settings.time);
    if (typeof settings.timePlaying === 'boolean') this.app.timeManager?.setPlaying?.(settings.timePlaying);
    if (Number.isFinite(settings.timeSpeed) && settings.timeSpeed > 0) this.app.timeManager?.setSpeed?.(settings.timeSpeed);
    if (typeof settings.weather === 'string') this.app.environment?.setWeather?.(settings.weather);
    // Dynamic weather is a session default, not a persisted preference. Older
    // saves may contain `dynamicWeather: false`; startup intentionally ignores it.
    this.app.environment?.setDynamicWeather?.(true);
    if (
      this.app.features?.isEnabled?.('persistentMayhem')
      && typeof settings.mayhem === 'boolean'
    ) {
      this.app.funMode = settings.mayhem;
      this.app.gameManager?.setMayhem?.(settings.mayhem, 'persistence');
      this.app.uiManager?.renderMayhemState?.(settings.mayhem);
    }
    if (typeof settings.heatmap === 'boolean') {
      this.app.trafficHeatmapEnabled = settings.heatmap;
      this.app.trafficHeatmapSystem?.setVisible?.(settings.heatmap);
      if (this.app.uiManager?.heatmapToggle) this.app.uiManager.heatmapToggle.checked = settings.heatmap;
    }
  }

  clear() {
    try {
      this.storage?.removeItem?.(SAVE_KEY);
      this.status = 'IDLE';
      this.lastSavedAt = null;
      return true;
    } catch (error) {
      this.lastError = error;
      this.status = 'ERROR';
      return false;
    }
  }

  getStatus() {
    return Object.freeze({
      status: this.status,
      available: Boolean(this.storage),
      pending: Boolean(this.timer),
      restoring: this.restoring,
      lastSavedAt: this.lastSavedAt,
      error: this.lastError?.message || null
    });
  }

  destroy() {
    clearTimeout(this.timer);
    this.unsubscribeEconomy?.();
    this.unsubscribeGame?.();
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}

export default PersistenceSystem;

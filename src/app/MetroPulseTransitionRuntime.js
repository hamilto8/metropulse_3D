import * as THREE from 'three';

import {
  CAMERA_POLICIES,
  CLOCK_POLICIES,
  CONTROL_KINDS,
  GAME_STATES
} from '../core/GameManager.js';
import { CameraClearanceQuery } from '../camera/CameraClearanceQuery.js';

function clonePose(entity) {
  const mesh = entity?.mesh;
  if (!mesh?.position || !mesh?.quaternion) return null;
  return {
    entity,
    position: mesh.position.clone(),
    quaternion: mesh.quaternion.clone(),
    visible: mesh.visible
  };
}

function restorePose(pose) {
  if (!pose?.entity?.mesh) return;
  pose.entity.mesh.position.copy(pose.position);
  pose.entity.mesh.quaternion.copy(pose.quaternion);
  pose.entity.mesh.visible = pose.visible;
  const chassis = pose.entity.physicsVehicle?.chassisBody;
  if (chassis) {
    chassis.position.set(pose.position.x, pose.position.y, pose.position.z);
    chassis.quaternion.set(
      pose.quaternion.x,
      pose.quaternion.y,
      pose.quaternion.z,
      pose.quaternion.w
    );
  }
}

function buildingObstacle(building) {
  const plot = building?.plot;
  const position = building?.group?.position || building?.mesh?.position;
  const x = Number(plot?.x ?? position?.x);
  const z = Number(plot?.z ?? position?.z);
  const width = Number(plot?.width ?? building?.spec?.width ?? 0);
  const depth = Number(plot?.depth ?? building?.spec?.depth ?? 0);
  const height = Number(building?.height ?? building?.spec?.height ?? 0);
  if (![x, z, width, depth, height].every(Number.isFinite) || width <= 0 || depth <= 0 || height <= 0) {
    return null;
  }
  return {
    entity: building,
    position: { x, y: height * 0.5, z },
    size: { x: width, y: height, z: depth },
    kind: 'building'
  };
}

function entityObstacle(entity, size, kind) {
  const position = entity?.mesh?.position;
  if (!position) return null;
  return { entity, position, size, kind };
}

export class MetroPulseTransitionRuntime {
  constructor(app) {
    if (!app) throw new TypeError('app is required');
    this.app = app;
    this.cameraClearance = new CameraClearanceQuery({
      getTerrainHeight: (x, z) => app.cityBuilder?.getTerrainHeight?.(x, z) ?? 0,
      isWater: position => Boolean(
        position.y <= 1.5
        && app.cityBuilder?.isInWater?.({ x: position.x, y: position.y, z: position.z })
      ),
      getObstacles: () => this.getCameraObstacles()
    });
    app.sceneManager?.setCameraClearanceQuery?.(this.cameraClearance);
  }

  getCameraObstacles() {
    const obstacles = [...(this.app.cityBuilder?.sceneryColliders || [])];
    for (const building of this.app.buildingFactory?.buildings || []) {
      const obstacle = buildingObstacle(building);
      if (obstacle) obstacles.push(obstacle);
    }
    for (const vehicle of this.app.trafficSystem?.vehicles || []) {
      const obstacle = entityObstacle(vehicle, { x: 4.4, y: 3.2, z: 8.5 }, 'vehicle');
      if (obstacle) obstacles.push(obstacle);
    }
    for (const pedestrian of this.app.pedestrianSystem?.pedestrians || []) {
      const obstacle = entityObstacle(pedestrian, { x: 1, y: 2.4, z: 1 }, 'pedestrian');
      if (obstacle) obstacles.push(obstacle);
    }
    if (this.app.aircraftSystem?.aircraft) {
      const obstacle = entityObstacle(
        this.app.aircraftSystem.aircraft,
        { x: 13, y: 5, z: 16 },
        'aircraft'
      );
      if (obstacle) obstacles.push(obstacle);
    }
    return obstacles;
  }

  suspendInput({ transition }) {
    const token = this.app.inputManager?.suspendInput?.(transition.id);
    return {
      cleanup: () => {
        if (token) this.app.inputManager?.resumeInput?.(token);
      }
    };
  }

  clearHeldActions() {
    this.app.inputManager?.clearTransientInputState?.();
  }

  captureSourceState() {
    const scene = this.app.sceneManager;
    const vehicle = this.app.trafficSystem?.controlledVehicle || null;
    const pedestrian = this.app.pedestrianSystem?.controlledPedestrian || null;
    const aircraft = this.app.aircraftSystem?.controlledAircraft || null;
    return {
      state: {
        control: { vehicle, pedestrian, aircraft },
        controlSessions: {
          vehicle: this.app.trafficSystem?.controlSession || null,
          aircraft: this.app.aircraftSystem?.controlSession || null
        },
        poses: [vehicle, pedestrian, aircraft].filter(Boolean).map(clonePose),
        camera: scene ? {
          position: scene.camera.position.clone(),
          target: scene.controls.target.clone(),
          followTarget: scene.followTarget,
          activePreset: scene.activePreset
        } : null,
        clockPolicy: this.app.simulationClockPolicy || null,
        editorVisible: Boolean(this.app.uiManager?.cityEditorUI?.isVisible)
      }
    };
  }

  handoffEntityOwnership({ transition, options }) {
    const request = options.control || {};
    if (request.action === 'EXIT_VEHICLE') {
      return this.app.trafficSystem?.exitControlledVehicle?.({ coordinated: true }) || {
        ok: false,
        reason: 'Vehicle exit could not create a controlled pedestrian.'
      };
    }
    if (request.action === 'EXIT_AIRCRAFT') {
      return this.app.aircraftSystem?.releaseControl?.({
        force: Boolean(request.force),
        coordinated: true
      }) || { ok: false, reason: 'Aircraft exit could not complete.' };
    }

    if (transition.to === GAME_STATES.STREET_VEHICLE) {
      if (request.kind === CONTROL_KINDS.AIRCRAFT || request.kind === 'AIRCRAFT') {
        return this.app.aircraftSystem?.takeControl?.(request.entity, {
          source: request.source,
          pedestrian: request.pedestrian,
          coordinated: true
        }) || { ok: false, reason: 'Aircraft control could not be acquired.' };
      }
      if (request.entity) {
        return this.app.trafficSystem?.toggleUserControl?.(request.entity, {
          source: request.source,
          pedestrian: request.pedestrian,
          coordinated: true
        }) || { ok: false, reason: 'Vehicle control could not be acquired.' };
      }
      return true;
    }

    if (transition.to === GAME_STATES.STREET_ON_FOOT) {
      if (request.entity) {
        return this.app.pedestrianSystem?.toggleUserControl?.(request.entity, {
          coordinated: true
        }) || { ok: false, reason: 'Pedestrian control could not be acquired.' };
      }
      return true;
    }

    if ([
      GAME_STATES.BOOT,
      GAME_STATES.LOAD,
      GAME_STATES.MANAGEMENT,
      GAME_STATES.BUILDER,
      GAME_STATES.RESULT
    ].includes(transition.to)) {
      return this.releaseAllControl();
    }
    return true;
  }

  releaseAllControl() {
    const aircraft = this.app.aircraftSystem?.controlledAircraft;
    if (aircraft && !this.app.aircraftSystem.releaseControl({ force: false, coordinated: true })) {
      return { ok: false, reason: 'Aircraft must land before leaving direct control.' };
    }
    const vehicle = this.app.trafficSystem?.controlledVehicle;
    if (vehicle && !this.app.trafficSystem.releaseControl(vehicle, { coordinated: true })) {
      return { ok: false, reason: 'Vehicle control could not be released.' };
    }
    const pedestrian = this.app.pedestrianSystem?.controlledPedestrian;
    if (pedestrian && !this.app.pedestrianSystem.releaseControl(pedestrian, { coordinated: true })) {
      return { ok: false, reason: 'Pedestrian control could not be released.' };
    }
    return true;
  }

  positionCamera({ transition }) {
    const scene = this.app.sceneManager;
    if (!scene) return true;
    const policy = transition.effects?.camera?.to;
    if (policy === CAMERA_POLICIES.STREET_ON_FOOT || policy === CAMERA_POLICIES.STREET_VEHICLE) {
      const target = this.getControlledEntity();
      if (!target?.mesh) return { ok: false, reason: 'Street camera requires a controlled entity.' };
      const targetPosition = target.mesh.position;
      const desired = targetPosition.clone().add(new THREE.Vector3(0, 5, 10));
      const safe = this.cameraClearance.resolve(desired, {
        ignore: [target],
        preferredDirection: desired.clone().sub(targetPosition).setY(0).normalize(),
        maxSearchRadius: 24
      });
      scene.applyImmediateCameraPose(safe, targetPosition.clone().add(new THREE.Vector3(0, 1.4, 0)), {
        ignore: [target]
      });
      scene.startFollowTarget(target);
      return true;
    }

    scene.stopFollowTarget?.();
    if (policy === CAMERA_POLICIES.BUILDER) {
      scene.preparePresetOrbit?.();
      const preset = scene.presets?.birdseye;
      if (!preset) return { ok: false, reason: 'Builder camera preset is unavailable.' };
      scene.activePreset = 'birdseye';
      scene.targetCameraPos = null;
      scene.targetLookAt = null;
      return scene.applyImmediateCameraPose(preset.pos, preset.target, { maxSearchRadius: 40 });
    }
    const safe = this.cameraClearance.resolve(scene.camera.position, { maxSearchRadius: 30 });
    scene.applyImmediateCameraPose(safe, scene.controls.target);
    return true;
  }

  configureSimulation({ transition }) {
    this.app.simulationClockPolicy = transition.effects?.simulationClock?.to || CLOCK_POLICIES.STOPPED;
    return true;
  }

  configurePresentation({ transition }) {
    const editor = this.app.uiManager?.cityEditorUI;
    if (transition.to === GAME_STATES.BUILDER) editor?.show?.({ preserveMode: true });
    else if (editor?.isVisible) editor.hide({ preserveMode: true });
    this.app.uiManager?.hideInspector?.();
    this.app.uiManager?.updateActionHUD?.();
    this.app.inputManager?.syncControlContext?.();
    return true;
  }

  validateDestination({ transition }) {
    const context = this.app.getGameStateContext?.();
    if (context?.controlledEntityCount > 1) {
      return { ok: false, code: 'MULTIPLE_CONTROLLED_ENTITIES', reason: 'Multiple systems own player control.' };
    }
    if (transition.to === GAME_STATES.STREET_ON_FOOT) {
      return context?.controlledEntityKind === CONTROL_KINDS.PEDESTRIAN
        ? true
        : { ok: false, reason: 'On-foot transition did not produce one controlled pedestrian.' };
    }
    if (transition.to === GAME_STATES.STREET_VEHICLE) {
      return [CONTROL_KINDS.VEHICLE, CONTROL_KINDS.AIRCRAFT].includes(context?.controlledEntityKind)
        ? true
        : { ok: false, reason: 'Vehicle transition did not produce one controlled vehicle.' };
    }
    return true;
  }

  restoreSourceState({ sourceState }) {
    if (!sourceState) return;
    this.releaseAllControl();
    for (const pose of sourceState.poses || []) restorePose(pose);

    const { vehicle, pedestrian, aircraft } = sourceState.control || {};
    if (vehicle) {
      const session = sourceState.controlSessions?.vehicle || {};
      this.app.trafficSystem?.toggleUserControl?.(vehicle, {
        source: session.source,
        pedestrian: session.pedestrian,
        coordinated: true
      });
    } else if (pedestrian) {
      this.app.pedestrianSystem?.toggleUserControl?.(pedestrian, { coordinated: true });
    } else if (aircraft) {
      const session = sourceState.controlSessions?.aircraft || {};
      this.app.aircraftSystem?.takeControl?.(aircraft, {
        source: session.source,
        pedestrian: session.pedestrian,
        coordinated: true
      });
    }

    const camera = sourceState.camera;
    if (camera && this.app.sceneManager) {
      this.app.sceneManager.applyImmediateCameraPose(camera.position, camera.target, {
        ignore: [vehicle, pedestrian, aircraft].filter(Boolean)
      });
      this.app.sceneManager.activePreset = camera.activePreset;
      if (camera.followTarget) this.app.sceneManager.startFollowTarget(camera.followTarget);
    }
    this.app.simulationClockPolicy = sourceState.clockPolicy;
    if (sourceState.editorVisible) this.app.uiManager?.cityEditorUI?.show?.({ preserveMode: true });
    else this.app.uiManager?.cityEditorUI?.hide?.({ preserveMode: true });
  }

  getControlledEntity() {
    return this.app.aircraftSystem?.controlledAircraft
      || this.app.trafficSystem?.controlledVehicle
      || this.app.pedestrianSystem?.controlledPedestrian
      || null;
  }
}

export default MetroPulseTransitionRuntime;

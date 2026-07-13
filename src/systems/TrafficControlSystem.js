import * as THREE from 'three';
import {
  createTrafficControlPlan,
  getSignalState,
  getTrafficStoppingKinematics,
  parseTrafficApproach,
  SIGNAL_STATES,
  TRAFFIC_RULES
} from './TrafficRules.js';

const APPROACHES = Object.freeze([
  { direction: 'EB', axis: 'EW', dx: -8.6, dz: 8.6, rotationY: -Math.PI / 2 },
  { direction: 'WB', axis: 'EW', dx: 8.6, dz: -8.6, rotationY: Math.PI / 2 },
  { direction: 'SB', axis: 'NS', dx: -8.6, dz: -8.6, rotationY: Math.PI },
  { direction: 'NB', axis: 'NS', dx: 8.6, dz: 8.6, rotationY: 0 }
]);

function createStopTexture() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, 256, 256);
  context.fillStyle = '#ffffff';
  context.font = '900 72px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('STOP', 128, 132);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function setLensState(head, state) {
  for (const [lensState, lens] of Object.entries(head.lenses)) {
    const active = lensState === state;
    const signalColor = lens.userData.signalColor;
    lens.material.color.setHex(active ? signalColor : 0x171b24);
    lens.material.emissive.setHex(active ? signalColor : 0x000000);
    lens.material.emissiveIntensity = active ? 3.2 : 0;
    lens.material.opacity = 1;
  }
  head.state = state;
}

export class TrafficControlSystem {
  constructor(app, coordsX, coordsZ, { buildVisuals = true } = {}) {
    this.app = app;
    this.elapsed = 0;
    this.controls = createTrafficControlPlan(coordsX, coordsZ).map(control => ({ ...control, heads: [] }));
    this.controlByLocation = new Map(this.controls.map(control => [`${control.x},${control.z}`, control]));
    this.posts = [];
    this.stopQueues = new Map();
    this.group = null;
    if (buildVisuals) this.buildVisuals();
  }

  getTerrainHeight(x, z) {
    const value = this.app?.cityBuilder?.getHillHeight?.(x, z);
    return Number.isFinite(value) ? value : 0;
  }

  registerPost(control, x, z, height = 5.2, footprint = 0.7) {
    const y = this.getTerrainHeight(x, z);
    const safeFootprint = Number.isFinite(footprint) ? Math.max(0.7, footprint) : 0.7;
    const post = { controlId: control.id, x, z, radius: safeFootprint * 0.5 };
    this.posts.push(post);
    this.app?.physicsWorld?.addStaticBoxCollider?.(
      new THREE.Vector3(x, y + height * 0.5, z),
      new THREE.Vector3(safeFootprint, height, safeFootprint)
    );
    return y;
  }

  createSignal(control, approach, materials) {
    const group = new THREE.Group();
    const x = control.x + approach.dx;
    const z = control.z + approach.dz;
    // The solid footprint covers the mast arm and signal housing as well as
    // the pole, preventing glancing vehicles or pedestrians clipping through.
    const groundY = this.registerPost(control, x, z, 5.4, 3.4);
    group.position.set(x, groundY, z);
    group.rotation.y = approach.rotationY;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 5.4, 8), materials.pole);
    pole.position.y = 2.7;
    pole.castShadow = true;
    group.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.18), materials.pole);
    arm.position.set(0.58, 4.85, 0);
    group.add(arm);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.25, 0.62), materials.housing);
    housing.position.set(1.18, 4.15, 0);
    housing.castShadow = true;
    group.add(housing);

    const lenses = {};
    const lensSpecs = [
      [SIGNAL_STATES.RED, 0xff304f, 4.8],
      [SIGNAL_STATES.YELLOW, 0xffc928, 4.15],
      [SIGNAL_STATES.GREEN, 0x29f28d, 3.5]
    ];
    for (const [state, color, y] of lensSpecs) {
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.08,
        roughness: 0.3,
        transparent: true,
        opacity: 0.45
      });
      material.toneMapped = false;
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 12), material);
      lens.position.set(1.18, y, 0.32);
      lens.userData.signalColor = color;
      group.add(lens);
      lenses[state] = lens;
    }
    const head = { axis: approach.axis, lenses, state: null };
    control.heads.push(head);
    setLensState(head, getSignalState(this.elapsed, approach.axis, control.phaseOffset));
    return group;
  }

  createStopSign(control, approach, materials, stopTexture) {
    const group = new THREE.Group();
    const x = control.x + approach.dx;
    const z = control.z + approach.dz;
    const groundY = this.registerPost(control, x, z, 4.8, 2.2);
    group.position.set(x, groundY, z);
    group.rotation.y = approach.rotationY;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 3.6, 8), materials.pole);
    pole.position.y = 1.8;
    pole.castShadow = true;
    group.add(pole);
    const border = new THREE.Mesh(new THREE.CircleGeometry(1.05, 8), materials.stopBorder);
    border.position.set(0, 3.75, 0.03);
    group.add(border);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.91, 8), materials.stopFace);
    face.position.set(0, 3.75, 0.055);
    group.add(face);
    if (stopTexture) {
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(1.65, 0.72),
        new THREE.MeshBasicMaterial({ map: stopTexture, transparent: true, depthWrite: false })
      );
      label.position.set(0, 3.75, 0.075);
      group.add(label);
    }
    return group;
  }

  buildVisuals() {
    const scene = this.app?.sceneManager?.scene;
    if (!scene) return false;
    this.group = new THREE.Group();
    this.group.name = 'traffic-controls';
    const materials = {
      pole: new THREE.MeshStandardMaterial({ color: 0x263044, metalness: 0.72, roughness: 0.38 }),
      housing: new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.4, roughness: 0.48 }),
      stopBorder: new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.5 }),
      stopFace: new THREE.MeshStandardMaterial({ color: 0xd52545, roughness: 0.42, metalness: 0.12 })
    };
    const stopTexture = createStopTexture();
    for (const control of this.controls) {
      for (const approach of APPROACHES) {
        const visual = control.type === 'SIGNAL'
          ? this.createSignal(control, approach, materials)
          : this.createStopSign(control, approach, materials, stopTexture);
        visual.name = `${control.type.toLowerCase()}-${approach.direction}-${control.x},${control.z}`;
        this.group.add(visual);
      }
    }
    scene.add(this.group);
    return true;
  }

  update(delta) {
    const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
    this.elapsed += safeDelta;
    for (const [controlId, queue] of this.stopQueues) {
      const active = queue.filter(vehicle => (
        vehicle?.stopSignState?.controlId === controlId
        && this.elapsed - (vehicle.stopSignState.lastSeen || 0) < 1
      ));
      if (active.length > 0) this.stopQueues.set(controlId, active);
      else this.stopQueues.delete(controlId);
    }
    for (const control of this.controls) {
      if (control.type !== 'SIGNAL') continue;
      for (const head of control.heads) {
        const state = getSignalState(this.elapsed, head.axis, control.phaseOffset);
        if (state !== head.state) setLensState(head, state);
      }
    }
  }

  getControlForTarget(targetNode) {
    const approach = parseTrafficApproach(targetNode);
    if (!approach) return null;
    const control = this.controlByLocation.get(`${approach.x},${approach.z}`);
    return control ? { control, approach } : null;
  }

  getSignalState(control, axis) {
    return getSignalState(this.elapsed, axis, control?.phaseOffset || 0);
  }

  evaluateVehicle(vehicle, delta) {
    const target = this.getControlForTarget(vehicle?.targetNode);
    if (!target || !vehicle?.mesh?.position) {
      this.removeFromStopQueue(vehicle);
      vehicle && (vehicle.stopSignState = null);
      vehicle && (vehicle.signalCommitId = null);
      vehicle && (vehicle.trafficControlBlocked = false);
      return { shouldStop: false, reason: null };
    }
    const { control, approach } = target;
    const distance = Math.hypot(
      vehicle.mesh.position.x - vehicle.targetNode.pos.x,
      vehicle.mesh.position.z - vehicle.targetNode.pos.z
    );
    const kinematics = getTrafficStoppingKinematics(vehicle);
    if (distance > kinematics.detectionDistance) {
      vehicle.trafficControlBlocked = false;
      return { shouldStop: false, reason: null };
    }
    if (vehicle.trafficRuleCompliant === false || vehicle.emergencyTarget || vehicle.hitAndRunState) {
      this.removeFromStopQueue(vehicle);
      vehicle.trafficControlBlocked = false;
      return { shouldStop: false, reason: 'VIOLATION' };
    }

    if (control.type === 'STOP') {
      let state = vehicle.stopSignState;
      if (!state || state.controlId !== control.id) {
        this.removeFromStopQueue(vehicle);
        state = vehicle.stopSignState = {
          controlId: control.id,
          waited: 0,
          released: false,
          lastSeen: this.elapsed
        };
        const queue = this.stopQueues.get(control.id) || [];
        queue.push(vehicle);
        this.stopQueues.set(control.id, queue);
      }
      state.lastSeen = this.elapsed;
      if (state.released) {
        vehicle.trafficControlBlocked = false;
        return { shouldStop: false, reason: 'STOP_COMPLETE' };
      }
      const queue = this.stopQueues.get(control.id) || [];
      const hasPriority = queue[0] === vehicle;
      if (hasPriority && kinematics.speed <= 0.35) {
        state.waited += Math.max(0, Number(delta) || 0);
      }
      if (state.waited >= TRAFFIC_RULES.stopSignWaitDuration) {
        state.released = true;
        queue.shift();
        if (queue.length === 0) this.stopQueues.delete(control.id);
        vehicle.trafficControlBlocked = false;
        return { shouldStop: false, reason: 'STOP_COMPLETE' };
      }
      vehicle.trafficControlBlocked = true;
      return { shouldStop: true, reason: 'STOP_SIGN' };
    }

    vehicle.stopSignState = null;
    const state = this.getSignalState(control, approach.axis);
    if (state === SIGNAL_STATES.GREEN) {
      vehicle.signalCommitId = null;
      vehicle.trafficControlBlocked = false;
      return { shouldStop: false, reason: 'GREEN' };
    }
    if (vehicle.signalCommitId === control.id) {
      vehicle.trafficControlBlocked = false;
      return { shouldStop: false, reason: 'CLEARING_INTERSECTION' };
    }
    if (state === SIGNAL_STATES.YELLOW && distance <= kinematics.stoppingDistance + 1.5) {
      vehicle.signalCommitId = control.id;
      vehicle.trafficControlBlocked = false;
      return { shouldStop: false, reason: 'YELLOW_COMMIT' };
    }
    vehicle.trafficControlBlocked = true;
    return { shouldStop: true, reason: state };
  }

  removeFromStopQueue(vehicle) {
    const controlId = vehicle?.stopSignState?.controlId;
    if (!controlId) return false;
    const queue = this.stopQueues.get(controlId);
    if (!queue) return false;
    const next = queue.filter(candidate => candidate !== vehicle);
    if (next.length > 0) this.stopQueues.set(controlId, next);
    else this.stopQueues.delete(controlId);
    return next.length !== queue.length;
  }

  intersectsPost(position, radius = 1.6) {
    if (!position) return false;
    const safeRadius = Number.isFinite(radius) ? Math.max(0, radius) : 1.6;
    return this.posts.some(post => Math.hypot(position.x - post.x, position.z - post.z) < safeRadius + post.radius);
  }
}

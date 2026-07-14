import * as THREE from 'three';
import {
  AIRCRAFT_MODES,
  createAircraftFlightState,
  DEFAULT_AIRCRAFT_CONFIG,
  stepAircraftFlight
} from './AircraftFlightModel.js';

function addMesh(group, geometry, material, position = {}) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(position.x || 0, position.y || 0, position.z || 0);
  result.castShadow = true;
  result.receiveShadow = true;
  group.add(result);
  return result;
}

function createAircraftModel() {
  const root = new THREE.Group();
  root.name = 'NorthwindSparrowAircraft';
  root.rotation.order = 'YXZ';

  const paint = new THREE.MeshStandardMaterial({ color: 0xb9d4e8, metalness: 0.22, roughness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xf24e3d, metalness: 0.3, roughness: 0.38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b26, metalness: 0.62, roughness: 0.28 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x39bfe5,
    emissive: 0x052f47,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.78,
    metalness: 0.2,
    roughness: 0.12
  });

  const fuselage = addMesh(root, new THREE.CylinderGeometry(0.72, 0.52, 7.2, 16), paint);
  fuselage.rotation.x = Math.PI / 2;
  addMesh(root, new THREE.ConeGeometry(0.73, 1.6, 16), accent, { z: 4.35 }).rotation.x = Math.PI / 2;
  addMesh(root, new THREE.BoxGeometry(9.6, 0.18, 1.35), paint, { y: 0.05, z: 0.35 });
  addMesh(root, new THREE.BoxGeometry(3.7, 0.14, 0.82), accent, { y: 0.38, z: -2.85 });

  const finGeometry = new THREE.BufferGeometry();
  finGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.08, 0, -3.2,
     0.08, 0, -3.2,
     0.08, 2.0, -2.45,
    -0.08, 0, -3.2,
     0.08, 2.0, -2.45,
    -0.08, 2.0, -2.45
  ], 3));
  finGeometry.computeVertexNormals();
  addMesh(root, finGeometry, accent);

  const cockpit = addMesh(root, new THREE.SphereGeometry(0.78, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), glass, {
    y: 0.43, z: 0.45
  });
  cockpit.scale.set(0.82, 0.72, 1.45);
  cockpit.rotation.x = Math.PI;

  const propeller = new THREE.Group();
  propeller.name = 'Propeller';
  propeller.position.z = 5.14;
  addMesh(propeller, new THREE.CylinderGeometry(0.2, 0.28, 0.42, 12), dark).rotation.x = Math.PI / 2;
  addMesh(propeller, new THREE.BoxGeometry(0.18, 4.4, 0.12), dark);
  addMesh(propeller, new THREE.BoxGeometry(4.4, 0.18, 0.12), dark);
  root.add(propeller);

  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x080b11, roughness: 0.82 });
  const strutMaterial = new THREE.MeshStandardMaterial({ color: 0x8da0b7, metalness: 0.82, roughness: 0.22 });
  for (const x of [-1.45, 1.45]) {
    const strut = addMesh(root, new THREE.CylinderGeometry(0.055, 0.055, 1.0, 8), strutMaterial, {
      x, y: -0.62, z: 0.45
    });
    strut.rotation.z = x < 0 ? -0.28 : 0.28;
    const wheel = addMesh(root, new THREE.TorusGeometry(0.34, 0.12, 8, 14), wheelMaterial, {
      x: x * 1.08, y: -1.05, z: 0.45
    });
    wheel.rotation.y = Math.PI / 2;
  }
  const tailWheel = addMesh(root, new THREE.TorusGeometry(0.18, 0.07, 8, 12), wheelMaterial, {
    y: -0.52, z: -3.0
  });
  tailWheel.rotation.y = Math.PI / 2;

  const navigationLights = [
    { x: -4.82, color: 0xff334d },
    { x: 4.82, color: 0x35ff8d }
  ];
  for (const lightData of navigationLights) {
    const light = addMesh(
      root,
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: lightData.color }),
      { x: lightData.x, y: 0.08, z: 0.35 }
    );
    light.userData.navigationLight = true;
  }

  // A forgiving transparent interaction volume keeps the small aircraft easy
  // to select from an elevated management camera without changing its visual
  // silhouette or flight collision envelope.
  const interactionTarget = addMesh(
    root,
    new THREE.BoxGeometry(11, 3.4, 9.5),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  interactionTarget.name = 'AircraftInteractionTarget';
  interactionTarget.castShadow = false;
  interactionTarget.receiveShadow = false;

  root.userData.propeller = propeller;
  return root;
}

export class PropellerAircraft {
  constructor({ position, heading = 0, config = DEFAULT_AIRCRAFT_CONFIG } = {}) {
    this.type = 'AIRCRAFT';
    this.name = 'Northwind Sparrow';
    this.config = config;
    this.mesh = createAircraftModel();
    this.userControlled = false;
    this.state = createAircraftFlightState({ position, heading, grounded: true });
    this.spawnState = createAircraftFlightState(this.state);
    this.speed = 0;
    this.speedKmh = 0;
    this.altitude = 0;
    this.info = {
      'Status': 'Ready at runway 36',
      'Aircraft': 'Single-engine propeller trainer',
      'Flight Mode': 'PARKED',
      'Airspeed': '0 km/h',
      'Altitude': '0 m AGL',
      'Throttle': '0%'
    };
    this.syncRenderState();
  }

  get isAirborne() {
    return !this.state.grounded && !this.state.crashed;
  }

  get isCrashed() {
    return this.state.crashed;
  }

  setControlled(controlled) {
    this.userControlled = Boolean(controlled);
    this.updateInfo();
  }

  update(rawControls, delta, environment = {}) {
    this.state = stepAircraftFlight(this.state, rawControls, delta, environment, this.config);
    this.syncRenderState(delta);
    return this.state;
  }

  syncRenderState(delta = 0) {
    const { position, heading, pitch, roll, speed, throttle } = this.state;
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.set(-pitch, heading, -roll, 'YXZ');
    const propeller = this.mesh.userData.propeller;
    if (propeller) {
      const engineRunning = this.userControlled || throttle > 0.02 || speed > 1;
      const propellerRate = engineRunning ? 6 + throttle * 34 + speed * 0.18 : 0;
      propeller.rotation.z = (propeller.rotation.z + propellerRate * Math.max(0, delta)) % (Math.PI * 2);
    }
    this.speed = speed;
    this.speedKmh = speed * 3.6;
    this.altitude = Math.max(0, position.y - this.config.gearHeight);
    this.updateInfo();
  }

  updateInfo() {
    const modeLabel = this.state.stallWarning ? 'STALL WARNING' : this.state.mode;
    this.info['Status'] = this.userControlled
      ? '🎮 PILOT CONTROLLED'
      : (this.state.crashed ? 'Emergency recovery required' : 'Ready for pilot');
    this.info['Flight Mode'] = modeLabel;
    this.info['Airspeed'] = `${Math.round(this.speedKmh)} km/h`;
    this.info['Altitude'] = `${Math.round(this.altitude)} m AGL`;
    this.info['Throttle'] = `${Math.round(this.state.throttle * 100)}%`;
  }

  resetToSpawn() {
    this.state = createAircraftFlightState(this.spawnState);
    this.state.mode = AIRCRAFT_MODES.PARKED;
    this.state.grounded = true;
    this.state.crashed = false;
    this.state.stallWarning = false;
    this.syncRenderState();
    return this.state;
  }
}

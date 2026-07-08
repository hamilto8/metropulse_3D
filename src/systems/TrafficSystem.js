import * as THREE from 'three';
import { Vehicle } from '../entities/Vehicle.js';

class TrafficNode {
  constructor(id, x, z) {
    this.id = id;
    this.pos = new THREE.Vector3(x, 0, z);
    this.nextNodes = [];
  }
}

export class TrafficSystem {
  constructor(app) {
    this.app = app;
    this.vehicles = [];
    this.nodes = new Map();
    this.roadCoordsX = [-100, -50, 0, 50, 100, 210, 260, 310];
    this.roadCoordsZ = [-100, -50, 0, 50, 100];
    this.laneOffset = 3.5; // Right-hand traffic lane center

    this.initWaypoints();
    this.spawnVehicles(48);
    this.initKeyboardControls();
  }

  initKeyboardControls() {
    this.keys = {};
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      this.keys[e.key.toLowerCase()] = true;

      // Check Honk with Shift key when controlling a vehicle!
      if (e.key === 'Shift' && this.controlledVehicle && !e.repeat) {
        if (this.app.audioSystem) {
          if (this.controlledVehicle.isPolice) {
            this.app.audioSystem.playSiren(1.5);
          } else {
            this.app.audioSystem.playHonk();
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }

  toggleUserControl(vehicle) {
    if (!vehicle) return false;
    if (vehicle.userControlled && this.controlledVehicle === vehicle) {
      this.releaseControl(vehicle);
      return false;
    } else {
      if (this.controlledVehicle && this.controlledVehicle !== vehicle) {
        this.releaseControl(this.controlledVehicle);
      }
      vehicle.userControlled = true;
      this.controlledVehicle = vehicle;
      vehicle.info['Status'] = '🎮 USER CONTROLLED';
      return true;
    }
  }

  releaseControl(vehicle) {
    if (!vehicle) return;
    vehicle.userControlled = false;
    if (this.controlledVehicle === vehicle) {
      this.controlledVehicle = null;
    }
    vehicle.info['Status'] = 'Cruising';

    const allNodesList = Array.from(this.nodes.values());
    if (allNodesList.length > 0) {
      let closestNode = allNodesList[0];
      let minDist = vehicle.mesh.position.distanceTo(closestNode.pos);
      for (const node of allNodesList) {
        const dist = vehicle.mesh.position.distanceTo(node.pos);
        if (dist < minDist) {
          minDist = dist;
          closestNode = node;
        }
      }
      vehicle.currentNode = closestNode;
      if (closestNode.nextNodes && closestNode.nextNodes.length > 0) {
        vehicle.targetNode = closestNode.nextNodes[0];
      } else {
        vehicle.targetNode = closestNode;
      }
      if (vehicle.targetNode) {
        vehicle.mesh.lookAt(vehicle.targetNode.pos);
      }
      vehicle.speed = Math.max(8, vehicle.speed);
    }
  }

  updateUserControlledVehicle(v, delta) {
    if (!this.keys) return;

    const isForward = this.keys['w'] || this.keys['arrowup'];
    const isReverse = this.keys['s'] || this.keys['arrowdown'];
    const isLeft = this.keys['a'] || this.keys['arrowleft'];
    const isRight = this.keys['d'] || this.keys['arrowright'];

    const userMaxSpeed = v.maxSpeed * 1.35; // A bit faster for manual driving

    // 1. Acceleration / Braking / Reverse
    if (isForward) {
      v.speed = Math.min(userMaxSpeed, v.speed + v.acceleration * 1.8 * delta);
    } else if (isReverse) {
      if (v.speed > 0) {
        v.speed = Math.max(-12, v.speed - v.acceleration * 3.0 * delta); // Brake
      } else {
        v.speed = Math.max(-12, v.speed - v.acceleration * 1.5 * delta); // Reverse
      }
    } else {
      // Natural engine deceleration / friction
      if (v.speed > 0) {
        v.speed = Math.max(0, v.speed - 9.0 * delta);
      } else if (v.speed < 0) {
        v.speed = Math.min(0, v.speed + 9.0 * delta);
      }
    }

    // Save previous state before movement/steering
    const oldPos = v.mesh.position.clone();
    const oldRotY = v.mesh.rotation.y;

    // 2. Steering (Turning Left / Right when moving)
    if (Math.abs(v.speed) > 0.2) {
      const turnDir = v.speed > 0 ? 1 : -1;
      const steerSpeed = 2.8 * delta * turnDir;
      if (isLeft) {
        v.mesh.rotation.y += steerSpeed;
      }
      if (isRight) {
        v.mesh.rotation.y -= steerSpeed;
      }
    }

    // 3. Move vehicle along its orientation
    const moveStep = v.speed * delta;
    v.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
    v.mesh.position.y = 0;

    // 4. Building Collision Check (prevent driving through buildings!)
    if (this.app.buildingFactory && this.app.buildingFactory.buildings) {
      const pos = v.mesh.position;
      for (const b of this.app.buildingFactory.buildings) {
        if (b.isDestroyed) continue; // Can drive over destroyed rubble

        const minX = b.plot.x - (b.plot.width - 4) / 2 - 1.8;
        const maxX = b.plot.x + (b.plot.width - 4) / 2 + 1.8;
        const minZ = b.plot.z - (b.plot.depth - 4) / 2 - 1.8;
        const maxZ = b.plot.z + (b.plot.depth - 4) / 2 + 1.8;

        if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
          // COLLISION WITH BUILDING!
          if (this.app.funMode && Math.abs(v.speed) > 14) {
            // In Fun Mode, high speed impact destroys building into rubble!
            this.app.buildingFactory.destroyBuilding(b);
            if (this.app.audioSystem) {
              this.app.audioSystem.playExplosion();
            }
            if (this.app.sceneManager) {
              this.app.sceneManager.triggerShake(0.35);
            }
            v.speed *= 0.3;
            break;
          } else {
            // Solid Building Wall Collision! Revert position and rotation so vehicle cannot penetrate building!
            v.mesh.position.copy(oldPos);
            v.mesh.rotation.y = oldRotY;

            if (Math.abs(v.speed) > 2.0 && this.app.audioSystem && Math.random() < 0.4) {
              this.app.audioSystem.playBump();
            }

            v.speed = -v.speed * 0.3; // Bounce back off wall
            break;
          }
        }
      }
    }

    // 5. Check bump with other cars while manual driving
    for (const other of this.vehicles) {
      if (other === v) continue;
      if (v.mesh.position.distanceTo(other.mesh.position) < 3.6 && Math.abs(v.speed) > 3.0) {
        if (this.app.audioSystem && Math.random() < 0.25) {
          this.app.audioSystem.playBump();
          other.speed = 0; // Knock the AI car
        }
      }
    }
  }

  initWaypoints() {
    const coordsX = this.roadCoordsX;
    const coordsZ = this.roadCoordsZ;
    const off = this.laneOffset;

    for (const rx of coordsX) {
      for (const rz of coordsZ) {
        this.nodes.set(`EB_IN:${rx},${rz}`, new TrafficNode(`EB_IN:${rx},${rz}`, rx - 10, rz + off));
        this.nodes.set(`EB_OUT:${rx},${rz}`, new TrafficNode(`EB_OUT:${rx},${rz}`, rx + 10, rz + off));

        this.nodes.set(`WB_IN:${rx},${rz}`, new TrafficNode(`WB_IN:${rx},${rz}`, rx + 10, rz - off));
        this.nodes.set(`WB_OUT:${rx},${rz}`, new TrafficNode(`WB_OUT:${rx},${rz}`, rx - 10, rz - off));

        this.nodes.set(`SB_IN:${rx},${rz}`, new TrafficNode(`SB_IN:${rx},${rz}`, rx - off, rz - 10));
        this.nodes.set(`SB_OUT:${rx},${rz}`, new TrafficNode(`SB_OUT:${rx},${rz}`, rx - off, rz + 10));

        this.nodes.set(`NB_IN:${rx},${rz}`, new TrafficNode(`NB_IN:${rx},${rz}`, rx + off, rz + 10));
        this.nodes.set(`NB_OUT:${rx},${rz}`, new TrafficNode(`NB_OUT:${rx},${rz}`, rx + off, rz - 10));
      }
    }

    // Link East-West streets across intersections and river bridge
    for (let i = 0; i < coordsX.length - 1; i++) {
      const c1 = coordsX[i];
      const c2 = coordsX[i + 1];

      for (const rz of coordsZ) {
        const ebOut = this.nodes.get(`EB_OUT:${c1},${rz}`);
        const ebIn = this.nodes.get(`EB_IN:${c2},${rz}`);
        if (ebOut && ebIn) ebOut.nextNodes.push(ebIn);

        const wbOut = this.nodes.get(`WB_OUT:${c2},${rz}`);
        const wbIn = this.nodes.get(`WB_IN:${c1},${rz}`);
        if (wbOut && wbIn) wbOut.nextNodes.push(wbIn);
      }
    }

    // Link North-South streets
    for (let i = 0; i < coordsZ.length - 1; i++) {
      const c1 = coordsZ[i];
      const c2 = coordsZ[i + 1];

      for (const rx of coordsX) {
        const sbOut = this.nodes.get(`SB_OUT:${rx},${c1}`);
        const sbIn = this.nodes.get(`SB_IN:${rx},${c2}`);
        if (sbOut && sbIn) sbOut.nextNodes.push(sbIn);

        const nbOut = this.nodes.get(`NB_OUT:${rx},${c2}`);
        const nbIn = this.nodes.get(`NB_IN:${rx},${c1}`);
        if (nbOut && nbIn) nbOut.nextNodes.push(nbIn);
      }
    }

    for (const rx of coordsX) {
      for (const rz of coordsZ) {
        const ebIn = this.nodes.get(`EB_IN:${rx},${rz}`);
        if (ebIn) {
          if (rx < 310) ebIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
          if (rz < 100) ebIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
          if (rz > -100) ebIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
        }

        const wbIn = this.nodes.get(`WB_IN:${rx},${rz}`);
        if (wbIn) {
          if (rx > -100) wbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
          if (rz > -100) wbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
          if (rz < 100) wbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
        }

        const sbIn = this.nodes.get(`SB_IN:${rx},${rz}`);
        if (sbIn) {
          if (rz < 100) sbIn.nextNodes.push(this.nodes.get(`SB_OUT:${rx},${rz}`));
          if (rx > -100) sbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
          if (rx < 310) sbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
        }

        const nbIn = this.nodes.get(`NB_IN:${rx},${rz}`);
        if (nbIn) {
          if (rz > -100) nbIn.nextNodes.push(this.nodes.get(`NB_OUT:${rx},${rz}`));
          if (rx < 310) nbIn.nextNodes.push(this.nodes.get(`EB_OUT:${rx},${rz}`));
          if (rx > -100) nbIn.nextNodes.push(this.nodes.get(`WB_OUT:${rx},${rz}`));
        }
      }
    }
  }

  spawnVehicles(count) {
    const types = ['SEDAN', 'SPORTS', 'BUS', 'TRUCK', 'TAXI', 'POLICE', 'POLICE', 'SEDAN'];
    const colors = [0xdf0054, 0x00f0ff, 0xffcc00, 0x22ee44, 0xeeeeee, 0x1a1a24, 0x1a1a24, 0xff5500];
    const names = [
      'Cyber Cruiser 2099', 'Apex GT Turbo', 'Metro Transit Bus #42', 'Express Freight Truck',
      'City Yellow Cab #88', 'Metro Police Cruiser #01', 'Metro Police Interceptor #02', 'Neo Tech autonomous Sedan'
    ];

    const outNodes = Array.from(this.nodes.values()).filter(n => n.id.includes('_OUT') && n.nextNodes.length > 0);

    for (let i = 0; i < count; i++) {
      const typeIdx = i % types.length;
      const vType = types[typeIdx];
      const color = colors[i % colors.length];
      const name = `${names[typeIdx]} #${i + 10}`;

      const vehicle = new Vehicle(vType, color, name);
      vehicle.crashed = false;
      vehicle.crashTimer = 0;
      vehicle.emergencyTarget = null;
      vehicle.normalMaxSpeed = vehicle.maxSpeed;

      const startNode = outNodes[i % outNodes.length];
      vehicle.mesh.position.copy(startNode.pos);
      vehicle.currentNode = startNode;
      vehicle.targetNode = startNode.nextNodes[0];

      if (vehicle.targetNode) {
        vehicle.mesh.lookAt(vehicle.targetNode.pos);
      }

      this.app.sceneManager.scene.add(vehicle.mesh);
      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(vehicle.mesh, vehicle);
      }
      this.vehicles.push(vehicle);
    }
  }

  dispatchPolice(crashPos) {
    const policeVehicles = this.vehicles.filter(v => v.isPolice && !v.crashed);
    
    // Sort police by distance to crash site
    policeVehicles.sort((a, b) => {
      return a.mesh.position.distanceTo(crashPos) - b.mesh.position.distanceTo(crashPos);
    });

    // Dispatch up to 2 closest police cruisers to rush to the crash scene
    const responders = policeVehicles.slice(0, 2);
    for (const p of responders) {
      p.emergencyTarget = crashPos.clone();
      p.maxSpeed = 42; // High speed pursuit/response
      p.targetSpeed = 42;
      if (this.app.audioSystem && this.app.audioSystem.isEnabled) {
        this.app.audioSystem.playSiren(4.0);
      }
    }
  }

  update(delta) {
    const funMode = this.app.funMode;

    // Check collisions between cars in Fun Mode!
    if (funMode) {
      for (let i = 0; i < this.vehicles.length; i++) {
        for (let j = i + 1; j < this.vehicles.length; j++) {
          const v1 = this.vehicles[i];
          const v2 = this.vehicles[j];
          if (v1.crashed || v2.crashed) continue;

          const dist = v1.mesh.position.distanceTo(v2.mesh.position);
          if (dist < 3.8) {
            // MAYHEM COLLISION!
            v1.crashed = true;
            v1.speed = 0;
            v1.targetSpeed = 0;
            v1.crashTimer = 16.0;
            v1.mesh.rotation.z = (Math.random() - 0.5) * 0.9; // Wrecked tilt

            v2.crashed = true;
            v2.speed = 0;
            v2.targetSpeed = 0;
            v2.crashTimer = 16.0;
            v2.mesh.rotation.z = (Math.random() - 0.5) * 0.9;

            const crashPos = v1.mesh.position.clone().add(v2.mesh.position).multiplyScalar(0.5);
            
            // Trigger explosion visual and audio effects
            if (this.app.explosionManager) {
              this.app.explosionManager.createExplosion(crashPos);
            }
            if (this.app.audioSystem) {
              this.app.audioSystem.playExplosion();
            }

            // Police rush to the scene of the accident
            this.dispatchPolice(crashPos);
          }
        }
      }
    }

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const pos = v.mesh.position;

      // Handle crashed state recovery
      if (v.crashed) {
        v.crashTimer -= delta;
        if (v.crashTimer <= 0) {
          // Clear accident and resume driving
          v.crashed = false;
          v.mesh.rotation.z = 0;
          v.speed = 12;
          v.maxSpeed = v.normalMaxSpeed || 18;
          
          // Release any responding police cars
          for (const p of this.vehicles) {
            if (p.isPolice && p.emergencyTarget) {
              p.emergencyTarget = null;
              p.maxSpeed = p.normalMaxSpeed || 20;
            }
          }
        }
        v.update(delta);
        continue;
      }

      // Handle emergency police rushing to crash site
      if (v.isPolice && v.emergencyTarget) {
        const distToCrash = pos.distanceTo(v.emergencyTarget);
        if (distToCrash < 10.0) {
          // Arrived at the scene of the accident! Secure the area
          v.speed = 0;
          v.targetSpeed = 0;
        } else {
          v.targetSpeed = v.maxSpeed;
          if (v.speed < v.targetSpeed) {
            v.speed = Math.min(v.targetSpeed, v.speed + v.acceleration * 2 * delta);
          }
          // Steer directly towards accident scene at high speed
          const dir = v.emergencyTarget.clone().sub(pos).normalize();
          const targetAngle = Math.atan2(dir.x, dir.z);

          let currentAngle = v.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          v.mesh.rotation.y += diff * 8.0 * delta;

          const moveStep = v.speed * delta;
          v.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
          v.mesh.position.y = 0;
        }
        v.update(delta);
        continue;
      }

      // Handle User Controlled manual driving (WASD / Arrows)
      if (v.userControlled) {
        this.updateUserControlledVehicle(v, delta);
        v.update(delta);
        continue;
      }

      // 1. Normal Collision avoidance check with vehicle ahead
      let isBlocked = false;
      for (let j = 0; j < this.vehicles.length; j++) {
        if (i === j) continue;
        const other = this.vehicles[j];
        const dist = pos.distanceTo(other.mesh.position);

        if (dist < 11) {
          const toOther = other.mesh.position.clone().sub(pos).normalize();
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
          if (toOther.dot(forward) > 0.65) {
            // In Fun Mode, ignore collision avoidance so cars smash into each other!
            if (!funMode) {
              isBlocked = true;
              break;
            } else {
              // Accelerate slightly before crash for maximum mayhem!
              v.targetSpeed = v.maxSpeed * 1.3;
            }
          }
        }
      }

      if (!funMode) {
        if (isBlocked) {
          v.targetSpeed = 0;
        } else {
          v.targetSpeed = v.maxSpeed;
        }
      } else if (!isBlocked) {
        v.targetSpeed = v.maxSpeed * 1.2;
      }

      if (v.speed < v.targetSpeed) {
        v.speed = Math.min(v.targetSpeed, v.speed + v.acceleration * delta);
      } else if (v.speed > v.targetSpeed) {
        v.speed = Math.max(v.targetSpeed, v.speed - v.acceleration * 1.8 * delta);
      }

      // 2. Steer along road graph towards target node
      if (v.targetNode) {
        const distToTarget = pos.distanceTo(v.targetNode.pos);
        if (distToTarget < 2.5) {
          v.currentNode = v.targetNode;
          if (v.currentNode.nextNodes.length > 0) {
            v.targetNode = v.currentNode.nextNodes[Math.floor(Math.random() * v.currentNode.nextNodes.length)];
          } else {
            v.speed = 0;
          }
        }

        if (v.targetNode) {
          const dir = v.targetNode.pos.clone().sub(pos).normalize();
          const targetAngle = Math.atan2(dir.x, dir.z);

          let currentAngle = v.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          v.mesh.rotation.y += diff * 6.0 * delta;

          const moveStep = v.speed * delta;
          v.mesh.translateOnAxis(new THREE.Vector3(0, 0, 1), moveStep);
          v.mesh.position.y = 0;
        }
      }

      // 3. Update vehicle animations & wheels
      v.update(delta);

      // 4. Check Doppler siren sound for normal police patrol
      if (v.isPolice && v.speed > 5 && !v.emergencyTarget && this.app.audioSystem && this.app.audioSystem.isEnabled) {
        const camDist = pos.distanceTo(this.app.sceneManager.camera.position);
        if (camDist < 40 && Math.random() < 0.005) {
          this.app.audioSystem.playSiren(2.0);
        }
      }
    }
  }
}

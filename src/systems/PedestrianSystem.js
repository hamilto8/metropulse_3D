import * as THREE from 'three';
import { Pedestrian } from '../entities/Pedestrian.js';

/** Shared forward-axis vector — avoids per-frame allocation in 60-pedestrian movement loop */
const FORWARD_AXIS = Object.freeze(new THREE.Vector3(0, 0, 1));

class SidewalkNode {
  constructor(id, x, z, y = 0.4) {
    this.id = id;
    this.pos = new THREE.Vector3(x, y, z);
    this.nextNodes = [];
  }
}

export class PedestrianSystem {
  constructor(app) {
    this.app = app;
    this.pedestrians = [];
    this.nodes = new Map();
    this.sidewalkCoordsX = [-109, -91, -59, -41, -9, 9, 41, 59, 91, 109, 201, 219, 251, 269, 301, 319];
    this.sidewalkCoordsZ = [-109, -91, -59, -41, -9, 9, 41, 59, 91, 109];
    
    this.initWaypoints();
    this.spawnPedestrians(60);
  }

  initWaypoints() {
    const coordsX = this.sidewalkCoordsX;
    const coordsZ = this.sidewalkCoordsZ;

    // 1. Create a grid of sidewalk intersection and corner nodes
    for (const x of coordsX) {
      for (const z of coordsZ) {
        const y = (x < -60 && z < -60) ? 0.7 : 0.4; // Elevated inside park area
        this.nodes.set(`${x},${z}`, new SidewalkNode(`${x},${z}`, x, z, y));
      }
    }

    // 2. Connect orthogonal neighbors (sidewalk edges along blocks, crosswalks, and river bridge sidewalks)
    for (let i = 0; i < coordsX.length; i++) {
      for (let j = 0; j < coordsZ.length; j++) {
        const current = this.nodes.get(`${coordsX[i]},${coordsZ[j]}`);
        if (!current) continue;

        // Connect East neighbor (i + 1)
        if (i < coordsX.length - 1) {
          const east = this.nodes.get(`${coordsX[i + 1]},${coordsZ[j]}`);
          if (east) {
            current.nextNodes.push(east);
            east.nextNodes.push(current); // Bi-directional walking
          }
        }

        // Connect South neighbor (j + 1)
        if (j < coordsZ.length - 1) {
          const south = this.nodes.get(`${coordsX[i]},${coordsZ[j + 1]}`);
          if (south) {
            current.nextNodes.push(south);
            south.nextNodes.push(current); // Bi-directional walking
          }
        }
      }
    }

    // 3. Add Central Park internal walking paths (in the NW quadrant: x and z between -100 and -50)
    const parkNodes = [
      new SidewalkNode('park_center', -75, -75, 0.7),
      new SidewalkNode('park_n', -75, -91, 0.7),
      new SidewalkNode('park_s', -75, -59, 0.7),
      new SidewalkNode('park_w', -91, -75, 0.7),
      new SidewalkNode('park_e', -59, -75, 0.7)
    ];

    for (const pn of parkNodes) {
      this.nodes.set(pn.id, pn);
    }

    // Link park paths to sidewalk grid
    this.linkBiDir('park_center', 'park_n');
    this.linkBiDir('park_center', 'park_s');
    this.linkBiDir('park_center', 'park_w');
    this.linkBiDir('park_center', 'park_e');

    this.linkBiDir('park_n', '-75,-91'); if (!this.nodes.has('-75,-91')) {
      const n = new SidewalkNode('-75,-91', -75, -91, 0.7);
      this.nodes.set('-75,-91', n);
      this.linkBiDir('-75,-91', '-91,-91');
      this.linkBiDir('-75,-91', '-59,-91');
      this.linkBiDir('park_n', '-75,-91');
    }
  }

  linkBiDir(id1, id2) {
    const n1 = this.nodes.get(id1);
    const n2 = this.nodes.get(id2);
    if (n1 && n2) {
      if (!n1.nextNodes.includes(n2)) n1.nextNodes.push(n2);
      if (!n2.nextNodes.includes(n1)) n2.nextNodes.push(n1);
    }
  }

  spawnPedestrians(count) {
    const types = ['BUSINESS', 'CASUAL', 'JOGGER', 'CASUAL', 'BUSINESS', 'CASUAL'];
    const colors = [0x2563eb, 0xdb2777, 0x16a34a, 0xd97706, 0x7c3aed, 0x0891b2, 0xe11d48, 0x475569];
    const firstNames = ['Alex', 'Jordan', 'Elena', 'Marcus', 'Sophia', 'Liam', 'Chloe', 'David', 'Maya', 'Lucas', 'Zoe', 'Daniel'];
    const lastNames = ['V.', 'K.', 'M.', 'S.', 'R.', 'T.', 'L.', 'H.', 'W.', 'P.', 'B.', 'N.'];

    const allNodes = Array.from(this.nodes.values()).filter(n => n.nextNodes.length > 0);

    for (let i = 0; i < count; i++) {
      const pType = types[i % types.length];
      const color = colors[i % colors.length];
      const fname = firstNames[Math.floor(Math.random() * firstNames.length)];
      const lname = lastNames[Math.floor(Math.random() * lastNames.length)];
      const name = `${fname} ${lname}`;

      const ped = new Pedestrian(pType, color, name);

      // Pick starting node
      const startNode = allNodes[i % allNodes.length];
      ped.mesh.position.copy(startNode.pos);
      ped.currentNode = startNode;
      ped.targetNode = startNode.nextNodes[Math.floor(Math.random() * startNode.nextNodes.length)];

      if (ped.targetNode) {
        ped.mesh.lookAt(ped.targetNode.pos);
      }

      this.app.sceneManager.scene.add(ped.mesh);
      if (this.app.inspectorHud) {
        this.app.inspectorHud.registerObject(ped.mesh, ped);
      }
      this.pedestrians.push(ped);
    }
  }

  knockDownPedestrian(p, knockDir) {
    if (!p || p.knockedDown) return;
    p.knockedDown = true;
    p.knockdownTimer = 4.5; // Stay knocked down for 4.5 seconds before getting back up!
    p.speed = 0;
    p.targetSpeed = 0;

    if (knockDir) {
      p.mesh.position.addScaledVector(knockDir, 1.8);
    }

    // Fall on their butts onto the ground
    p.mesh.rotation.x = -1.4; // Tilted back sitting on butt
    p.mesh.rotation.z = (Math.random() - 0.5) * 0.4;
    if (p.legL && p.legR) {
      p.legL.rotation.x = -1.2; // Legs sticking forward
      p.legR.rotation.x = -1.2;
    }
    if (p.armL && p.armR) {
      p.armL.rotation.x = -0.8; // Arms thrown back/up
      p.armR.rotation.x = -0.8;
    }

    if (!p.normalActivity) p.normalActivity = p.info['Activity'];
    p.info['Activity'] = '💥 Knocked Down by Car!';
    p.info['Mood'] = 'Dazed on Ground';

    if (this.app && this.app.audioSystem) {
      this.app.audioSystem.playBump();
    }
  }

  update(delta) {
    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      const pos = p.mesh.position;

      // 0. Check knockdown recovery
      if (p.knockedDown) {
        p.knockdownTimer -= delta;
        if (p.knockdownTimer <= 0) {
          p.knockedDown = false;
          p.mesh.rotation.x = 0;
          p.mesh.rotation.z = 0;
          if (p.legL && p.legR) {
            p.legL.rotation.x = 0;
            p.legR.rotation.x = 0;
          }
          if (p.armL && p.armR) {
            p.armL.rotation.x = 0;
            p.armR.rotation.x = 0;
          }
          if (p.normalActivity) p.info['Activity'] = p.normalActivity;
          p.info['Mood'] = 'Recovered & Walking';
        } else {
          continue; // Stay knocked down sitting on butt on the ground!
        }
      }

      // 1. Check collisions and avoidance with nearby vehicles
      let isBlocked = false;
      if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
        for (const v of this.app.trafficSystem.vehicles) {
          const dist = pos.distanceTo(v.mesh.position);
          const hitDist = (v.vType === 'BUS' || v.vType === 'TRUCK') ? 3.8 : 2.6;

          if (dist < hitDist && v.speed > 2.0) {
            // HIT BY A CAR!
            const pushDir = pos.clone().sub(v.mesh.position).normalize();
            this.knockDownPedestrian(p, pushDir);
            break;
          } else if (dist < 4.5 && v.speed > 1.0) {
            isBlocked = true;
          }
        }
      }

      if (p.knockedDown) continue;

      if (p.userControlled) {
        const ts = this.app.trafficSystem;
        const keys = ts ? ts.keys : null;
        
        if (keys) {
          const isW = keys['w'] || keys['arrowup'];
          const isS = keys['s'] || keys['arrowdown'];
          const isA = keys['a'] || keys['arrowleft'];
          const isD = keys['d'] || keys['arrowright'];

          // Rotate pedestrian
          if (isA) p.mesh.rotation.y += 3.2 * delta;
          if (isD) p.mesh.rotation.y -= 3.2 * delta;

          // Determine target speed based on keys
          let moveSpeed = 0;
          if (isW) moveSpeed = p.maxSpeed;
          if (isS) moveSpeed = -p.maxSpeed * 0.6; // Backwards movement is slower
          
          p.targetSpeed = moveSpeed;
        }

        // Interpolate speed
        if (p.speed < p.targetSpeed) {
          p.speed = Math.min(p.targetSpeed, p.speed + 16 * delta);
        } else if (p.speed > p.targetSpeed) {
          p.speed = Math.max(p.targetSpeed, p.speed - 16 * delta);
        }

        // Translate pedestrian
        if (Math.abs(p.speed) > 0.05) {
          const moveStep = p.speed * delta;
          p.mesh.translateOnAxis(FORWARD_AXIS, moveStep);
        }

        // Snapping elevation to current sidewalk, road, or park height
        p.mesh.position.y = this.getTerrainHeight(pos.x, pos.z);

        // Update leg/arm swing animations
        p.update(delta);
        continue;
      }

      if (isBlocked) {
        p.targetSpeed = 0;
      } else {
        const isFunMode = this.app && this.app.funMode;
        p.targetSpeed = isFunMode ? p.maxSpeed * 3.0 : p.maxSpeed;
      }

      if (p.speed < p.targetSpeed) {
        p.speed = Math.min(p.targetSpeed, p.speed + 12 * delta);
      } else if (p.speed > p.targetSpeed) {
        p.speed = Math.max(p.targetSpeed, p.speed - 14 * delta);
      }

      // 2. Move along sidewalk graph towards target node
      if (p.targetNode) {
        const dist = pos.distanceTo(p.targetNode.pos);
        if (dist < 1.2) {
          // Reached node! Pick next connected node along sidewalk (prefer not turning immediately back if possible)
          const prevNode = p.currentNode;
          p.currentNode = p.targetNode;
          
          let candidates = p.currentNode.nextNodes.filter(n => n !== prevNode);
          if (candidates.length === 0) candidates = p.currentNode.nextNodes;
          
          if (candidates.length > 0) {
            p.targetNode = candidates[Math.floor(Math.random() * candidates.length)];
          }
        }

        if (p.targetNode) {
          const dir = p.targetNode.pos.clone().sub(pos).normalize();
          const targetAngle = Math.atan2(dir.x, dir.z);

          let currentAngle = p.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          p.mesh.rotation.y += diff * 7.0 * delta;

          const moveStep = p.speed * delta;
          p.mesh.translateOnAxis(FORWARD_AXIS, moveStep);
          p.mesh.position.y = (pos.x < -60 && pos.z < -60) ? 0.7 : 0.4;
        }
      }

      // 3. Update walk animation
      p.update(delta);
    }

    // 4. Handle proximity checking for entering a vehicle
    this.updateVehicleEntryCheck();
  }

  updateVehicleEntryCheck() {
    if (!this.controlledPedestrian) {
      const prompt = document.getElementById('vehicle-enter-prompt');
      if (prompt) prompt.classList.add('hidden');
      return;
    }

    const p = this.controlledPedestrian;
    const pos = p.mesh.position;
    
    let closestVehicle = null;
    let minDist = 3.5; // Vehicle boarding range (meters)

    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const v of this.app.trafficSystem.vehicles) {
        const dist = pos.distanceTo(v.mesh.position);
        if (dist < minDist) {
          minDist = dist;
          closestVehicle = v;
        }
      }
    }

    let prompt = document.getElementById('vehicle-enter-prompt');
    if (closestVehicle) {
      if (!prompt) {
        prompt = document.createElement('div');
        prompt.id = 'vehicle-enter-prompt';
        prompt.style.position = 'fixed';
        prompt.style.bottom = '15%';
        prompt.style.left = '50%';
        prompt.style.transform = 'translateX(-50%)';
        prompt.style.padding = '12px 24px';
        prompt.style.borderRadius = '24px';
        prompt.style.background = 'rgba(7, 12, 30, 0.75)';
        prompt.style.backdropFilter = 'blur(12px)';
        prompt.style.border = '1px solid #ff007f';
        prompt.style.color = '#fff';
        prompt.style.fontFamily = 'Outfit, Inter, sans-serif';
        prompt.style.fontSize = '0.95rem';
        prompt.style.fontWeight = 'bold';
        prompt.style.boxShadow = '0 0 15px rgba(255, 0, 127, 0.4)';
        prompt.style.zIndex = '1000';
        prompt.style.pointerEvents = 'none';
        document.body.appendChild(prompt);
      }
      
      prompt.innerHTML = `🏎️ Press <span style="color: #00f0ff;">[E]</span> to Hijack ${closestVehicle.name.toUpperCase()}`;
      prompt.classList.remove('hidden');

      const ts = this.app.trafficSystem;
      const keys = ts ? ts.keys : null;
      if (keys && (keys['e'] || keys['f'] || keys['enter'])) {
        // Hijack key pressed! Consume input to prevent duplicate hits
        keys['e'] = false;
        keys['f'] = false;
        keys['enter'] = false;

        const success = this.app.trafficSystem.toggleUserControl(closestVehicle);
        if (success) {
          this.releaseControl(p);
          prompt.classList.add('hidden');
          
          this.app.sceneManager.startFollowTarget(closestVehicle);
          if (this.app.uiManager) {
            this.app.uiManager.showInspector(closestVehicle);
          }
        }
      }
    } else {
      if (prompt) {
        prompt.classList.add('hidden');
      }
    }
  }

  toggleUserControl(pedestrian) {
    if (!pedestrian) return false;
    
    if (pedestrian.userControlled && this.controlledPedestrian === pedestrian) {
      this.releaseControl(pedestrian);
      return false;
    } else {
      // Release any currently controlled pedestrian
      if (this.controlledPedestrian && this.controlledPedestrian !== pedestrian) {
        this.releaseControl(this.controlledPedestrian);
      }
      // Release control of any vehicle to prevent conflicts
      if (this.app.trafficSystem && this.app.trafficSystem.controlledVehicle) {
        this.app.trafficSystem.releaseControl(this.app.trafficSystem.controlledVehicle);
      }
      
      pedestrian.userControlled = true;
      this.controlledPedestrian = pedestrian;
      pedestrian.info['Mood'] = '🎮 USER CONTROLLED';
      pedestrian.info['Activity'] = 'Walking streets';
      return true;
    }
  }

  releaseControl(pedestrian) {
    if (!pedestrian) return;
    pedestrian.userControlled = false;
    if (this.controlledPedestrian === pedestrian) {
      this.controlledPedestrian = null;
    }
    
    pedestrian.info['Mood'] = 'Energized';
    pedestrian.info['Activity'] = pedestrian.pType === 'JOGGER' ? 'Evening Run' : (pedestrian.pType === 'BUSINESS' ? 'Commuting to Office' : 'Strolling Downtown');
    
    const prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) prompt.classList.add('hidden');

    // Return to sidewalk network at closest node to avoid floating
    const allNodes = Array.from(this.nodes.values()).filter(n => n.nextNodes.length > 0);
    let closestNode = null;
    let minDist = Infinity;
    for (const n of allNodes) {
      const dist = pedestrian.mesh.position.distanceTo(n.pos);
      if (dist < minDist) {
        minDist = dist;
        closestNode = n;
      }
    }
    
    if (closestNode) {
      pedestrian.currentNode = closestNode;
      if (closestNode.nextNodes.length > 0) {
        pedestrian.targetNode = closestNode.nextNodes[0];
        pedestrian.mesh.lookAt(pedestrian.targetNode.pos);
      }
    }
  }

  getTerrainHeight(x, z) {
    // 1. Northwest Central Park region
    if (x < -60 && z < -60) return 0.7;

    // 2. Main street blocks (sidewalks)
    const blockCentersX = [-75, -25, 25, 75, 235, 285];
    const blockCentersZ = [-75, -25, 25, 75];
    const size = 22.0; // Block half-width (36 block + 4 sidewalk on each side = 44 / 2 = 22)

    for (const bx of blockCentersX) {
      for (const bz of blockCentersZ) {
        if (Math.abs(x - bx) < size && Math.abs(z - bz) < size) {
          return 0.4; // Elevated sidewalk height
        }
      }
    }

    // 3. Street/Asphalt level (offset slightly so feet align with floor)
    return 0.05;
  }
}

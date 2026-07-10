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
    this.talkingPedestrian = null;
    this.talkingBubbleText = '';
    this.talkingBubbleTimer = 0;
    this.sidewalkCoordsX = [-109, -91, -59, -41, -9, 9, 41, 59, 91, 109, 201, 219, 251, 269, 301, 319, 441, 459, 541, 559, 641, 659, 741, 759];
    this.sidewalkCoordsZ = [-109, -91, -59, -41, -9, 9, 41, 59, 91, 109];
    
    this.initWaypoints();
    this.spawnPedestrians(60);
    this.baseballBats = [];
    this.isWanted = false;
    this.escapeTimer = 0;
    this.spawnBaseballBats();

    // Listen for attacks
    window.addEventListener('click', (e) => {
      if (e.target.closest('header, aside, footer, button, input') || e.target.classList.contains('action-btn')) {
        return;
      }
      if (this.controlledPedestrian && this.controlledPedestrian.hasBaseballBat) {
        this.swingBaseballBat();
      }
    });
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
          const eastX = coordsX[i + 1];
          // Do not allow crossing River 1 (109 to 201) or River 2 (319 to 441) except on the bridge sidewalks near Z = 0
          if (((coordsX[i] === 109 && eastX === 201) || (coordsX[i] === 319 && eastX === 441)) && Math.abs(coordsZ[j]) > 10) {
            continue;
          }
          const east = this.nodes.get(`${eastX},${coordsZ[j]}`);
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

    // Safety check: ensure NO dead-end sidewalk nodes exist
    for (const node of this.nodes.values()) {
      node.nextNodes = node.nextNodes.filter(Boolean);
      if (node.nextNodes.length === 0) {
        for (const other of this.nodes.values()) {
          if (other !== node) {
            node.nextNodes.push(other);
            break;
          }
        }
      }
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
    const weather = this.app.environment ? this.app.environment.weatherMode : 'clear';
    const isRaining = (weather === 'rain' || weather === 'thunderstorm');

    // Update baseball bat pick-ups
    const p = this.controlledPedestrian;
    if (p && !p.hasBaseballBat && this.baseballBats) {
      for (const bat of this.baseballBats) {
        if (bat.pickedUp) continue;
        const dist = p.mesh.position.distanceTo(bat.pos);
        if (dist < 2.0) {
          bat.pickedUp = true;
          this.app.sceneManager.scene.remove(bat.mesh);
          p.hasBaseballBat = true;
          p.attachBaseballBat();

          // Show pickup notice via the proximity prompt element
          const prompt = document.getElementById('vehicle-enter-prompt');
          if (prompt) {
            prompt.innerHTML = '🏏 <span style="color: #00ff88; font-weight:700;">BASEBALL BAT EQUIPPED!</span> Left-Click to swing!';
            prompt.classList.remove('hidden');
            setTimeout(() => { prompt.classList.add('hidden'); }, 3000);
          }
          if (this.app.audioSystem) {
            this.app.audioSystem.playUIClick();
          }
          break;
        }
      }
    }

    // Animate active (uncollected) baseball bats
    if (this.baseballBats) {
      for (const bat of this.baseballBats) {
        if (bat.pickedUp) continue;
        bat.pulseTime += delta * 4.0;
        const scale = 1.0 + Math.sin(bat.pulseTime) * 0.18;
        bat.halo.scale.set(scale, scale, 1.0);
        bat.mesh.rotation.y += 1.5 * delta;
      }
    }

    // Handle wanted level/police pursuit and arrest check
    if (this.isWanted && p) {
      const playerPos = p.mesh.position;
      
      // Update police targets to track the player
      if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
        const policeVehicles = this.app.trafficSystem.vehicles.filter(v => v.isPolice && !v.crashed);
        let minPoliceDist = Infinity;

        for (const pv of policeVehicles) {
          pv.emergencyTarget = playerPos.clone();
          pv.maxSpeed = 42;
          pv.targetSpeed = 42;
          pv.sirenTimer = 5.0; // Keep siren blaring!
          
          const distToPlayer = pv.mesh.position.distanceTo(playerPos);
          if (distToPlayer < minPoliceDist) {
            minPoliceDist = distToPlayer;
          }
        }

        // Arrest check: only arrest if police vehicle is right next to the player (< 3.0 meters)
        if (minPoliceDist < 3.0) {
          this.arrestPlayer();
        } else {
          // If the player is far away from all police cruisers (> 35 meters), let them escape over time
          if (minPoliceDist > 35.0) {
            this.escapeTimer += delta;
            if (this.escapeTimer >= 8.0) {
              // Successfully escaped!
              this.isWanted = false;
              this.escapeTimer = 0;
              
              // Reset police response
              for (const pv of policeVehicles) {
                pv.emergencyTarget = null;
                pv.maxSpeed = 18;
                pv.targetSpeed = 18;
              }
              
              // Show notification on prompt
              const prompt = document.getElementById('vehicle-enter-prompt');
              if (prompt) {
                prompt.innerHTML = '🚨 <span style="color:#00ff88; font-weight:700;">LOST THE COPS!</span> Wanted level cleared.';
                prompt.classList.remove('hidden');
                setTimeout(() => { prompt.classList.add('hidden'); }, 3000);
              }
            }
          } else {
            // Cops are nearby (between 3.0m and 35.0m), reset escape timer
            this.escapeTimer = 0;
          }
        }
      }
    } else {
      this.escapeTimer = 0;
    }

    // Always update wanted HUD
    this.updateWantedHud();

    // Update active speech bubble if any
    if (this.talkingBubbleTimer > 0) {
      this.talkingBubbleTimer -= delta;
      this.updateSpeechBubblePosition();
      if (this.talkingBubbleTimer <= 0) {
        this.talkingPedestrian = null;
        const bubble = document.getElementById('pedestrian-speech-bubble');
        if (bubble) bubble.classList.add('hidden');
      }
    }

    for (let i = this.pedestrians.length - 1; i >= 0; i--) {
      const p = this.pedestrians[i];
      const pos = p.mesh.position;

      if (this.app && this.app.cityBuilder && this.app.cityBuilder.isInWater(pos)) {
        if (this.app.audioSystem && this.app.audioSystem.playSplash) {
          this.app.audioSystem.playSplash();
        }
        if (p.userControlled || (this.app.sceneManager && this.app.sceneManager.followTarget === p)) {
          if (this.app.sceneManager) {
            this.app.sceneManager.breakToFreeOrbit();
          }
        }
        this.cullPedestrian(p);
        continue;
      }

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
        if (this.app.cityBuilder && this.app.cityBuilder.isInWater(p.mesh.position)) {
          if (this.app.audioSystem && this.app.audioSystem.playSplash) {
            this.app.audioSystem.playSplash();
          }
          this.releaseControl(p);
          if (this.app.sceneManager) {
            this.app.sceneManager.breakToFreeOrbit();
          }
          continue;
        }

        const ts = this.app.trafficSystem;
        const keys = ts ? ts.keys : null;
        
        if (keys) {
          const isW = keys['w'] || keys['arrowup'];
          const isS = keys['s'] || keys['arrowdown'];
          const isA = keys['a'] || keys['arrowleft'];
          const isD = keys['d'] || keys['arrowright'];
          const isShift = keys['shift'];

          // Rotate pedestrian
          if (isA) p.mesh.rotation.y += 3.2 * delta;
          if (isD) p.mesh.rotation.y -= 3.2 * delta;

          // Determine target speed based on keys (Shift triples maxSpeed)
          let moveSpeed = 0;
          const currentMaxSpeed = isShift ? p.maxSpeed * 3.0 : p.maxSpeed;
          if (isW) moveSpeed = currentMaxSpeed;
          if (isS) moveSpeed = -currentMaxSpeed * 0.6; // Backwards movement is slower
          
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
        const dist = Math.hypot(pos.x - p.targetNode.pos.x, pos.z - p.targetNode.pos.z);
        if (dist < 1.8) {
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
          const dx = p.targetNode.pos.x - pos.x;
          const dz = p.targetNode.pos.z - pos.z;
          const targetAngle = Math.atan2(dx, dz);

          let currentAngle = p.mesh.rotation.y;
          let diff = targetAngle - currentAngle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          p.mesh.rotation.y += diff * 7.0 * delta;

          const moveStep = p.speed * delta;
          p.mesh.translateOnAxis(FORWARD_AXIS, moveStep);
          p.mesh.position.y = this.getTerrainHeight(pos.x, pos.z);
        }
      }

      // 3. Update walk animation
      p.update(delta, isRaining);
    }

    // 4. Handle proximity checking for vehicles and pedestrians
    this.updateProximityChecks();
  }

  updateProximityChecks() {
    if (!this.controlledPedestrian) {
      const prompt = document.getElementById('vehicle-enter-prompt');
      if (prompt) prompt.classList.add('hidden');
      return;
    }

    const p = this.controlledPedestrian;
    const pos = p.mesh.position;
    
    // 1. Scan for closest vehicle
    let closestVehicle = null;
    let minVehDist = 3.5;

    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const v of this.app.trafficSystem.vehicles) {
        const dist = pos.distanceTo(v.mesh.position);
        if (dist < minVehDist) {
          minVehDist = dist;
          closestVehicle = v;
        }
      }
    }

    // 2. Scan for closest other pedestrian
    let closestPed = null;
    let minPedDist = 3.0;

    for (const other of this.pedestrians) {
      if (other === p || other.knockedDown) continue;
      const dist = pos.distanceTo(other.mesh.position);
      if (dist < minPedDist) {
        minPedDist = dist;
        closestPed = other;
      }
    }

    // 3. Resolve priority: whichever is closer triggers prompt
    let prompt = document.getElementById('vehicle-enter-prompt');
    if (closestVehicle && (closestPed === null || minVehDist < minPedDist)) {
      // Vehicle prompt
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
    } else if (closestPed) {
      // Pedestrian Talk prompt
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

      prompt.innerHTML = `💬 Press <span style="color: #00f0ff;">[E]</span> to Talk to ${closestPed.name.toUpperCase()}`;
      prompt.classList.remove('hidden');
    } else {
      // Check if near a baseball bat pickup
      let nearBat = false;
      if (p && !p.hasBaseballBat && this.baseballBats) {
        for (const bat of this.baseballBats) {
          if (bat.pickedUp) continue;
          const dist = p.mesh.position.distanceTo(bat.pos);
          if (dist < 4.0) {
            nearBat = true;
            if (prompt) {
              prompt.innerHTML = '🏏 Walk over to pick up <span style="color: #00ff88;">BASEBALL BAT</span>';
              prompt.classList.remove('hidden');
            }
            break;
          }
        }
      }
      if (!nearBat && prompt) {
        prompt.classList.add('hidden');
      }
    }
  }

  handlePedestrianActionKey() {
    if (!this.controlledPedestrian) return;

    const p = this.controlledPedestrian;
    const pos = p.mesh.position;

    // 1. Scan for closest vehicle
    let closestVehicle = null;
    let minVehDist = 3.5;

    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const v of this.app.trafficSystem.vehicles) {
        const dist = pos.distanceTo(v.mesh.position);
        if (dist < minVehDist) {
          minVehDist = dist;
          closestVehicle = v;
        }
      }
    }

    // 2. Scan for closest other pedestrian
    let closestPed = null;
    let minPedDist = 3.0;

    for (const other of this.pedestrians) {
      if (other === p || other.knockedDown) continue;
      const dist = pos.distanceTo(other.mesh.position);
      if (dist < minPedDist) {
        minPedDist = dist;
        closestPed = other;
      }
    }

    // 3. Trigger action based on priority
    if (closestVehicle && (closestPed === null || minVehDist < minPedDist)) {
      const success = this.app.trafficSystem.toggleUserControl(closestVehicle);
      if (success) {
        closestVehicle.driverPedestrian = p;
        this.releaseControl(p);
        
        if (closestVehicle.vType === 'MOTORBIKE') {
          closestVehicle.mountRider(p);
        } else {
          this.app.sceneManager.scene.remove(p.mesh);
        }
        
        const index = this.pedestrians.indexOf(p);
        if (index > -1) {
          this.pedestrians.splice(index, 1);
        }

        const prompt = document.getElementById('vehicle-enter-prompt');
        if (prompt) prompt.classList.add('hidden');
        
        this.app.sceneManager.startFollowTarget(closestVehicle);
        if (this.app.uiManager) {
          this.app.uiManager.showInspector(closestVehicle);
        }
      }
    } else if (closestPed) {
      const funnyDialogues = [
        "Corporate told me to smile 15% harder today.",
        "Did you see the comets? Excellent for property prices!",
        "Buy the dip! NeoTech stock is basically free!",
        "Property damage is temporary, profit is eternal.",
        "I'm commuting to work. My shift is 48 hours.",
        "I love the smell of comet fuel in the morning.",
        "Please do not step on my briefcase. It has my lunch.",
        "My coffee costs $80. What a steal!",
        "A drone scanned my iris and deducted $5 tax.",
        "Living the dream! (Help me, the AI is watching)",
        "I'm jogger #3829. Enforcing cardiovascular optimization.",
        "Can you move? I have a corporate synergy meeting."
      ];
      
      this.talkingPedestrian = closestPed;
      this.talkingBubbleText = funnyDialogues[Math.floor(Math.random() * funnyDialogues.length)];
      this.talkingBubbleTimer = 3.5;

      if (this.app.audioSystem) {
        this.app.audioSystem.playUIClick();
      }

      let bubble = document.getElementById('pedestrian-speech-bubble');
      if (!bubble) {
        bubble = document.createElement('div');
        bubble.id = 'pedestrian-speech-bubble';
        bubble.className = 'floating-speech-bubble';
        document.body.appendChild(bubble);
      }
      bubble.textContent = this.talkingBubbleText;
      bubble.classList.remove('hidden');
      this.updateSpeechBubblePosition();
    }
  }

  updateSpeechBubblePosition() {
    if (!this.talkingPedestrian || !this.talkingPedestrian.mesh) {
      const bubble = document.getElementById('pedestrian-speech-bubble');
      if (bubble) bubble.classList.add('hidden');
      return;
    }
    
    const camera = this.app.sceneManager.camera;
    if (!camera) return;

    // Ensure camera world matrix is fresh
    camera.updateMatrixWorld();

    const targetPos = new THREE.Vector3();
    this.talkingPedestrian.mesh.getWorldPosition(targetPos);
    targetPos.y += 2.8; // Position above the pedestrian's head

    // Check mathematically if the target is in front of the camera plane
    const toTarget = targetPos.clone().sub(camera.position);
    const camDir = new THREE.Vector3();
    camera.getWorldDirection(camDir);
    const dot = toTarget.dot(camDir);

    const bubble = document.getElementById('pedestrian-speech-bubble');
    if (!bubble) return;

    if (dot <= 0.1) {
      // Behind camera, hide bubble
      bubble.classList.add('hidden');
      return;
    }

    // Project world coordinates onto screen
    targetPos.project(camera);

    // NDC coordinates must be within visible viewport depth limits
    if (targetPos.z > 1.0) {
      bubble.classList.add('hidden');
    } else {
      const x = (targetPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (targetPos.y * -0.5 + 0.5) * window.innerHeight;

      if (isNaN(x) || isNaN(y)) {
        bubble.classList.add('hidden');
        return;
      }

      bubble.style.left = `${x}px`;
      bubble.style.top = `${y}px`;
      bubble.classList.remove('hidden');
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

  cullPedestrian(p) {
    if (!p) return;
    p.userControlled = false;
    if (this.controlledPedestrian === p) {
      this.controlledPedestrian = null;
    }
    if (this.app && this.app.uiManager && (this.app.uiManager.selectedEntity === p || !this.controlledPedestrian)) {
      this.app.uiManager.hideInspector();
    }
    const prompt = document.getElementById('vehicle-enter-prompt');
    if (prompt) prompt.classList.add('hidden');

    if (this.app && this.app.sceneManager) {
      if (this.app.sceneManager.followTarget === p || this.app.sceneManager.activePreset === 'FREE_ORBIT') {
        this.app.sceneManager.breakToFreeOrbit();
      }
    }
    if (p.mesh && p.mesh.parent) {
      p.mesh.parent.remove(p.mesh);
    }
    if (this.app && this.app.inspectorHud) {
      this.app.inspectorHud.unregisterObject(p.mesh);
    }
    const idx = this.pedestrians.indexOf(p);
    if (idx !== -1) {
      this.pedestrians.splice(idx, 1);
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
      if (this.app && this.app.cityBuilder && this.app.cityBuilder.isInWater(pedestrian.mesh.position)) {
        pedestrian.mesh.position.copy(closestNode.pos);
        pedestrian.mesh.position.y = this.getTerrainHeight(closestNode.pos.x, closestNode.pos.z);
      }
    }
  }

  getTerrainHeight(x, z) {
    // 1. Bridges over the rivers (first river X: 110 to 210, second river X: 380 to 420)
    if (x >= 110 && x <= 210) {
      if (Math.abs(z) <= 9.5) {
        return 0.05; // Flush top surface of the suspension bridge deck
      }
    }
    if (x >= 380 && x <= 420) {
      for (const bz of [-100, -50, 0, 50, 100]) {
        if (Math.abs(z - bz) <= 9.5) {
          return 0.05; // Flush top surface of the stone arch bridges
        }
      }
    }

    // 2. River Basin bottoms (-4.0)
    if (x >= 135 && x <= 185) {
      return -4.0;
    }
    if (x >= 380 && x <= 420) {
      return -4.0;
    }

    // 3. Northwest Central Park region
    if (x < -60 && z < -60) return 0.7;

    // 4. Main street blocks (sidewalks)
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

    // 5. Countryside rolling hills (X >= 420)
    if (x >= 420) {
      if (this.app && this.app.cityBuilder) {
        return this.app.cityBuilder.getHillHeight(x, z) + 0.05;
      }
      const factor = Math.min(1.0, (x - 420) / 100);
      const hillHeight = (Math.sin(x * 0.05) * Math.cos(z * 0.04) * 8 + Math.sin(x * 0.02) * 15) * factor;
      return hillHeight + 0.05; // Base offset to align with street
    }

    // 6. Street/Asphalt level
    return 0.05;
  }

  spawnBaseballBats() {
    const batPositions = [
      { x: 12, z: 12 },
      { x: -42, z: 55 },
      { x: 95, z: -38 },
      { x: 55, z: 95 },
      { x: -95, z: 12 },
      { x: 210, z: 55 },
      { x: 265, z: -38 },
      { x: 305, z: 95 },
    ];

    for (const bp of batPositions) {
      const y = this.getTerrainHeight(bp.x, bp.z) + 0.5;
      const group = new THREE.Group();
      group.position.set(bp.x, y, bp.z);

      // Bat model (wooden cylinder)
      const batGeo = new THREE.CylinderGeometry(0.06, 0.03, 1.1, 8);
      const batMat = new THREE.MeshStandardMaterial({
        color: 0xc19a6b, roughness: 0.6, metalness: 0.1,
        emissive: 0x6b4226, emissiveIntensity: 0.15
      });
      const batMesh = new THREE.Mesh(batGeo, batMat);
      batMesh.rotation.z = Math.PI / 2; // Lay horizontally
      batMesh.position.y = 0.15;
      batMesh.castShadow = true;
      group.add(batMesh);

      // Glowing ground halo
      const haloGeo = new THREE.RingGeometry(0.6, 1.2, 32);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = -Math.PI / 2; // Lay flat on ground
      halo.position.y = -0.15;
      group.add(halo);

      // Vertical glow pillar
      const pillarGeo = new THREE.CylinderGeometry(0.15, 0.15, 3.0, 8);
      const pillarMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88, transparent: true, opacity: 0.08
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.y = 1.2;
      group.add(pillar);

      this.app.sceneManager.scene.add(group);

      this.baseballBats.push({
        mesh: group,
        halo: halo,
        pos: new THREE.Vector3(bp.x, y, bp.z),
        pickedUp: false,
        pulseTime: Math.random() * 6.28
      });
    }
  }

  swingBaseballBat() {
    const ped = this.controlledPedestrian;
    if (!ped || !ped.hasBaseballBat) return;
    if (ped.swingTimer > 0) return; // Already swinging

    ped.swingTimer = 0.3;

    // Play whoosh/swing sound
    if (this.app.audioSystem) {
      this.app.audioSystem.playUIClick();
    }

    // Hit detection: use XZ-plane only to avoid Y-offset issues
    const pedPos2D = new THREE.Vector2(ped.mesh.position.x, ped.mesh.position.z);
    const pedFwd3D = new THREE.Vector3(0, 0, 1).applyQuaternion(ped.mesh.quaternion);
    const pedDir2D = new THREE.Vector2(pedFwd3D.x, pedFwd3D.z).normalize();

    let hitSomething = false;

    // Check vehicle hits (range 5m on XZ plane, wide 180-degree cone)
    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const v of this.app.trafficSystem.vehicles) {
        if (v.crashed) continue;
        const vPos2D = new THREE.Vector2(v.mesh.position.x, v.mesh.position.z);
        const dist = pedPos2D.distanceTo(vPos2D);
        if (dist > 5.0) continue;

        const toVeh2D = vPos2D.clone().sub(pedPos2D).normalize();
        const dot = pedDir2D.dot(toVeh2D);
        if (dot < 0.0) continue; // Must be in front hemisphere

        hitSomething = true;

        // Register hit
        v.batHits = (v.batHits || 0) + 1;
        v.info['Damage'] = '🏏 ' + v.batHits + '/3 hits';

        // Visual feedback: flash vehicle body red briefly
        if (v.mesh.children && v.mesh.children.length > 0) {
          const body = v.mesh.children[0];
          if (body && body.material) {
            const origColor = body.material.color.getHex();
            body.material.color.setHex(0xff2200);
            setTimeout(() => { body.material.color.setHex(origColor); }, 150);
          }
        }

        // Show hit count prompt
        const prompt = document.getElementById('vehicle-enter-prompt');
        if (prompt) {
          prompt.innerHTML = `🏏 <span style="color:#ff4500;">HIT!</span> ${v.name} — <span style="color:#ffaa00;">${v.batHits}/3</span> hits`;
          prompt.classList.remove('hidden');
          setTimeout(() => { prompt.classList.add('hidden'); }, 1200);
        }

        if (v.batHits >= 3 && !v.onFire) {
          v.onFire = true;
          v.fireTimer = 5.0;
          v.info['Status'] = '🔥 ON FIRE!';

          // Add fire visual
          const fireGeo = new THREE.SphereGeometry(1.2, 8, 8);
          const fireMat = new THREE.MeshBasicMaterial({
            color: 0xff4500, transparent: true, opacity: 0.7
          });
          const fireMesh = new THREE.Mesh(fireGeo, fireMat);
          fireMesh.position.y = 2.0;
          v.mesh.add(fireMesh);
          v.fireMesh = fireMesh;

          // Dispatch police for destruction
          this.isWanted = true;
          if (this.app.trafficSystem) {
            this.app.trafficSystem.dispatchPolice(ped.mesh.position.clone());
          }
        }
        break; // Only hit one vehicle per swing
      }
    }

    // Check NPC hits (range 3.5m on XZ plane, wide 180-degree cone)
    if (!hitSomething) {
      for (const other of this.pedestrians) {
        if (other === ped || other.knockedDown) continue;
        const oPos2D = new THREE.Vector2(other.mesh.position.x, other.mesh.position.z);
        const dist = pedPos2D.distanceTo(oPos2D);
        if (dist > 3.5) continue;

        const toNpc2D = oPos2D.clone().sub(pedPos2D).normalize();
        const dot = pedDir2D.dot(toNpc2D);
        if (dot < 0.0) continue;

        hitSomething = true;

        // NPC runs away in fear
        other.info['Mood'] = '😱 TERRIFIED';
        other.info['Activity'] = '🏃 Fleeing!';
        other.maxSpeed = 12.0;
        other.targetSpeed = 12.0;
        other.speed = 10.0;

        // Face away from the player and run
        const fleeDir = other.mesh.position.clone().sub(ped.mesh.position);
        fleeDir.y = 0;
        fleeDir.normalize();
        other.mesh.lookAt(
          other.mesh.position.x + fleeDir.x * 10,
          other.mesh.position.y,
          other.mesh.position.z + fleeDir.z * 10
        );

        // Show hit prompt
        const prompt = document.getElementById('vehicle-enter-prompt');
        if (prompt) {
          prompt.innerHTML = `🏏 <span style="color:#ff4500;">HIT!</span> ${other.name} is <span style="color:#ffaa00;">FLEEING!</span>`;
          prompt.classList.remove('hidden');
          setTimeout(() => { prompt.classList.add('hidden'); }, 1500);
        }

        // Dispatch police for assault
        this.isWanted = true;
        if (this.app.trafficSystem) {
          this.app.trafficSystem.dispatchPolice(ped.mesh.position.clone());
        }
        break; // Only hit one NPC per swing
      }
    }

    // Play impact sound if we hit something
    if (hitSomething && this.app.audioSystem) {
      this.app.audioSystem.playExplosion();
    }
  }

  arrestPlayer() {
    if (!this.controlledPedestrian) return;

    // Show arrested overlay
    const overlay = document.getElementById('arrested-overlay');
    if (overlay) overlay.classList.remove('hidden');

    // Play arrest sound
    if (this.app.audioSystem) {
      this.app.audioSystem.playExplosion();
    }

    // Clear wanted state
    this.isWanted = false;

    // Reset police targets
    if (this.app.trafficSystem && this.app.trafficSystem.vehicles) {
      for (const v of this.app.trafficSystem.vehicles) {
        if (v.isPolice) {
          v.emergencyTarget = null;
          v.maxSpeed = 18;
          v.targetSpeed = 18;
        }
      }
    }

    // Remove baseball bat from pedestrian
    const ped = this.controlledPedestrian;
    ped.hasBaseballBat = false;
    if (ped.batMesh) {
      ped.armR.remove(ped.batMesh);
      ped.batMesh = null;
    }

    // Release control of pedestrian
    this.releaseControl(ped);

    // Stop camera follow and reset to orbital view
    this.app.sceneManager.stopFollowTarget();
    if (this.app.uiManager) {
      this.app.uiManager.hideInspector();
    }

    // Hide the overlay after 3 seconds
    setTimeout(() => {
      if (overlay) overlay.classList.add('hidden');
    }, 3000);
  }

  updateWantedHud() {
    let hud = document.getElementById('wanted-hud');
    if (!this.isWanted) {
      if (hud) hud.classList.add('hidden');
      return;
    }

    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'wanted-hud';
      hud.className = 'wanted-hud';
      document.body.appendChild(hud);
    }

    // Calculate how many seconds left to escape
    const escapeProgress = Math.max(0, 8.0 - this.escapeTimer);
    const progressPercent = Math.min(100, (this.escapeTimer / 8.0) * 100);

    hud.innerHTML = `
      <div class="wanted-title">🚨 WANTED 🚨</div>
      <div class="wanted-subtitle">${this.escapeTimer > 0 ? `ESCAPING... (${escapeProgress.toFixed(1)}s)` : 'POLICE PURSUIT!'}</div>
      <div class="wanted-bar-bg">
        <div class="wanted-bar" style="width: ${progressPercent}%"></div>
      </div>
    `;
    hud.classList.remove('hidden');
  }
}

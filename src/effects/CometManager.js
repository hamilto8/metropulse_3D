import * as THREE from 'three';

export class CometManager {
  constructor(app) {
    this.app = app;
    this.scene = app.sceneManager.scene;
    this.comets = [];
    this.spawnTimer = 2.0; // Initial comet spawn delay when entering Fun Mode
  }

  disposeComet(comet) {
    if (!comet || !comet.mesh) return;
    this.scene.remove(comet.mesh);
    comet.mesh.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    });
  }

  spawnComet() {
    // Pick a random target position on the city map
    const targetX = (Math.random() - 0.5) * 170;
    const targetZ = (Math.random() - 0.5) * 170;

    // Check if there is a building near this coordinate to target!
    let targetBuilding = null;
    if (this.app.buildingFactory && this.app.buildingFactory.buildings.length > 0) {
      // 65% chance to explicitly target an intact skyscraper for maximum chaotic destruction!
      if (Math.random() < 0.65) {
        const intactBuildings = this.app.buildingFactory.buildings.filter(b => !b.isDestroyed);
        if (intactBuildings.length > 0) {
          targetBuilding = intactBuildings[Math.floor(Math.random() * intactBuildings.length)];
        }
      }
    }

    const resolvedTargetX = targetBuilding ? targetBuilding.plot.x : targetX;
    const resolvedTargetZ = targetBuilding ? targetBuilding.plot.z : targetZ;
    const resolvedTargetY = targetBuilding
      ? (Number.isFinite(targetBuilding.plot.y) ? targetBuilding.plot.y : (targetBuilding.group?.position?.y || 0))
      : (this.app.cityBuilder?.getHillHeight?.(resolvedTargetX, resolvedTargetZ) || 0);
    const targetPos = new THREE.Vector3(resolvedTargetX, resolvedTargetY, resolvedTargetZ);

    // Spawn high up in the sky with a steep diagonal trajectory
    const spawnPos = new THREE.Vector3(
      targetPos.x - 80 + (Math.random() - 0.5) * 20,
      140 + Math.random() * 30,
      targetPos.z - 60 + (Math.random() - 0.5) * 20
    );

    // Comet Core Mesh
    const geom = new THREE.DodecahedronGeometry(3.5, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3300 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(spawnPos);

    // Glowing aura / tail glow
    const auraGeom = new THREE.SphereGeometry(5.5, 12, 12);
    const auraMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.65
    });
    const aura = new THREE.Mesh(auraGeom, auraMat);
    mesh.add(aura);

    this.scene.add(mesh);

    // Velocity vector towards target
    const speed = 80 + Math.random() * 25;
    const velocity = targetPos.clone().sub(spawnPos).normalize().multiplyScalar(speed);

    // Play incoming whistle / meteor sound if sound enabled
    if (this.app.audioSystem && this.app.audioSystem.isEnabled) {
      this.app.audioSystem.playCometIncoming();
    }

    this.comets.push({
      mesh,
      aura,
      velocity,
      targetPos,
      targetBuilding,
      trailTimer: 0
    });
  }

  update(delta) {
    if (!this.app.funMode) {
      // Clean up any remaining comets if Fun Mode turned off
      while (this.comets.length > 0) {
        const c = this.comets.pop();
        this.disposeComet(c);
      }
      return;
    }

    // Spawn timer
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      this.spawnComet();
      this.spawnTimer = 2.2 + Math.random() * 2.8; // Rain a new comet down every 2-5 seconds!
    }

    // Update active comets
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      
      const moveStep = c.velocity.clone().multiplyScalar(delta);
      c.mesh.position.add(moveStep);
      c.mesh.rotation.x += 12 * delta;
      c.mesh.rotation.y += 15 * delta;

      // Pulse aura
      const scale = 1 + Math.sin(Date.now() * 0.015) * 0.35;
      c.aura.scale.set(scale, scale, scale);

      // Check if comet reached ground or target altitude
      if (c.mesh.position.y <= c.targetPos.y + 4.0 || c.mesh.position.distanceTo(c.targetPos) < 6.0) {
        const impactPos = c.mesh.position.clone();
        impactPos.y = c.targetPos.y + 1.0;

        // 1. Remove comet mesh
        this.comets.splice(i, 1);
        this.disposeComet(c);

        // 2. Giant Impact Mega-Explosion
        if (this.app.explosionManager) {
          this.app.explosionManager.createMegaExplosion(impactPos);
        }

        // 3. Impact Earth-shaking sound & Camera vibration
        if (this.app.audioSystem && this.app.audioSystem.isEnabled) {
          this.app.audioSystem.playCometImpact();
        }
        if (this.app.sceneManager) {
          this.app.sceneManager.earthquakeShake(3.0, 0.9);
        }

        // 4. Check building destruction! Any building within 24 units turns to rubble!
        if (this.app.buildingFactory) {
          for (const b of this.app.buildingFactory.buildings) {
            if (!b.isDestroyed) {
              const dist = new THREE.Vector2(b.plot.x, b.plot.z).distanceTo(new THREE.Vector2(impactPos.x, impactPos.z));
              if (dist < 24.0) {
                // COMET DIRECT IMPACT OR BLAST AREA -> DESTROY BUILDING TO RUBBLE!
                this.app.buildingFactory.destroyBuilding(b);
              }
            }
          }
        }

        // 5. Check nearby vehicles and blast them into chaos!
        if (this.app.trafficSystem) {
          for (const v of this.app.trafficSystem.vehicles) {
            const dist = v.mesh.position.distanceTo(impactPos);
            if (dist < 28.0) {
              v.crashed = true;
              v.speed = 0;
              v.targetSpeed = 0;
              v.crashTimer = 22.0;
              if (v.physicsVehicle && v.physicsVehicle.chassisBody) {
                const body = v.physicsVehicle.chassisBody;
                const blastX = v.mesh.position.x - impactPos.x;
                const blastZ = v.mesh.position.z - impactPos.z;
                const blastLength = Math.hypot(blastX, blastZ) || 1;
                body.velocity.x += (blastX / blastLength) * 14;
                body.velocity.y += 9;
                body.velocity.z += (blastZ / blastLength) * 14;
                body.angularVelocity.x += (Math.random() - 0.5) * 2.5;
                body.angularVelocity.z += (Math.random() - 0.5) * 2.5;
              } else {
                v.mesh.rotation.z = (Math.random() - 0.5) * 1.6;
                v.mesh.rotation.y += Math.random() * Math.PI * 1.5;
              }
            }
          }
          // Dispatch emergency police cruisers to the disaster impact zone!
          this.app.trafficSystem.dispatchPolice(impactPos);
        }

        // Blast waves also affect nearby pedestrians, including the player.
        if (this.app.pedestrianSystem && this.app.pedestrianSystem.pedestrians) {
          for (const pedestrian of this.app.pedestrianSystem.pedestrians) {
            const dist = pedestrian.mesh.position.distanceTo(impactPos);
            if (dist >= 28.0 || pedestrian.knockedDown) continue;
            const knockDir = pedestrian.mesh.position.clone().sub(impactPos);
            knockDir.y = 0.2;
            if (knockDir.lengthSq() === 0) knockDir.set(1, 0.2, 0);
            knockDir.normalize();
            this.app.pedestrianSystem.knockDownPedestrian(pedestrian, knockDir);
          }
        }
      }
    }
  }
}

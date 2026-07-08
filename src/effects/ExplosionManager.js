import * as THREE from 'three';

export class ExplosionManager {
  constructor(scene) {
    this.scene = scene;
    this.explosions = [];
  }

  createExplosion(pos) {
    // 1. Expanding fireball sphere
    const geom = new THREE.SphereGeometry(1.2, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 1.0
    });
    const fireball = new THREE.Mesh(geom, mat);
    fireball.position.copy(pos);
    fireball.position.y += 2.5;
    this.scene.add(fireball);

    // 2. Inner bright yellow flash core
    const coreGeom = new THREE.SphereGeometry(0.7, 12, 12);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 1.0
    });
    const core = new THREE.Mesh(coreGeom, coreMat);
    core.position.copy(pos);
    core.position.y += 2.5;
    this.scene.add(core);

    // 3. Flying sparks/debris
    const sparkCount = 30;
    const sparkGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(sparkCount * 3);
    const velocities = [];

    for (let i = 0; i < sparkCount; i++) {
      positions[i * 3] = pos.x + (Math.random() - 0.5);
      positions[i * 3 + 1] = pos.y + 2 + (Math.random() - 0.5);
      positions[i * 3 + 2] = pos.z + (Math.random() - 0.5);

      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 35,
        Math.random() * 30 + 8,
        (Math.random() - 0.5) * 35
      ));
    }

    sparkGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffbb00,
      size: 1.5,
      transparent: true,
      opacity: 1.0
    });
    const sparks = new THREE.Points(sparkGeom, sparkMat);
    this.scene.add(sparks);

    // 4. Rising dark smoke column
    const smokeGeom = new THREE.SphereGeometry(2.0, 12, 12);
    const smokeMat = new THREE.MeshBasicMaterial({
      color: 0x18181c,
      transparent: true,
      opacity: 0.85
    });
    const smoke = new THREE.Mesh(smokeGeom, smokeMat);
    smoke.position.copy(pos);
    smoke.position.y += 2.5;
    this.scene.add(smoke);

    this.explosions.push({
      fireball,
      core,
      sparks,
      velocities,
      smoke,
      age: 0,
      maxAge: 4.0
    });
  }

  update(delta) {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.age += delta;

      // Fireball and core expand and fade over 0.4s
      if (exp.age < 0.4) {
        const scale = 1 + exp.age * 18;
        const coreScale = 1 + exp.age * 12;
        exp.fireball.scale.set(scale, scale, scale);
        exp.fireball.material.opacity = 1.0 - (exp.age / 0.4);
        exp.core.scale.set(coreScale, coreScale, coreScale);
        exp.core.material.opacity = 1.0 - (exp.age / 0.35);
      } else {
        if (exp.fireball.parent) {
          this.scene.remove(exp.fireball);
          exp.fireball.geometry.dispose();
          exp.fireball.material.dispose();
        }
        if (exp.core.parent) {
          this.scene.remove(exp.core);
          exp.core.geometry.dispose();
          exp.core.material.dispose();
        }
      }

      // Sparks fly outwards with gravity
      if (exp.sparks.parent) {
        const positions = exp.sparks.geometry.attributes.position.array;
        for (let j = 0; j < exp.velocities.length; j++) {
          positions[j * 3] += exp.velocities[j].x * delta;
          positions[j * 3 + 1] += exp.velocities[j].y * delta;
          positions[j * 3 + 2] += exp.velocities[j].z * delta;
          exp.velocities[j].y -= 28 * delta; // Gravity
        }
        exp.sparks.geometry.attributes.position.needsUpdate = true;
        exp.sparks.material.opacity = Math.max(0, 1.0 - (exp.age / 1.5));

        if (exp.age >= 1.5) {
          this.scene.remove(exp.sparks);
          exp.sparks.geometry.dispose();
          exp.sparks.material.dispose();
        }
      }

      // Smoke rises, expands, and slowly dissipates
      if (exp.smoke.parent) {
        const smokeScale = 1 + exp.age * 3.5;
        exp.smoke.scale.set(smokeScale, smokeScale, smokeScale);
        exp.smoke.position.y += 5 * delta;
        exp.smoke.material.opacity = Math.max(0, 0.85 * (1.0 - (exp.age / exp.maxAge)));

        if (exp.age >= exp.maxAge) {
          this.scene.remove(exp.smoke);
          exp.smoke.geometry.dispose();
          exp.smoke.material.dispose();
        }
      }

      if (exp.age >= exp.maxAge) {
        this.explosions.splice(i, 1);
      }
    }
  }
}

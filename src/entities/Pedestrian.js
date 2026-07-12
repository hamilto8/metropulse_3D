import * as THREE from 'three';

export class Pedestrian {
  constructor(type, colorHex, name) {
    this.type = 'PEDESTRIAN';
    this.pType = type;
    this.name = name;
    this.speed = 0;
    this.maxSpeed = type === 'JOGGER' ? 5.5 : (type === 'BUSINESS' ? 3.5 : 2.8);
    this.targetSpeed = this.maxSpeed;
    this.walkTimer = Math.random() * 10;
    this.hasBaseballBat = false;
    this.swingTimer = 0;
    this.batMesh = null;
    this.knockedDown = false;
    this.knockdownTimer = 0;
    this.knockbackVelocity = null;
    this.knockbackSpin = 0;

    this.info = {
      'Name': name,
      'Class': type,
      'Activity': type === 'JOGGER' ? 'Evening Run' : (type === 'BUSINESS' ? 'Commuting to Office' : 'Strolling Downtown'),
      'Mood': 'Energized'
    };

    this.mesh = this.buildModel(type, colorHex);
    this.mesh.userData.entityData = this;
  }

  buildModel(type, colorHex) {
    const group = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdbac, roughness: 0.8 });
    const clothColor = colorHex || 0x3b82f6;
    const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });

    // 1. Torso
    const torsoGeo = new THREE.BoxGeometry(0.7, 1.2, 0.4);
    const torso = new THREE.Mesh(torsoGeo, clothMat);
    torso.position.y = 1.6;
    torso.castShadow = true;
    group.add(torso);

    // 2. Head
    const headGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 2.5;
    group.add(head);

    // Hair or hat
    if (type === 'BUSINESS') {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 0.75), darkMat);
      hair.position.y = 2.75;
      group.add(hair);

      // Briefcase in right hand
      const caseMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18 });
      const briefcase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.5), caseMat);
      briefcase.position.set(-0.6, 1.2, 0);
      group.add(briefcase);
    } else if (type === 'JOGGER') {
      // Headband
      const bandMat = new THREE.MeshBasicMaterial({ color: 0xff007f });
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 8), bandMat);
      band.position.y = 2.6;
      group.add(band);
    }

    // 3. Limbs (Hinged Arms & Legs)
    const armGeo = new THREE.BoxGeometry(0.25, 0.8, 0.25);
    const legGeo = new THREE.BoxGeometry(0.28, 0.9, 0.28);
    legGeo.translate(0, -0.45, 0); // Pivot at top
    armGeo.translate(0, -0.4, 0);

    // Left Arm
    this.armL = new THREE.Mesh(armGeo, clothMat);
    this.armL.position.set(0.5, 2.1, 0);
    group.add(this.armL);

    // Right Arm
    this.armR = new THREE.Mesh(armGeo, clothMat);
    this.armR.position.set(-0.5, 2.1, 0);
    group.add(this.armR);

    // Left Leg
    this.legL = new THREE.Mesh(legGeo, darkMat);
    this.legL.position.set(0.2, 1.0, 0);
    group.add(this.legL);

    // Right Leg
    this.legR = new THREE.Mesh(legGeo, darkMat);
    this.legR.position.set(-0.2, 1.0, 0);
    group.add(this.legR);

    // Scale down slightly for realistic proportions relative to cars
    group.scale.set(0.9, 0.9, 0.9);

    // Build rain behaviors and procedural umbrella attachment
    const r = Math.random();
    if (r < 0.33) {
      this.rainBehavior = 'SHIELD';
    } else if (r < 0.67) {
      this.rainBehavior = 'UMBRELLA';

      const umbrellaGroup = new THREE.Group();

      const shaftGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4);
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = 0.8;
      umbrellaGroup.add(shaft);

      const colors = [0x00f0ff, 0xff007f, 0xffcc00, 0xef4444, 0x10b981, 0x8b5cf6, 0xf97316];
      const canopyColor = colors[Math.floor(Math.random() * colors.length)];
      const canopyGeo = new THREE.ConeGeometry(0.8, 0.35, 8);
      const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.5 });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.y = 1.6;
      umbrellaGroup.add(canopy);

      this.umbrella = umbrellaGroup;
      this.umbrella.position.set(0, -0.8, 0);
      this.umbrella.visible = false;
      this.armL.add(this.umbrella);
    } else {
      this.rainBehavior = 'NORMAL';
    }

    this.highDetailParts = [...group.children];
    this.shadowCasters = [];
    group.traverse(child => {
      if (child.isMesh && child.castShadow) this.shadowCasters.push(child);
    });
    this.lowDetailProxy = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.38, 1.35, 3, 6),
      new THREE.MeshLambertMaterial({ color: clothColor })
    );
    this.lowDetailProxy.position.y = 1.35;
    this.lowDetailProxy.visible = false;
    this.lowDetailProxy.userData.lowDetailProxy = true;
    group.add(this.lowDetailProxy);
    this.detailLevel = 'HIGH';
    return group;
  }

  setDetailLevel(level = 'HIGH') {
    if (!this.lowDetailProxy || this.detailLevel === level) return;
    const low = level === 'LOW';
    for (const part of this.highDetailParts) part.visible = !low;
    this.lowDetailProxy.visible = low;
    for (const mesh of this.shadowCasters) mesh.castShadow = level === 'HIGH';
    this.detailLevel = level;
  }

  update(delta, isRaining = false) {
    const swingFreq = this.speed * 2.8;
    this.walkTimer += delta * Math.max(1.0, swingFreq);
    const swing = Math.sin(this.walkTimer) * 0.65;

    if (this.armL && this.armR && this.legL && this.legR) {
      if (this.speed > 0.1) {
        this.legL.rotation.x = -swing;
        this.legR.rotation.x = swing;
      } else {
        this.legL.rotation.x *= 0.8;
        this.legR.rotation.x *= 0.8;
      }

      if (isRaining) {
        if (this.rainBehavior === 'SHIELD') {
          // Shield head with both hands raised
          this.armL.rotation.x = -2.6;
          this.armL.rotation.z = -0.4;
          this.armR.rotation.x = -2.6;
          this.armR.rotation.z = 0.4;
          if (this.umbrella) this.umbrella.visible = false;
        } else if (this.rainBehavior === 'UMBRELLA') {
          // Hold umbrella with left hand, right arm swings normally
          this.armL.rotation.x = -1.25;
          this.armL.rotation.z = -0.15;
          if (this.umbrella) {
            this.umbrella.visible = true;
            this.umbrella.rotation.x = 1.25;
            this.umbrella.rotation.z = 0.15;
          }

          if (this.speed > 0.1) {
            this.armR.rotation.x = -swing;
            this.armR.rotation.z *= 0.8;
          } else {
            this.armR.rotation.x *= 0.8;
            this.armR.rotation.z *= 0.8;
          }
        } else {
          // NORMAL: walk normally under rain
          if (this.umbrella) this.umbrella.visible = false;
          if (this.speed > 0.1) {
            this.armL.rotation.x = swing;
            this.armL.rotation.z *= 0.8;
            this.armR.rotation.x = -swing;
            this.armR.rotation.z *= 0.8;
          } else {
            this.armL.rotation.x *= 0.8;
            this.armL.rotation.z *= 0.8;
            this.armR.rotation.x *= 0.8;
            this.armR.rotation.z *= 0.8;
          }
        }
      } else {
        // Clear weather: normal walking animations
        if (this.umbrella) this.umbrella.visible = false;
        if (this.speed > 0.1) {
          this.armL.rotation.x = swing;
          this.armL.rotation.z *= 0.8;
          this.armR.rotation.x = -swing;
          this.armR.rotation.z *= 0.8;
        } else {
          this.armL.rotation.x *= 0.8;
          this.armL.rotation.z *= 0.8;
          this.armR.rotation.x *= 0.8;
          this.armR.rotation.z *= 0.8;
        }
      }
      
      // Override right arm animation if they have a baseball bat
      if (this.hasBaseballBat) {
        if (this.swingTimer > 0) {
          this.swingTimer -= delta;
          const progress = Math.max(0, Math.min(1, (0.3 - this.swingTimer) / 0.3));
          // Fast swing from back to front
          this.armR.rotation.x = -1.2 + progress * 2.8;
          this.armR.rotation.z = -0.3 + Math.sin(progress * Math.PI) * 0.5;
        } else {
          // Carry pose
          this.armR.rotation.x = -0.6;
          this.armR.rotation.z = -0.15;
        }
      }
    }
  }

  attachBaseballBat() {
    if (this.batMesh) return;
    const batGeo = new THREE.CylinderGeometry(0.045, 0.02, 0.9, 8);
    const batMat = new THREE.MeshStandardMaterial({ color: 0xc19a6b, roughness: 0.7 });
    this.batMesh = new THREE.Mesh(batGeo, batMat);
    // Position at the hand of the right arm (0, -0.8, 0)
    this.batMesh.position.set(0, -0.75, 0.15);
    this.batMesh.rotation.x = Math.PI / 2.2; // Tilt forward
    this.armR.add(this.batMesh);
  }
}

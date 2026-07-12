import * as THREE from 'three';

export class Pedestrian {
  constructor(type, colorHex, name, options = {}) {
    this.type = 'PEDESTRIAN';
    this.pType = type;
    this.archetype = options.archetype || type;
    this.name = name;
    this.speed = 0;
    this.maxSpeed = Number.isFinite(options.profile?.maxSpeed)
      ? Math.max(0, options.profile.maxSpeed)
      : (type === 'JOGGER' ? 5.5 : (type === 'BUSINESS' ? 3.5 : 2.8));
    this.normalMaxSpeed = this.maxSpeed;
    this.targetSpeed = this.maxSpeed;
    this.appearance = options.appearance || {};
    this.behaviorState = options.behaviorState || null;
    this.walkTimer = Math.random() * 10;
    this.hasBaseballBat = false;
    this.swingTimer = 0;
    this.batMesh = null;
    this.knockedDown = false;
    this.knockdownTimer = 0;
    this.knockdownState = null;
    this.attackTimer = 0;

    this.info = {
      'Name': name,
      'Class': options.profile?.label || type,
      'Activity': options.profile?.activity || (type === 'JOGGER' ? 'Evening Run' : (type === 'BUSINESS' ? 'Commuting to Office' : 'Strolling Downtown')),
      'Mood': options.profile?.mood || 'Energized'
    };
    this.defaultActivity = this.info.Activity;
    this.defaultMood = this.info.Mood;
    this.normalActivity = this.defaultActivity;

    this.mesh = this.buildModel(type, colorHex);
    this.mesh.userData.entityData = this;
  }

  buildModel(type, colorHex) {
    const group = new THREE.Group();

    const skinMat = new THREE.MeshStandardMaterial({ color: this.appearance.skinTone || 0xffdbac, roughness: 0.8 });
    const clothColor = colorHex || 0x3b82f6;
    const clothMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: this.appearance.pantsColor || 0x1a1a1a });
    const hairMat = new THREE.MeshStandardMaterial({ color: this.appearance.hairColor || 0x1a1a1a, roughness: 0.9 });

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

    // Hair and hats are profile-driven so archetype and appearance can evolve independently.
    const hairStyle = this.appearance.hairStyle || (type === 'BUSINESS' ? 'PARTED' : 'SHORT');
    if (['SHORT', 'PARTED', 'BUZZ'].includes(hairStyle)) {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 0.75), darkMat);
      hair.position.y = 2.75;
      hair.material = hairMat;
      group.add(hair);
    } else if (hairStyle === 'CURLY') {
      for (let index = 0; index < 5; index += 1) {
        const curl = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), hairMat);
        curl.position.set((index - 2) * 0.14, 2.72 + (index % 2) * 0.08, 0);
        group.add(curl);
      }
    } else if (hairStyle === 'PONYTAIL') {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8), hairMat);
      hair.scale.set(1, 0.55, 1);
      hair.position.y = 2.73;
      group.add(hair);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.65, 8), hairMat);
      tail.position.set(0, 2.35, -0.25);
      tail.rotation.x = 0.2;
      group.add(tail);
    } else if (hairStyle === 'CAP' || hairStyle === 'BEANIE') {
      const hatColor = hairStyle === 'BEANIE' ? 0x111827 : clothColor;
      const hat = new THREE.Mesh(new THREE.SphereGeometry(0.39, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: hatColor }));
      hat.position.y = 2.64;
      group.add(hat);
    }

    if (this.appearance.accessory === 'BRIEFCASE' || type === 'BUSINESS') {
      // Briefcase in right hand
      const caseMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18 });
      const briefcase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.5), caseMat);
      briefcase.position.set(-0.6, 1.2, 0);
      group.add(briefcase);
    }
    if (this.appearance.accessory === 'HEADBAND' || type === 'JOGGER') {
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

    if (this.appearance.accessory === 'BOOK') {
      const book = new THREE.Group();
      const coverMaterial = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.75 });
      const pageMaterial = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 1 });
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.5), pageMaterial);
      const cover = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.56), coverMaterial);
      cover.position.y = -0.065;
      book.add(pages, cover);
      book.position.set(0, 1.35, 0.48);
      book.rotation.x = -0.32;
      group.add(book);
      this.bookMesh = book;
    }
    if (this.appearance.accessory === 'PHONE') {
      const phone = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.32, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.6, roughness: 0.3 })
      );
      phone.position.set(0, -0.73, 0.12);
      phone.visible = false;
      this.armR.add(phone);
      this.phoneMesh = phone;
    }

    // Scale variation stays within collision-safe proportions relative to cars.
    const heightScale = Number.isFinite(this.appearance.heightScale) ? this.appearance.heightScale : 0.9;
    group.scale.set(0.9, heightScale, 0.9);

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

      const behaviorMode = this.behaviorState?.mode;
      if (this.bookMesh) this.bookMesh.visible = behaviorMode === 'SITTING_READING';
      if (this.phoneMesh) this.phoneMesh.visible = behaviorMode === 'TAKING_PHOTO';
      if (behaviorMode === 'SITTING_READING') {
        this.legL.rotation.x = -1.45;
        this.legR.rotation.x = -1.45;
        this.legL.rotation.z = -0.08;
        this.legR.rotation.z = 0.08;
        this.armL.rotation.x = -1.05;
        this.armR.rotation.x = -1.05;
        this.armL.rotation.z = -0.25;
        this.armR.rotation.z = 0.25;
      } else if (behaviorMode === 'TAKING_PHOTO') {
        this.armL.rotation.x = -1.45;
        this.armR.rotation.x = -1.55;
        this.armL.rotation.z = -0.2;
        this.armR.rotation.z = 0.2;
      }

      if (this.attackTimer > 0) {
        this.attackTimer = Math.max(0, this.attackTimer - delta);
        const attackProgress = 1 - this.attackTimer / 0.35;
        this.armR.rotation.x = -1.5 + Math.sin(Math.min(1, attackProgress) * Math.PI) * 2.4;
        this.armR.rotation.z = -0.35;
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

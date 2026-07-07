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

    return group;
  }

  update(delta) {
    if (this.speed > 0.1) {
      this.walkTimer += delta * (this.speed * 2.8);
      const swing = Math.sin(this.walkTimer) * 0.6;

      if (this.armL && this.armR && this.legL && this.legR) {
        this.armL.rotation.x = swing;
        this.armR.rotation.x = -swing;
        this.legL.rotation.x = -swing;
        this.legR.rotation.x = swing;
      }
    } else {
      // Stand still
      if (this.armL) {
        this.armL.rotation.x *= 0.8;
        this.armR.rotation.x *= 0.8;
        this.legL.rotation.x *= 0.8;
        this.legR.rotation.x *= 0.8;
      }
    }
  }
}

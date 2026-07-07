import * as THREE from 'three';

export class Vehicle {
  constructor(type, colorHex, name) {
    this.type = 'VEHICLE';
    this.vType = type;
    this.name = name;
    this.speed = 0;
    this.maxSpeed = type === 'SPORTS' ? 28 : (type === 'BUS' || type === 'TRUCK' ? 16 : 22);
    this.targetSpeed = this.maxSpeed;
    this.acceleration = 12;
    this.wheels = [];
    this.headlights = [];
    this.taillights = [];
    this.isPolice = (type === 'POLICE');
    this.sirenTimer = 0;
    this.sirenLights = [];

    this.info = {
      'Model': name,
      'Type': type,
      'Speed': '0 km/h',
      'Status': 'Cruising',
      'Battery': `${Math.floor(Math.random() * 30 + 70)}%`
    };

    this.mesh = this.buildModel(type, colorHex);
    // Register reference for InspectorHUD
    this.mesh.userData.entityData = this;
  }

  buildModel(type, colorHex) {
    const group = new THREE.Group();
    const bodyColor = colorHex || 0x3366cc;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.3, metalness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });

    let length = 4.2, width = 2.0, height = 1.4;
    let wheelRadius = 0.4, wheelWidth = 0.3;

    if (type === 'SPORTS') {
      length = 4.4; width = 2.1; height = 1.1;
      wheelRadius = 0.45;
    } else if (type === 'BUS') {
      length = 10.5; width = 2.6; height = 3.2;
      wheelRadius = 0.6;
    } else if (type === 'TRUCK') {
      length = 7.5; width = 2.4; height = 3.0;
      wheelRadius = 0.55;
    }

    // 1. Main Chassis Body
    const chassisGeo = new THREE.BoxGeometry(width, height, length);
    const chassis = new THREE.Mesh(chassisGeo, bodyMat);
    chassis.position.y = wheelRadius + height / 2;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    group.add(chassis);

    // 2. Cabin / Roof / Windows
    if (type === 'SEDAN' || type === 'TAXI' || type === 'POLICE') {
      const cabinGeo = new THREE.BoxGeometry(width - 0.2, height * 0.7, length * 0.55);
      const cabin = new THREE.Mesh(cabinGeo, glassMat);
      cabin.position.set(0, wheelRadius + height + (height * 0.7) / 2 - 0.1, -0.2);
      group.add(cabin);

      if (type === 'TAXI') {
        const signMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.5 });
        const sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.4), signMat);
        sign.position.set(0, wheelRadius + height + height * 0.7 + 0.15, -0.2);
        group.add(sign);
      } else if (type === 'POLICE') {
        // Siren Light Bar
        const barMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.3), barMat);
        bar.position.set(0, wheelRadius + height + height * 0.7 + 0.08, -0.2);
        group.add(bar);

        // Red & Blue Siren Lights
        const redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const blueMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
        const redLight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.25), redMat);
        const blueLight = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.25), blueMat);
        redLight.position.set(-0.35, wheelRadius + height + height * 0.7 + 0.2, -0.2);
        blueLight.position.set(0.35, wheelRadius + height + height * 0.7 + 0.2, -0.2);
        group.add(redLight);
        group.add(blueLight);
        this.sirenLights.push({ mesh: redLight, color: 0xff0000 });
        this.sirenLights.push({ mesh: blueLight, color: 0x0000ff });
      }
    } else if (type === 'SPORTS') {
      const cabinGeo = new THREE.BoxGeometry(width - 0.3, height * 0.6, length * 0.45);
      const cabin = new THREE.Mesh(cabinGeo, glassMat);
      cabin.position.set(0, wheelRadius + height + (height * 0.6) / 2 - 0.1, -0.3);
      group.add(cabin);

      // Spoiler
      const spoilerMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(width - 0.2, 0.15, 0.4), spoilerMat);
      spoiler.position.set(0, wheelRadius + height + 0.3, -length / 2 + 0.3);
      group.add(spoiler);
    } else if (type === 'TRUCK') {
      // Rear Cargo Box
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, height * 1.3, length * 0.65), boxMat);
      box.position.set(0, wheelRadius + (height * 1.3) / 2 + 0.2, -length * 0.15);
      box.castShadow = true;
      group.add(box);
    } else if (type === 'BUS') {
      // Glass sides
      const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(width + 0.05, height * 0.5, length * 0.8), glassMat);
      sideGlass.position.set(0, wheelRadius + height * 0.65, 0);
      group.add(sideGlass);
    }

    // 3. Wheels (4 or 6 wheels)
    const wheelPositions = [
      { x: -width / 2 - wheelWidth / 2 + 0.1, z: length / 2 - 1.0 },
      { x: width / 2 + wheelWidth / 2 - 0.1, z: length / 2 - 1.0 },
      { x: -width / 2 - wheelWidth / 2 + 0.1, z: -length / 2 + 1.0 },
      { x: width / 2 + wheelWidth / 2 - 0.1, z: -length / 2 + 1.0 }
    ];
    if (type === 'BUS') {
      wheelPositions.push({ x: -width / 2 - wheelWidth / 2 + 0.1, z: -length / 2 + 2.5 });
      wheelPositions.push({ x: width / 2 + wheelWidth / 2 - 0.1, z: -length / 2 + 2.5 });
    }

    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
    wheelGeo.rotateZ(Math.PI / 2);

    for (const wPos of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wPos.x, wheelRadius, wPos.z);
      wheel.castShadow = true;
      group.add(wheel);
      this.wheels.push(wheel);
    }

    // 4. Headlights & Taillights
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 });
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0 });

    const hlL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), hlMat);
    const hlR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), hlMat);
    hlL.position.set(-width / 2 + 0.4, wheelRadius + height * 0.5, length / 2);
    hlR.position.set(width / 2 - 0.4, wheelRadius + height * 0.5, length / 2);
    group.add(hlL);
    group.add(hlR);
    this.headlights.push(hlL, hlR);

    const tlL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), tlMat);
    const tlR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.1), tlMat);
    tlL.position.set(-width / 2 + 0.4, wheelRadius + height * 0.5, -length / 2);
    tlR.position.set(width / 2 - 0.4, wheelRadius + height * 0.5, -length / 2);
    group.add(tlL);
    group.add(tlR);
    this.taillights.push(tlL, tlR);

    return group;
  }

  setNightLights(enabled) {
    const intensity = enabled ? 2.5 : 0;
    for (const hl of this.headlights) {
      hl.material.emissiveIntensity = intensity;
    }
    for (const tl of this.taillights) {
      tl.material.emissiveIntensity = enabled ? 1.5 : 0;
    }
  }

  update(delta) {
    // 1. Wheel rotation
    const wheelRotSpeed = (this.speed / 0.4) * delta;
    for (const wheel of this.wheels) {
      wheel.rotation.x += wheelRotSpeed;
    }

    // 2. Police Siren flashing animation
    if (this.isPolice && this.sirenLights.length === 2) {
      this.sirenTimer += delta * 8; // Flash speed
      const isRed = Math.floor(this.sirenTimer) % 2 === 0;
      this.sirenLights[0].mesh.material.color.setHex(isRed ? 0xff0000 : 0x220000);
      this.sirenLights[1].mesh.material.color.setHex(isRed ? 0x000022 : 0x0000ff);
    }

    // 3. Update info data
    this.info['Speed'] = `${Math.round(this.speed * 1.8)} km/h`;
    this.info['Status'] = this.speed < 1.0 ? 'Stopped (Traffic/Light)' : 'Cruising';
  }
}

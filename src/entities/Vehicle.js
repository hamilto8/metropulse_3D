import * as THREE from 'three';

export class Vehicle {
  constructor(type, colorHex, name) {
    this.type = 'VEHICLE';
    this.vType = type;
    this.name = name;
    this.speed = 0;
    this.maxSpeed = (type === 'SPORTS' || type === 'SPORTS_CAR') ? 32 : (type === 'MOTORBIKE' ? 28 : (type === 'BUS' || type === 'TRUCK' || type === 'DUMP_TRUCK' ? 15 : (type === 'AMBULANCE' ? 24 : 20)));
    this.targetSpeed = this.maxSpeed;
    this.acceleration = (type === 'SPORTS' || type === 'SPORTS_CAR') ? 18 : (type === 'MOTORBIKE' ? 16 : 12);
    this.wheels = [];
    this.headlights = [];
    this.taillights = [];
    this.mountedRider = null;
    this.isPolice = (type === 'POLICE');
    this.sirenTimer = 0;
    this.sirenFlashPhase = 0;
    this.sirenLights = [];
    this.sirenActive = false;
    this.wheelRadius = 0.4;
    this.onFire = false;
    this.fireTimer = 0;
    this.fireMesh = null;
    this.isDestroyed = false;
    this.destroyedTimer = 0;
    this.chainReactionTriggered = false;

    this.info = {
      'Model': name,
      'Type': type,
      'Speed': '0 km/h',
      'Status': 'Cruising',
      'Battery': `${Math.floor(Math.random() * 30 + 70)}%`
    };

    this.mesh = this.buildModel(type, colorHex);
    this.mesh.rotation.order = 'YXZ';
    // Register reference for InspectorHUD
    this.mesh.userData.entityData = this;
  }

  addLowDetailProxy(group, { width, height, length, colorHex, centerY }) {
    this.highDetailParts = [...group.children];
    this.shadowCasters = [];
    group.traverse(child => {
      if (child.isMesh && child.castShadow) this.shadowCasters.push(child);
    });

    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(width, Math.max(0.55, height), length),
      new THREE.MeshLambertMaterial({ color: colorHex || 0x3366cc })
    );
    proxy.position.y = centerY;
    proxy.visible = false;
    proxy.castShadow = false;
    proxy.userData.lowDetailProxy = true;
    group.add(proxy);
    this.lowDetailProxy = proxy;
    this.detailLevel = 'HIGH';
    return group;
  }

  setDetailLevel(level = 'HIGH') {
    if (!this.lowDetailProxy) return;
    const low = level === 'LOW';
    if (this.detailLevel !== level) {
      for (const part of this.highDetailParts) part.visible = !low;
      this.lowDetailProxy.visible = low;
      for (const mesh of this.shadowCasters) mesh.castShadow = level === 'HIGH';
    }
    if (this.mountedRider?.mesh) this.mountedRider.mesh.visible = !low;
    if (this.riderLowDetailProxy) {
      this.riderLowDetailProxy.visible = low && Boolean(this.mountedRider);
    }
    this.detailLevel = level;
  }

  mountRider(pedestrian) {
    if (!pedestrian || !pedestrian.mesh) return;
    this.mountedRider = pedestrian;
    // Position rider seated atop motorbike saddle
    pedestrian.mesh.position.set(0, 0.68, -0.12);
    pedestrian.mesh.rotation.set(0, 0, 0);

    // Pose pedestrian limbs astride the bike holding handlebars
    if (pedestrian.legL && pedestrian.legR) {
      pedestrian.legL.rotation.set(-0.85, 0, 0.28);
      pedestrian.legR.rotation.set(-0.85, 0, -0.28);
    }
    if (pedestrian.armL && pedestrian.armR) {
      pedestrian.armL.rotation.set(0.95, 0, -0.18);
      pedestrian.armR.rotation.set(0.95, 0, 0.18);
    }
    pedestrian.info['Activity'] = '🏍️ Riding Motorbike';
    this.mesh.add(pedestrian.mesh);
    pedestrian.mesh.visible = this.detailLevel !== 'LOW';
    if (this.riderLowDetailProxy) {
      this.riderLowDetailProxy.visible = this.detailLevel === 'LOW';
    }
  }

  unmountRider() {
    const ped = this.mountedRider;
    if (!ped || !ped.mesh) return null;
    this.mesh.remove(ped.mesh);
    this.mountedRider = null;
    if (this.riderLowDetailProxy) this.riderLowDetailProxy.visible = false;
    // Reset limb rotations
    if (ped.legL && ped.legR) {
      ped.legL.rotation.set(0, 0, 0);
      ped.legR.rotation.set(0, 0, 0);
    }
    if (ped.armL && ped.armR) {
      ped.armL.rotation.set(0, 0, 0);
      ped.armR.rotation.set(0, 0, 0);
    }
    return ped;
  }

  buildMotorbikeModel(colorHex) {
    const group = new THREE.Group();
    const bodyColor = colorHex || 0xea580c;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.3, metalness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.8 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.1, metalness: 0.95 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.9 });

    const length = 2.2, width = 0.65, height = 1.0;
    const wheelRadius = 0.35, wheelWidth = 0.16;
    this.wheelRadius = wheelRadius;

    // Main engine & lower chassis frame
    const engineBlock = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.65), darkMat);
    engineBlock.position.set(0, wheelRadius + 0.3, 0);
    engineBlock.castShadow = true;
    group.add(engineBlock);

    // Sculpted fuel tank
    const fuelTank = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.28, 0.55), bodyMat);
    fuelTank.position.set(0, wheelRadius + 0.55, 0.18);
    fuelTank.castShadow = true;
    group.add(fuelTank);

    // Leather saddle seat
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.6), seatMat);
    saddle.position.set(0, wheelRadius + 0.5, -0.32);
    group.add(saddle);

    // Tail fairing
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.35), bodyMat);
    tail.position.set(0, wheelRadius + 0.54, -0.68);
    group.add(tail);

    // Front fork & handlebars
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.85), chromeMat);
    fork.position.set(0, wheelRadius + 0.48, 0.62);
    fork.rotation.x = -0.28;
    group.add(fork);

    const handlebars = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.06), chromeMat);
    handlebars.position.set(0, wheelRadius + 0.8, 0.52);
    group.add(handlebars);

    // Exhaust pipe
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.85), chromeMat);
    exhaust.rotation.x = Math.PI / 2 - 0.15;
    exhaust.position.set(0.24, wheelRadius + 0.15, -0.3);
    group.add(exhaust);

    // Front & Rear Wheels
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
    wheelGeo.rotateZ(Math.PI / 2);

    const frontWheel = new THREE.Mesh(wheelGeo, wheelMat);
    frontWheel.position.set(0, wheelRadius, 0.78);
    frontWheel.receiveShadow = false;
    group.add(frontWheel);
    this.wheels.push(frontWheel);

    const rearWheel = new THREE.Mesh(wheelGeo, wheelMat);
    rearWheel.position.set(0, wheelRadius, -0.78);
    rearWheel.receiveShadow = false;
    group.add(rearWheel);
    this.wheels.push(rearWheel);

    // Headlight & Taillight
    const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 });
    const tlMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0 });

    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.12), hlMat);
    headlight.position.set(0, wheelRadius + 0.65, 0.75);
    group.add(headlight);
    this.headlights.push(headlight);

    const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.1), tlMat);
    taillight.position.set(0, wheelRadius + 0.54, -0.86);
    group.add(taillight);
    this.taillights.push(taillight);

    const model = this.addLowDetailProxy(group, {
      width,
      height: 0.8,
      length,
      colorHex: bodyColor,
      centerY: wheelRadius + 0.35
    });
    // Preserve the rider silhouette when distant motorbikes use their cheap
    // vehicle proxy. Without this companion proxy, LOD made occupied bikes
    // appear driverless even though the rider lifecycle was intact.
    const riderProxy = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.25, 0.72, 2, 5),
      new THREE.MeshLambertMaterial({ color: 0x29436f })
    );
    riderProxy.position.set(0, 1.28, -0.12);
    riderProxy.rotation.x = -0.18;
    riderProxy.visible = false;
    riderProxy.castShadow = false;
    riderProxy.userData.lowDetailRiderProxy = true;
    group.add(riderProxy);
    this.riderLowDetailProxy = riderProxy;
    return model;
  }

  buildModel(type, colorHex) {
    if (type === 'MOTORBIKE') {
      return this.buildMotorbikeModel(colorHex);
    }
    const group = new THREE.Group();
    const bodyColor = colorHex || 0x3366cc;
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.3, metalness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });

    let length = 4.2, width = 2.0, height = 1.4;
    let wheelRadius = 0.4, wheelWidth = 0.3;

    if (type === 'SPORTS' || type === 'SPORTS_CAR') {
      length = 4.4; width = 2.1; height = 1.05;
      wheelRadius = 0.45;
    } else if (type === 'BUS') {
      length = 10.5; width = 2.6; height = 3.2;
      wheelRadius = 0.6;
    } else if (type === 'TRUCK') {
      length = 7.5; width = 2.4; height = 3.0;
      wheelRadius = 0.55;
    } else if (type === 'AMBULANCE') {
      length = 6.2; width = 2.3; height = 2.4;
      wheelRadius = 0.5;
    } else if (type === 'ICECREAM') {
      length = 5.8; width = 2.2; height = 2.3;
      wheelRadius = 0.48;
    } else if (type === 'DUMP_TRUCK') {
      length = 7.8; width = 2.5; height = 2.9;
      wheelRadius = 0.6;
    }
    this.wheelRadius = wheelRadius;

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
        const barMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.3), barMat);
        bar.position.set(0, wheelRadius + height + height * 0.7 + 0.08, -0.2);
        group.add(bar);

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
    } else if (type === 'SPORTS' || type === 'SPORTS_CAR') {
      const cabinGeo = new THREE.BoxGeometry(width - 0.3, height * 0.6, length * 0.45);
      const cabin = new THREE.Mesh(cabinGeo, glassMat);
      cabin.position.set(0, wheelRadius + height + (height * 0.6) / 2 - 0.1, -0.3);
      group.add(cabin);

      const spoilerMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8 });
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(width - 0.15, 0.15, 0.4), spoilerMat);
      spoiler.position.set(0, wheelRadius + height + 0.3, -length / 2 + 0.3);
      group.add(spoiler);
    } else if (type === 'AMBULANCE') {
      // High rear medical rescue box module
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xfdfdfd, roughness: 0.3 });
      const rescueBox = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, height * 1.1, length * 0.62), boxMat);
      rescueBox.position.set(0, wheelRadius + (height * 1.1) / 2 + 0.2, -length * 0.14);
      rescueBox.castShadow = true;
      group.add(rescueBox);

      // EMS Red Stripe
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe60026, roughness: 0.3 });
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(width + 0.14, 0.35, length * 0.62), stripeMat);
      stripe.position.set(0, wheelRadius + height * 0.7, -length * 0.14);
      group.add(stripe);

      // EMS Lightbar & Dual emergency strobes
      const barMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.16, 0.35), barMat);
      bar.position.set(0, wheelRadius + height * 1.1 + 0.28, 0.5);
      group.add(bar);

      const redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const redLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.28), redMat);
      const whiteLight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.28), whiteMat);
      redLight.position.set(-0.4, wheelRadius + height * 1.1 + 0.4, 0.5);
      whiteLight.position.set(0.4, wheelRadius + height * 1.1 + 0.4, 0.5);
      group.add(redLight);
      group.add(whiteLight);
      this.sirenLights.push({ mesh: redLight, color: 0xff0000 });
      this.sirenLights.push({ mesh: whiteLight, color: 0xffffff });
    } else if (type === 'ICECREAM') {
      // Pastel serving box
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xfff0f5, roughness: 0.4 });
      const servingBox = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, height * 1.05, length * 0.62), boxMat);
      servingBox.position.set(0, wheelRadius + (height * 1.05) / 2 + 0.15, -length * 0.14);
      group.add(servingBox);

      // Serving window
      const windowMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.2 });
      const servWindow = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, 0.7, 1.4), windowMat);
      servWindow.position.set(0, wheelRadius + height * 0.75, -length * 0.1);
      group.add(servWindow);

      // 3D Soft-serve ice cream cone roof topper
      const coneGroup = new THREE.Group();
      const coneGeo = new THREE.ConeGeometry(0.3, 0.7, 16);
      const coneMat = new THREE.MeshStandardMaterial({ color: 0xd4a373, roughness: 0.7 });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.x = Math.PI;
      cone.position.y = 0.35;
      coneGroup.add(cone);

      const scoopGeo = new THREE.SphereGeometry(0.32, 16, 16);
      const scoopMat = new THREE.MeshStandardMaterial({ color: 0xff88a5, roughness: 0.3 });
      const scoop = new THREE.Mesh(scoopGeo, scoopMat);
      scoop.position.y = 0.75;
      coneGroup.add(scoop);

      coneGroup.position.set(0, wheelRadius + height * 1.05 + 0.15, -0.4);
      group.add(coneGroup);
    } else if (type === 'DUMP_TRUCK') {
      // Construction yellow/orange dumper box
      const dumpMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.5, metalness: 0.4 });
      const dumpBox = new THREE.Mesh(new THREE.BoxGeometry(width + 0.25, height * 1.15, length * 0.58), dumpMat);
      dumpBox.position.set(0, wheelRadius + (height * 1.15) / 2 + 0.3, -length * 0.18);
      dumpBox.castShadow = true;
      group.add(dumpBox);
    } else if (type === 'TRUCK') {
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(width + 0.2, height * 1.3, length * 0.65), boxMat);
      box.position.set(0, wheelRadius + (height * 1.3) / 2 + 0.2, -length * 0.15);
      box.castShadow = true;
      group.add(box);
    } else if (type === 'BUS') {
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
    if (type === 'BUS' || type === 'DUMP_TRUCK') {
      wheelPositions.push({ x: -width / 2 - wheelWidth / 2 + 0.1, z: -length / 2 + 2.5 });
      wheelPositions.push({ x: width / 2 + wheelWidth / 2 - 0.1, z: -length / 2 + 2.5 });
    }

    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
    wheelGeo.rotateZ(Math.PI / 2);

    for (const wPos of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wPos.x, wheelRadius, wPos.z);
      wheel.receiveShadow = false;
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

    return this.addLowDetailProxy(group, {
      width,
      height,
      length,
      colorHex: bodyColor,
      centerY: wheelRadius + height / 2
    });
  }

  setNightLights(enabled) {
    const factor = typeof enabled === 'number'
      ? THREE.MathUtils.clamp(enabled, 0, 1)
      : (enabled ? 1 : 0);
    const intensity = 1.2 * factor;
    for (const hl of this.headlights) {
      hl.material.emissiveIntensity = intensity;
    }
    for (const tl of this.taillights) {
      tl.material.emissiveIntensity = 0.78 * factor;
    }
  }

  toggleAmbulanceSiren(audioSystem) {
    if (this.vType !== 'AMBULANCE' && !this.isPolice) return false;
    this.sirenActive = !this.sirenActive;

    if (audioSystem) {
      if (this.vType === 'AMBULANCE') {
        if (this.sirenActive) {
          audioSystem.startAmbulanceSiren(this);
        } else {
          audioSystem.stopAmbulanceSiren(this);
        }
      } else if (this.sirenActive) {
        // Police audio is spatialized by TrafficSystem for AI vehicles. A
        // controlled cruiser gets immediate audible feedback on activation.
        audioSystem.playSiren(1.5);
      }
    }

    return this.sirenActive;
  }

  update(delta) {
    // 1. Wheel rotation
    const speedMs = Number.isFinite(this.speed) ? this.speed : 0;
    const wheelRotSpeed = (speedMs / Math.max(0.1, this.wheelRadius)) * delta;
    for (const wheel of this.wheels) {
      wheel.rotation.x += wheelRotSpeed;
    }

    // 2. Emergency Siren strobe light flashing animation
    if (this.sirenLights.length >= 2) {
      const shouldFlash = this.sirenActive || (this.isPolice && (this.emergencyTarget != null || this.sirenTimer > 0));
      if (shouldFlash) {
        this.sirenFlashPhase += delta * 9;
        const isOdd = Math.floor(this.sirenFlashPhase) % 2 === 0;
        this.sirenLights[0].mesh.material.color.setHex(isOdd ? this.sirenLights[0].color : 0x1a0000);
        this.sirenLights[1].mesh.material.color.setHex(isOdd ? 0x111111 : this.sirenLights[1].color);
      } else {
        this.sirenLights[0].mesh.material.color.setHex(0x220000);
        this.sirenLights[1].mesh.material.color.setHex(0x111111);
      }
    }

    // 3. Update info data
    if (this.physicsVehicle) {
      this.info['Speed'] = `${this.physicsVehicle.speedKmH} km/h (Gear ${this.physicsVehicle.gear})`;
    } else {
      this.info['Speed'] = `${Math.round(Math.abs(speedMs) * 3.6)} km/h`;
    }

    if (this.onFire) {
      this.info['Status'] = '🔥 ON FIRE!';
    } else if (this.crashed) {
      if (this.info['Status'] !== '💥 DESTROYED') {
        this.info['Status'] = '💥 CRASHED';
      }
    } else if (this.userControlled) {
      this.info['Status'] = '🎮 USER CONTROLLED';
    } else if (this.isParked) {
      this.info['Status'] = '🅿️ Parked';
    } else if (this.emergencyTarget) {
      this.info['Status'] = '🚨 EMERGENCY RESPONSE';
    } else {
      this.info['Status'] = Math.abs(speedMs) < 1.0 ? 'Stopped (Traffic/Light)' : 'Cruising';
    }
  }
}

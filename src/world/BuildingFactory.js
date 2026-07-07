import * as THREE from 'three';

export class BuildingFactory {
  constructor(scene, billboardCanvas, inspectorHud) {
    this.scene = scene;
    this.billboardCanvas = billboardCanvas;
    this.inspectorHud = inspectorHud;
    this.nightLights = []; // Store references to emissive window materials & neon signs
  }

  buildAll(plots) {
    const businessTypes = [
      'NEOTECH',
      'CYBERCAFE',
      'APEX_BANK',
      'STARLIGHT_HOTEL',
      'BOBA_HAVEN',
      'GALAXY_CINEMA',
      'MART_247',
      'METRO_TOWER'
    ];

    let bIdx = 0;
    for (const plot of plots) {
      const bType = businessTypes[bIdx] || 'OFFICE';
      this.createBuilding(plot, bType);
      bIdx++;
    }
  }

  createBuilding(plot, type) {
    const group = new THREE.Group();
    group.position.set(plot.x, 0, plot.z);

    const w = plot.width - 4;
    const d = plot.depth - 4;

    let height = 30;
    let color = 0x223344;
    let name = 'Modern Office Building';
    let employees = Math.floor(Math.random() * 500 + 100);
    let status = 'Open';
    let specialty = 'Commercial Office Space';

    if (type === 'NEOTECH') {
      height = 75;
      color = 0x0a192f;
      name = 'NeoTech HQ';
      employees = 1420;
      specialty = 'Quantum AI & Robotics';
      this.addSkyscraperDetails(group, w, height, d, color, 0x00f0ff);
      
      const adMesh = this.billboardCanvas.createAdBillboard('NEOTECH', 20, 10);
      adMesh.position.set(0, height - 15, d / 2 + 0.6);
      group.add(adMesh);
    } else if (type === 'CYBERCAFE') {
      height = 25;
      color = 0x1f102f;
      name = 'CyberCafe 24/7';
      employees = 24;
      specialty = 'Espresso & High-Speed Net';
      this.addShopDetails(group, w, height, d, color, 0xff007f, '☕ CYBER CAFE');

      const adMesh = this.billboardCanvas.createAdBillboard('CYBERCAFE', 16, 8);
      adMesh.position.set(0, height + 5, 0);
      group.add(adMesh);
    } else if (type === 'APEX_BANK') {
      height = 55;
      color = 0x2d3748;
      name = 'Apex Bank Central';
      employees = 650;
      specialty = 'Global Financial Vault';
      this.addSkyscraperDetails(group, w, height, d, color, 0xffb800);
    } else if (type === 'STARLIGHT_HOTEL') {
      height = 65;
      color = 0x2a1b3d;
      name = 'Starlight Hotel & Suites';
      employees = 310;
      specialty = '5-Star Luxury Hospitality';
      this.addSkyscraperDetails(group, w, height, d, color, 0xff00a0);
    } else if (type === 'BOBA_HAVEN') {
      height = 20;
      color = 0x311b3f;
      name = 'Boba Haven Lounge';
      employees = 18;
      specialty = 'Taro & Matcha Milk Tea';
      this.addShopDetails(group, w, height, d, color, 0x00ff88, '🧋 BOBA HAVEN');
    } else if (type === 'GALAXY_CINEMA') {
      height = 35;
      color = 0x1a0f2e;
      name = 'Galaxy Cinema Complex';
      employees = 85;
      specialty = 'Inmerse-3D Hologram Movies';
      this.addShopDetails(group, w, height, d, color, 0xffb800, '🎬 GALAXY CINEMA');

      const adMesh = this.billboardCanvas.createAdBillboard('CINEMA', 22, 12);
      adMesh.position.set(0, height - 8, d / 2 + 0.6);
      group.add(adMesh);
    } else if (type === 'MART_247') {
      height = 18;
      color = 0x1a2e26;
      name = '24/7 Convenience Mart';
      employees = 12;
      specialty = 'Snacks, Electronics & Essentials';
      this.addShopDetails(group, w, height, d, color, 0x00f0ff, '🏪 24/7 MART');
    } else if (type === 'METRO_TOWER') {
      height = 95;
      color = 0x111827;
      name = 'Metro Pulse Spire';
      employees = 2100;
      specialty = 'City Communications & Broadcast';
      this.addSkyscraperDetails(group, w, height, d, color, 0xff0000);

      const tickerMesh = this.billboardCanvas.createClockTickerBillboard(26, 10);
      tickerMesh.position.set(0, 30, d / 2 + 0.6);
      group.add(tickerMesh);
    } else {
      height = Math.floor(Math.random() * 40 + 30);
      name = `Office Block #${Math.floor(Math.random() * 90 + 10)}`;
      this.addSkyscraperDetails(group, w, height, d, color, 0x00f0ff);
    }

    const baseBox = new THREE.Mesh(
      new THREE.BoxGeometry(w, height, d),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.5, metalness: 0.5 })
    );
    baseBox.position.y = height / 2;
    baseBox.castShadow = true;
    baseBox.receiveShadow = true;
    group.add(baseBox);

    this.inspectorHud.registerObject(baseBox, {
      type: 'BUILDING',
      name: name,
      info: {
        'Floors': Math.floor(height / 3.5),
        'Employees': employees,
        'Specialty': specialty,
        'Status': status
      }
    });

    this.scene.add(group);
  }

  addSkyscraperDetails(group, w, height, d, baseColor, accentColorHex) {
    // 1. Accent ribs / corners
    const ribMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      emissive: accentColorHex,
      emissiveIntensity: 0 // Turned on at dusk
    });
    this.nightLights.push({ mat: ribMat, maxIntensity: 0.8 });

    const ribGeo = new THREE.BoxGeometry(1.5, height, 1.5);
    const corners = [
      [-w / 2, -d / 2], [w / 2, -d / 2],
      [-w / 2, d / 2], [w / 2, d / 2]
    ];
    for (const [cx, cz] of corners) {
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.position.set(cx, height / 2, cz);
      group.add(rib);
    }

    // 2. Window Grids (Optimized with InstancedMesh to save ~3,000 draw calls!)
    const winMat = new THREE.MeshStandardMaterial({
      color: 0xffffd0,
      emissive: 0xffe080,
      emissiveIntensity: 0,
      roughness: 0.2
    });
    this.nightLights.push({ mat: winMat, maxIntensity: 0.9 });

    const rows = Math.floor(height / 4);
    const cols = Math.floor(w / 4);
    const maxWins = (rows - 1) * cols * 2;
    
    if (maxWins > 0) {
      const winGeo = new THREE.PlaneGeometry(2, 2);
      const winInstanced = new THREE.InstancedMesh(winGeo, winMat, maxWins);
      let winIdx = 0;
      const dummy = new THREE.Object3D();

      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.3) {
            const wx = -w / 2 + 3 + c * 4;
            const wy = r * 4;

            // Front window
            dummy.position.set(wx, wy, d / 2 + 0.1);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            winInstanced.setMatrixAt(winIdx++, dummy.matrix);

            // Back window
            dummy.position.set(wx, wy, -d / 2 - 0.1);
            dummy.rotation.set(0, Math.PI, 0);
            dummy.updateMatrix();
            winInstanced.setMatrixAt(winIdx++, dummy.matrix);
          }
        }
      }
      winInstanced.count = winIdx;
      group.add(winInstanced);
    }

    // 3. Rooftop antenna or spire
    if (height > 60) {
      const spireGeo = new THREE.CylinderGeometry(0.2, 0.8, 15, 8);
      const spireMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8 });
      const spire = new THREE.Mesh(spireGeo, spireMat);
      spire.position.set(0, height + 7.5, 0);
      group.add(spire);

      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), beaconMat);
      beacon.position.set(0, height + 15.5, 0);
      group.add(beacon);
    }
  }

  addShopDetails(group, w, height, d, baseColor, neonColorHex, signText) {
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 1, 4), canopyMat);
    canopy.position.set(0, 5, d / 2 + 2);
    group.add(canopy);

    const neonMat = new THREE.MeshStandardMaterial({
      color: neonColorHex,
      emissive: neonColorHex,
      emissiveIntensity: 0
    });
    this.nightLights.push({ mat: neonMat, maxIntensity: 1.5 });

    const neonBar = new THREE.Mesh(new THREE.BoxGeometry(w - 4, 1.8, 0.6), neonMat);
    neonBar.position.set(0, 6.2, d / 2 + 0.5);
    group.add(neonBar);

    const storeWinMat = new THREE.MeshStandardMaterial({
      color: 0xffeedd,
      emissive: 0xffeedd,
      emissiveIntensity: 0
    });
    this.nightLights.push({ mat: storeWinMat, maxIntensity: 0.8 });

    const storeWin = new THREE.Mesh(new THREE.PlaneGeometry(w - 6, 3.5), storeWinMat);
    storeWin.position.set(0, 2.5, d / 2 + 0.1);
    group.add(storeWin);
  }
}

import * as THREE from 'three';

export class BuildingFactory {
  constructor(scene, billboardCanvas, inspectorHud) {
    this.scene = scene;
    this.billboardCanvas = billboardCanvas;
    this.inspectorHud = inspectorHud;
    this.nightLights = []; // Store references to emissive window materials & neon signs
    this.buildings = []; // Store building metadata and meshes for destruction in Fun Mode
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
      'METRO_TOWER',
      'ORBITAL_SYSTEMS',
      'QUANTUM_DYNAMIC',
      'VALKYRIE_MOTORS',
      'SYNTH_LABS',
      'NEXUS_PLAZA',
      'CHRONO_BANK',
      'AETHER_TOWER',
      'SOLARIS_HOTEL',
      'CYBER_DYNAMICS',
      'HYPERION_SPA',
      'TITAN_INDUSTRIES',
      'OMNI_CORP',
      'VORTEX_ENERGY',
      'SILICON_SPIRE',
      'ZENITH_TOWER'
    ];

    let bIdx = 0;
    for (const plot of plots) {
      const bType = businessTypes[bIdx % businessTypes.length] || 'OFFICE';
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
      color = 0x3b4d68;
      name = 'NeoTech HQ';
      employees = 1420;
      specialty = 'Quantum AI & Robotics';
      this.addSkyscraperDetails(group, w, height, d, color, 0x00f0ff);
      
      const adMesh = this.billboardCanvas.createAdBillboard('NEOTECH', 20, 10);
      adMesh.position.set(0, height - 15, d / 2 + 0.6);
      group.add(adMesh);
    } else if (type === 'CYBERCAFE') {
      height = 25;
      color = 0x5a3e73;
      name = 'CyberCafe 24/7';
      employees = 35;
      specialty = 'High-Speed Quantum Gaming & Coffee';
      this.addShopDetails(group, w, height, d, color, 0xff00ff, '☕ CYBERCAFE');
    } else if (type === 'APEX_BANK') {
      height = 85;
      color = 0x475569;
      name = 'Apex Financial Tower';
      employees = 980;
      specialty = 'Decentralized Crypto Banking';
      this.addSkyscraperDetails(group, w, height, d, color, 0xffaa00);
    } else if (type === 'STARLIGHT_HOTEL') {
      height = 65;
      color = 0x6b4c7a;
      name = 'Starlight Grand Resort';
      employees = 420;
      specialty = 'Luxury Skyline Suites';
      this.addSkyscraperDetails(group, w, height, d, color, 0xbf55ec);
    } else if (type === 'BOBA_HAVEN') {
      height = 20;
      color = 0x7a4358;
      name = 'Boba Haven Tea Bar';
      employees = 18;
      specialty = 'Synthetic Fruit Infusions';
      this.addShopDetails(group, w, height, d, color, 0xff66bb, '🧋 BOBA HAVEN');
    } else if (type === 'GALAXY_CINEMA') {
      height = 35;
      color = 0x4f3f6e;
      name = 'Galaxy Cinema Complex';
      employees = 85;
      specialty = 'Inmerse-3D Hologram Movies';
      this.addShopDetails(group, w, height, d, color, 0xffb800, '🎬 GALAXY CINEMA');

      const adMesh = this.billboardCanvas.createAdBillboard('CINEMA', 22, 12);
      adMesh.position.set(0, height - 8, d / 2 + 0.6);
      group.add(adMesh);
    } else if (type === 'MART_247') {
      height = 18;
      color = 0x3d5a4d;
      name = '24/7 Convenience Mart';
      employees = 12;
      specialty = 'Snacks, Electronics & Essentials';
      this.addShopDetails(group, w, height, d, color, 0x00f0ff, '🏪 24/7 MART');
    } else if (type === 'METRO_TOWER') {
      height = 95;
      color = 0x485265;
      name = 'Metro Pulse Spire';
      employees = 2100;
      specialty = 'City Communications & Broadcast';
      this.addSkyscraperDetails(group, w, height, d, color, 0xff0000);

      const tickerMesh = this.billboardCanvas.createClockTickerBillboard(26, 10);
      tickerMesh.position.set(0, 30, d / 2 + 0.6);
      group.add(tickerMesh);
    } else if (type === 'ORBITAL_SYSTEMS') {
      height = 105;
      color = 0x3b526c;
      name = 'Orbital Systems Spire';
      employees = 1850;
      specialty = 'Satellite Navigation & Deep Space AI';
      this.addSkyscraperDetails(group, w, height, d, color, 0x00ffff);
      const adMesh = this.billboardCanvas.createAdBillboard('NEOTECH', 22, 11);
      adMesh.position.set(0, height - 18, d / 2 + 0.6);
      group.add(adMesh);
    } else if (type === 'QUANTUM_DYNAMIC') {
      height = 88;
      color = 0x4f4a6e;
      name = 'Quantum Dynamics Tower';
      employees = 1200;
      specialty = 'Supercomputing & Particle Simulation';
      this.addSkyscraperDetails(group, w, height, d, color, 0xe94560);
    } else if (type === 'VALKYRIE_MOTORS') {
      height = 70;
      color = 0x3a5372;
      name = 'Valkyrie Motors Tower';
      employees = 890;
      specialty = 'Autonomous Flying Vehicle Engines';
      this.addSkyscraperDetails(group, w, height, d, color, 0x0f3460);
    } else if (type === 'SYNTH_LABS') {
      height = 80;
      color = 0x375a63;
      name = 'SynthLabs Biotech HQ';
      employees = 1100;
      specialty = 'Cybernetic Enhancement & Diagnostics';
      this.addSkyscraperDetails(group, w, height, d, color, 0x203a43);
    } else if (type === 'CHRONO_BANK') {
      height = 92;
      color = 0x555047;
      name = 'Chrono Bank Plaza';
      employees = 1500;
      specialty = 'Temporal Vaults & Secure Transfers';
      this.addSkyscraperDetails(group, w, height, d, color, 0xf0a500);
    } else if (type === 'AETHER_TOWER') {
      height = 115;
      color = 0x494d5a;
      name = 'Aether Skyspire';
      employees = 2400;
      specialty = 'Atmospheric Energy Harvesting';
      this.addSkyscraperDetails(group, w, height, d, color, 0x7f5a83);
      const tickerMesh = this.billboardCanvas.createClockTickerBillboard(26, 10);
      tickerMesh.position.set(0, height - 25, d / 2 + 0.6);
      group.add(tickerMesh);
    } else if (type === 'SOLARIS_HOTEL') {
      height = 78;
      color = 0x6e4854;
      name = 'Solaris Waterfront Hotel';
      employees = 650;
      specialty = 'River-View Luxury Suites & Spa';
      this.addSkyscraperDetails(group, w, height, d, color, 0xff6b6b);
    } else {
      height = Math.floor(Math.random() * 45 + 40);
      color = 0x4a5568;
      name = `East District Tower #${Math.floor(Math.random() * 90 + 10)}`;
      this.addSkyscraperDetails(group, w, height, d, color, 0x00f0ff);
    }

    const baseBox = new THREE.Mesh(
      new THREE.BoxGeometry(w, height, d),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.35, metalness: 0.35 })
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

    this.buildings.push({
      group: group,
      baseBox: baseBox,
      plot: plot,
      type: type,
      name: name,
      height: height,
      isDestroyed: false,
      rubbleGroup: null
    });
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
      color: 0x9ed8f0,
      emissive: 0xffe8a0,
      emissiveIntensity: 0.22,
      roughness: 0.15,
      metalness: 0.45
    });
    this.nightLights.push({ mat: winMat, baseIntensity: 0.22, maxIntensity: 0.95 });

    const rows = Math.floor(height / 4);
    const cols = Math.floor(w / 4);
    const maxWins = (rows - 1) * cols * 2;
    
    if (maxWins > 0) {
      const winGeo = new THREE.PlaneGeometry(2.4, 2.4);
      const winInstanced = new THREE.InstancedMesh(winGeo, winMat, maxWins);
      let winIdx = 0;
      const dummy = new THREE.Object3D();

      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.15) {
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

    // 3. Horizontal architectural spandrel bands / floor cornices
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xc8d6e5, roughness: 0.3, metalness: 0.6 });
    const floorStep = 16;
    for (let fy = floorStep; fy < height - 2; fy += floorStep) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6), trimMat);
      band.position.set(0, fy, 0);
      group.add(band);
    }

    // 4. Ground floor lobby entrance glass pavilion
    const lobbyGlassMat = new THREE.MeshStandardMaterial({
      color: 0xa8e0ff,
      emissive: 0xddeeff,
      emissiveIntensity: 0.35,
      roughness: 0.1,
      metalness: 0.5
    });
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 4.0, 1.2), lobbyGlassMat);
    lobby.position.set(0, 2.0, d / 2 + 0.4);
    group.add(lobby);

    // 5. Rooftop antenna or spire
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

  addResidentialDetails(group, w, height, d, baseColor, accentColorHex) {
    const balconyMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      emissive: accentColorHex,
      emissiveIntensity: 0
    });
    this.nightLights.push({ mat: balconyMat, maxIntensity: 0.6 });

    const levels = Math.floor(height / 6);
    for (let i = 1; i < levels; i++) {
      const balc = new THREE.Mesh(
        new THREE.BoxGeometry(w + 1.2, 0.6, d + 1.2),
        balconyMat
      );
      balc.position.set(0, i * 6, 0);
      group.add(balc);
    }
  }

  addCivicDetails(group, w, height, d, baseColor, accentColorHex, signText) {
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.2 });
    for (let i = -w / 3; i <= w / 3; i += w / 3) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 8, 12), pillarMat);
      pillar.position.set(i, 4, d / 2 + 1);
      group.add(pillar);
    }

    const archMat = new THREE.MeshStandardMaterial({
      color: accentColorHex,
      emissive: accentColorHex,
      emissiveIntensity: 0
    });
    this.nightLights.push({ mat: archMat, maxIntensity: 0.9 });
    const arch = new THREE.Mesh(new THREE.BoxGeometry(w - 6, 1.6, 2), archMat);
    arch.position.set(0, 8.8, d / 2 + 1);
    group.add(arch);
  }

  addParkPlazaDetails(group, w, d, baseColor, accentColorHex) {
    // Plaza base
    const plazaBase = new THREE.Mesh(
      new THREE.BoxGeometry(w, 1.5, d),
      new THREE.MeshStandardMaterial({ color: 0x2d4c38, roughness: 0.8 })
    );
    plazaBase.position.y = 0.75;
    plazaBase.receiveShadow = true;
    group.add(plazaBase);

    // Glowing Cyber Fountain Pool
    const poolGeo = new THREE.CylinderGeometry(6, 6, 1.8, 24);
    const poolMat = new THREE.MeshStandardMaterial({ color: 0x113344, roughness: 0.2 });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(0, 1.2, 0);
    group.add(pool);

    const waterGeo = new THREE.CylinderGeometry(5.2, 5.2, 2.1, 24);
    const waterMat = new THREE.MeshBasicMaterial({ color: accentColorHex, transparent: true, opacity: 0.65 });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.set(0, 1.4, 0);
    group.add(water);

    // Cyber Park Trees at 4 corners
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });
    const treeLeavesMat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00aa55,
      emissiveIntensity: 0.35,
      roughness: 0.4
    });

    const corners = [
      [-w / 3, -d / 3], [w / 3, -d / 3],
      [-w / 3, d / 3], [w / 3, d / 3]
    ];
    for (const [tx, tz] of corners) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 8), treeTrunkMat);
      trunk.position.set(tx, 2.5, tz);
      group.add(trunk);

      const crown = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 12), treeLeavesMat);
      crown.position.set(tx, 5.2, tz);
      group.add(crown);
    }
  }

  addRoadSegmentDetails(group, w, d, roadType) {
    const roadBase = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.4, d),
      new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.9 })
    );
    roadBase.position.y = 0.2;
    roadBase.receiveShadow = true;
    group.add(roadBase);

    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    if (roadType === 'INTERSECTION') {
      const lineX = new THREE.Mesh(new THREE.PlaneGeometry(w - 4, 0.6), lineMat);
      lineX.rotation.x = -Math.PI / 2;
      lineX.position.set(0, 0.42, 0);
      group.add(lineX);

      const lineZ = new THREE.Mesh(new THREE.PlaneGeometry(0.6, d - 4), lineMat);
      lineZ.rotation.x = -Math.PI / 2;
      lineZ.position.set(0, 0.42, 0);
      group.add(lineZ);
    } else {
      const lineZ = new THREE.Mesh(new THREE.PlaneGeometry(0.6, d - 4), lineMat);
      lineZ.rotation.x = -Math.PI / 2;
      lineZ.position.set(0, 0.42, 0);
      group.add(lineZ);
    }
  }

  placeUserBuilding(plot, spec, rotationY = 0) {
    const group = new THREE.Group();
    group.position.set(plot.x, plot.y || 0, plot.z);
    group.rotation.y = rotationY;

    const w = spec.footprint.width;
    const d = spec.footprint.depth;
    const height = spec.height || 30;

    let baseBox = null;

    if (spec.generatorType === 'PARK_PLAZA') {
      this.addParkPlazaDetails(group, w, d, spec.baseColor, spec.accentColor);
      baseBox = group.children[0];
    } else if (spec.generatorType === 'ROAD_SEGMENT') {
      this.addRoadSegmentDetails(group, w, d, spec.roadType);
      baseBox = group.children[0];
    } else {
      baseBox = new THREE.Mesh(
        new THREE.BoxGeometry(w - 2, height, d - 2),
        new THREE.MeshStandardMaterial({ color: spec.baseColor, roughness: 0.35, metalness: 0.35 })
      );
      baseBox.position.y = height / 2;
      baseBox.castShadow = true;
      baseBox.receiveShadow = true;
      group.add(baseBox);

      if (spec.generatorType === 'SKYSCRAPER') {
        this.addSkyscraperDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor);
      } else if (spec.generatorType === 'SHOP') {
        this.addShopDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor, spec.signText);
      } else if (spec.generatorType === 'RESIDENTIAL') {
        this.addResidentialDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor);
      } else if (spec.generatorType === 'CIVIC') {
        this.addCivicDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor, spec.signText);
      }
    }

    if (this.inspectorHud && baseBox) {
      this.inspectorHud.registerObject(baseBox, {
        type: `${spec.category} (USER PLACED)`,
        name: spec.name,
        info: {
          'Category': spec.category,
          'Footprint': `${w}m x ${d}m`,
          'Height': `${height}m`,
          'Status': 'User Constructed Structure 🏗️'
        }
      });
    }

    this.scene.add(group);

    const buildingObj = {
      group: group,
      baseBox: baseBox,
      plot: { ...plot, width: w, depth: d },
      spec: spec,
      type: spec.id,
      name: spec.name,
      height: height,
      isUserPlaced: true,
      isDestroyed: false
    };

    this.buildings.push(buildingObj);
    return buildingObj;
  }

  createStructurePreviewGroup(spec, tintHex = 0x00ff88) {
    const group = new THREE.Group();
    const w = spec.footprint.width;
    const d = spec.footprint.depth;
    const height = spec.height || 30;

    if (spec.generatorType === 'PARK_PLAZA') {
      this.addParkPlazaDetails(group, w, d, spec.baseColor, spec.accentColor);
    } else if (spec.generatorType === 'ROAD_SEGMENT') {
      this.addRoadSegmentDetails(group, w, d, spec.roadType);
    } else {
      const baseBox = new THREE.Mesh(
        new THREE.BoxGeometry(w - 2, height, d - 2),
        new THREE.MeshStandardMaterial({ color: spec.baseColor, roughness: 0.35, metalness: 0.35 })
      );
      baseBox.position.y = height / 2;
      group.add(baseBox);

      if (spec.generatorType === 'SKYSCRAPER') {
        this.addSkyscraperDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor);
      } else if (spec.generatorType === 'SHOP') {
        this.addShopDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor, spec.signText);
      } else if (spec.generatorType === 'RESIDENTIAL') {
        this.addResidentialDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor);
      } else if (spec.generatorType === 'CIVIC') {
        this.addCivicDetails(group, w - 2, height, d - 2, spec.baseColor, spec.accentColor, spec.signText);
      }
    }

    const tintColor = new THREE.Color(tintHex);
    group.traverse(child => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.material.opacity = 0.65;
        if (child.material.emissive) {
          child.material.emissive = tintColor;
          child.material.emissiveIntensity = 0.28;
        }
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });

    return group;
  }



  destroyBuilding(building) {
    if (building.isDestroyed) return;
    building.isDestroyed = true;

    if (this.app && this.app.uiManager) {
      this.app.uiManager.onBuildingDestroyed();
    }

    // Hide original building group
    building.group.visible = false;

    // Create Rubble pile in its exact plot!
    const rubbleGroup = new THREE.Group();
    rubbleGroup.position.set(building.plot.x, 0, building.plot.z);

    const w = building.plot.width - 6;
    const d = building.plot.depth - 6;
    const pieceCount = Math.floor(building.height * 0.5) + 12;

    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.9 });
    const burntMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.8 });
    const rustMat = new THREE.MeshStandardMaterial({ color: 0x5a2a18, roughness: 0.85 });
    const mats = [concreteMat, burntMat, rustMat];

    for (let i = 0; i < pieceCount; i++) {
      const pw = Math.random() * 5 + 2;
      const ph = Math.random() * 4 + 1.5;
      const pd = Math.random() * 5 + 2;
      const piece = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), mats[i % mats.length]);
      
      piece.position.set(
        (Math.random() - 0.5) * w,
        ph / 2 + Math.random() * 5,
        (Math.random() - 0.5) * d
      );
      piece.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );
      piece.castShadow = true;
      piece.receiveShadow = true;
      rubbleGroup.add(piece);
    }

    // Glowing ember crater at base
    const craterGeo = new THREE.PlaneGeometry(w + 2, d + 2);
    const craterMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.7 });
    const crater = new THREE.Mesh(craterGeo, craterMat);
    crater.rotation.x = -Math.PI / 2;
    crater.position.y = 0.15;
    rubbleGroup.add(crater);

    this.scene.add(rubbleGroup);
    building.rubbleGroup = rubbleGroup;

    if (this.inspectorHud) {
      this.inspectorHud.registerObject(rubbleGroup.children[0] || building.baseBox, {
        type: 'DESTROYED BUILDING',
        name: `${building.name} (Rubble)`,
        info: {
          'Status': 'DESTROYED BY COMET IMPACT 🔥',
          'Condition': 'Total Rubble & Debris',
          'Hazard Level': 'EXTREME'
        }
      });
    }
  }

  restoreAllBuildings() {
    for (const b of this.buildings) {
      if (b.isDestroyed) {
        b.isDestroyed = false;
        b.group.visible = true;
        if (b.rubbleGroup) {
          this.scene.remove(b.rubbleGroup);
          b.rubbleGroup = null;
        }
      }
    }
  }
}

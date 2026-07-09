import * as THREE from 'three';

export class BillboardCanvas {
  constructor(app) {
    this.app = app;
    this.billboards = [];
  }

  createClockTickerBillboard(width = 16, height = 8) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);

    const billboardData = {
      type: 'ticker',
      canvas: canvas,
      ctx: ctx,
      texture: texture,
      scrollX: 512,
      timeVal: 14.5
    };
    this.billboards.push(billboardData);

    // Initial draw
    this.drawTicker(billboardData);

    return mesh;
  }

  createAdBillboard(adName, width = 14, height = 10) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);

    const billboardData = {
      type: 'ad',
      adName: adName,
      canvas: canvas,
      ctx: ctx,
      texture: texture,
      timer: 0,
      phase: 0
    };
    this.billboards.push(billboardData);

    this.drawAd(billboardData);
    return mesh;
  }

  drawTicker(data) {
    const { ctx, canvas, scrollX, timeVal } = data;
    const isFunMode = this.app && this.app.funMode;
    
    // Background
    ctx.fillStyle = isFunMode ? '#1e0208' : '#070c1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border glow
    ctx.strokeStyle = isFunMode ? '#ef4444' : '#00f0ff';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

    // Header / Title
    if (isFunMode) {
      ctx.fillStyle = '#ff0055';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('METRO MAYHEM LIVE 🚨', 24, 50);
    } else {
      ctx.fillStyle = '#ff007f';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillText('METRO NEWS LIVE', 24, 50);
    }

    // Digital Clock
    const hours = Math.floor(timeVal);
    const minutes = Math.floor((timeVal - hours) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    ctx.fillStyle = isFunMode ? '#ffcc00' : '#00ff88';
    ctx.font = 'bold 54px monospace';
    ctx.fillText(timeStr, 340, 56);

    // Divider
    ctx.strokeStyle = isFunMode ? '#551122' : '#223355';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(20, 75);
    ctx.lineTo(canvas.width - 20, 75);
    ctx.stroke();

    // Scrolling Ticker Text
    ctx.fillStyle = '#ffffff';
    ctx.font = '32px sans-serif';
    
    let tickerText = "★ METROPULSE 3D SIMULATION ★ Traffic Flowing Smoothly ★ CyberCafe Offering 50% Off Espresso ★ NeoTech Stock Hits Record High ★ Starlight Hotel Booking Fast ★ Welcome to the Future!";
    if (isFunMode) {
      tickerText = "🚨 METEOR ALERT: COMET SHOWER DETECTED ★ KEEP PRODUCTIVE ★ Property Damage is Temporary, Profit is Eternal! ★ Real Estate Index Plunging: Buy The Dip! ★ Police Dispatching Heavy Enforcers To Secure Corporate Annexes ★ Stay Indoors and Consume ★ NeoTech Defence Drones Online ★";
    }
    
    ctx.fillText(tickerText, scrollX, 160);

    // Footer info
    if (isFunMode) {
      ctx.fillStyle = '#85001a';
      ctx.fillRect(20, 190, canvas.width - 40, 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('WEATHER: COMET PRECIPITATION 🔥', 40, 222);
    } else {
      ctx.fillStyle = '#7000ff';
      ctx.fillRect(20, 190, canvas.width - 40, 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('WEATHER: CLEAR / CYBER ATMOSPHERE', 40, 222);
    }

    data.texture.needsUpdate = true;
  }

  drawAd(data) {
    const { ctx, canvas, adName, phase } = data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (adName === 'CYBERCAFE') {
      const bg = phase % 2 === 0 ? '#110522' : '#220a44';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ff007f';
      ctx.font = 'bold 56px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CYBER CAFE', canvas.width / 2, 110);

      ctx.fillStyle = '#00f0ff';
      ctx.font = '40px monospace';
      ctx.fillText('24 / 7 COFFEE & NET', canvas.width / 2, 180);

      ctx.fillStyle = '#00ff88';
      ctx.font = '36px sans-serif';
      ctx.fillText('⚡ FUEL YOUR BRAIN ⚡', canvas.width / 2, 280);
    } else if (adName === 'NEOTECH') {
      const isFunMode = this.app && this.app.funMode;
      if (isFunMode) {
        ctx.fillStyle = '#1e0505';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ff3366';
        ctx.font = 'bold 64px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NEO SHIELD', canvas.width / 2, 130);

        ctx.fillStyle = '#ffffff';
        ctx.font = '36px sans-serif';
        ctx.fillText('SECURITY COMBAT DRONES', canvas.width / 2, 200);

        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 38px monospace';
        ctx.fillText('PROTECTING CAPITAL NOW', canvas.width / 2, 290);
      } else {
        ctx.fillStyle = '#031025';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 64px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('NEO TECH', canvas.width / 2, 130);

        ctx.fillStyle = '#ffffff';
        ctx.font = '36px sans-serif';
        ctx.fillText('BUILDING TOMORROW', canvas.width / 2, 200);

        ctx.fillStyle = '#ffb800';
        ctx.font = 'bold 38px monospace';
        ctx.fillText('AI • ROBOTICS • QUANTUM', canvas.width / 2, 290);
      }
    } else if (adName === 'CINEMA') {
      ctx.fillStyle = '#1a0010';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffb800';
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GALAXY CINEMA', canvas.width / 2, 90);

      ctx.fillStyle = '#ff007f';
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText('CYBER RUNNER 2099', canvas.width / 2, 190);

      ctx.fillStyle = '#00f0ff';
      ctx.font = '32px monospace';
      ctx.fillText('NOW SHOWING IN INMERSE-3D', canvas.width / 2, 280);
    }

    ctx.textAlign = 'left'; // Reset
    data.texture.needsUpdate = true;
  }

  update(timeVal, delta) {
    for (const bb of this.billboards) {
      if (bb.type === 'ticker') {
        bb.timeVal = timeVal;
        bb.scrollX -= 120 * delta;
        if (bb.scrollX < -1800) {
          bb.scrollX = 512;
        }
        this.drawTicker(bb);
      } else if (bb.type === 'ad') {
        bb.timer += delta;
        if (bb.timer > 2.0) {
          bb.timer = 0;
          bb.phase++;
          this.drawAd(bb);
        }
      }
    }
  }
}

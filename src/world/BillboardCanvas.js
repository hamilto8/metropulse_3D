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
    const env = this.app && this.app.environment;
    const weatherMode = env ? env.weatherMode : 'clear';
    
    // Background
    ctx.fillStyle = isFunMode ? '#1e0208' : '#070c1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Border glow
    ctx.strokeStyle = isFunMode ? '#ef4444' : '#00f0ff';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);

    // Header / Title (repositioned & sized down to 28px to prevent overlapping)
    if (isFunMode) {
      ctx.fillStyle = '#ff0055';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('METRO MAYHEM LIVE 🚨', 20, 52);
    } else {
      ctx.fillStyle = '#ff007f';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('METRO NEWS LIVE', 20, 52);
    }

    // Digital Clock (repositioned to x=360 and sized down to 48px to prevent overlapping)
    const hours = Math.floor(timeVal);
    const minutes = Math.floor((timeVal - hours) * 60);
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    ctx.fillStyle = isFunMode ? '#ffcc00' : '#00ff88';
    ctx.font = 'bold 48px monospace';
    ctx.fillText(timeStr, 360, 54);

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
      tickerText = "🚨 METEOR ALERT: COMET SHOWER DETECTED ★ BILLIONAIRES FLEEING BY ROCKET: 'DO NOT PANIC, CAPITAL STAYS SAFE' ★ KEEP PRODUCTIVE ★ Property Damage is Temporary, Profit is Eternal! ★ Real Estate Index Plunging: Buy The Dip! ★ Police Dispatching Heavy Enforcers To Secure Corporate Annexes ★ Stay Indoors and Consume ★ NeoTech Defence Drones Online ★";
    }
    
    ctx.fillText(tickerText, scrollX, 160);

    // Footer info
    if (isFunMode) {
      ctx.fillStyle = '#85001a';
      ctx.fillRect(20, 190, canvas.width - 40, 46);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('WEATHER: COMET PRECIPITATION 🔥', canvas.width / 2, 213);
    } else {
      let footerBg = '#7000ff';
      let weatherText = 'WEATHER: CLEAR / CYBER ATMOSPHERE ☀️';
      
      if (weatherMode === 'mist') {
        footerBg = '#4f5b66';
        weatherText = 'WEATHER: CYBER MIST / FOGGY CLOUDS 🌫️';
      } else if (weatherMode === 'rain') {
        footerBg = '#1d3c5f';
        weatherText = 'WEATHER: ACID RAIN / LIGHT METRO SHOWERS 🌧️';
      } else if (weatherMode === 'thunderstorm') {
        footerBg = '#5e0d7c';
        weatherText = 'WEATHER: ELECTRICAL STORM / DANGER ⚡';
      }
      
      ctx.fillStyle = footerBg;
      ctx.fillRect(20, 190, canvas.width - 40, 46);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(weatherText.toUpperCase(), canvas.width / 2, 213);
    }

    // Restore text alignment defaults
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

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
      // Dark cyberpunk theater backdrop
      ctx.fillStyle = '#0f0212';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Neon pink/cyan accent lines or border
      ctx.strokeStyle = '#ff007f';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

      // Header: Galaxy Cinema
      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✨ GALAXY CINEMA ✨', canvas.width / 2, 70);

      // Movie Title: CYBER RUNNER 2099 (Fits perfectly at 40px!)
      // Add neon glow layers
      ctx.fillStyle = 'rgba(255, 0, 127, 0.45)';
      ctx.font = '900 40px sans-serif';
      ctx.fillText('CYBER RUNNER 2099', canvas.width / 2 + 3, 173);
      ctx.fillStyle = '#ff007f';
      ctx.fillText('CYBER RUNNER 2099', canvas.width / 2, 170);

      // Subtitle: NOW SHOWING IN IMMERSIVE 3D (corrected spelling of IMMERSIVE)
      ctx.fillStyle = '#ffcc00';
      ctx.font = 'bold 22px monospace';
      ctx.fillText('NOW SHOWING IN IMMERSIVE 3D', canvas.width / 2, 270);

    } else if (adName === 'SPACE_PROGRAM') {
      // Space Nebula Gradient
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#03071e');
      grad.addColorStop(0.5, '#370617');
      grad.addColorStop(1, '#03001e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid lines
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.1)';
      ctx.lineWidth = 2;
      for (let i = 0; i < canvas.width; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let j = 0; j < canvas.height; j += 64) {
        ctx.beginPath();
        ctx.moveTo(0, j);
        ctx.lineTo(canvas.width, j);
        ctx.stroke();
      }

      // Title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 12;
      ctx.fillText('METROPULSE SPACE PROGRAM', canvas.width / 2, 70);

      // Rocket Icon Silhouette
      ctx.fillStyle = '#e53e3e';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 110);
      ctx.lineTo(canvas.width / 2 + 15, 140);
      ctx.lineTo(canvas.width / 2 + 10, 170);
      ctx.lineTo(canvas.width / 2 - 10, 170);
      ctx.lineTo(canvas.width / 2 - 15, 140);
      ctx.closePath();
      ctx.fill();

      // Flame
      ctx.fillStyle = phase % 2 === 0 ? '#ff9f1c' : '#ff4d6d';
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2 - 8, 170);
      ctx.lineTo(canvas.width / 2, 190);
      ctx.lineTo(canvas.width / 2 + 8, 170);
      ctx.closePath();
      ctx.fill();

      const isFunMode = this.app && this.app.funMode;
      const launched = this.app && this.app.rocketLaunched;
      const countdown = this.app && typeof this.app.rocketCountdown === 'number' ? Math.max(0, Math.ceil(this.app.rocketCountdown)) : 300;
      const mins = Math.floor(countdown / 60);
      const secs = countdown % 60;
      const timeStr = `T-${mins}:${String(secs).padStart(2, '0')}`;

      if (isFunMode) {
        if (launched) {
          ctx.fillStyle = phase % 2 === 0 ? '#ffcc00' : '#00ff88';
          ctx.font = 'bold 28px sans-serif';
          ctx.fillText('🚀 BLASTOFF! WE HAVE LIFTOFF! 🚀', canvas.width / 2, 220);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 24px monospace';
          ctx.fillText('BILLIONAIRES EN ROUTE TO ORBIT!', canvas.width / 2, 255);

          ctx.fillStyle = '#ff0055';
          ctx.font = 'bold 24px monospace';
          ctx.fillText('GOODBYE EARTH - GOOD LUCK!', canvas.width / 2, 290);
        } else {
          // Red warning title for End of the World Express
          ctx.fillStyle = phase % 2 === 0 ? '#ff0055' : '#ffcc00';
          ctx.font = 'bold 26px sans-serif';
          ctx.fillText('🚀 END OF THE WORLD EXPRESS! 🚀', canvas.width / 2, 218);

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 22px monospace';
          ctx.fillText('BILLIONAIRES NOW BOARDING!', canvas.width / 2, 252);

          ctx.fillStyle = '#00f0ff';
          ctx.font = 'bold 24px monospace';
          ctx.fillText(`LAST CALL (${timeStr})`, canvas.width / 2, 290);
        }
      } else {
        // Normal status
        if (phase % 2 === 0) {
          ctx.fillStyle = '#00ff88';
          ctx.font = 'bold 28px monospace';
          ctx.fillText('NEXT LAUNCH: T-MINUS 00:04:12', canvas.width / 2, 240);
        } else {
          ctx.fillStyle = '#ffaa00';
          ctx.font = 'bold 28px monospace';
          ctx.fillText('STATUS: PROPELLANT LOADING', canvas.width / 2, 240);
        }

        ctx.fillStyle = '#00f0ff';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText('DESTINATION: CYBER MOON BASE 🌌', canvas.width / 2, 290);
      }

      // Ticker Background Bar (black bar at the bottom)
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 324, canvas.width, 60);

      // Yellow neon dividing line above the ticker
      ctx.strokeStyle = '#ffb703';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 324);
      ctx.lineTo(canvas.width, 324);
      ctx.stroke();

      // Scrolling text (left-aligned relative to scrollX)
      ctx.fillStyle = '#ff007f'; // Neon pink for high contrast
      ctx.font = 'bold 22px Courier New, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('★ Tapping the unexploited resources of the cosmos! ★ Metropulse Space Program: Exploiting the final frontier for maximum shareholder value ★', data.scrollX || 512, 355);
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
        if (bb.adName === 'SPACE_PROGRAM') {
          if (bb.scrollX === undefined) {
            bb.scrollX = 512;
          }
          bb.scrollX -= 70 * delta;
          if (bb.scrollX < -1500) {
            bb.scrollX = 512;
          }
          if (bb.timer > 2.0) {
            bb.timer = 0;
            bb.phase++;
          }
          this.drawAd(bb);
        } else {
          if (bb.timer > 2.0) {
            bb.timer = 0;
            bb.phase++;
            this.drawAd(bb);
          }
        }
      }
    }
  }

  forceRedrawAll() {
    for (const bb of this.billboards) {
      if (bb.type === 'ad') {
        this.drawAd(bb);
      } else if (bb.type === 'ticker') {
        this.drawTicker(bb);
      }
    }
  }
}

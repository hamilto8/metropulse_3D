export class AudioSystem {
  constructor(app = null) {
    this.app = app;
    this.ctx = null;
    this.masterGain = null;
    this.isEnabled = false;
    this.volume = 0.5;

    // Ambience state
    this.rumbleNode = null;
    this.rumbleGain = null;
    this.windGain = null;
    this.trafficGain = null;
    this.rainGain = null;
    this.tornadoGain = null;
    this.panicGain = null;

    // Timers for occasional procedural events
    this.birdTimer = 3.0;
    this.honkTimer = 8.0 + Math.random() * 10.0;
    this.panicScreamTimer = 0;
  }

  toggleAudio() {
    if (!this.isEnabled) {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.volume;
        this.masterGain.connect(this.ctx.destination);
        this.startBackgroundAmbience();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.isEnabled = true;
    } else {
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend();
      }
      this.isEnabled = false;
    }
    return this.isEnabled;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  startBackgroundAmbience() {
    // Generate buffer for natural noise
    const bufferSize = 2 * this.ctx.sampleRate;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      output[i] = (lastOut + (0.02 * white)) / 1.02; // Brown noise approximation
      lastOut = output[i];
      output[i] *= 3.5; // Gain compensation
    }

    // 1. City Rumble (deep, soft background hum at 110Hz)
    const rumbleNoise = this.ctx.createBufferSource();
    rumbleNoise.buffer = noiseBuffer;
    rumbleNoise.loop = true;

    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 110;

    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0.20;

    rumbleNoise.connect(rumbleFilter);
    rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.masterGain);
    rumbleNoise.start();

    // 2. Outdoor Wind Breeze (gentle, soothing white/pink noise breeze)
    const windNoise = this.ctx.createBufferSource();
    windNoise.buffer = noiseBuffer;
    windNoise.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 320; // Soft wind frequency

    // LFO for slow wind gusts (0.1 Hz = 10 second cycle)
    const windLfo = this.ctx.createOscillator();
    windLfo.frequency.value = 0.1;
    const windLfoGain = this.ctx.createGain();
    windLfoGain.gain.value = 120; // Gently oscillate between 200Hz and 440Hz

    windLfo.connect(windLfoGain);
    windLfoGain.connect(windFilter.frequency);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.18; // Mild, relaxing outdoor breeze

    windNoise.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    windNoise.start();
    windLfo.start();

    // 3. Mild Traffic Ambience (undulating mid-low rumble of distant tires/engines)
    const trafficNoise = this.ctx.createBufferSource();
    trafficNoise.buffer = noiseBuffer;
    trafficNoise.loop = true;

    const trafficFilter = this.ctx.createBiquadFilter();
    trafficFilter.type = 'bandpass';
    trafficFilter.frequency.value = 380;
    trafficFilter.Q.value = 0.9;

    const trafficLfo = this.ctx.createOscillator();
    trafficLfo.frequency.value = 0.2; // 5-second cycle for passing traffic
    const trafficLfoGain = this.ctx.createGain();
    trafficLfoGain.gain.value = 100; // Sweep smoothly around 280Hz - 480Hz

    trafficLfo.connect(trafficLfoGain);
    trafficLfoGain.connect(trafficFilter.frequency);

    this.trafficGain = this.ctx.createGain();
    this.trafficGain.gain.value = 0.10;

    trafficNoise.connect(trafficFilter);
    trafficFilter.connect(this.trafficGain);
    this.trafficGain.connect(this.masterGain);
    trafficNoise.start();
    trafficLfo.start();

    // 4. Mild Rain Weather SFX (soft, relaxing rain without harsh treble)
    const rainNoise = this.ctx.createBufferSource();
    rainNoise.buffer = noiseBuffer;
    rainNoise.loop = true;

    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1100; // Lowered center freq for warm rain sound
    rainFilter.Q.value = 0.5;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0; // Off unless raining

    rainNoise.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainNoise.start();

    // 5. Fun Mode Tornado Siren (Loud, ominous air raid wail)
    const tornadoOsc1 = this.ctx.createOscillator();
    const tornadoOsc2 = this.ctx.createOscillator();
    tornadoOsc1.type = 'sawtooth';
    tornadoOsc2.type = 'sawtooth';
    tornadoOsc1.frequency.value = 440;
    tornadoOsc2.frequency.value = 444; // Detuned for ominous chorus

    const tornadoLfo = this.ctx.createOscillator();
    tornadoLfo.frequency.value = 0.12; // ~8-second slow sweep cycle
    const tornadoLfoGain = this.ctx.createGain();
    tornadoLfoGain.gain.value = 180; // Smoothly wail between 260Hz and 620Hz

    tornadoLfo.connect(tornadoLfoGain);
    tornadoLfoGain.connect(tornadoOsc1.frequency);
    tornadoLfoGain.connect(tornadoOsc2.frequency);

    const tornadoFilter = this.ctx.createBiquadFilter();
    tornadoFilter.type = 'lowpass';
    tornadoFilter.frequency.value = 1500;

    this.tornadoGain = this.ctx.createGain();
    this.tornadoGain.gain.value = 0; // Off unless Fun Mode is active!

    tornadoOsc1.connect(tornadoFilter);
    tornadoOsc2.connect(tornadoFilter);
    tornadoFilter.connect(this.tornadoGain);
    this.tornadoGain.connect(this.masterGain);

    tornadoOsc1.start();
    tornadoOsc2.start();
    tornadoLfo.start();

    // 6. Crowd Panic Ambience (Frantic footsteps rumble & commotion)
    const panicNoise = this.ctx.createBufferSource();
    panicNoise.buffer = noiseBuffer;
    panicNoise.loop = true;

    const panicFilter = this.ctx.createBiquadFilter();
    panicFilter.type = 'bandpass';
    panicFilter.frequency.value = 700;
    panicFilter.Q.value = 1.3;

    const panicLfo = this.ctx.createOscillator();
    panicLfo.frequency.value = 5.0; // Rapid footsteps/commotion rate
    const panicLfoGain = this.ctx.createGain();
    panicLfoGain.gain.value = 280;
    panicLfo.connect(panicLfoGain);
    panicLfoGain.connect(panicFilter.frequency);

    this.panicGain = this.ctx.createGain();
    this.panicGain.gain.value = 0; // Off unless Fun Mode is active!

    panicNoise.connect(panicFilter);
    panicFilter.connect(this.panicGain);
    this.panicGain.connect(this.masterGain);

    panicNoise.start();
    panicLfo.start();
  }

  update(timeVal, delta) {
    if (!this.isEnabled || !this.ctx) return;

    const isNight = (timeVal >= 18.0 || timeVal < 6.0);
    const isRushHour = (timeVal >= 7.0 && timeVal <= 9.5) || (timeVal >= 16.0 && timeVal <= 18.5);
    const isRaining = this.app && this.app.environment && this.app.environment.weatherMode === 'rain';

    // 1. Adjust Traffic volume: slightly louder during daytime rush hours, quieter at night
    let targetTrafficGain = isNight ? 0.05 : 0.10;
    if (isRushHour) targetTrafficGain = 0.15;
    this.trafficGain.gain.setTargetAtTime(targetTrafficGain, this.ctx.currentTime, 1.0);

    // 2. Adjust Wind Breeze: slightly breezier in clear daytime or mist
    const targetWindGain = isRaining ? 0.12 : (isNight ? 0.15 : 0.20);
    this.windGain.gain.setTargetAtTime(targetWindGain, this.ctx.currentTime, 1.0);

    // 3. Adjust Rain SFX based on weather mode
    const targetRainGain = isRaining ? 0.20 : 0.0;
    this.rainGain.gain.setTargetAtTime(targetRainGain, this.ctx.currentTime, 0.5);

    // 4. Daytime bird chirps (only in clear weather during day)
    if (!isNight && !isRaining) {
      this.birdTimer -= delta;
      if (this.birdTimer <= 0) {
        this.playBirdChirp();
        this.birdTimer = 6.0 + Math.random() * 10.0;
      }
    }

    // 5. Occasional Cars Honking in Traffic
    this.honkTimer -= delta;
    if (this.honkTimer <= 0) {
      this.playHonk(true); // Randomized pitch
      if (isRushHour) {
        this.honkTimer = 6.0 + Math.random() * 8.0; // Frequent during rush hour
      } else if (isNight) {
        this.honkTimer = 22.0 + Math.random() * 30.0; // Very rare at night
      } else {
        this.honkTimer = 12.0 + Math.random() * 15.0;
      }
    }

    // 6. Fun Mode Tornado Siren & Crowd Panic
    const isFunMode = this.app && this.app.funMode;
    const targetTornadoGain = isFunMode ? 0.22 : 0.0;
    const targetPanicGain = isFunMode ? 0.16 : 0.0;

    if (this.tornadoGain) this.tornadoGain.gain.setTargetAtTime(targetTornadoGain, this.ctx.currentTime, 0.5);
    if (this.panicGain) this.panicGain.gain.setTargetAtTime(targetPanicGain, this.ctx.currentTime, 0.5);

    if (isFunMode) {
      this.panicScreamTimer -= delta;
      if (this.panicScreamTimer <= 0) {
        this.playPanicScream();
        this.panicScreamTimer = 1.2 + Math.random() * 2.2;
      }
    }
  }

  playPanicScream() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = Math.random() > 0.5 ? 'triangle' : 'sawtooth';
    const baseFreq = 450 + Math.random() * 450;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq + (Math.random() * 350 - 100), now + 0.15);
    osc.frequency.linearRampToValueAtTime(baseFreq - 150, now + 0.35);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.005, now + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  playBirdChirp() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const baseFreq = 2600 + Math.random() * 600;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq + 400, now + 0.08);
    osc.frequency.linearRampToValueAtTime(baseFreq - 150, now + 0.16);
    osc.frequency.linearRampToValueAtTime(baseFreq + 500, now + 0.25);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.04, now + 0.02); // Soft, non-intrusive chirp
    gain.gain.linearRampToValueAtTime(0.02, now + 0.15);
    gain.gain.linearRampToValueAtTime(0, now + 0.28);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playHonk(randomizePitch = false) {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';

    const pitchShift = randomizePitch ? (Math.random() * 60 - 30) : 0;
    const freq1 = 330 + pitchShift; // E4 nominal
    const freq2 = freq1 * 1.2589;

    osc1.frequency.setValueAtTime(freq1, now);
    osc2.frequency.setValueAtTime(freq2, now);

    const isDoubleHonk = randomizePitch && Math.random() > 0.6;
    const honkVol = randomizePitch ? 0.08 : 0.12; // Mild, comfortable honk volume

    if (isDoubleHonk) {
      gain.gain.setValueAtTime(honkVol, now);
      gain.gain.setValueAtTime(honkVol, now + 0.15);
      gain.gain.linearRampToValueAtTime(0, now + 0.18);
      
      gain.gain.setValueAtTime(honkVol, now + 0.25);
      gain.gain.setValueAtTime(honkVol, now + 0.45);
      gain.gain.linearRampToValueAtTime(0, now + 0.52);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.55);
      osc2.stop(now + 0.55);
    } else {
      gain.gain.setValueAtTime(honkVol, now);
      gain.gain.setValueAtTime(honkVol, now + 0.35);
      gain.gain.linearRampToValueAtTime(0, now + 0.42);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.45);
      osc2.stop(now + 0.45);
    }
  }

  playSiren(duration = 2.0) {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, now);

    for (let t = 0; t < duration; t += 0.4) {
      osc.frequency.linearRampToValueAtTime(1100, now + t + 0.2);
      osc.frequency.linearRampToValueAtTime(600, now + t + 0.4);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.1);
    gain.gain.setValueAtTime(0.08, now + duration - 0.2);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration);
  }

  playUIClick() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.05);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playExplosion() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Noise burst with sweeping lowpass for the boom/rumble
    const bufferSize = this.ctx.sampleRate * 1.5;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.35));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(35, now + 1.2);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.55, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 1.4);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 1.4);

    // 2. Deep sub-bass punch (sine wave sweep)
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(25, now + 0.35);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.65, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.45);
  }

  playCometIncoming() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(150, now + 1.2);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 1.0);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.25);
  }

  playCometImpact() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Massive thunderous roar
    const bufferSize = this.ctx.sampleRate * 2.5;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.6));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(30, now + 2.2);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.8, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 2.4);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 2.4);

    // Deep sub-bass earthquake boom
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.8);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.9);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.95);
  }

  playBump() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Thud impact (low pitch drop)
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.15);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);

    // 2. Short slap/bump noise
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.12);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.03));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, now);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + 0.12);
  }
}

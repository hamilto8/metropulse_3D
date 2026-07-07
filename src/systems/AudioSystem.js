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
    this.trafficGain = null;
    this.cricketGain = null;
    this.rainGain = null;

    // Timers for occasional procedural events
    this.birdTimer = 3.0;
    this.cricketTimer = 0;
    this.honkTimer = 6.0 + Math.random() * 8.0;
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
    // 1. City Rumble (low pass brown noise)
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

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 130;

    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0.22;

    whiteNoise.connect(rumbleFilter);
    rumbleFilter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.masterGain);
    whiteNoise.start();

    // 2. Traffic Ambience (Tires & Engines Swishing / Undulating hiss)
    const trafficFilter = this.ctx.createBiquadFilter();
    trafficFilter.type = 'bandpass';
    trafficFilter.frequency.value = 550;
    trafficFilter.Q.value = 1.2;

    // LFO to modulate traffic frequency (simulating cars passing by)
    const trafficLfo = this.ctx.createOscillator();
    trafficLfo.frequency.value = 0.25; // 4-second cycle
    const trafficLfoGain = this.ctx.createGain();
    trafficLfoGain.gain.value = 220; // Sweep between 330Hz and 770Hz

    trafficLfo.connect(trafficLfoGain);
    trafficLfoGain.connect(trafficFilter.frequency);

    this.trafficGain = this.ctx.createGain();
    this.trafficGain.gain.value = 0.14;

    const trafficNoise = this.ctx.createBufferSource();
    trafficNoise.buffer = noiseBuffer;
    trafficNoise.loop = true;

    trafficNoise.connect(trafficFilter);
    trafficFilter.connect(this.trafficGain);
    this.trafficGain.connect(this.masterGain);
    trafficNoise.start();
    trafficLfo.start();

    // 3. Continuous Cricket Drone for Nighttime
    const cricketOsc = this.ctx.createOscillator();
    cricketOsc.type = 'triangle';
    cricketOsc.frequency.value = 4600;

    const cricketLfo = this.ctx.createOscillator();
    cricketLfo.frequency.value = 16; // 16 Hz chirping rate
    const cricketLfoGain = this.ctx.createGain();
    cricketLfoGain.gain.value = 0.08;

    this.cricketGain = this.ctx.createGain();
    this.cricketGain.gain.value = 0; // Off during day

    cricketLfo.connect(cricketLfoGain);
    cricketLfoGain.connect(this.cricketGain.gain);

    cricketOsc.connect(this.cricketGain);
    this.cricketGain.connect(this.masterGain);
    cricketOsc.start();
    cricketLfo.start();

    // 4. Rain Weather SFX (Raindrops on asphalt and foliage)
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1800;
    rainFilter.Q.value = 0.7;

    const rainHighPass = this.ctx.createBiquadFilter();
    rainHighPass.type = 'highpass';
    rainHighPass.frequency.value = 800;

    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0; // Off unless raining

    const rainNoise = this.ctx.createBufferSource();
    rainNoise.buffer = noiseBuffer;
    rainNoise.loop = true;

    rainNoise.connect(rainFilter);
    rainFilter.connect(rainHighPass);
    rainHighPass.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainNoise.start();
  }

  update(timeVal, delta) {
    if (!this.isEnabled || !this.ctx) return;

    // 1. Adjust night vs day ambience gains
    const isNight = (timeVal >= 18.0 || timeVal < 6.0);
    const targetCricketGain = isNight ? 0.06 : 0.0;
    this.cricketGain.gain.setTargetAtTime(targetCricketGain, this.ctx.currentTime, 0.5);

    // Traffic volume: louder during daytime rush hours, quieter late at night
    const isRushHour = (timeVal >= 7.0 && timeVal <= 9.5) || (timeVal >= 16.0 && timeVal <= 18.5);
    let targetTrafficGain = isNight ? 0.06 : 0.14;
    if (isRushHour) targetTrafficGain = 0.20;
    this.trafficGain.gain.setTargetAtTime(targetTrafficGain, this.ctx.currentTime, 1.0);

    // 2. Adjust Rain SFX based on weather mode
    const isRaining = this.app && this.app.environment && this.app.environment.weatherMode === 'rain';
    const targetRainGain = isRaining ? 0.22 : 0.0;
    this.rainGain.gain.setTargetAtTime(targetRainGain, this.ctx.currentTime, 0.5);

    // 3. Daytime birds
    if (!isNight && !isRaining) {
      this.birdTimer -= delta;
      if (this.birdTimer <= 0) {
        this.playBirdChirp();
        this.birdTimer = 5.0 + Math.random() * 8.0;
      }
    }

    // 4. Occasional Cars Honking in Traffic
    this.honkTimer -= delta;
    if (this.honkTimer <= 0) {
      this.playHonk(true); // Randomized pitch
      if (isRushHour) {
        this.honkTimer = 5.0 + Math.random() * 7.0; // Frequent during rush hour
      } else if (isNight) {
        this.honkTimer = 18.0 + Math.random() * 25.0; // Rare at night
      } else {
        this.honkTimer = 9.0 + Math.random() * 12.0;
      }
    }
  }

  playBirdChirp() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const baseFreq = 2800 + Math.random() * 800;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq + 600, now + 0.08);
    osc.frequency.linearRampToValueAtTime(baseFreq - 200, now + 0.16);
    osc.frequency.linearRampToValueAtTime(baseFreq + 800, now + 0.25);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.15);
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

    // Slight randomization for different vehicle horn sizes (compact vs truck/bus)
    const pitchShift = randomizePitch ? (Math.random() * 80 - 40) : 0;
    const freq1 = 330 + pitchShift; // E4 nominal
    const freq2 = freq1 * 1.2589; // Classic minor seventh/major third interval detune

    osc1.frequency.setValueAtTime(freq1, now);
    osc2.frequency.setValueAtTime(freq2, now);

    // Double honk probability (beep-beep!)
    const isDoubleHonk = randomizePitch && Math.random() > 0.5;
    const honkVol = randomizePitch ? 0.10 : 0.15; // Slightly softer for background ambient honks

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
      osc.frequency.linearRampToValueAtTime(1200, now + t + 0.2);
      osc.frequency.linearRampToValueAtTime(600, now + t + 0.4);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.1);
    gain.gain.setValueAtTime(0.12, now + duration - 0.2);
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
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1400, now + 0.05);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.linearRampToValueAtTime(0, now + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }
}

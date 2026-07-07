export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.isEnabled = false;
    this.volume = 0.5;

    // Ambience state
    this.rumbleNode = null;
    this.rumbleGain = null;
    this.cricketGain = null;
    this.birdTimer = 3.0;
    this.cricketTimer = 0;
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
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  startBackgroundAmbience() {
    // 1. City Rumble (low pass noise)
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

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 140;

    this.rumbleGain = this.ctx.createGain();
    this.rumbleGain.gain.value = 0.25;

    whiteNoise.connect(filter);
    filter.connect(this.rumbleGain);
    this.rumbleGain.connect(this.masterGain);
    whiteNoise.start();

    // 2. Continuous Cricket Drone for Nighttime
    const cricketOsc = this.ctx.createOscillator();
    cricketOsc.type = 'triangle';
    cricketOsc.frequency.value = 4600;

    // Pulse modulation for cricket sound
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 16; // 16 Hz chirping rate
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.08;

    this.cricketGain = this.ctx.createGain();
    this.cricketGain.gain.value = 0; // Off during day

    lfo.connect(lfoGain);
    lfoGain.connect(this.cricketGain.gain);

    cricketOsc.connect(this.cricketGain);
    this.cricketGain.connect(this.masterGain);
    cricketOsc.start();
    lfo.start();
  }

  update(timeVal, delta) {
    if (!this.isEnabled || !this.ctx) return;

    // 1. Adjust night vs day ambience gain
    const isNight = (timeVal >= 18.0 || timeVal < 6.0);
    const targetCricketGain = isNight ? 0.06 : 0.0;
    this.cricketGain.gain.setTargetAtTime(targetCricketGain, this.ctx.currentTime, 0.5);

    // 2. Daytime birds
    if (!isNight) {
      this.birdTimer -= delta;
      if (this.birdTimer <= 0) {
        this.playBirdChirp();
        this.birdTimer = 4.0 + Math.random() * 6.0;
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

  playHonk() {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(330, now); // E4
    osc2.frequency.setValueAtTime(415, now); // G#4 (minor seventh detune for classic car horn)

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.setValueAtTime(0.15, now + 0.35);
    gain.gain.linearRampToValueAtTime(0, now + 0.42);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
  }

  playSiren(duration = 2.0) {
    if (!this.isEnabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, now);

    // Modulate frequency up and down
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

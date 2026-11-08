import {MUSIC_STEP, musicStep, noteHz} from './music.js';
import {mix, clamp} from './math.js';
// Every sound is synthesized locally (structure adapted from QSOLKCB/QUICKSCOPER).
// Bullet time routes the whole mix through a closing low-pass filter, lowers the
// pitch and stretches the length of new sounds, and stretches the music tempo.
export class Sound {
  constructor() { this.context = null; this.volume = 0.5; this.musicVolume = 0.3; this.muted = false; this.musicActive = false; this.musicVoices = new Set(); this.musicIndex = 0; this.nextNote = 0; this.slow = 0; }
  start() {
    try {
      if (!this.context) {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Audio) return;
        const c = this.context = new Audio();
        this.master = c.createGain();
        this.filter = c.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 18000; this.filter.Q.value = 0.9;
        this.compressor = c.createDynamicsCompressor();
        this.compressor.threshold.value = -10; this.compressor.knee.value = 12; this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.003; this.compressor.release.value = 0.2;
        this.master.connect(this.filter); this.filter.connect(this.compressor); this.compressor.connect(c.destination);
        this.musicGain = c.createGain(); this.musicGain.gain.value = this.musicVolume; this.musicGain.connect(this.master);
        const n = c.sampleRate*0.5; this.noise = c.createBuffer(1, n, c.sampleRate);
        const a = this.noise.getChannelData(0); for (let i = 0; i < n; i++) a[i] = Math.random()*2 - 1;
      }
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.context.resume().catch(() => {});
    } catch { this.context = null; }
  }
  get ready() { return this.context && this.context.state === 'running' && !this.muted; }
  setVolume(value) { this.volume = value; if (this.master) this.master.gain.value = this.muted ? 0 : value; }
  setMusicVolume(value) { this.musicVolume = value; if (this.musicGain) this.musicGain.gain.setTargetAtTime(value, this.context.currentTime, 0.02); if (!value) this.stopMusic(); }
  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; return this.muted; }
  // 0 = normal time, 1 = full bullet time.
  setSlow(amount) {
    amount = clamp(amount, 0, 1);
    if (Math.abs(amount - this.slow) < 0.01) return;
    this.slow = amount;
    if (this.filter) this.filter.frequency.setTargetAtTime(mix(18000, 950, amount**0.7), this.context.currentTime, 0.04);
  }
  get rate() { return mix(1, 0.55, this.slow); }
  stopMusic() {
    this.musicActive = false;
    for (const voice of this.musicVoices) { try { voice.stop(); } catch { /* Already ended. */ } }
    this.musicVoices.clear();
  }
  music(active, intensity = 0) {
    const c = this.context;
    if (!active || !this.ready || !this.volume || !this.musicVolume) { if (this.musicActive) this.stopMusic(); return; }
    if (!this.musicActive) { this.musicActive = true; this.nextNote = c.currentTime + 0.03; }
    if (this.nextNote < c.currentTime - 0.05) this.nextNote = c.currentTime + 0.03;
    let scheduled = 0;
    while (this.nextNote < c.currentTime + 0.12 && scheduled++ < 3) {
      for (const n of musicStep(this.musicIndex, intensity)) this.tone(noteHz(n.note), n.duration, n.type, n.volume, this.nextNote - c.currentTime, n.end || noteHz(n.note), true);
      this.nextNote += MUSIC_STEP / mix(1, 0.6, this.slow); this.musicIndex++;
    }
  }
  tone(frequency, duration, type = 'sine', volume = 0.1, delay = 0, end = frequency, music = false) {
    if (!this.ready) return;
    const c = this.context, rate = this.rate, t = c.currentTime + Math.max(0, delay), o = c.createOscillator(), g = c.createGain();
    duration /= music ? 1 : rate;
    o.type = type; o.frequency.setValueAtTime(frequency*rate, t); o.frequency.exponentialRampToValueAtTime(Math.max(10, end*rate), t + duration);
    g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(volume, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g); g.connect(music ? this.musicGain : this.master); o.start(t); o.stop(t + duration + 0.02);
    if (music) this.musicVoices.add(o);
    o.onended = () => { this.musicVoices.delete(o); o.disconnect(); g.disconnect(); };
  }
  burst(duration, volume, cutoff, delay = 0, type = 'lowpass', sweep = 0) {
    if (!this.ready) return;
    const c = this.context, rate = this.rate, t = c.currentTime + delay, n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    duration /= rate;
    n.buffer = this.noise; n.playbackRate.value = rate; f.type = type; f.frequency.setValueAtTime(cutoff*rate, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweep*rate), t + duration);
    g.gain.setValueAtTime(volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t); n.stop(t + duration);
    n.onended = () => { n.disconnect(); f.disconnect(); g.disconnect(); };
  }
  play(type, data = {}) {
    switch (type) {
      case 'shot':
        if (data.weapon === 'shotgun') { this.burst(0.4, 0.9, 3200, 0, 'lowpass', 300); this.tone(90, 0.3, 'triangle', 0.6, 0, 30); this.burst(0.08, 0.2, 2500, 0.32, 'bandpass'); this.tone(320, 0.05, 'square', 0.05, 0.38, 200); }
        else if (data.weapon === 'revolver') { this.burst(0.32, 0.85, 3800, 0, 'lowpass', 260); this.tone(110, 0.28, 'triangle', 0.55, 0, 35); this.burst(0.5, 0.18, 900, 0.08, 'lowpass', 120); }
        else if (data.weapon === 'vipers') { this.burst(0.07, 0.4, 6000, 0, 'lowpass', 1400); this.tone(190, 0.06, 'triangle', 0.22, 0, 90); }
        else if (data.weapon === 'rifle') { this.burst(0.06, 0.7, 9000, 0, 'highpass'); this.burst(0.3, 0.7, 4200, 0, 'lowpass', 240); this.tone(130, 0.24, 'triangle', 0.45, 0, 40); this.burst(0.7, 0.12, 1400, 0.12, 'bandpass', 200); this.tone(260, 0.05, 'square', 0.04, 0.3, 160); }
        else if (data.weapon === 'carbine') { this.burst(0.12, 0.55, 5200, 0, 'lowpass', 900); this.tone(150, 0.1, 'triangle', 0.35, 0, 60); }
        else { this.burst(0.17, 0.65, 4200, 0, 'lowpass', 700); this.tone(170, 0.16, 'triangle', 0.45, 0, 50); this.tone(2400, 0.03, 'square', 0.03, 0.05, 1800); }
        break;
      case 'enemyShot': this.burst(0.14, 0.18, 2200, 0, 'lowpass', 400); this.tone(120, 0.1, 'triangle', 0.08, 0, 50); break;
      case 'whiz': this.burst(0.18, 0.22, 2600, 0, 'bandpass', 900); break;
      case 'impact': this.burst(0.05, 0.12, 5000, 0, 'highpass'); break;
      case 'hit': this.tone(1350, 0.04, 'triangle', 0.18); this.burst(0.06, 0.15, 3000, 0, 'bandpass'); break;
      case 'kill': this.tone(520, 0.09, 'sine', 0.14); this.tone(780, 0.14, 'sine', 0.12, 0.06); this.burst(0.25, 0.25, 900, 0, 'lowpass', 120); break;
      case 'headshot': this.tone(1800, 0.06, 'triangle', 0.12); break;
      case 'glass':
        this.burst(0.5, 0.5, 6000, 0, 'highpass');
        for (let i = 0; i < 6; i++) this.tone(2200 + Math.random()*3200, 0.12 + Math.random()*0.25, 'sine', 0.05, Math.random()*0.25);
        break;
      case 'focusOn': this.burst(0.6, 0.45, 3000, 0, 'lowpass', 120); this.tone(320, 0.7, 'sine', 0.25, 0, 45); this.tone(640, 0.5, 'triangle', 0.05, 0, 90); break;
      case 'focusOff': this.burst(0.35, 0.3, 200, 0, 'lowpass', 5000); this.tone(60, 0.35, 'sine', 0.2, 0, 300); break;
      case 'focusDenied': this.tone(180, 0.12, 'square', 0.05); this.tone(140, 0.12, 'square', 0.05, 0.1); break;
      case 'heart': this.tone(62, 0.16, 'sine', 0.55, 0, 38); this.tone(58, 0.14, 'sine', 0.38, 0.2, 36); break;
      case 'dive': this.burst(0.4, 0.3, 1200, 0, 'bandpass', 400); this.tone(200, 0.25, 'sine', 0.08, 0, 120); break;
      case 'land': this.burst(0.18, 0.5, 500, 0, 'lowpass', 90); this.tone(70, 0.2, 'triangle', 0.4, 0, 30); break;
      case 'reload': this.burst(0.08, 0.18, 3500); this.tone(240, 0.06, 'square', 0.04, 0.05); break;
      case 'loaded': this.burst(0.06, 0.25, 4500); this.tone(300, 0.04, 'square', 0.05); break;
      case 'switch': this.burst(0.07, 0.15, 2500); this.tone(420, 0.05, 'square', 0.03, 0.06); break;
      case 'damage': this.burst(0.18, 0.35, 700); this.tone(85, 0.18, 'triangle', 0.3, 0, 30); break;
      case 'spawn': this.tone(220, 0.4, 'sine', 0.06, 0, 440); break;
      case 'wave': [196, 233, 294].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.06, i*0.12)); break;
      case 'waveClear': [392, 494, 587, 784].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.1, i*0.09)); break;
      case 'killcamStart': this.burst(1.2, 0.35, 1800, 0, 'bandpass', 300); this.tone(110, 1.2, 'sine', 0.2, 0, 70); break;
      case 'killcamImpact': this.burst(0.8, 0.6, 1500, 0, 'lowpass', 80); this.tone(55, 0.9, 'sine', 0.5, 0, 30); break;
      case 'death': this.tone(110, 1.4, 'sawtooth', 0.12, 0, 30); this.burst(1, 0.4, 600, 0, 'lowpass', 60); break;
      case 'start': [262, 311, 392].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.1, i*0.1)); break;
      case 'end': [392, 311, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.12, i*0.14)); break;
    }
  }
}

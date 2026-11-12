import * as THREE from 'three';
import { settings } from './settings';

/**
 * Fully procedural audio: every sound is synthesized with WebAudio at play time.
 * Zero downloads, tiny bundle, and every hero gets a signature sonic identity.
 */
export type Sfx =
  | 'photon' | 'gravity' | 'emcCharge' | 'boom'
  | 'bell' | 'dash' | 'bass808' | 'mode2093'
  | 'paint' | 'splat' | 'bloom' | 'starry'
  | 'hit' | 'crit' | 'kill' | 'hurt' | 'jump' | 'heal' | 'ui' | 'uiHover' | 'respawn' | 'victory' | 'defeat'
  | 'denied' | 'ultReady' | 'pickup' | 'countdown' | 'go';

const PENTA = [0, 2, 4, 7, 9, 12, 14];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private dist!: WaveShaperNode;
  private listenerPos = new THREE.Vector3();
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private lastPlayed = new Map<string, number>();
  private voices = 0;
  private musicNodes: AudioNode[] = [];
  private musicTimer: number | null = null;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = settings.music * 0.35;
    this.sfxBus.connect(comp);
    this.musicBus.connect(comp);
    comp.connect(this.master).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3.5); }
    this.dist.curve = curve;
    this.dist.connect(this.sfxBus);
  }

  setVolume(v: number) { if (this.ctx) this.master.gain.value = v; }
  setMusic(v: number) { if (this.ctx) this.musicBus.gain.value = v * 0.35; }

  setListener(pos: THREE.Vector3, camera: THREE.Camera) {
    this.listenerPos.copy(pos);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  private out(pos?: THREE.Vector3, vol = 1): AudioNode | null {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let gain = vol;
    if (pos) {
      const dx = pos.x - this.listenerPos.x, dy = pos.y - this.listenerPos.y, dz = pos.z - this.listenerPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gain *= 1 / (1 + dist * 0.09);
      if (gain < 0.025) return null;
      const p = ctx.createStereoPanner();
      const inv = dist > 0.001 ? 1 / dist : 0;
      p.pan.value = Math.max(-0.85, Math.min(0.85, (dx * this.listenerRight.x + dz * this.listenerRight.z) * inv));
      g.connect(p).connect(this.sfxBus);
    } else {
      g.connect(this.sfxBus);
    }
    g.gain.value = gain;
    return g;
  }

  private env(param: AudioParam, t: number, a: number, peak: number, d: number, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(end, t + a + d);
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode) {
    const o = this.ctx!.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number, dest: AudioNode) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    s.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return s;
  }

  play(name: Sfx, pos?: THREE.Vector3, vol = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const key = name;
    const last = this.lastPlayed.get(key) ?? -1;
    if (now - last < 0.025) return; // dedupe stacked identical sounds
    this.lastPlayed.set(key, now);
    if (this.voices > 40) return;
    const out = this.out(pos, vol);
    if (!out) return;
    this.voices++;
    const t = now + 0.005;
    let life = 1;
    switch (name) {
      case 'photon': {
        const g = ctx.createGain(); g.connect(out);
        this.env(g.gain, t, 0.004, 0.32, 0.12);
        const o = this.osc('square', 2200, t, 0.14, g);
        o.frequency.exponentialRampToValueAtTime(420, t + 0.12);
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
        const ng = ctx.createGain(); this.env(ng.gain, t, 0.002, 0.25, 0.04);
        f.connect(ng).connect(out); this.noiseSrc(t, 0.06, f);
        const s = this.osc('sine', 3400, t, 0.18, g); s.frequency.exponentialRampToValueAtTime(1800, t + 0.15);
        life = 0.25; break;
      }
      case 'gravity': {
        const g = ctx.createGain(); g.connect(out);
        this.env(g.gain, t, 0.1, 0.6, 2.6);
        const o = this.osc('sine', 140, t, 2.8, g); o.frequency.exponentialRampToValueAtTime(38, t + 2.6);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
        const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + 2.9);
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
        f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(200, t + 1.5);
        const ng = ctx.createGain(); this.env(ng.gain, t, 0.3, 0.35, 1.6);
        f.connect(ng).connect(out); this.noiseSrc(t, 2, f);
        life = 3; break;
      }
      case 'emcCharge': {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 8;
        f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(6000, t + 1.3);
        const g = ctx.createGain(); g.connect(out);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 1.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.45);
        f.connect(g);
        for (const det of [-12, 0, 7, 12]) {
          const o = this.osc('sawtooth', 110 * Math.pow(2, det / 12), t, 1.5, f);
          o.frequency.exponentialRampToValueAtTime(440 * Math.pow(2, det / 12), t + 1.3);
        }
        life = 1.6; break;
      }
      case 'boom': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.005, 1.0, 1.4);
        const o = this.osc('sine', 120, t, 1.5, g); o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.2);
        const ng = ctx.createGain(); this.env(ng.gain, t, 0.003, 0.9, 1.3); f.connect(ng).connect(out); this.noiseSrc(t, 1.5, f);
        const sh = ctx.createGain(); this.env(sh.gain, t + 0.02, 0.01, 0.18, 2.2); sh.connect(out);
        for (const n of [0, 4, 7, 11]) this.osc('sine', 880 * Math.pow(2, n / 12), t, 2.4, sh);
        life = 2.5; break;
      }
      case 'bell': {
        // FM bell — Yeat's signature
        const note = 523.25 * Math.pow(2, PENTA[Math.floor(Math.random() * PENTA.length)] / 12);
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.002, 0.42, 1.3);
        const car = this.osc('sine', note, t, 1.4, g);
        const mod = ctx.createOscillator(); mod.frequency.value = note * 3.5;
        const mg = ctx.createGain(); mg.gain.setValueAtTime(note * 5, t); mg.gain.exponentialRampToValueAtTime(note * 0.2, t + 1.1);
        mod.connect(mg).connect(car.frequency); mod.start(t); mod.stop(t + 1.45);
        const g2 = ctx.createGain(); g2.connect(out); this.env(g2.gain, t, 0.002, 0.15, 0.6);
        this.osc('sine', note * 2.01, t, 0.7, g2);
        life = 1.5; break;
      }
      case 'dash': {
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.5;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.28);
        const g = ctx.createGain(); this.env(g.gain, t, 0.03, 0.7, 0.35); f.connect(g).connect(out); this.noiseSrc(t, 0.45, f);
        const s = ctx.createGain(); this.env(s.gain, t, 0.005, 0.5, 0.3); s.connect(this.dist);
        const o = this.osc('sine', 90, t, 0.35, s); o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
        life = 0.5; break;
      }
      case 'bass808': {
        const g = ctx.createGain(); this.env(g.gain, t, 0.004, 0.55 * (pos ? 1 : 1), 0.8); g.connect(this.dist);
        const o = this.osc('sine', 150, t, 0.9, g); o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
        const c = ctx.createGain(); this.env(c.gain, t, 0.001, 0.4, 0.05); c.connect(out);
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2000; f.connect(c); this.noiseSrc(t, 0.06, f);
        life = 1; break;
      }
      case 'mode2093': {
        const g = ctx.createGain(); this.env(g.gain, t, 0.01, 0.8, 1.8); g.connect(this.dist);
        const o = this.osc('sine', 220, t, 2, g); o.frequency.exponentialRampToValueAtTime(36, t + 1.2);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 12;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(8000, t + 0.6); f.frequency.exponentialRampToValueAtTime(400, t + 2);
        const sg = ctx.createGain(); this.env(sg.gain, t, 0.05, 0.3, 1.8); f.connect(sg).connect(out);
        for (const d of [0, 0.07, -0.05]) this.osc('sawtooth', 55 * (1 + d), t, 2, f);
        const bg = ctx.createGain(); this.env(bg.gain, t + 0.15, 0.002, 0.3, 1.5); bg.connect(out);
        for (const n of [0, 3, 7, 10]) this.osc('sine', 622 * Math.pow(2, n / 12), t + 0.15, 1.6, bg);
        life = 2.2; break;
      }
      case 'paint': {
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
        const g = ctx.createGain(); this.env(g.gain, t, 0.005, 0.4, 0.12); f.connect(g).connect(out); this.noiseSrc(t, 0.15, f);
        const p = ctx.createGain(); this.env(p.gain, t, 0.002, 0.2, 0.15); p.connect(out);
        const o = this.osc('triangle', 660, t, 0.18, p); o.frequency.exponentialRampToValueAtTime(990, t + 0.1);
        life = 0.3; break;
      }
      case 'splat': {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.2);
        const g = ctx.createGain(); this.env(g.gain, t, 0.003, 0.55, 0.22); f.connect(g).connect(out); this.noiseSrc(t, 0.3, f);
        const th = ctx.createGain(); this.env(th.gain, t, 0.002, 0.4, 0.14); th.connect(out);
        const o = this.osc('sine', 180, t, 0.2, th); o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
        life = 0.4; break;
      }
      case 'bloom': {
        const notes = [0, 4, 7, 12, 16];
        notes.forEach((n, i) => {
          const g = ctx.createGain(); g.connect(out);
          this.env(g.gain, t + i * 0.07, 0.01, 0.22, 0.9);
          this.osc('sine', 587.33 * Math.pow(2, n / 12), t + i * 0.07, 1.0, g);
          this.osc('triangle', 587.33 * 2 * Math.pow(2, n / 12), t + i * 0.07, 0.5, g);
        });
        life = 1.5; break;
      }
      case 'starry': {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1.5); f.frequency.exponentialRampToValueAtTime(600, t + 7);
        const g = ctx.createGain(); g.connect(out);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 1.2); g.gain.setValueAtTime(0.35, t + 5.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 7.5);
        f.connect(g);
        for (const n of [0, 7, 12, 16, 19, 23]) for (const d of [-0.004, 0.004]) this.osc('sawtooth', 130.81 * Math.pow(2, n / 12) * (1 + d), t, 7.5, f);
        const sh = ctx.createGain(); sh.connect(out);
        sh.gain.setValueAtTime(0.0001, t); sh.gain.exponentialRampToValueAtTime(0.08, t + 2); sh.gain.exponentialRampToValueAtTime(0.0001, t + 7.4);
        for (let i = 0; i < 8; i++) { const o = this.osc('sine', 1046.5 * Math.pow(2, PENTA[i % 7] / 12), t + i * 0.6, 1.2, sh); o.detune.value = Math.random() * 10; }
        life = 7.6; break;
      }
      case 'hit': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.001, 0.25, 0.05);
        this.osc('triangle', 2600, t, 0.07, g);
        life = 0.1; break;
      }
      case 'crit': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.001, 0.3, 0.12);
        this.osc('triangle', 3300, t, 0.14, g); this.osc('sine', 1650, t, 0.14, g);
        life = 0.2; break;
      }
      case 'kill': {
        [0, 7, 12].forEach((n, i) => {
          const g = ctx.createGain(); g.connect(out); this.env(g.gain, t + i * 0.06, 0.003, 0.3, 0.45);
          this.osc('triangle', 880 * Math.pow(2, n / 12), t + i * 0.06, 0.5, g);
        });
        life = 0.7; break;
      }
      case 'hurt': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.003, 0.5, 0.18);
        const o = this.osc('sine', 160, t, 0.2, g); o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
        life = 0.25; break;
      }
      case 'jump': {
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1500, t + 0.15);
        const g = ctx.createGain(); this.env(g.gain, t, 0.01, 0.15, 0.15); f.connect(g).connect(out); this.noiseSrc(t, 0.2, f);
        life = 0.25; break;
      }
      case 'heal': {
        [0, 5, 9].forEach((n, i) => {
          const g = ctx.createGain(); g.connect(out); this.env(g.gain, t + i * 0.05, 0.01, 0.1, 0.3);
          this.osc('sine', 1318 * Math.pow(2, n / 12), t + i * 0.05, 0.35, g);
        });
        life = 0.5; break;
      }
      case 'pickup': {
        [0, 4, 7, 12].forEach((n, i) => {
          const g = ctx.createGain(); g.connect(out); this.env(g.gain, t + i * 0.045, 0.005, 0.22, 0.3);
          this.osc('triangle', 784 * Math.pow(2, n / 12), t + i * 0.045, 0.35, g);
        });
        life = 0.5; break;
      }
      case 'ui': case 'uiHover': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.001, name === 'ui' ? 0.18 : 0.05, 0.06);
        this.osc('sine', name === 'ui' ? 1200 : 1800, t, 0.08, g);
        life = 0.1; break;
      }
      case 'denied': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.002, 0.15, 0.12);
        this.osc('square', 140, t, 0.14, g);
        life = 0.2; break;
      }
      case 'ultReady': {
        [0, 7, 12, 19].forEach((n, i) => {
          const g = ctx.createGain(); g.connect(out); this.env(g.gain, t + i * 0.08, 0.005, 0.18, 0.6);
          this.osc('sine', 523 * Math.pow(2, n / 12), t + i * 0.08, 0.7, g);
        });
        life = 1; break;
      }
      case 'respawn': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.2, 0.2, 0.7);
        const o = this.osc('sine', 300, t, 0.9, g); o.frequency.exponentialRampToValueAtTime(1200, t + 0.8);
        life = 1; break;
      }
      case 'countdown': case 'go': {
        const g = ctx.createGain(); g.connect(out); this.env(g.gain, t, 0.002, 0.3, name === 'go' ? 0.8 : 0.25);
        this.osc('triangle', name === 'go' ? 1320 : 660, t, name === 'go' ? 0.9 : 0.3, g);
        life = 1; break;
      }
      case 'victory': case 'defeat': {
        const seq = name === 'victory' ? [0, 4, 7, 12, 16, 19, 24] : [7, 3, 0, -5];
        seq.forEach((n, i) => {
          const g = ctx.createGain(); g.connect(out); this.env(g.gain, t + i * 0.12, 0.01, 0.25, 0.9);
          this.osc('triangle', 392 * Math.pow(2, n / 12), t + i * 0.12, 1, g);
          this.osc('sine', 196 * Math.pow(2, n / 12), t + i * 0.12, 1, g);
        });
        life = 2; break;
      }
    }
    setTimeout(() => { this.voices--; }, life * 1000);
  }

  /** Generative ambient bed for menus/matches: slow evolving chord pad. */
  startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    const chords = [[0, 7, 12, 16], [-3, 4, 9, 12], [-7, 0, 5, 9], [-5, 2, 7, 11]];
    let i = 0;
    const playChord = () => {
      const ctx = this.ctx!;
      const t = ctx.currentTime + 0.05;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 2.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 8.5);
      f.connect(g).connect(this.musicBus);
      for (const n of chords[i % chords.length]) {
        for (const d of [-0.003, 0.003]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 196 * Math.pow(2, n / 12) * (1 + d);
          o.connect(f); o.start(t); o.stop(t + 8.6);
        }
      }
      const bell = ctx.createGain(); bell.gain.setValueAtTime(0.0001, t + 1); bell.gain.exponentialRampToValueAtTime(0.04, t + 1.02); bell.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      bell.connect(this.musicBus);
      const o = ctx.createOscillator(); o.frequency.value = 784 * Math.pow(2, chords[i % chords.length][2] / 12); o.connect(bell); o.start(t + 1); o.stop(t + 4.2);
      this.musicNodes = [g];
      i++;
    };
    playChord();
    this.musicTimer = window.setInterval(playChord, 6000);
  }

  stopMusic() {
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
    for (const n of this.musicNodes) n.disconnect();
    this.musicNodes = [];
  }
}

export const audio = new AudioEngine();

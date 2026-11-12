import * as THREE from 'three';
import { settings } from './settings';
import { RECIPES, BAKE_ORDER, renderRecipe, type Sfx, type Recipe } from '../audio/bank';
import { impulseResponse } from '../audio/synth';

export type { Sfx };

/**
 * Audio engine. Every sound is designed procedurally in audio/bank.ts and baked into
 * buffers once when audio unlocks, so firing one at runtime is just a buffer source,
 * a gain and a panner. The mix: SFX / UI / voice / music buses, a shared convolution
 * reverb whose send grows with distance, air absorption on far sounds, ducking under
 * voice lines and big moments, and a "doom" filter on the music for The Bell.
 */

export interface PlayOpts { variant?: number; rate?: number }

export interface LoopHandle {
  set(pos: THREE.Vector3 | null, rate: number, vol: number): void;
  stop(fade?: number): void;
}

export interface VoiceChain {
  /** high-pass Hz */ hp: number;
  /** low-pass Hz */ lp: number;
  /** 0..1 saturation */ drive: number;
  /** slapback delay seconds (0 = off) */ slap: number;
  slapMix: number;
  reverb: number;
  /** playback rate (pitch) */ rate: number;
  gain: number;
}

interface Voice { src: AudioBufferSourceNode; gain: GainNode; nodes: AudioNode[]; name: Sfx }

const semi = (n: number) => Math.pow(2, n / 12);
const MAX_VOICES = 72;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private voiceBus!: GainNode;
  private musicBus!: GainNode;
  private sfxDuck!: GainNode;
  private musicDuck!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private reverbIn!: GainNode;
  private bank = new Map<Sfx, AudioBuffer[]>();
  private lastVariant = new Map<Sfx, number>();
  private lastPlayed = new Map<Sfx, number>();
  private active = new Map<Sfx, Voice[]>();
  private total = 0;
  private hearPos = new THREE.Vector3(0, 0, 0);
  private panPos = new THREE.Vector3(0, 0, 0);
  private right = new THREE.Vector3(1, 0, 0);
  private doomLevel = 0;
  private chains = new Map<string, GainNode>();
  private voiceCache = new Map<string, Promise<AudioBuffer | null>>();
  private voiceReady = new Map<string, AudioBuffer | null>();
  private musicNodes: AudioNode[] = [];
  private musicTimer: number | null = null;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    // master chain: glue compressor → brickwall-ish limiter → master volume
    const pre = g();
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.005; glue.release.value = 0.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2.5; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.08;
    this.master = g(settings.volume);
    pre.connect(glue).connect(limit).connect(this.master).connect(ctx.destination);

    this.sfxBus = g(); this.sfxDuck = g();
    this.sfxBus.connect(this.sfxDuck).connect(pre);
    this.uiBus = g(); this.uiBus.connect(pre);
    this.voiceBus = g(settings.voice ?? 0.9); this.voiceBus.connect(pre);
    this.musicBus = g(settings.music * 0.35);
    this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass'; this.musicFilter.frequency.value = 18000; this.musicFilter.Q.value = 0.9;
    this.musicDuck = g();
    this.musicBus.connect(this.musicFilter).connect(this.musicDuck).connect(pre);

    // shared reverb: one convolver for the whole world
    this.reverbIn = g();
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = impulseResponse(ctx.sampleRate, 2.4, 3.2, 0.5, 21);
    const ret = g(0.42);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
    this.reverbIn.connect(hp).connect(conv).connect(ret).connect(pre);

    void this.bake();
  }

  private async bake() {
    const sr = this.ctx!.sampleRate;
    const t0 = performance.now();
    for (const name of BAKE_ORDER) {
      const r: Recipe = RECIPES[name];
      const n = r.variants ?? 1;
      const out: AudioBuffer[] = [];
      for (let v = 0; v < n; v++) {
        try { out.push(await renderRecipe(name, v, sr)); } catch (e) { console.warn('[audio] bake failed', name, e); }
      }
      if (out.length) this.bank.set(name, out);
    }
    console.info(`[audio] ${this.bank.size} sounds baked in ${Math.round(performance.now() - t0)} ms`);
  }

  setVolume(v: number) { if (this.ctx) this.master.gain.value = v; }
  setMusic(v: number) { if (this.ctx) this.musicBus.gain.value = v * 0.35; }
  setVoice(v: number) { if (this.ctx) this.voiceBus.gain.value = v; }

  /** Mute the world (not the UI) while the game is paused. */
  setWorldPaused(p: boolean) {
    if (!this.ctx) return;
    this.sfxBus.gain.setTargetAtTime(p ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** Pan from the camera, attenuate from `hear` (the local hero), like third-person games do. */
  setListener(camPos: THREE.Vector3, camera: THREE.Camera, hear?: THREE.Vector3) {
    this.panPos.copy(camPos);
    this.hearPos.copy(hear ?? camPos);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this.right.y = 0;
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();
  }

  /** 0..1: The Bell's doom sky muffles the music. */
  setDoom(d: number) {
    if (!this.ctx || Math.abs(d - this.doomLevel) < 0.01) return;
    this.doomLevel = d;
    this.musicFilter.frequency.setTargetAtTime(18000 * Math.pow(380 / 18000, d), this.ctx.currentTime, 0.08);
  }

  /** Briefly pull the SFX and music down (voice lines, huge moments). */
  duck(dur: number, sfx = 0.72, music = 0.5) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [node, v] of [[this.sfxDuck, sfx], [this.musicDuck, music]] as [GainNode, number][]) {
      node.gain.cancelScheduledValues(now);
      node.gain.setTargetAtTime(v, now, 0.04);
      node.gain.setTargetAtTime(1, now + dur, 0.3);
    }
  }

  private spatial(pos: THREE.Vector3 | null | undefined) {
    if (!pos) return { gain: 1, pan: 0, lp: 22000, wet: 1 };
    const h = this.hearPos;
    const d = Math.hypot(pos.x - h.x, pos.y - h.y, pos.z - h.z);
    const gain = 1 / (1 + Math.max(0, d - 2) * 0.075);
    const px = pos.x - this.panPos.x, pz = pos.z - this.panPos.z;
    const pl = Math.hypot(px, pz);
    const pan = pl > 0.5 ? Math.max(-0.85, Math.min(0.85, ((px * this.right.x + pz * this.right.z) / pl) * 0.9)) : 0;
    const lp = d > 8 ? Math.max(1400, 22000 * Math.exp(-(d - 8) / 22)) : 22000;
    const wet = 0.6 + Math.min(1, d / 35) * 1.2;
    return { gain, pan, lp, wet };
  }

  private release(v: Voice) {
    const list = this.active.get(v.name);
    if (list) { const i = list.indexOf(v); if (i >= 0) { list.splice(i, 1); this.total--; } }
    for (const n of v.nodes) n.disconnect();
  }

  private steal(v: Voice) {
    const now = this.ctx!.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.012);
    try { v.src.stop(now + 0.05); } catch { /* already stopped */ }
    const list = this.active.get(v.name);
    if (list) { const i = list.indexOf(v); if (i >= 0) { list.splice(i, 1); this.total--; } }
  }

  play(name: Sfx, pos?: THREE.Vector3 | null, vol = 1, opts: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const bufs = this.bank.get(name);
    if (!bufs) return;
    const r: Recipe = RECIPES[name];
    const now = ctx.currentTime;
    const dedupe = r.dedupe ?? 0.025;
    if (dedupe > 0 && now - (this.lastPlayed.get(name) ?? -1) < dedupe) return;
    const sp = this.spatial(pos);
    const gain = vol * (r.level ?? 1) * sp.gain;
    if (gain < 0.008 || this.total >= MAX_VOICES) return;
    this.lastPlayed.set(name, now);

    let list = this.active.get(name);
    if (!list) { list = []; this.active.set(name, list); }
    const max = r.maxVoices ?? 8;
    while (list.length >= max) this.steal(list[0]);

    let vi = opts.variant ?? Math.floor(Math.random() * bufs.length);
    if (opts.variant === undefined && bufs.length > 1 && vi === this.lastVariant.get(name)) vi = (vi + 1) % bufs.length;
    vi = Math.min(vi, bufs.length - 1);
    this.lastVariant.set(name, vi);

    const src = ctx.createBufferSource();
    src.buffer = bufs[vi];
    src.playbackRate.value = (opts.rate ?? 1) * (r.jitter ? semi((Math.random() * 2 - 1) * r.jitter) : 1);
    const g = ctx.createGain();
    g.gain.value = gain;
    const nodes: AudioNode[] = [src, g];
    if (sp.lp < 20000) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp.lp; f.Q.value = 0.5;
      src.connect(f).connect(g); nodes.push(f);
    } else src.connect(g);
    const bus = r.bus === 'ui' ? this.uiBus : this.sfxBus;
    if (pos) {
      const p = ctx.createStereoPanner(); p.pan.value = sp.pan;
      g.connect(p).connect(bus); nodes.push(p);
    } else g.connect(bus);
    const wet = (r.reverb ?? 0.1) * sp.wet;
    if (wet > 0.01) { const s = ctx.createGain(); s.gain.value = wet; g.connect(s).connect(this.reverbIn); nodes.push(s); }
    const voice: Voice = { src, gain: g, nodes, name };
    list.push(voice);
    this.total++;
    src.onended = () => this.release(voice);
    src.start(now + 0.002);
  }

  /** A looping sound whose position, pitch and level can be steered every frame. */
  loop(name: Sfx, pos?: THREE.Vector3 | null, vol = 1): LoopHandle | null {
    const ctx = this.ctx;
    const bufs = this.bank.get(name);
    if (!ctx || ctx.state !== 'running' || !bufs) return null;
    const r: Recipe = RECIPES[name];
    const src = ctx.createBufferSource();
    src.buffer = bufs[0];
    src.loop = true;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 22000;
    const p = ctx.createStereoPanner();
    src.connect(lp).connect(g).connect(p).connect(this.sfxBus);
    const send = ctx.createGain(); send.gain.value = 0;
    g.connect(send).connect(this.reverbIn);
    const level = r.level ?? 1;
    let stopped = false;
    const set = (ps: THREE.Vector3 | null, rate: number, v: number) => {
      if (stopped) return;
      const sp = this.spatial(ps);
      const now = ctx.currentTime;
      g.gain.setTargetAtTime(v * level * sp.gain, now, 0.05);
      p.pan.setTargetAtTime(sp.pan, now, 0.05);
      lp.frequency.setTargetAtTime(sp.lp, now, 0.05);
      send.gain.setTargetAtTime((r.reverb ?? 0.1) * sp.wet, now, 0.1);
      src.playbackRate.setTargetAtTime(rate, now, 0.06);
    };
    g.gain.value = 0;
    set(pos ?? null, 1, vol);
    src.start(ctx.currentTime + 0.002, Math.random() * src.buffer.duration);
    this.total++;
    return {
      set,
      stop: (fade = 0.2) => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, fade / 4);
        src.stop(now + fade + 0.05);
        src.onended = () => { this.total--; for (const n of [src, lp, g, p, send]) n.disconnect(); };
      },
    };
  }

  // ───────────────────────── voice lines ─────────────────────────

  /** Start loading a recorded line (cached). */
  loadVoice(url: string) {
    let p = this.voiceCache.get(url);
    if (!p) {
      p = (async () => {
        try {
          const ctx = this.ctx;
          if (!ctx) return null;
          const res = await fetch(url);
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.voiceReady.set(url, buf);
          return buf;
        } catch (e) {
          console.warn('[audio] voice line failed to load', url, e);
          this.voiceReady.set(url, null);
          return null;
        }
      })();
      this.voiceCache.set(url, p);
    }
    return p;
  }

  /** Decoded buffer if it's ready right now (and kicks off the load if it isn't). */
  voiceBuffer(url: string) {
    if (!this.ctx) return null;
    if (!this.voiceCache.has(url)) void this.loadVoice(url);
    return this.voiceReady.get(url) ?? null;
  }

  private chain(id: string, c: VoiceChain) {
    const ctx = this.ctx!;
    let input = this.chains.get(id);
    if (input) return input;
    input = ctx.createGain(); input.gain.value = c.gain;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = c.hp; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = c.lp; lp.Q.value = 0.7;
    const sum = ctx.createGain();
    input.connect(hp).connect(lp);
    const dry = ctx.createGain(); dry.gain.value = 1 - c.drive * 0.6;
    lp.connect(dry).connect(sum);
    if (c.drive > 0) {
      const sh = ctx.createWaveShaper();
      const curve = new Float32Array(1024);
      const k = 1 + c.drive * 5;
      for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
      sh.curve = curve;
      const wet = ctx.createGain(); wet.gain.value = c.drive * 0.8;
      lp.connect(sh).connect(wet).connect(sum);
    }
    sum.connect(this.voiceBus);
    if (c.slap > 0) {
      const d = ctx.createDelay(1); d.delayTime.value = c.slap;
      const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 3500;
      const dg = ctx.createGain(); dg.gain.value = c.slapMix;
      sum.connect(d).connect(dl).connect(dg).connect(this.voiceBus);
    }
    const rv = ctx.createGain(); rv.gain.value = c.reverb;
    sum.connect(rv).connect(this.reverbIn);
    this.chains.set(id, input);
    return input;
  }

  /** Play a recorded line through the hero's voice chain. Returns its length and a stop(). */
  playVoice(buf: AudioBuffer, chainId: string, chain: VoiceChain, pos: THREE.Vector3 | null, vol = 1) {
    const ctx = this.ctx!;
    const sp = this.spatial(pos);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = chain.rate;
    const g = ctx.createGain(); g.gain.value = vol * Math.max(0.35, sp.gain);
    const p = ctx.createStereoPanner(); p.pan.value = sp.pan * 0.7;
    src.connect(g).connect(p).connect(this.chain(chainId, chain));
    src.start(ctx.currentTime + 0.01);
    const dur = buf.duration / chain.rate;
    this.duck(dur, 0.78, 0.55);
    src.onended = () => { src.disconnect(); g.disconnect(); p.disconnect(); };
    return {
      dur,
      stop: () => {
        const now = ctx.currentTime;
        g.gain.setTargetAtTime(0, now, 0.03);
        try { src.stop(now + 0.15); } catch { /* done */ }
      },
    };
  }

  // ───────────────────────── music ─────────────────────────

  /** Generative ambient bed for menus/matches: slow evolving chord pad with a glass bell. */
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
      const send = ctx.createGain(); send.gain.value = 0.25;
      g.connect(send).connect(this.reverbIn);
      for (const n of chords[i % chords.length]) {
        for (const d of [-0.003, 0.003]) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 196 * Math.pow(2, n / 12) * (1 + d);
          o.connect(f); o.start(t); o.stop(t + 8.6);
        }
      }
      const bell = ctx.createGain(); bell.gain.setValueAtTime(0.0001, t + 1); bell.gain.exponentialRampToValueAtTime(0.04, t + 1.02); bell.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      bell.connect(this.musicBus);
      bell.connect(send);
      const o = ctx.createOscillator(); o.frequency.value = 784 * Math.pow(2, chords[i % chords.length][2] / 12); o.connect(bell); o.start(t + 1); o.stop(t + 4.2);
      this.musicNodes = [g, send];
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

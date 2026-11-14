import * as THREE from 'three';
import { audio } from '../core/Audio';

/**
 * The Tonka's voice: a live V8 (engineWorklet.js) driven like a real drivetrain.
 *
 * - Speed maps to rpm through a three-speed gearbox, so the engine climbs, shifts (rpm falls,
 *   a clunk from the shifter, sometimes a pop from the pipes) and climbs again.
 * - Throttle is load: flooring it (W) leans the engine into a harder, raspier note.
 * - A supercharger whine rides on top, pitched to the crank and loudest at full load.
 * - Transforming blips the throttle from idle; ending lifts off, and the overrun crackles and
 *   pops before the engine dies away.
 * The whole thing sits in the world like any other sound: panned, distance-faded, filtered
 * when the truck is behind you or behind the clutter.
 */
const GEARS = [
  { top: 11, lo: 2300, hi: 6700 },
  { top: 18.5, lo: 4300, hi: 6700 },
  { top: 26, lo: 4800, hi: 6350 },
];
const IDLE = 900;

export class TonkaEngine {
  private node: AudioWorkletNode;
  private out: GainNode;
  private lp: BiquadFilterNode;
  private pan: StereoPannerNode;
  private send: GainNode;
  private whine: OscillatorNode;
  private whine2: OscillatorNode;
  private whineGain: GainNode;
  private wbp: BiquadFilterNode;
  private gear = 0;
  private cut = 0;
  private dead = false;
  private t = 0;
  private lastPos = new THREE.Vector3();

  static create(pos: THREE.Vector3) {
    if (!audio.ctx || !audio.engineReady || audio.ctx.state !== 'running') return null;
    try { return new TonkaEngine(pos); } catch (e) { console.warn('[audio] engine failed', e); return null; }
  }

  private constructor(pos: THREE.Vector3) {
    const ctx = audio.ctx!;
    this.node = new AudioWorkletNode(ctx, 'v8-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.5;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.send = ctx.createGain(); this.send.gain.value = 0.05;
    // supercharger: two detuned partials through a resonant band, a classic blower whine
    this.whine = ctx.createOscillator(); this.whine.type = 'sawtooth';
    this.whine2 = ctx.createOscillator(); this.whine2.type = 'sine';
    const wbp = this.wbp = ctx.createBiquadFilter(); wbp.type = 'bandpass'; wbp.Q.value = 6;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(wbp); this.whine2.connect(this.whineGain); wbp.connect(this.whineGain);
    this.whine.frequency.value = 400; this.whine2.frequency.value = 800;
    wbp.frequency.value = 1200;
    this.whineGain.connect(this.lp);
    this.node.connect(this.lp).connect(this.out).connect(this.pan).connect(audio.sfxOut);
    this.out.connect(this.send).connect(audio.reverbSend);
    this.whine.start(); this.whine2.start();
    this.lastPos.copy(pos);
    this.param('rpm').value = IDLE;
    this.param('load').value = 0.2;
  }

  private param(n: 'rpm' | 'load' | 'gain') { return this.node.parameters.get(n)!; }

  /** Speed in m/s, throttle 0..1. Call every frame while driving. */
  update(dt: number, pos: THREE.Vector3, speed: number, throttle: number) {
    if (this.dead) return;
    const ctx = audio.ctx!;
    const now = ctx.currentTime;
    this.t += dt;
    // gearbox: pick the gear for this speed; upshifts cut the throttle for a beat
    let g = 0;
    while (g < GEARS.length - 1 && speed > GEARS[g].top) g++;
    if (g > this.gear) {
      this.cut = 0.13;
      audio.play('gearShift', pos, 0.9);
      if (Math.random() < 0.6) setTimeout(() => audio.play('backfire', this.lastPos, 0.7), 40);
    }
    this.gear = g;
    const G = GEARS[g], lo = g === 0 ? 0 : GEARS[g - 1].top;
    let want = G.lo + (G.hi - G.lo) * Math.min(1, Math.max(0, (speed - lo) / (G.top - lo)));
    // transform: blip from idle up to the first-gear note
    if (this.t < 0.55) want = IDLE + (want - IDLE) * Math.min(1, this.t / 0.35) + Math.sin(Math.min(1, this.t / 0.55) * Math.PI) * 1800;
    this.cut = Math.max(0, this.cut - dt);
    const load = this.cut > 0 ? 0.08 : throttle;
    // a small rev-limiter flutter when pinned at the top of the last gear
    if (g === GEARS.length - 1 && want > 6300) want += Math.sin(this.t * 38) * 60;
    this.param('rpm').setTargetAtTime(want, now, this.cut > 0 ? 0.05 : 0.04);
    this.param('load').setTargetAtTime(load, now, 0.03);
    // whine pitched to the crank (blower overdriven ~2.1x, 4 lobes)
    const wf = (want / 60) * 2.1 * 4;
    this.whine.frequency.setTargetAtTime(wf, now, 0.04);
    this.whine2.frequency.setTargetAtTime(wf * 2.01, now, 0.04);
    this.wbp.frequency.setTargetAtTime(wf * 1.5, now, 0.05);
    const wl = load * Math.pow(want / 6500, 2) * 0.05;
    this.whineGain.gain.setTargetAtTime(wl, now, 0.06);
    this.place(pos, 1);
  }

  private place(pos: THREE.Vector3, vol: number) {
    const now = audio.ctx!.currentTime;
    this.lastPos.copy(pos);
    const sp = audio.spatial(pos, 5, 0.06, false);
    const fade = Math.min(1, this.t / 0.15);
    this.out.gain.setTargetAtTime(0.62 * vol * sp.gain * fade, now, 0.04);
    this.pan.pan.setTargetAtTime(sp.pan, now, 0.04);
    this.lp.frequency.setTargetAtTime(Math.min(sp.lp, 16000), now, 0.05);
    this.send.gain.setTargetAtTime(0.08 * sp.wet, now, 0.1);
  }

  /** Lift off and let it die: overrun crackle, a couple of pops, then silence. */
  stop(crashed: boolean) {
    if (this.dead) return;
    this.dead = true;
    const ctx = audio.ctx!;
    const now = ctx.currentTime;
    this.param('load').setTargetAtTime(0, now, 0.02);
    this.param('rpm').setTargetAtTime(IDLE * 1.1, now, crashed ? 0.12 : 0.3);
    this.whineGain.gain.setTargetAtTime(0, now, 0.08);
    const tail = crashed ? 0.35 : 1.1;
    this.out.gain.setTargetAtTime(0, now + tail * 0.4, tail / 3);
    if (!crashed) {
      const at = this.lastPos.clone();
      setTimeout(() => audio.play('backfire', at, 0.85), 120);
      if (Math.random() < 0.7) setTimeout(() => audio.play('backfire', at, 0.6), 420);
    }
    setTimeout(() => {
      this.whine.stop(); this.whine2.stop();
      for (const n of [this.node, this.lp, this.out, this.pan, this.send, this.whine, this.whine2, this.whineGain]) n.disconnect();
    }, (tail + 1.2) * 1000);
  }
}

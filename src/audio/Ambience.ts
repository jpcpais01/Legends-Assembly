import * as THREE from 'three';
import { audio, type LoopHandle, type Sfx } from '../core/Audio';
import type { Soundscape } from '../world/types';

/**
 * The arena as a place you can hear. Instead of one stereo bed, the study is a set of sources
 * placed where they are in the room, so they pan and fade as you move:
 * - a quiet room-air bed (non-positional)
 * - the fireplace crackling on its wall, flaring up now and then
 * - wind and rain at each window, with birds and a distant city drifting in through them
 * - the pocket watch on the desk ticking in time with its second hand, the metronome
 *   clicking on each swing, the Newton's cradle clacking as its balls meet
 * - the old house creaking in its beams, the chandelier chain groaning as it sways
 * The Assembly Hall (menus) and the museum get a vast airy drone of their own.
 */
interface Emitter { name: Sfx; pos: THREE.Vector3 | null; vol: number; h: LoopHandle | null }

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

class AmbienceDirector {
  private sc: Soundscape | null = null;
  private loops: Emitter[] = [];
  private lastSec = -1;
  private lastBeat = -1;
  private lastClack = -1;
  private timers = { creak: 6, chain: 9, outside: 7, surge: 18 };
  private refresh = 0;
  private _p = new THREE.Vector3();

  /** Bring an arena's soundscape up (idempotent). */
  start(sc: Soundscape) {
    if (this.sc === sc) return;
    this.stop();
    this.sc = sc;
    const L = (name: Sfx, pos: THREE.Vector3 | null, vol: number) => this.loops.push({ name, pos, vol, h: null });
    if (sc.kind === 'study') {
      L('ambStudy', null, 1);
      if (sc.fire) L('fireLoop', sc.fire, 1);
      for (const w of sc.windows ?? []) L('windowLoop', w, 0.8);
    } else if (sc.kind === 'hall') L('hallAmb', null, 1);
  }

  stop() {
    for (const e of this.loops) e.h?.stop(1.2);
    this.loops = [];
    this.sc = null;
  }

  /** `time` is the same clock the arena animates the watch and metronome with. */
  update(dt: number, time: number) {
    const sc = this.sc;
    if (!sc || !audio.ctx) return;
    // loops start once their recordings have decoded; positions are re-panned ~10x a second
    this.refresh -= dt;
    if (this.refresh <= 0) {
      this.refresh = 0.1;
      for (const e of this.loops) {
        if (!e.h && audio.hasSample(e.name)) e.h = audio.loop(e.name, e.pos, 0);
        e.h?.set(e.pos, 1, e.vol);
      }
    }
    if (sc.kind === 'study') this.study(sc, dt, time);
  }

  private study(sc: Soundscape, dt: number, time: number) {
    // the watch ticks with its second hand, the metronome on each swing (same formulas as the arena)
    const sec = Math.floor(time);
    if (sec !== this.lastSec) {
      if (this.lastSec >= 0 && sc.watch) audio.play('watchTick', sc.watch, 1, { variant: sec & 1 });
      this.lastSec = sec;
    }
    const beat = Math.floor(time * 1.1 - 0.5);
    if (beat !== this.lastBeat) {
      if (this.lastBeat >= 0 && sc.metronome) audio.play('metronome', sc.metronome, 1, { variant: beat & 1 });
      this.lastBeat = beat;
    }
    // the Newton's cradle: the balls meet at the bottom of every half swing (T = 1.3 s)
    const clack = Math.floor((time * 2) / 1.3);
    if (clack !== this.lastClack) {
      if (this.lastClack >= 0 && sc.cradle) audio.play('cradleClack', sc.cradle, 0.85 + Math.random() * 0.15);
      this.lastClack = clack;
    }
    const t = this.timers;
    t.creak -= dt; t.chain -= dt; t.outside -= dt; t.surge -= dt;
    if (t.creak <= 0 && sc.room) {
      t.creak = rnd(7, 16);
      // somewhere in the walls or the beams overhead
      const b = sc.room, p = this._p;
      const side = Math.random();
      p.set(rnd(b.min.x, b.max.x), rnd(b.min.y + 20, b.max.y), rnd(b.min.z, b.max.z));
      if (side < 0.33) p.x = Math.random() < 0.5 ? b.min.x : b.max.x;
      else if (side < 0.66) p.z = Math.random() < 0.5 ? b.min.z : b.max.z;
      else p.y = b.max.y;
      audio.play('woodCreak', p, rnd(0.6, 1));
    }
    if (t.chain <= 0 && sc.chandelier) { t.chain = rnd(11, 22); audio.play('chainCreak', sc.chandelier, rnd(0.5, 0.9)); }
    if (t.outside <= 0 && sc.windows?.length) {
      t.outside = rnd(10, 22);
      const w = sc.windows[Math.floor(Math.random() * sc.windows.length)];
      audio.play(Math.random() < 0.55 ? 'cityDistant' : 'birdsWindow', w, rnd(0.6, 1));
    }
    if (t.surge <= 0 && sc.fire) { t.surge = rnd(22, 45); audio.play('fireSurge', sc.fire, rnd(0.6, 1)); }
  }
}

export const ambience = new AmbienceDirector();

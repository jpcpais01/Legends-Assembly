import { audio } from '../core/Audio';
import { settings } from '../core/settings';
import { SAMPLE_FILES } from './sampleManifest';

/**
 * The score. Four recorded cues (ElevenLabs, seamless loops):
 *   menu   — the theme behind the menus
 *   select — hero select: a pulse that builds toward Lock In
 *   calm   — a match while nobody is fighting: ticking, waiting
 *   combat — once the fight is on
 *   clutch — the last minute, match point, overtime
 * The game reports how heated things are and the director moves between cues with
 * equal-power crossfades, holding each cue long enough that it never flip-flops. Specials
 * get a "surge": the score drops out under the cast and swells back bigger. Cues load lazily
 * (menu first), and if they can't load at all the old generative pad plays instead.
 */
export type Cue = 'menu' | 'select' | 'calm' | 'combat' | 'clutch';

const FILES: Record<Cue, string> = { menu: 'musicMenu', select: 'musicSelect', calm: 'musicCalm', combat: 'musicCombat', clutch: 'musicClutch' };
/** Per-cue trim, so the quiet underscore and the full battle loop sit right against each other. */
const LEVEL: Record<Cue, number> = { menu: 1.5, select: 1.35, calm: 1.15, combat: 0.95, clutch: 1.05 };
/** Minimum seconds a cue holds before the director may leave it. */
const HOLD: Record<Cue, number> = { menu: 0, select: 0, calm: 6, combat: 10, clutch: 30 };

interface Playing { cue: Cue; src: AudioBufferSourceNode; g: GainNode }

class MusicDirector {
  private bufs = new Map<Cue, Promise<AudioBuffer | null>>();
  private cur: Playing | null = null;
  private want: Cue | null = null;
  private since = 0;
  private surgeNode: GainNode | null = null;
  private failed = false;
  private pad = false;

  private load(cue: Cue) {
    let p = this.bufs.get(cue);
    if (!p) {
      p = (async () => {
        const ctx = audio.ctx;
        const f = SAMPLE_FILES[FILES[cue]]?.[0];
        if (!ctx || !f) return null;
        try {
          const res = await fetch(`/audio/sfx/${f}`);
          if (!res.ok) throw new Error(String(res.status));
          return await ctx.decodeAudioData(await res.arrayBuffer());
        } catch (e) {
          console.warn('[music] cue failed to load', cue, e);
          return null;
        }
      })();
      this.bufs.set(cue, p);
    }
    return p;
  }

  /** Warm the match cues while the player is still in the menus. */
  preload() { for (const c of ['select', 'calm', 'combat', 'clutch'] as Cue[]) void this.load(c); }

  private out() {
    const ctx = audio.ctx!;
    if (!this.surgeNode) { this.surgeNode = ctx.createGain(); this.surgeNode.connect(audio.musicOut); }
    return this.surgeNode;
  }

  /** Ask for a cue (null = silence). Crossfades from whatever is playing. */
  play(cue: Cue | null, fade = 2.5) {
    if (!audio.ctx) return;
    if (cue === this.want) return;
    this.want = cue;
    this.since = audio.ctx.currentTime;
    if (!cue) { this.fadeOut(fade); return; }
    void this.load(cue).then((buf) => {
      if (this.want !== cue) return;
      if (!buf) {
        // nothing recorded could load: keep the menus from going silent
        if (!this.failed) { this.failed = true; console.warn('[music] using the generative pad'); }
        if (!this.pad) { this.pad = true; audio.startPad(); }
        return;
      }
      if (this.pad) { this.pad = false; audio.stopPad(); }
      this.start(cue, buf, fade);
    });
  }

  private start(cue: Cue, buf: AudioBuffer, fade: number) {
    const ctx = audio.ctx!;
    if (this.cur?.cue === cue) return;
    this.fadeOut(fade);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    // equal-power-ish: a fast rise in the first third of the fade
    g.gain.setTargetAtTime(LEVEL[cue], now, fade / 3);
    src.connect(g).connect(this.out());
    src.start(now + 0.02);
    this.cur = { cue, src, g };
  }

  private fadeOut(fade: number) {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    const now = audio.ctx!.currentTime;
    c.g.gain.cancelScheduledValues(now);
    c.g.gain.setTargetAtTime(0, now, fade / 4);
    c.src.stop(now + fade + 0.2);
    c.src.onended = () => { c.src.disconnect(); c.g.disconnect(); };
  }

  /**
   * In a match: pick the cue from how heated it is (0..1) and whether we are in the
   * closing stretch. Hysteresis + minimum hold times keep the score from flickering.
   */
  match(heat: number, clutch: boolean) {
    const ctx = audio.ctx;
    if (!ctx || !this.want || this.want === 'menu' || this.want === 'select') return;
    const held = ctx.currentTime - this.since;
    let next: Cue = this.want;
    if (clutch) next = 'clutch';
    else if (this.want === 'calm' && heat > 0.45) next = 'combat';
    else if (this.want === 'combat' && heat < 0.12) next = 'calm';
    else if (this.want === 'clutch') next = heat > 0.3 ? 'combat' : 'calm';
    if (next !== this.want && (held >= HOLD[this.want] || next === 'clutch')) this.play(next, next === 'combat' ? 1.6 : 3.5);
  }

  /** A special went off: the score drops out under it, then swells back bigger. */
  surge(mine: boolean) {
    const ctx = audio.ctx;
    if (!ctx || !this.surgeNode) return;
    const g = this.surgeNode.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.25, now, 0.05);
    g.setTargetAtTime(mine ? 1.35 : 1.15, now + 0.9, 0.25);
    g.setTargetAtTime(1, now + 4.5, 1.2);
  }

  /** Match is over: the stinger takes it from here. */
  end() { this.play(null, 1.2); }

  get cue() { return this.want; }
  get enabled() { return settings.music > 0; }
}

export const music = new MusicDirector();

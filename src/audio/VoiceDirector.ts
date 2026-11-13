import { audio } from '../core/Audio';
import { settings } from '../core/settings';
import { VOICES, VOICE_INDEX, spoken, type Line, type VoiceEvent } from './voicelines';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import type { HeroId } from '../game/types';

// Recorded lines are discovered at build time: src/assets/voice/<hero>/<lineId>.<ext>
const FILES = import.meta.glob('../assets/voice/*/*.{mp3,ogg,wav,m4a,webm,opus}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const URLS = new Map<string, string>();
for (const [path, url] of Object.entries(FILES)) {
  const m = path.match(/voice\/([^/]+)\/([^/]+)\.[a-z0-9]+$/i);
  if (m) URLS.set(`${m[1]}/${m[2]}`, url);
}

export interface SpokenLine { hero: Hero; name: string; text: string; dur: number; rel: 'self' | 'ally' | 'enemy' }

interface Rule {
  /** chance for the local hero */ chance: number;
  /** chance for other heroes (undefined = only the local hero says it) */ others?: number;
  /** others must be this close to be heard */ range?: number;
  /** per-hero cooldown for this event */ cd: number;
  /** higher interrupts lower */ prio: number;
}

const RULES: Record<VoiceEvent, Rule> = {
  matchStart: { chance: 1, cd: 0, prio: 2 },
  primary: { chance: 0.03, cd: 40, prio: 0 },
  secondary: { chance: 0.4, cd: 14, prio: 1 },
  secondaryHit: { chance: 0.85, cd: 8, prio: 2 },
  ult: { chance: 1, others: 1, range: 90, cd: 0, prio: 4 },
  ultEnemy: { chance: 1, others: 1, range: 90, cd: 0, prio: 4 },
  kill: { chance: 0.7, others: 0.22, range: 20, cd: 4, prio: 2 },
  multiKill: { chance: 1, others: 0.5, range: 25, cd: 2, prio: 3 },
  death: { chance: 0.55, cd: 12, prio: 2 },
  respawn: { chance: 0.35, cd: 25, prio: 1 },
  ultReady: { chance: 0.85, cd: 30, prio: 1 },
  lowHp: { chance: 0.8, cd: 25, prio: 2 },
  victory: { chance: 1, cd: 0, prio: 5 },
  defeat: { chance: 1, cd: 0, prio: 5 },
  assist: { chance: 0.45, cd: 20, prio: 1 },
  revenge: { chance: 0.9, others: 0.3, range: 25, cd: 6, prio: 3 },
  streak: { chance: 0.85, cd: 15, prio: 2 },
  shutdown: { chance: 0.8, cd: 10, prio: 2 },
  heal: { chance: 0.4, cd: 30, prio: 0 },
  takeLead: { chance: 0.8, cd: 30, prio: 2 },
  behind: { chance: 0.85, cd: 60, prio: 2 },
  matchPoint: { chance: 1, cd: 0, prio: 3 },
  overtime: { chance: 1, cd: 0, prio: 3 },
  enemyUlt: { chance: 0.75, cd: 12, prio: 3 },
  allyDown: { chance: 0.4, cd: 18, prio: 1 },
};

/**
 * Decides who says what and when: one line at a time, priorities (ult callouts cut
 * through chatter), cooldowns, shuffle bags so lines don't repeat, and banter
 * exchanges at the start of a match when two legends meet.
 */
export class VoiceDirector {
  onLine: ((l: SpokenLine) => void) | null = null;
  private time = 0;
  private busyUntil = 0;
  private busyPrio = -1;
  private stopCurrent: (() => void) | null = null;
  private cds = new Map<string, number>();
  private speakerCd = new Map<number, number>();
  private bags = new Map<string, number[]>();
  private queue: { at: number; fn: () => void }[] = [];

  constructor(private g: Game) {}

  static hasRecording(hero: HeroId, id: string) { return URLS.has(`${hero}/${id}`); }

  reset() {
    this.stopCurrent?.();
    this.stopCurrent = null;
    this.queue = [];
    this.cds.clear();
    this.speakerCd.clear();
    this.busyUntil = 0;
    this.busyPrio = -1;
    this.time = 0;
  }

  /** Warm the decoder for the legends in this match. */
  preload(heroes: HeroId[]) {
    for (const [key, url] of URLS) if (heroes.some((h) => key.startsWith(h + '/'))) void audio.loadVoice(url);
  }

  update(dt: number) {
    this.time += dt;
    if (!this.queue.length) return;
    const due = this.queue.filter((q) => q.at <= this.time);
    if (!due.length) return;
    this.queue = this.queue.filter((q) => q.at > this.time);
    for (const q of due) q.fn();
  }

  after(delay: number, fn: () => void) { this.queue.push({ at: this.time + delay, fn }); }

  /** Try to have `h` say a line for `ev`. Returns true if a line started. */
  say(h: Hero, ev: VoiceEvent, force = false): boolean {
    const voice = VOICES[h.def.id];
    const lines = voice?.lines[ev];
    if (!lines?.length || !h) return false;
    const rule = RULES[ev];
    const local = this.g.local;
    let chance = rule.chance;
    if (!h.isLocal) {
      if (rule.others === undefined || !local) return false;
      if (rule.range && h.pos.distanceTo(local.pos) > rule.range) return false;
      chance = rule.others;
    }
    if (!force && Math.random() > chance) return false;
    const key = `${h.id}:${ev}`;
    if (!force && this.time < (this.cds.get(key) ?? 0)) return false;
    if (!force && rule.prio < 3 && this.time < (this.speakerCd.get(h.id) ?? 0)) return false;
    if (this.time < this.busyUntil && rule.prio <= this.busyPrio) return false;
    this.cds.set(key, this.time + rule.cd);
    this.speak(h, this.next(h.def.id, ev, lines), rule.prio);
    return true;
  }

  /** A kill line aimed at the rival legend that just fell (Yeat taunting Einstein, and so on). */
  rival(h: Hero, victim: Hero): boolean {
    const lines = VOICES[h.def.id]?.rival[victim.def.id];
    if (!lines?.length) return false;
    const rule = RULES.kill;
    if (!h.isLocal && (!this.g.local || h.pos.distanceTo(this.g.local.pos) > (rule.range ?? 20) || Math.random() > (rule.others ?? 0))) return false;
    const key = `${h.id}:kill`;
    if (this.time < (this.cds.get(key) ?? 0) || this.time < (this.speakerCd.get(h.id) ?? 0)) return false;
    if (this.time < this.busyUntil && rule.prio <= this.busyPrio) return false;
    this.cds.set(key, this.time + rule.cd);
    this.speak(h, this.next(h.def.id, `rival_${victim.def.id}` as VoiceEvent, lines), rule.prio);
    return true;
  }

  /** Ult callout: allies (and you) hear the hero's own cry, enemies hear the threat. */
  ult(h: Hero) {
    const local = this.g.local;
    const enemyHears = local && local.team !== h.team && VOICES[h.def.id]?.lines.ultEnemy?.length;
    return this.say(h, enemyHears ? 'ultEnemy' : 'ult', true);
  }

  /** Opening line, or a banter exchange if a rival legend is in the match. */
  matchStart() {
    const me = this.g.local;
    if (!me || !me.alive) return;
    const others = this.g.heroes.filter((x) => x !== me);
    const options = VOICES[me.def.id].banter.filter((b) => others.some((o) => o.def.id === b.vs));
    if (options.length && Math.random() < 0.6) {
      const b = options[Math.floor(Math.random() * options.length)];
      const partner = others.find((o) => o.def.id === b.vs && o.team !== me.team) ?? others.find((o) => o.def.id === b.vs)!;
      const dur = this.speak(me, { id: b.id, text: b.text }, 3);
      this.after(dur + 0.35, () => {
        if (partner.alive) this.speak(partner, { id: `reply_${me.def.id}`, text: b.reply }, 3);
      });
      return;
    }
    this.say(me, 'matchStart', true);
  }

  private next(hero: HeroId, ev: VoiceEvent, lines: Line[]) {
    const key = `${hero}:${ev}`;
    let bag = this.bags.get(key);
    if (!bag || !bag.length) {
      bag = lines.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      this.bags.set(key, bag);
    }
    return lines[bag.pop()!];
  }

  private speak(h: Hero, line: Line, prio: number) {
    const v = VOICES[h.def.id];
    const local = this.g.local;
    const rel: SpokenLine['rel'] = h.isLocal ? 'self' : local && h.team === local.team ? 'ally' : 'enemy';
    this.stopCurrent?.();
    this.stopCurrent = null;
    const url = URLS.get(`${h.def.id}/${line.id}`);
    const text = spoken(line.text);
    const buf = url ? audio.voiceBuffer(url) : null;
    let dur: number;
    if (buf) {
      const handle = audio.playVoice(buf, h.def.id, v.chain, h.isLocal ? null : h.center, h.isLocal ? 1 : 0.95);
      dur = handle.dur;
      this.stopCurrent = handle.stop;
    } else {
      const words = text.split(/\s+/).length;
      dur = Math.min(4.2, Math.max(1.6, 0.8 + words * 0.3));
      audio.play('comm', null, 1, { variant: VOICE_INDEX[h.def.id] });
    }
    this.busyUntil = this.time + dur + 0.25;
    this.busyPrio = prio;
    this.speakerCd.set(h.id, this.time + dur + 3);
    if (settings.subtitles) this.onLine?.({ hero: h, name: v.short, text, dur: dur + 0.6, rel });
    return dur;
  }
}

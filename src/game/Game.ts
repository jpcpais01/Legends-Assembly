import * as THREE from 'three';
import { TEAM_COLORS } from '../world/types';
import type { ArenaLike } from '../world/types';
import { Vfx, InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { Hero, HERO_RADIUS } from './Hero';
import { CameraRig } from './CameraRig';
import { Bot } from './Bot';
import type { HeroDef, HeroId, Projectile, Zone } from './types';
import { HEROES, HERO_LIST } from '../heroes';
import { Input } from '../core/Input';
import { audio, type Sfx, type PlayOpts } from '../core/Audio';
import { VoiceDirector } from '../audio/VoiceDirector';
import { music } from '../audio/Music';
import type { Surface } from '../world/types';
import { globalUniforms } from '../render/materials';
import { clamp, pick, rand, segmentVsCapsule, shuffle, TAU } from '../core/math';
import { settings } from '../core/settings';
import { screenFx } from '../vfx/ScreenFx';

export type Mode = '1v1' | '2v2' | '3v3' | '5v5';
export const MODE_INFO: Record<Mode, { size: number; target: number; label: string }> = {
  '1v1': { size: 1, target: 7, label: 'Duel' },
  '2v2': { size: 2, target: 10, label: 'Skirmish' },
  '3v3': { size: 3, target: 15, label: 'Clash' },
  '5v5': { size: 5, target: 25, label: 'Assembly War' },
};
const MATCH_TIME = 6 * 60;
const CRIT = new THREE.Color(4, 3, 1.1);
const HURT = new THREE.Color(1.4, 0.12, 0.1);
const KILLFLASH = new THREE.Color(1.6, 1.3, 1.1);
const HEALC = new THREE.Color(0.6, 3.2, 1.2);
const SLOWC = new THREE.Color(0.9, 1.4, 3.2);
/** Each legend's own shoes on bare wood, and what each surface adds underneath them. */
const STEP: Record<HeroId, Sfx> = { einstein: 'stepEinstein', yeat: 'stepYeat', vangogh: 'stepVangogh', blitzcrank: 'stepBlitz' };
const SURFACE_STEP: Partial<Record<Surface, Sfx>> = { paper: 'stepPaper', metal: 'stepMetal', leather: 'stepLeather', stone: 'stepStone', grass: 'stepGrass' };
const BOT_NAMES = ['Nova', 'Kairo', 'Mika', 'Juno', 'Rex', 'Vale', 'Orion', 'Lumen', 'Zephyr', 'Sable', 'Ember', 'Atlas', 'Pixel', 'Echo', 'Blitz'];

export interface LineupSlot { id: HeroId; name: string }
/** Who the bots play: [allies (without you), enemies]. Hero select rolls this up front so it can show the picks. */
export type Lineup = [LineupSlot[], LineupSlot[]];
export interface MatchConfig { mode: Mode; heroId: HeroId; difficulty: 'easy' | 'normal' | 'hard'; lineup?: Lineup }

/** Varied comps: each team cycles through a shuffled roster; small ally teams avoid doubling your legend. */
export function rollLineup(mode: Mode, heroId: HeroId): Lineup {
  const size = MODE_INFO[mode].size;
  const names = shuffle([...BOT_NAMES]);
  const all: HeroId[] = HERO_LIST.map((h) => h.id);
  const out: Lineup = [[], []];
  for (let team = 0; team < 2; team++) {
    const roster = shuffle([...all]);
    for (let i = team === 0 ? 1 : 0; i < size; i++) {
      let id = roster[(i + (team === 0 ? 1 : 0)) % roster.length];
      if (team === 0 && size <= 3 && id === heroId) id = roster[(i + 2) % roster.length];
      out[team].push({ id, name: names.pop() ?? 'Bot' });
    }
  }
  return out;
}

/** Keep a rolled lineup valid after you switch legend (small ally teams never double your pick). */
export function fixLineup(l: Lineup, mode: Mode, heroId: HeroId): number[] {
  const changed: number[] = [];
  if (MODE_INFO[mode].size > 3) return changed;
  const all: HeroId[] = HERO_LIST.map((h) => h.id);
  l[0].forEach((s, i) => {
    if (s.id !== heroId) return;
    const taken = new Set([heroId, ...l[0].map((x) => x.id)]);
    s.id = all.find((x) => !taken.has(x)) ?? all.find((x) => x !== heroId) ?? s.id;
    changed.push(i);
  });
  return changed;
}

export type AbilitySlot = 'primary' | 'secondary' | 'ult';

export interface GameEvents {
  onKill(killer: Hero | null, victim: Hero, assists: Hero[], ab?: AbilitySlot): void;
  /** A special went off: yours (cinematic beat) or a nearby enemy's (danger warning). */
  onUltCast(h: Hero, near: boolean): void;
  /** Letterboxed final-blow replay at the end of a match. */
  onOutro(title: string, sub: string): void;
  onDamageNumber(pos: THREE.Vector3, amount: number, crit: boolean, heal: boolean, key?: number): void;
  onHitmarker(crit: boolean, kill: boolean, amount?: number): void;
  onLocalHurt(amount: number, from: THREE.Vector3 | null): void;
  onAnnounce(text: string, sub?: string, tone?: 'gold' | 'red' | 'blue'): void;
  onMatchEnd(winner: number): void;
  onCountdown(n: number): void;
  onCallout(c: Callout): void;
}

/** A kill-feat banner: multi-kills, streaks, first blood, shutdowns and team wipes. */
export interface Callout {
  kind: 'multi' | 'streak' | 'firstBlood' | 'shutdown' | 'teamWipe' | 'wiped' | 'revenge' | 'clutch' | 'ultDenied' | 'longshot';
  title: string;
  sub: string;
  /** 1..5 intensity: drives color, size and the badge. */
  tier: number;
  /** Badge number (×2, ×3 … or the streak length). */
  count: number;
  /** Lesser feats earned on the same kill, shown as tags. */
  tags: string[];
  /** Current kill streak, drawn as pips. */
  streak: number;
}

const MULTI_WINDOW = 4.5;
/** View kick per primary shot (radians). */
const RECOIL: Partial<Record<HeroId, number>> = { einstein: 0.005, yeat: 0.011, vangogh: 0.007, blitzcrank: 0.014 };
const MULTI = [
  null, null,
  { title: 'Double Elimination', vox: 'double' },
  { title: 'Triple Elimination', vox: 'triple' },
  { title: 'Quadra Elimination', vox: 'quadra' },
  { title: 'Penta Elimination', vox: 'penta' },
];
const STREAKS: Record<number, { title: string; vox: string; tier: number }> = {
  3: { title: 'On a Streak', vox: 'streak3', tier: 2 },
  5: { title: 'Rampage', vox: 'streak5', tier: 3 },
  7: { title: 'Unstoppable', vox: 'streak7', tier: 4 },
  10: { title: 'Legendary', vox: 'streak10', tier: 5 },
};

/** The highlight the results screen celebrates. */
export interface PlayOfGame { hero: Hero; title: string; score: number; t: number }

interface Pickup { pos: THREE.Vector3; ready: boolean; t: number; mesh: THREE.Group; orb: THREE.Mesh }

export class Game {
  scene: THREE.Scene;
  arena: ArenaLike;
  vfx: Vfx;
  camRig: CameraRig;
  input: Input;
  heroes: Hero[] = [];
  local!: Hero;
  bots: Bot[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  pickups: Pickup[] = [];
  private multi = new Map<number, { n: number; t: number }>();
  private firstBlood = false;
  /** Match storyline: who leads, the biggest deficit, which calls have been made. */
  private flow = { lead: -1, deficit: 0, behindSaid: false, mp: [false, false], oneMin: false, ot: false };
  playOfGame: PlayOfGame | null = null;
  /** Real seconds of brief slow motion left (your special's opening beat). */
  private slowT = 0;
  pools = new Map<string, InstancedPool>();
  time = 0;
  matchTime = MATCH_TIME;
  score = [0, 0];
  target = 10;
  state: 'menu' | 'intro' | 'playing' | 'ended' = 'menu';
  introT = 0;
  paused = false;
  /** 0..1 "doom sky" (The Bell): zones raise it each frame, it falls back on its own. */
  doom = 0;
  timeScale = 1;
  endT = 0;
  winner = -1;
  config: MatchConfig | null = null;
  events: GameEvents;
  showcase: Hero | null = null;
  voice: VoiceDirector;
  private lastCount = 4;
  private steps = new Map<number, number>();
  private healSfxT = 0;
  /** Hitstop: real seconds left of near-frozen simulation after a heavy local hit. */
  private stopT = 0;
  private healFxT = new Map<number, number>();
  private glowCache = new Map<string, THREE.Color>();
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private _v3 = new THREE.Vector3();
  /** 0..1 how hot the fight around you is (drives the music). */
  heat = 0;
  private lastTick = 99;

  constructor(scene: THREE.Scene, arena: ArenaLike, camera: THREE.PerspectiveCamera, input: Input, events: GameEvents) {
    this.scene = scene;
    this.arena = arena;
    this.vfx = new Vfx(scene);
    this.camRig = new CameraRig(camera);
    this.input = input;
    this.events = events;
    this.voice = new VoiceDirector(this);
    this.buildPickups();
    // sounds behind the desk's clutter come through muffled
    audio.setOcclusion((a, b) => this.world.raycast(a, b) >= 0);
  }

  get world() { return this.arena.world; }

  pool(key: string, make: () => InstancedPool) {
    let p = this.pools.get(key);
    if (!p) { p = make(); this.pools.set(key, p); this.scene.add(p.mesh); }
    return p;
  }

  play(name: Sfx, pos?: THREE.Vector3 | null, vol = 1, opts?: PlayOpts) { audio.play(name, pos, vol, opts); }
  loop(name: Sfx, pos?: THREE.Vector3 | null, vol = 1) { return audio.loop(name, pos, vol); }

  /** Camera trauma scaled by distance to the local hero. */
  shake(pos: THREE.Vector3, amount: number, radius = 25) {
    this.arena.shock?.(pos, amount);
    if (!this.local) return;
    const d = this.local.pos.distanceTo(pos);
    const k = clamp(1 - d / radius, 0, 1);
    if (k > 0) this.camRig.shake(amount * k);
  }

  /** Freeze the simulation for a few frames so heavy hits land with weight (local events only). */
  hitStop(dur: number) { if (this.state === 'playing') this.stopT = Math.max(this.stopT, Math.min(0.12, dur)); }

  /** 0..1 closeness of a world point to the local hero (for screen effects). */
  near(pos: THREE.Vector3, radius = 30) {
    if (!this.local) return 0;
    return clamp(1 - this.local.pos.distanceTo(pos) / radius, 0, 1);
  }

  /** HDR glow color for a hero (their signature color). */
  glow(h: Hero, k = 2.6) {
    const key = h.def.id + k;
    let c = this.glowCache.get(key);
    if (!c) { c = new THREE.Color(h.def.color).multiplyScalar(k); this.glowCache.set(key, c); }
    return c;
  }

  // ───────────────────────── match lifecycle ─────────────────────────

  startMatch(cfg: MatchConfig) {
    this.clearMatch();
    this.config = cfg;
    const info = MODE_INFO[cfg.mode];
    this.target = info.target;
    this.score = [0, 0];
    this.matchTime = MATCH_TIME;
    this.multi.clear();
    this.firstBlood = false;
    this.flow = { lead: -1, deficit: 0, behindSaid: false, mp: [false, false], oneMin: false, ot: false };
    this.playOfGame = null;
    this.finalBlow = null;
    this.slowT = 0;
    this.camRig.focus = null;
    this.time = 0;
    this.winner = -1;
    this.timeScale = 1;
    const lineup = cfg.lineup ?? rollLineup(cfg.mode, cfg.heroId);
    for (let team = 0; team < 2; team++) {
      for (let i = 0; i < info.size; i++) {
        const isLocal = team === 0 && i === 0;
        const slot = isLocal ? null : lineup[team][team === 0 ? i - 1 : i];
        const id: HeroId = slot ? slot.id : cfg.heroId;
        const def = HEROES[id];
        const name = isLocal ? (settings.playerName || 'You') : slot?.name ?? 'Bot';
        const h = new Hero(def, team, name, isLocal, TEAM_COLORS[team]);
        this.scene.add(h.model.root);
        this.heroes.push(h);
        if (isLocal) this.local = h;
        else this.bots.push(new Bot(h, this, cfg.difficulty));
        this.spawn(h, i, info.size);
      }
    }
    this.camRig.mode = 'play'; this.camRig.vehicle = 0;
    this.voice.reset();
    this.voice.preload([...new Set(this.heroes.map((h) => h.def.id))]);
    this.steps.clear();
    this.heat = 0;
    this.lastTick = 99;
    music.play('calm', 3);
    this.state = 'intro';
    this.introT = 0;
    this.lastCount = 4;
  }

  private spawn(h: Hero, slot = Math.floor(Math.random() * 5), size = 5) {
    const s = this.world.spawns[h.team];
    const spread = size > 1 ? (slot / (size - 1) - 0.5) * 5 : 0;
    // line up across the direction to the arena center, facing it
    const cl = Math.hypot(s.x, s.z) || 1, dx = -s.x / cl, dz = -s.z / cl;
    const p = this._v.set(s.x + rand(-0.6, 0.6) - dz * spread, 0, s.z + rand(-0.4, 0.4) + dx * spread);
    p.y = this.world.heightAt(p.x, p.z);
    const yaw = Math.atan2(-dx, -dz); // face the center
    h.respawnAt(p, yaw);
    if (h.isLocal) { this.camRig.yaw = yaw; this.camRig.pitch = -0.08; this.camRig.reset(); }
  }

  clearMatch() {
    this.doom = 0;
    audio.setLowHealth(0);
    audio.setSlowmo(0);
    this.stopT = 0;
    screenFx.clear();
    this.voice.reset();
    for (const z of this.zones) z.dispose(z, this);
    this.zones = [];
    this.projectiles = [];
    for (const h of this.heroes) { if (h.alive) h.kit.onDeath?.(h, this); this.scene.remove(h.model.root); h.dispose(); }
    this.heroes = [];
    this.bots = [];
    this.vfx.clear();
    for (const p of this.pools.values()) { p.begin(); p.end(); }
    for (const p of this.pickups) { p.ready = true; p.t = 0; }
    this.state = 'menu';
  }

  /** Menu showcase: a single hero posing on the dais. */
  setShowcase(id: HeroId | null, stage?: { scene: THREE.Scene; heroPos: THREE.Vector3 }) {
    if (this.showcase) { this.showcase.model.root.removeFromParent(); this.showcase.dispose(); this.showcase = null; }
    if (!id) return;
    const h = new Hero(HEROES[id], 0, 'showcase', false, new THREE.Color(HEROES[id].color));
    h.respawnAt((stage?.heroPos ?? this.arena.showcasePos).clone(), 0);
    h.spawnT = 0;
    if (stage) h.model.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    (stage?.scene ?? this.scene).add(h.model.root);
    this.showcase = h;
  }

  // ───────────────────────── combat API ─────────────────────────

  enemiesNear(team: number, pos: THREE.Vector3, r: number) {
    const out: Hero[] = [];
    for (const h of this.heroes) if (h.alive && h.team !== team && h.pos.distanceTo(pos) <= r + HERO_RADIUS) out.push(h);
    return out;
  }
  alliesNear(team: number, pos: THREE.Vector3, r: number) {
    const out: Hero[] = [];
    for (const h of this.heroes) if (h.alive && h.team === team && h.pos.distanceTo(pos) <= r + HERO_RADIUS) out.push(h);
    return out;
  }
  los(a: THREE.Vector3, b: THREE.Vector3) { return this.world.raycast(a, b) < 0; }

  damage(target: Hero, amount: number, source: Hero, opts: { crit?: boolean; knock?: THREE.Vector3; at?: THREE.Vector3; silent?: boolean; fx?: boolean } = {}) {
    if (!target.alive || this.state === 'ended') return 0;
    if (target.team === source.team) return 0;
    if (target.spawnT < 1.6) return 0;
    let dmg = amount * source.dmgMult * target.dmgTakenMult * (opts.crit ? 1.5 : 1);
    dmg = Math.min(dmg, target.hp);
    if (dmg <= 0) return 0;
    const wasHealthy = target.hp / target.maxHp >= 0.3;
    target.hp -= dmg;
    target.flashT = Math.min(1, target.flashT + (opts.crit ? 1 : 0.7));
    target.anim.hit = 1;
    {
      // which way the blow shoves them, in their own body frame (drives the recoil animation)
      const dx = target.pos.x - source.pos.x, dz = target.pos.z - source.pos.z, dl = Math.hypot(dx, dz) || 1;
      const sy = Math.sin(target.yaw), cy = Math.cos(target.yaw);
      target.anim.hitZ = (-dx * sy - dz * cy) / dl;
      target.anim.hitX = (dx * cy - dz * sy) / dl;
      target.anim.hitK = clamp(dmg / 70, 0.2, 1);
    }
    target.recentAttackers.set(source.id, this.time);
    target.lastAttacker = source;
    source.stats.damage += dmg;
    this.chargeUlt(source, dmg);
    if (opts.knock) target.applyImpulse(opts.knock);
    const at = opts.at ?? target.chest;
    const killed = target.hp <= 0.01;
    // universal impact layer on top of each kit's own hit effects
    if (opts.fx !== false) {
      const k = clamp(dmg / 40, 0.3, 2.2);
      this.vfx.impact(at, this.glow(source, 2.2), k);
      if (opts.crit) {
        this.vfx.flare(at, CRIT, 1.6, 0.16, rand(-0.2, 0.2));
        this.vfx.add.spawn({ x: at.x, y: at.y, z: at.z, r: CRIT.r, g: CRIT.g, b: CRIT.b, size: 0.45, grow: 2.2, life: 0.22, shape: Shape.Star, spin: 3 });
      }
    }
    if (source.isLocal && !opts.silent) {
      this.events.onDamageNumber(at, dmg, !!opts.crit, false, target.id);
      this.events.onHitmarker(!!opts.crit, killed, dmg);
      this.play(opts.crit ? 'crit' : 'hit', undefined, 0.6);
      this.heat = Math.min(1, this.heat + 0.18);
      if (dmg >= 55) this.play('hitHeavy', undefined, Math.min(1, 0.55 + dmg / 300));
      if (dmg >= 55) { this.hitStop(0.03 + Math.min(0.05, dmg / 4000)); screenFx.punch(Math.min(0.6, dmg / 300)); }
    }
    if (target.isLocal) {
      this.events.onLocalHurt(dmg, source.pos);
      this.heat = Math.min(1, this.heat + 0.28);
      // the hit comes from where the attacker is: it pans, so you know where to turn
      if (!opts.silent) {
        const d = this._v3.subVectors(source.pos, target.pos).setY(0);
        const l = d.length();
        this.play('hurt', l > 0.5 ? d.multiplyScalar(2.5 / l).add(target.center) : undefined, 0.5);
      }
      if (dmg >= 30) { screenFx.punch(Math.min(0.7, dmg / 200)); screenFx.flashScreen(HURT, Math.min(0.12, dmg / 1500)); }
      if (dmg >= 80) this.hitStop(0.05);
    }
    if (killed) this.kill(target, source);
    else if (target.isLocal && wasHealthy && target.hp / target.maxHp < 0.3) { this.play('lowHealth'); this.voice.say(target, 'lowHp'); }
    return dmg;
  }

  heal(target: Hero, amount: number, source: Hero) {
    if (!target.alive || target.hp >= target.maxHp) return 0;
    const h = Math.min(amount, target.maxHp - target.hp);
    target.hp += h;
    source.stats.healing += h;
    if (target !== source || h > 0) this.chargeUlt(source, h * 0.8);
    target.healGlowT = 1;
    // rising crosses, throttled per hero
    const last = this.healFxT.get(target.id) ?? -9;
    if (this.time - last > 0.22 && h > 1) {
      this.healFxT.set(target.id, this.time);
      const c = target.center;
      for (let i = 0; i < 2; i++) this.vfx.p({ x: c.x + rand(-0.45, 0.45), y: c.y + rand(-0.6, 0.5), z: c.z + rand(-0.45, 0.45), vy: rand(1.2, 2.2), r: HEALC.r, g: HEALC.g, b: HEALC.b, size: rand(0.16, 0.26), life: rand(0.6, 0.9), shape: Shape.Plus, fadeIn: 0.15, drag: 1 });
    }
    if (target.isLocal && h > 4 && this.time - this.healSfxT > 0.9) { this.healSfxT = this.time; this.play('heal'); }
    return h;
  }

  chargeUlt(h: Hero, amount: number) {
    if (h.ult >= 1) return;
    h.ult = Math.min(1, h.ult + amount / h.def.ultCost);
    if (h.ult >= 1 && h.isLocal && !h.ultReadyNotified) {
      h.ultReadyNotified = true;
      this.play('ultReady', undefined, 0.8);
      this.events.onAnnounce('SPECIAL READY', `Press SHIFT — ${h.def.abilities.ult.name}`, 'gold');
      this.voice.after(0.5, () => { if (h.alive && h.ult >= 1) this.voice.say(h, 'ultReady'); });
    }
  }

  private kill(victim: Hero, killer: Hero | null) {
    victim.alive = false;
    victim.hp = 0;
    victim.deathT = 0;
    const info = this.config ? MODE_INFO[this.config.mode] : MODE_INFO['3v3'];
    victim.respawnT = 4 + info.size * 0.5;
    victim.stats.deaths++;
    const victimStreak = victim.stats.streak;
    victim.stats.streak = 0;
    victim.channel = 0; victim.overrideVel = null; victim.moveLock = 0; victim.stunT = 0;
    victim.kit.onDeath?.(victim, this);
    const assists: Hero[] = [];
    for (const [id, t] of victim.recentAttackers) {
      if (killer && id === killer.id) continue;
      if (this.time - t < 6) { const a = this.heroes.find((h) => h.id === id); if (a) { a.stats.assists++; assists.push(a); this.chargeUlt(a, 120); } }
    }
    const ab: AbilitySlot | undefined = !killer ? undefined
      : this.time - killer.abT.ult < 9 ? 'ult' : this.time - killer.abT.secondary < 3.5 ? 'secondary' : 'primary';
    const revenge = !!killer && killer !== victim && killer.nemesis === victim;
    const denied = victim.ult >= 1;
    if (killer && killer !== victim) { if (revenge) killer.nemesis = null; victim.nemesis = killer; }
    if (killer) {
      killer.stats.kills++;
      killer.stats.streak++;
      killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.stats.streak);
      this.score[killer.team]++;
      this.chargeUlt(killer, 150);
      if (killer.isLocal) { this.play('kill'); this.play('killDrop'); }
      if (killer !== victim) this.feats(killer, victim, victimStreak, { revenge, denied, ab });
    }
    if (victim.isLocal) {
      this.camRig.mode = 'dead';
      this.camRig.focus = killer && killer !== victim ? killer : null;
      this.events.onAnnounce('YOU WERE ELIMINATED', killer ? `by ${killer.name} · ${killer.def.name}` : '', 'red');
    }
    // death burst: a flash, a ring through the world, and the legend's light rising away
    const c = TEAM_COLORS[victim.team];
    const p = victim.center;
    const tc = new THREE.Color(c.r * 4, c.g * 4, c.b * 4);
    this.vfx.burst(p, tc, 46, 7, 0.18, 1.0, { gravity: -1 });
    this.vfx.shockwave(victim.pos, new THREE.Color(c.r * 3, c.g * 3, c.b * 3), 4.5, 0.6, 0.08);
    this.vfx.flare(p, tc, 3.2, 0.3);
    this.vfx.pillar(victim.pos, new THREE.Color(c.r * 3, c.g * 3, c.b * 3), 9, 26, 0.35);
    this.vfx.rune(victim.pos, new THREE.Color(c.r * 2.5, c.g * 2.5, c.b * 2.5), 1.6, 1.4, 2, 1, 1.6);
    this.vfx.groundGlow(victim.pos, new THREE.Color(c.r * 1.5, c.g * 1.5, c.b * 1.5), 2.4, 1.6, 0.3);
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      this.vfx.p({ x: p.x + Math.cos(a) * 0.4, y: p.y + rand(-0.6, 0.6), z: p.z + Math.sin(a) * 0.4, vx: -Math.sin(a) * 1.4, vy: rand(1.5, 3.5), vz: Math.cos(a) * 1.4, r: tc.r, g: tc.g, b: tc.b, r2: 3, g2: 3, b2: 3, size: rand(0.1, 0.2), life: rand(1, 1.8), shape: Shape.Star, spin: rand(-3, 3), drag: 0.6, fadeIn: 0.1 });
    }
    this.vfx.flash(p, new THREE.Color(c.r * 1.2, c.g * 1.2, c.b * 1.2), 30, 0.6, 12);
    screenFx.ripple(p, 4, 0.6, 0.5);
    if (killer?.isLocal && victim !== killer) { this.hitStop(0.09); screenFx.punch(0.55); screenFx.zoomPunch(0.3); screenFx.flashScreen(KILLFLASH, 0.05); }
    this.play('death', p, 0.8);
    this.arena.shock?.(victim.pos, 0.45);
    this.events.onKill(killer, victim, assists, ab);
    if (killer && killer !== victim) {
      const m = this.multi.get(killer.id);
      const multi = !!m && m.n >= 2 && this.time - m.t < 0.01;
      const streak = killer.stats.streak;
      // on a feat the announcer speaks first, the legend answers after
      const feat = multi || revenge || victimStreak >= 3 || [3, 5, 7, 10].includes(streak);
      this.voice.after(feat ? 1.9 : 0.35, () => {
        const v = this.voice;
        if (multi && v.say(killer, 'multiKill')) return;
        if (revenge && v.say(killer, 'revenge')) return;
        if (victimStreak >= 3 && v.say(killer, 'shutdown')) return;
        if ([3, 5, 7, 10].includes(streak) && v.say(killer, 'streak')) return;
        if (Math.random() < 0.45 && v.rival(killer, victim)) return;
        v.say(killer, 'kill');
      });
    }
    const me = this.local;
    if (victim.isLocal) this.voice.after(0.2, () => this.voice.say(victim, 'death'));
    else if (me && me.alive && victim.team === me.team && victim.pos.distanceTo(me.pos) < 35) this.voice.after(0.7, () => this.voice.say(me, 'allyDown'));
    if (me && assists.includes(me)) { this.play('assist'); this.voice.after(1.1, () => this.voice.say(me, 'assist')); }
    this.trackPlay(killer, victim, ab);
    const over = this.score[0] >= this.target || this.score[1] >= this.target || (this.matchTime <= 0 && this.score[0] !== this.score[1]);
    if (over) {
      this.finalBlow = killer && killer !== victim ? killer : null;
      this.endMatch(this.score[0] > this.score[1] ? 0 : 1);
    } else if (killer && killer !== victim) this.scoreFlow();
  }

  /** The killer whose elimination ended the match (the outro orbits them). */
  private finalBlow: Hero | null = null;

  /** Weighs each elimination as a highlight; the best one becomes the Play of the Game. */
  private trackPlay(killer: Hero | null, victim: Hero, ab?: AbilitySlot) {
    if (!killer || killer === victim) return;
    const m = this.multi.get(killer.id);
    const n = m && this.time - m.t < 0.01 ? m.n : 1;
    const streak = killer.stats.streak;
    const score = n * 10 + (ab === 'ult' ? 4 : 0) + Math.min(streak, 10) * 1.5 + (killer.hp / killer.maxHp < 0.2 ? 3 : 0);
    if (n < 2 && streak < 3) return;
    const cur = this.playOfGame;
    if (cur && cur.score >= score && !(cur.hero === killer && this.time - cur.t < MULTI_WINDOW)) return;
    const abName = ab ? killer.def.abilities[ab].name : '';
    const title = n >= 2 ? MULTI[Math.min(n, 5)]!.title : `${streak} elimination streak`;
    this.playOfGame = { hero: killer, title: abName && n >= 2 ? `${title} · ${abName}` : title, score, t: this.time };
  }

  /** Lead changes, comebacks and match point: the announcer narrates the score. */
  private scoreFlow() {
    const me = this.local;
    if (!me) return;
    const t = me.team, a = this.score[t], e = this.score[1 - t];
    const f = this.flow;
    f.deficit = Math.max(f.deficit, e - a);
    const lead = a > e ? t : e > a ? 1 - t : -1;
    const talk = a + e >= 3;
    if (lead !== f.lead) {
      if (lead === t) {
        if (f.deficit >= 3) { audio.announce('comeback', 3); this.events.onAnnounce('COMEBACK', 'Your team has taken the lead', 'blue'); }
        else if (talk) { audio.announce('takeLead', 2); this.events.onAnnounce('LEAD TAKEN', `${a} — ${e}`, 'blue'); }
        if (talk || f.deficit >= 3) this.voice.after(1.8, () => this.voice.say(me, 'takeLead'));
        f.deficit = 0; f.behindSaid = false;
      } else if (lead === 1 - t) {
        if (talk) { audio.announce('lostLead', 2); this.events.onAnnounce('LEAD LOST', `${a} — ${e}`, 'red'); }
      } else if (talk) { audio.announce('tied', 2); this.events.onAnnounce('ALL TIED', `${a} — ${e}`, 'gold'); }
      f.lead = lead;
    }
    if (e - a >= 3 && !f.behindSaid) { f.behindSaid = true; this.voice.after(2.2, () => this.voice.say(me, 'behind')); }
    for (const side of [t, 1 - t]) {
      if (f.mp[side] || this.score[side] !== this.target - 1) continue;
      f.mp[side] = true;
      const mine = side === t;
      audio.announce(mine ? 'matchPoint' : 'enemyMatchPoint', 3);
      this.play('matchPointSting');
      this.events.onAnnounce(mine ? 'MATCH POINT' : 'ENEMY MATCH POINT', mine ? 'One more elimination wins it' : 'Hold the line', mine ? 'gold' : 'red');
      if (mine) this.voice.after(1.8, () => this.voice.say(me, 'matchPoint'));
    }
  }

  /** Multi-kills, streaks, first blood, shutdowns and wipes: banner + announcer. */
  private feats(killer: Hero, victim: Hero, victimStreak: number, x: { revenge: boolean; denied: boolean; ab?: AbilitySlot }) {
    const m = this.multi.get(killer.id);
    const n = m && this.time - m.t <= MULTI_WINDOW ? m.n + 1 : 1;
    this.multi.set(killer.id, { n, t: this.time });
    const first = !this.firstBlood;
    this.firstBlood = true;
    const streak = killer.stats.streak;
    const shutdown = victimStreak >= 3;
    const enemyTeam = victim.team;
    const teamSize = this.heroes.filter((h) => h.team === enemyTeam).length;
    const wipe = teamSize >= 2 && this.heroes.every((h) => h.team !== enemyTeam || !h.alive);
    const me = this.local;
    const sub = `${killer.isLocal ? victim.name + ' · ' + victim.def.name : killer.name + ' · ' + killer.def.name}`;

    type Feat = { kind: Callout['kind']; title: string; vox: string; tier: number; count: number; prio: number };
    const list: Feat[] = [];
    if (n >= 2) { const k = MULTI[Math.min(n, 5)]!; list.push({ kind: 'multi', title: k.title, vox: k.vox, tier: Math.min(5, n), count: n, prio: 10 + n }); }
    if (STREAKS[streak]) { const k = STREAKS[streak]; list.push({ kind: 'streak', title: k.title, vox: k.vox, tier: k.tier, count: streak, prio: 6 + k.tier }); }
    if (wipe) list.push({ kind: 'teamWipe', title: 'Team Wipe', vox: 'teamWipe', tier: 4, count: teamSize, prio: 9 });
    if (shutdown) list.push({ kind: 'shutdown', title: 'Shutdown', vox: 'shutdown', tier: 3, count: victimStreak, prio: 7 });
    if (first) list.push({ kind: 'firstBlood', title: 'First Blood', vox: 'firstBlood', tier: 2, count: 1, prio: 5 });
    if (x.revenge) list.push({ kind: 'revenge', title: 'Revenge', vox: 'revenge', tier: 2, count: 1, prio: 6.5 });
    if (x.denied) list.push({ kind: 'ultDenied', title: 'Ultimate Denied', vox: 'ultDenied', tier: 2, count: 1, prio: 5.5 });
    if (killer.alive && killer.hp / killer.maxHp < 0.2) list.push({ kind: 'clutch', title: 'Clutch', vox: 'clutch', tier: 2, count: Math.ceil(killer.hp), prio: 4.5 });
    if (x.ab === 'primary' && killer.pos.distanceTo(victim.pos) > 30) list.push({ kind: 'longshot', title: 'Long Shot', vox: 'longshot', tier: 1, count: Math.round(killer.pos.distanceTo(victim.pos)), prio: 4 });
    if (!list.length || !me) return;
    list.sort((a, b) => b.prio - a.prio);

    if (killer.isLocal) {
      const top = list[0];
      this.events.onCallout({ kind: top.kind, title: top.title, sub, tier: top.tier, count: top.count, tags: list.slice(1).map((f) => f.title), streak });
      audio.announce(top.vox, top.prio);
      if (list[1]) audio.announce(list[1].vox, 1);
      return;
    }
    // other players' feats: only the ones the whole lobby hears
    if (first) {
      this.events.onCallout({ kind: 'firstBlood', title: 'First Blood', sub: `${killer.name} drew first blood`, tier: 2, count: 1, tags: [], streak: 0 });
      audio.announce('firstBlood', 5);
    } else if (wipe && killer.team === me.team) {
      this.events.onCallout({ kind: 'teamWipe', title: 'Team Wipe', sub: 'Enemy team eliminated', tier: 4, count: teamSize, tags: [], streak: 0 });
      audio.announce('teamWipe', 9);
    } else if (wipe && enemyTeam === me.team) {
      this.events.onCallout({ kind: 'wiped', title: 'Team Wiped', sub: `by ${killer.name} · ${killer.def.name}`, tier: 1, count: teamSize, tags: [], streak: 0 });
    } else if (n >= 3 && killer.team !== me.team) {
      // an enemy is running riot: warn without the fanfare
      audio.announce(MULTI[Math.min(n, 5)]!.vox, 1);
    }
  }

  private endMatch(winner: number) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.winner = winner;
    this.endT = 0;
    this.timeScale = 0.25;
    const me = this.local;
    const won = !!me && winner === me.team;
    this.play('slowmo');
    this.play(won ? 'victory' : 'defeat');
    audio.duck(2.5, 0.6, 0.3);
    music.end();
    // final blow replay: slow motion orbit around whoever ended it
    const fb = this.finalBlow;
    this.camRig.focus = fb ?? me ?? null;
    this.camRig.mode = 'outro';
    if (me?.alive) me.model.root.visible = true;
    const flawless = won && this.score[1 - winner] === 0;
    this.events.onOutro(flawless ? 'Flawless' : fb ? 'Final Elimination' : 'Time', fb ? `${fb.name} · ${fb.def.name}` : `${this.score[winner]} — ${this.score[1 - winner]}`);
    audio.announce(flawless ? 'flawless' : 'finalKill', 6);
    this.voice.after(0.3, () => audio.announce(won ? 'victory' : 'defeat', 5));
    if (me) this.voice.after(2.2, () => this.voice.say(me, winner === me.team ? 'victory' : 'defeat', true));
    this.events.onMatchEnd(winner);
  }

  // ───────────────────────── projectiles ─────────────────────────

  spawnProjectile(p: Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'> & { seed?: number }) {
    const proj: Projectile = { ...p, prev: p.pos.clone(), age: 0, dead: false, seed: p.seed ?? Math.random() };
    this.projectiles.push(proj);
    return proj;
  }

  private updateProjectiles(dt: number) {
    for (const pool of this.pools.values()) pool.begin();
    const hitPoint = this._v2;
    for (const p of this.projectiles) {
      if (p.dead) continue;
      p.age += dt;
      p.prev.copy(p.pos);
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      // heroes
      let bestT = 2; let bestH: Hero | null = null;
      for (const h of this.heroes) {
        if (!h.alive || h.team === p.owner.team) continue;
        const t = segmentVsCapsule(p.prev, p.pos, h.pos.x, h.pos.z, h.pos.y + 0.15, h.pos.y + 1.65, HERO_RADIUS + p.radius);
        if (t >= 0 && t < bestT) { bestT = t; bestH = h; }
      }
      const wt = this.world.raycast(p.prev, p.pos, p.radius * 0.5);
      if (wt >= 0 && wt < bestT) { bestT = wt; bestH = null; }
      if (bestT <= 1) {
        hitPoint.lerpVectors(p.prev, p.pos, bestT);
        p.pos.copy(hitPoint);
        p.dead = true;
        p.onHit(p, this, bestH, hitPoint.clone());
        continue;
      }
      if (p.age >= p.life) {
        p.dead = true;
        p.onExpire?.(p, this);
        continue;
      }
      p.render(p, this, dt);
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    for (const pool of this.pools.values()) pool.end();
  }

  addZone(z: Zone) { this.zones.push(z); return z; }

  // ───────────────────────── pickups ─────────────────────────

  private buildPickups() {
    const padGeo = new THREE.CylinderGeometry(1.1, 1.25, 0.18, 40);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x2c2a33, metalness: 0.7, roughness: 0.35 });
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.6, 1.2) });
    const orbMat = new THREE.MeshStandardMaterial({ color: 0x7dffb0, emissive: new THREE.Color(0.3, 2.2, 0.9), roughness: 0.2, metalness: 0.1 });
    const crossGeo = new THREE.BoxGeometry(0.22, 0.7, 0.22);
    for (const pos of this.arena.healthPadPositions) {
      const g = new THREE.Group();
      g.position.copy(pos);
      const pad = new THREE.Mesh(padGeo, padMat); pad.position.y = 0.06; pad.receiveShadow = true;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.04, 8, 48).rotateX(Math.PI / 2), ringMat); ring.position.y = 0.17;
      const orb = new THREE.Mesh(crossGeo, orbMat);
      const bar = new THREE.Mesh(crossGeo, orbMat); bar.rotation.z = Math.PI / 2; orb.add(bar);
      orb.position.y = 1.1; orb.castShadow = true;
      g.add(pad, ring, orb);
      this.scene.add(g);
      this.pickups.push({ pos: pos.clone(), ready: true, t: 0, mesh: g, orb });
    }
  }

  private updatePickups(dt: number) {
    for (const p of this.pickups) {
      p.orb.rotation.y += dt * 1.6;
      p.orb.position.y = 1.1 + Math.sin(this.time * 2 + p.pos.x) * 0.12;
      if (!p.ready) {
        p.t -= dt;
        p.orb.scale.setScalar(Math.max(0.001, 1 - p.t / 12) * 0.4);
        if (p.t <= 0) { p.ready = true; p.orb.scale.setScalar(1); }
        continue;
      }
      if (Math.random() < dt * 6) this.vfx.p({ x: p.pos.x + rand(-0.7, 0.7), y: p.pos.y + 0.2, z: p.pos.z + rand(-0.7, 0.7), vy: rand(0.8, 1.6), r: 0.4, g: 2.4, b: 1, size: 0.08, life: 1, shape: Shape.Dot });
      for (const h of this.heroes) {
        if (!h.alive || h.hp >= h.maxHp) continue;
        if (Math.hypot(h.pos.x - p.pos.x, h.pos.z - p.pos.z) < 1.3 && Math.abs(h.pos.y - p.pos.y) < 1.5) {
          this.heal(h, 150, h);
          p.ready = false; p.t = 12;
          this.vfx.burst(this._v.copy(p.pos).setY(p.pos.y + 1), new THREE.Color(0.5, 3, 1.4), 30, 5, 0.12, 0.8);
          this.vfx.shockwave(p.pos, new THREE.Color(0.4, 2.5, 1.2), 3, 0.5);
          this.vfx.pillar(h.pos, HEALC, 5, 24, 0.6);
          this.vfx.flare(this._v.copy(p.pos).setY(p.pos.y + 1.1), HEALC, 2, 0.25);
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * TAU;
            this.vfx.p({ x: h.pos.x + Math.cos(a) * 0.7, y: h.pos.y + 0.2, z: h.pos.z + Math.sin(a) * 0.7, vx: -Math.sin(a) * 2, vy: rand(2, 3.5), vz: Math.cos(a) * 2, r: HEALC.r, g: HEALC.g, b: HEALC.b, size: rand(0.18, 0.28), life: rand(0.7, 1), shape: Shape.Plus, drag: 1.5, fadeIn: 0.1 });
          }
          this.play('pickup', p.pos);
          if (h.isLocal) this.voice.after(0.4, () => this.voice.say(h, 'heal'));
          break;
        }
      }
    }
  }

  // ───────────────────────── frame ─────────────────────────

  update(rawDt: number) {
    let dt = Math.min(rawDt, 1 / 20) * this.timeScale;
    if (this.stopT > 0) { this.stopT -= rawDt; dt *= 0.06; }
    else if (this.slowT > 0 && this.state === 'playing') { this.slowT -= rawDt; dt *= 0.4 + 0.6 * clamp(1 - this.slowT / 0.28, 0, 1); }
    globalUniforms.uTime.value += rawDt;
    this.time += dt;
    const t = globalUniforms.uTime.value;

    if (this.state === 'menu') {
      if (this.showcase) {
        const s = this.showcase;
        s.anim.attack = Math.max(0, s.anim.attack - rawDt * 2);
        if (Math.random() < rawDt * 0.25) { s.anim.attack = 1; s.anim.attackSide = Math.random() < 0.5 ? 1 : -1; }
        s.spawnT += rawDt;
        s.model.fx.uDissolve.value = Math.max(0, 1 - s.spawnT * 1.2);
        s.updateAnim(rawDt, t);
      }
      this.vfx.update(rawDt);
      this.arena.grass?.setPushers(this.showcase ? [this.showcase.pos] : []);
      // behind the menus you hear the room from the showcase dais
      audio.setListener(this.camRig.camera.position, this.camRig.camera, this.arena.showcasePos);
      return;
    }
    if (this.paused) return;
    this.voice.update(rawDt);

    // intro countdown
    if (this.state === 'intro') {
      this.introT += rawDt;
      const n = 3 - Math.floor(this.introT);
      if (n !== this.lastCount && n >= 0) {
        this.lastCount = n;
        this.events.onCountdown(n);
        this.play(n === 0 ? 'go' : 'countdown');
        if (n === 0) audio.announce('fight', 2);
        if (n === 0) this.voice.after(0.8, () => this.voice.matchStart());
      }
      if (this.introT >= 3) this.state = 'playing';
    }
    if (this.state === 'playing') {
      this.matchTime -= dt;
      const f = this.flow;
      if (!f.oneMin && this.matchTime <= 60) {
        f.oneMin = true;
        audio.announce('oneMinute', 2);
        this.events.onAnnounce('ONE MINUTE', 'remaining', 'gold');
      }
      if (!f.ot && this.matchTime <= 0 && this.score[0] === this.score[1]) {
        f.ot = true;
        audio.announce('overtime', 4);
        this.events.onAnnounce('OVERTIME', 'Next elimination wins', 'red');
        if (this.local) this.voice.after(1.6, () => this.voice.say(this.local, 'overtime'));
      }
      if (this.matchTime <= 0 && this.score[0] !== this.score[1]) this.endMatch(this.score[0] > this.score[1] ? 0 : 1);
      // the last ten seconds: the study's big clock counts them down, each tick a little tighter
      if (this.matchTime > 0 && this.matchTime <= 10.5) {
        const sec = Math.ceil(this.matchTime);
        if (sec !== this.lastTick) { this.lastTick = sec; this.play('finalTick', undefined, 0.6 + (10 - sec) * 0.04, { rate: 1 + (10 - sec) * 0.012 }); }
      }
    }
    if (this.state === 'ended') {
      this.endT += rawDt;
      this.timeScale = Math.min(1, 0.25 + this.endT * 0.25);
    }

    const frozen = this.state === 'intro';
    this.doom = Math.max(0, this.doom - dt * 1.2);
    this.updateLocalInput(rawDt);
    for (const b of this.bots) b.think(dt, frozen);

    for (const h of this.heroes) this.updateHero(h, dt, frozen);
    this.updateProjectiles(dt);
    for (const z of this.zones) { z.t += dt; z.update(z, this, dt); if (z.t >= z.dur) { z.dead = true; z.dispose(z, this); } }
    this.zones = this.zones.filter((z) => !z.dead);
    this.updatePickups(dt);
    this.vfx.update(dt);
    this.arena.grass?.setPushers(this.heroes.filter((h) => h.alive).map((h) => h.pos));

    if (this.local) {
      if (this.local.alive && this.camRig.mode === 'dead') this.camRig.mode = 'play';
      this.camRig.update(rawDt, this.local, this.world);
      audio.setListener(this.camRig.camera.position, this.camRig.camera, this.local.alive ? this.local.center : undefined);
      this.mix(rawDt);
    }
  }

  private updateLocalInput(dt: number) {
    const h = this.local;
    if (!h) return;
    const inp = this.input;
    if (this.state !== 'ended') this.camRig.look(inp.mouseDX, inp.mouseDY);
    const hi = h.input;
    const canAct = this.state === 'playing' && inp.locked;
    hi.forward = (inp.isDown('KeyW') ? 1 : 0) - (inp.isDown('KeyS') ? 1 : 0);
    hi.strafe = (inp.isDown('KeyD') ? 1 : 0) - (inp.isDown('KeyA') ? 1 : 0);
    hi.jump = inp.isDown('Space');
    hi.primary = canAct && inp.lmb;
    hi.secondary = canAct && (inp.rmbPressed || inp.rmb);
    hi.ult = canAct && (inp.shiftPressed || inp.shift);
    hi.yaw = this.camRig.yaw;
    hi.pitch = this.camRig.pitch;
    // aim: camera ray against enemies + world
    const origin = this.camRig.aimOrigin(this._v);
    const fwd = this.camRig.forward();
    const far = origin.clone().addScaledVector(fwd, 140);
    let best = 1;
    for (const e of this.heroes) {
      if (!e.alive || e.team === h.team) continue;
      const tt = segmentVsCapsule(origin, far, e.pos.x, e.pos.z, e.pos.y + 0.15, e.pos.y + 1.7, HERO_RADIUS);
      if (tt >= 0 && tt < best) best = tt;
    }
    const wt = this.world.raycast(origin, far);
    if (wt >= 0 && wt < best) best = wt;
    hi.aim.lerpVectors(origin, far, best);
    void dt;
  }

  private updateHero(h: Hero, dt: number, frozen: boolean) {
    if (!h.alive) {
      h.deathT += dt;
      h.model.fx.uDissolve.value = clamp((h.deathT - 0.5) / 1.4, 0, 1);
      if (h.deathT > 2.2) h.model.root.visible = false;
      h.respawnT -= dt;
      if (h.respawnT <= 0 && this.state !== 'ended') {
        this.spawn(h);
        this.play('respawn', h.pos, 0.6);
        this.voice.say(h, 'respawn');
        const tc = TEAM_COLORS[h.team].clone().multiplyScalar(3);
        this.vfx.burst(h.center, tc, 30, 4, 0.12, 0.9, { vy: 2 });
        this.vfx.shockwave(h.pos, TEAM_COLORS[h.team].clone().multiplyScalar(2.5), 3, 0.5);
        this.vfx.pillar(h.pos, tc, 12, 40, 0.5);
        this.vfx.rune(h.pos, TEAM_COLORS[h.team].clone().multiplyScalar(2.2), 1.5, 1.6, -2.2, 1, 1.25);
        this.vfx.flare(h.center, tc, 2.4, 0.35);
        this.vfx.groundGlow(h.pos, TEAM_COLORS[h.team].clone().multiplyScalar(1.4), 2.2, 1.4, 0.3);
      }
      h.updateAnim(dt, this.time);
      return;
    }
    h.spawnT += dt;
    h.model.fx.uDissolve.value = Math.max(0, 1 - h.spawnT * 1.4);
    if (frozen) {
      h.input.forward = h.input.strafe = 0; h.input.jump = false;
    }
    h.yaw = h.input.yaw;
    h.pitch = h.input.pitch;
    h.primaryCd = Math.max(0, h.primaryCd - dt);
    h.secondaryCd = Math.max(0, h.secondaryCd - dt);
    if (this.state === 'playing') h.ult = Math.min(1, h.ult + dt / 200);
    if (h.ult < 1) h.ultReadyNotified = false;

    // reset per-frame buffs; kit re-applies
    h.speedMult = 1; h.dmgMult = 1; h.dmgTakenMult = 1;
    h.kit.update(h, this, dt);
    if (!frozen && h.channel <= 0 && h.stunT <= 0 && h.alive) {
      if (h.input.primary && h.primaryCd <= 0) {
        h.kit.primary(h, this); h.spawnT = Math.max(h.spawnT, 1.6); h.abT.primary = this.time; this.voice.say(h, 'primary');
        if (h.isLocal) this.camRig.recoil(RECOIL[h.def.id] ?? 0.006, rand(-1, 1) * 0.002);
      }
      const silenced = h.silenceT > 0;
      if (h.input.secondary && h.secondaryCd <= 0 && !silenced) {
        if (h.kit.secondary(h, this)) { h.secondaryCd = h.def.secondaryCd; h.spawnT = Math.max(h.spawnT, 1.6); h.abT.secondary = this.time; this.voice.say(h, 'secondary'); if (h.isLocal) this.camRig.recoil(0.012); }
      } else if (h.isLocal && this.input.rmbPressed && (h.secondaryCd > 0 || silenced)) this.play('denied', undefined, 0.4);
      if (h.input.ult && h.ult >= 1 && !silenced) {
        if (h.kit.ult(h, this)) { h.ult = 0; h.spawnT = Math.max(h.spawnT, 1.6); h.abT.ult = this.time; this.voice.ult(h); this.ultCastFx(h); this.ultCine(h); this.ultMoment(h); }
      } else if (h.isLocal && this.input.shiftPressed && (h.ult < 1 || silenced)) this.play('denied', undefined, 0.4);
    }
    this.heroAmbient(h, dt);
    if (h.moveLock > 0) h.moveLock -= dt;
    if (h.channel > 0) h.channel -= dt;
    const wasGrounded = h.grounded;
    const preVy = h.vel.y;
    h.physics(dt, this.world);
    if (wasGrounded && !h.grounded && h.vel.y > 5) { this.play('jump', h.pos, 0.5); this.vfx.dust(h.pos, 3, 0.35, 0.22, 1.2); }
    else if (!wasGrounded && h.grounded && preVy < -6) {
      const k = clamp(-preVy / 14, 0.4, 1);
      this.play('land', h.pos, k);
      this.step(h, k * 1.1);
      this.vfx.dustRing(h.pos, 0.5 + k * 0.6, Math.round(8 + k * 10), 0.45 + k * 0.3, 0.3 + k * 0.15);
      if (h.isLocal && k > 0.8) this.camRig.shake(0.12 * k);
    }
    this.footsteps(h, dt, wasGrounded);
    h.updateAnim(dt, this.time);
  }

  /** Your special opens with a camera beat and a breath of slow motion; a nearby enemy special warns you. */
  private ultCine(h: Hero) {
    const me = this.local;
    if (!me) return;
    if (h.isLocal) {
      this.camRig.ultBeat();
      this.slowT = 0.28;
      this.events.onUltCast(h, true);
      return;
    }
    if (h.team !== me.team && me.alive && h.pos.distanceTo(me.pos) < 38) {
      this.events.onUltCast(h, true);
      this.voice.after(2.4, () => this.voice.say(me, 'enemyUlt'));
    } else this.events.onUltCast(h, false);
  }

  /** The moment a special goes off: a flare, a rune at the feet and a punch for the caster. */
  private ultCastFx(h: Hero) {
    const gc = this.glow(h, 3);
    this.vfx.flare(h.center, gc, 3.6, 0.35);
    this.vfx.rune(h.pos, this.glow(h, 2.2), 2.2, 1.2, 3, 1, 1.5);
    this.vfx.shockwave(h.pos, this.glow(h, 2), 5, 0.5, 0.08);
    this.vfx.pillar(h.pos, gc, 7, 24, 0.5);
    if (h.isLocal) { screenFx.zoomPunch(0.45); screenFx.punch(0.3); this.camRig.kick(4); }
  }

  /** Readability sparkles: slowed heroes get frosty motes, a ready special glows at the feet. */
  private heroAmbient(h: Hero, dt: number) {
    if (h.slowT > 0 && h.slowAmt > 0.05 && Math.random() < dt * 14) {
      const a = rand(0, TAU);
      this.vfx.p({ x: h.pos.x + Math.cos(a) * 0.5, y: h.pos.y + rand(0.1, 1.4), z: h.pos.z + Math.sin(a) * 0.5, vx: -Math.sin(a) * 1.2, vy: rand(-0.6, -0.2), vz: Math.cos(a) * 1.2, r: SLOWC.r, g: SLOWC.g, b: SLOWC.b, size: rand(0.05, 0.1), life: rand(0.4, 0.7), shape: Shape.Star, spin: 3 });
    }
    // silenced: static crackles over the body
    if (h.silenceT > 0 && Math.random() < dt * 16) {
      const a = rand(0, TAU), y = h.pos.y + rand(0.3, 1.7);
      this.vfx.p({ x: h.pos.x + Math.cos(a) * 0.45, y, z: h.pos.z + Math.sin(a) * 0.45, vx: rand(-2, 2), vy: rand(-1, 2), vz: rand(-2, 2), r: 0.8, g: 2.2, b: 3.4, size: rand(0.08, 0.16), life: rand(0.08, 0.16), shape: Shape.Spark, stretch: 0.05 });
    }
    // stunned: little sparks circling the head
    if (h.stunT > 0 && Math.random() < dt * 12) {
      const a = this.time * 9 + rand(0, 0.4);
      this.vfx.p({ x: h.pos.x + Math.cos(a) * 0.35, y: h.pos.y + 2.0, z: h.pos.z + Math.sin(a) * 0.35, vx: -Math.sin(a) * 2, vz: Math.cos(a) * 2, r: 3, g: 2.5, b: 0.8, size: 0.12, life: 0.25, shape: Shape.Star, spin: 6 });
    }
    if (h.ult >= 1 && Math.random() < dt * 9) {
      const a = rand(0, TAU), r = rand(0.35, 0.6);
      const gc = this.glow(h, 2.4);
      this.vfx.p({ x: h.pos.x + Math.cos(a) * r, y: h.pos.y + rand(0.05, 0.4), z: h.pos.z + Math.sin(a) * r, vx: -Math.sin(a) * 0.6, vy: rand(1.2, 2.4), vz: Math.cos(a) * 0.6, r: gc.r, g: gc.g, b: gc.b, size: rand(0.05, 0.1), life: rand(0.6, 1.0), shape: Shape.Spark, stretch: 0.04, drag: 0.5 });
    }
  }

  /** Footsteps: one per stride, paced by real ground speed. */
  private footsteps(h: Hero, dt: number, wasGrounded: boolean) {
    if (!h.grounded || !wasGrounded || h.overrideVel || h.kitState.truck) return;
    const sp = Math.hypot(h.vel.x, h.vel.z);
    if (sp < 1.2) { this.steps.set(h.id, 0.6); return; }
    let acc = (this.steps.get(h.id) ?? 0) + sp * dt;
    const stride = 0.9 + sp * 0.17;
    if (acc >= stride) {
      acc -= stride;
      this.step(h, 0.7 + Math.min(1, sp / 8) * 0.4);
      if (sp > 4) this.vfx.dust(h.pos, 1, 0.32, 0.16, 0.5);
    }
    this.steps.set(h.id, acc);
  }

  /**
   * One footstep: the legend's own shoes, plus whatever they are standing on (paper crunches,
   * coins clink, book covers thud). Enemy steps are louder and carry further than your own
   * team's, so you can hear someone coming round the clutter.
   */
  private step(h: Hero, k: number) {
    const me = this.local;
    const rel = h.isLocal ? 0 : me && h.team === me.team ? 1 : 2;
    const vol = [0.5, 0.6, 1.05][rel] * k;
    const opts: PlayOpts | undefined = rel === 2 ? { ref: 5, rolloff: 0.055 } : undefined;
    const surf: Surface = this.arena.surfaceAt?.(h.pos.x, h.pos.y, h.pos.z) ?? 'wood';
    const shoe = STEP[h.def.id];
    const shoeOk = audio.hasSample(shoe);
    const under = SURFACE_STEP[surf];
    if (under && (under === 'stepGrass' || audio.hasSample(under))) {
      this.play(under, h.pos, vol * 0.9, opts);
      if (shoeOk) this.play(shoe, h.pos, vol * (surf === 'grass' ? 0.25 : 0.4), opts);
    } else this.play(shoeOk ? shoe : 'step', h.pos, vol, opts);
  }

  /**
   * A special goes off: everyone hears it. A stinger from the caster's direction (heroic for
   * your side, menacing for theirs), the rest of the world ducks out of its way and the score
   * drops out and swells back.
   */
  private ultMoment(h: Hero) {
    const me = this.local;
    if (!me) return;
    const enemy = h.team !== me.team;
    const d = this._v3.subVectors(h.pos, me.pos).setY(0);
    const l = d.length();
    const at = l > 0.5 ? d.multiplyScalar(6 / l).add(me.center) : null;
    this.play(enemy ? 'ultEnemy' : 'ultAlly', at, h.isLocal ? 0.75 : 1, { ref: 60, rolloff: 0 });
    audio.duck(1.4, 0.6, 0.35);
    music.surge(h.isLocal);
  }

  /** Per-frame mix: how heated the fight is (music), low health, the outro's slow motion. */
  private mix(dt: number) {
    const me = this.local;
    this.heat = Math.max(0, this.heat - dt * 0.07);
    if (me.alive) {
      for (const e of this.heroes) {
        if (e.alive && e.team !== me.team && Math.abs(e.pos.x - me.pos.x) < 18 && Math.abs(e.pos.z - me.pos.z) < 18 && e.pos.distanceTo(me.pos) < 18) { this.heat = Math.max(this.heat, 0.5); break; }
      }
    }
    if (this.state === 'playing') {
      const f = this.flow;
      music.match(this.heat, this.matchTime <= 60 || f.mp[0] || f.mp[1] || f.ot);
    }
    const playing = this.state === 'playing' || this.state === 'intro';
    audio.setLowHealth(playing && me.alive ? clamp((0.32 - me.hp / me.maxHp) / 0.32, 0, 1) : 0);
    audio.setSlowmo(this.state === 'ended' ? clamp(1 - (this.endT - 0.4) / 2.6, 0, 1) * 0.85 : 0);
  }

  /** Bot helper: pick a hero def. */
  static randomDef(): HeroDef { return pick(HERO_LIST); }
}

import * as THREE from 'three';
import type { Game, NetLink, AbilitySlot } from '../game/Game';
import type { Hero } from '../game/Hero';
import type { Party, Msg } from './Party';

/**
 * One online match. Every machine runs the full simulation for the visuals; who decides what:
 * - Your own legend: your machine moves it, fires its abilities and detects its hits (reported to the host).
 * - Bots, health, eliminations, respawns, pickups, score and clock: the host.
 * Movement streams unreliably (unordered, latest wins) and is drawn ~100 ms in the past so it stays smooth;
 * abilities, hits and match events go over the reliable channel.
 */

const SLOT_CODE: Record<AbilitySlot, string> = { primary: 'p', secondary: 's', ult: 'u' };
const CODE_SLOT: Record<string, AbilitySlot> = { p: 'primary', s: 'secondary', u: 'ult' };
/** How far in the past other legends are drawn (ms): two snapshots deep at 20-30 Hz. */
const INTERP = 100;
const HOST_HZ = 20;
const GUEST_HZ = 30;

/** px py pz vx vy vz yaw pitch ax ay az fwd strafe flags */
type Pose = number[];
interface Sample { t: number; s: Pose }

const q = (v: number) => Math.round(v * 100) / 100;

function pose(h: Hero): Pose {
  const i = h.input;
  return [q(h.pos.x), q(h.pos.y), q(h.pos.z), q(h.vel.x), q(h.vel.y), q(h.vel.z), q(h.yaw), q(h.pitch),
    q(i.aim.x), q(i.aim.y), q(i.aim.z), i.forward, i.strafe, (h.grounded ? 1 : 0) | (i.jump ? 2 : 0)];
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class NetMatch implements NetLink {
  readonly authority: boolean;
  private g: Game;
  private party: Party;
  /** Roster seat -> owner member id (null = bot). */
  private owners: (string | null)[];
  private paths = new Map<number, Sample[]>();
  private sendT = 0;
  private statsT = 0;
  private seq = 0;
  private lastSeq = -1;
  /** Guests: the host vanished mid-match. */
  onHostLost: (() => void) | null = null;

  constructor(g: Game, party: Party, owners: (string | null)[]) {
    this.g = g;
    this.party = party;
    this.owners = owners;
    this.authority = party.isHost;
  }

  /** A player dropped out mid-match (host): a bot takes over their legend. */
  playerLeft(id: string) {
    this.owners.forEach((o, i) => {
      if (o !== id) return;
      this.owners[i] = null;
      const h = this.g.heroes[i];
      if (h) { this.g.adoptAsBot(h); this.paths.delete(i); }
    });
  }

  private hero(i: unknown) { return typeof i === 'number' ? this.g.heroes[i] ?? null : null; }
  private v3(a: unknown) { const x = a as number[]; return new THREE.Vector3(x[0], x[1], x[2]); }

  // ───────────────────────── outgoing (NetLink) ─────────────────────────

  ability(h: Hero, slot: AbilitySlot) {
    const m: Msg = { t: 'ab', i: h.idx, s: SLOT_CODE[slot], p: [q(h.pos.x), q(h.pos.y), q(h.pos.z)], y: h.yaw, pi: h.pitch, a: [q(h.input.aim.x), q(h.input.aim.y), q(h.input.aim.z)] };
    if (this.authority) this.party.broadcast(m);
    else this.party.send(m);
  }

  kitEvent(h: Hero, ev: string) {
    const m: Msg = { t: 'kev', i: h.idx, e: ev };
    if (this.authority) this.party.broadcast(m);
    else this.party.send(m);
  }

  hit(target: Hero, amount: number, source: Hero, crit: boolean) {
    if (this.authority) return;
    this.party.send({ t: 'hit', i: target.idx, s: source.idx, n: Math.round(amount * 100) / 100, c: crit ? 1 : 0 });
  }

  healed(target: Hero, amount: number, source: Hero) {
    if (this.authority) return;
    this.party.send({ t: 'heal', i: target.idx, s: source.idx, n: Math.round(amount * 100) / 100 });
  }

  killed(victim: Hero, killer: Hero | null, assists: Hero[], ab?: AbilitySlot) {
    this.party.broadcast({ t: 'kill', v: victim.idx, k: killer ? killer.idx : -1, a: assists.map((x) => x.idx), ab: ab ? SLOT_CODE[ab] : '' });
  }

  spawned(h: Hero) {
    this.party.broadcast({ t: 'spawn', i: h.idx, p: [q(h.pos.x), q(h.pos.y), q(h.pos.z)], y: h.yaw });
  }

  pickup(index: number, h: Hero) { this.party.broadcast({ t: 'pick', p: index, i: h.idx }); }

  ended(winner: number, finalBlow: Hero | null) {
    this.sendStats();
    this.party.broadcast({ t: 'end', w: winner, f: finalBlow ? finalBlow.idx : -1, sc: this.g.score });
  }

  /** Movement out: the host streams every legend (relaying guests' own), guests stream their own. */
  update(dt: number) {
    this.sendT += dt;
    const g = this.g;
    if (this.authority) {
      if (this.sendT >= 1 / HOST_HZ) {
        this.sendT = 0;
        const h = g.heroes.map((x) => [...pose(x), Math.round(x.hp * 10) / 10, Math.round(x.ult * 1000) / 1000]);
        this.party.broadcast({ t: 'S', q: this.seq++, mt: Math.round(g.matchTime * 100) / 100, sc: g.score, h }, false);
      }
      this.statsT += dt;
      if (this.statsT > 2) { this.statsT = 0; this.sendStats(); }
    } else if (this.sendT >= 1 / GUEST_HZ && g.local) {
      this.sendT = 0;
      this.party.send({ t: 'I', s: pose(g.local) }, false);
    }
  }

  private sendStats() {
    this.party.broadcast({ t: 'st', h: this.g.heroes.map((x) => { const s = x.stats; return [s.kills, s.deaths, s.assists, Math.round(s.damage), Math.round(s.healing), s.streak, s.bestStreak]; }) });
  }

  /** Draw another machine's legend where it was INTERP ms ago (extrapolating a little across gaps). */
  drive(h: Hero) {
    const path = this.paths.get(h.idx);
    if (!path || !path.length) return;
    const now = performance.now() - INTERP;
    let a = path[0], b = path[0];
    for (let k = path.length - 1; k >= 0; k--) {
      if (path[k].t <= now) { a = path[k]; b = path[k + 1] ?? path[k]; break; }
    }
    const A = a.s, B = b.s;
    let t = b.t > a.t ? (now - a.t) / (b.t - a.t) : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = a === b ? Math.min(0.15, Math.max(0, (now - a.t) / 1000)) : 0;
    h.pos.set(A[0] + (B[0] - A[0]) * t + A[3] * ex, A[1] + (B[1] - A[1]) * t + A[4] * ex * 0.3, A[2] + (B[2] - A[2]) * t + A[5] * ex);
    h.vel.set(A[3] + (B[3] - A[3]) * t, A[4] + (B[4] - A[4]) * t, A[5] + (B[5] - A[5]) * t);
    const i = h.input;
    i.yaw = lerpAngle(A[6], B[6], t);
    i.pitch = A[7] + (B[7] - A[7]) * t;
    i.aim.set(A[8] + (B[8] - A[8]) * t, A[9] + (B[9] - A[9]) * t, A[10] + (B[10] - A[10]) * t);
    i.forward = B[11]; i.strafe = B[12];
    h.grounded = (B[13] & 1) === 1;
    i.jump = (B[13] & 2) === 2;
  }

  private push(idx: number, s: Pose) {
    let p = this.paths.get(idx);
    if (!p) { p = []; this.paths.set(idx, p); }
    p.push({ t: performance.now(), s });
    if (p.length > 12) p.shift();
  }

  // ───────────────────────── incoming ─────────────────────────

  /** Feed every party message here while the match runs. `from` = sender member id. */
  receive(m: Msg, from: string) {
    const g = this.g;
    switch (m.t) {
      case 'I': { // guest pose (host)
        if (!this.authority) return;
        const i = this.owners.indexOf(from);
        if (i >= 0 && g.heroes[i] && !g.heroes[i].isLocal) this.push(i, m.s as Pose);
        return;
      }
      case 'S': { // host snapshot (guests)
        const sq = m.q as number;
        if (sq <= this.lastSeq) return; // unordered channel: stale
        this.lastSeq = sq;
        g.matchTime = m.mt as number;
        const sc = m.sc as number[];
        g.score[0] = sc[0]; g.score[1] = sc[1];
        (m.h as number[][]).forEach((row, i) => {
          const h = g.heroes[i];
          if (!h) return;
          if (!h.isLocal) this.push(i, row.slice(0, 14));
          h.hp = Math.min(h.maxHp, row[14]);
          if (h.ultGuardT <= 0) { h.ult = row[15]; if (h.ult < 1) h.ultReadyNotified = false; g.ultReadyCue(h); }
        });
        return;
      }
      case 'ab': {
        const h = this.hero(m.i);
        if (!h || h.isLocal || !h.alive) return;
        // host: only accept a guest's own legend from that guest, then pass it on
        if (this.authority) {
          if (this.owners[h.idx] !== from) return;
          this.party.broadcast(m, true, from);
        }
        const slot = CODE_SLOT[m.s as string];
        if (slot) g.fireAbility(h, slot, { pos: this.v3(m.p), yaw: m.y as number, pitch: m.pi as number, aim: this.v3(m.a) });
        return;
      }
      case 'kev': {
        const h = this.hero(m.i);
        if (!h || h.isLocal) return;
        if (this.authority) {
          if (this.owners[h.idx] !== from) return;
          this.party.broadcast(m, true, from);
        }
        h.kit.onNet?.(h, g, m.e as string);
        return;
      }
      case 'hit': case 'heal': { // a guest's own hit (host)
        if (!this.authority) return;
        const target = this.hero(m.i), source = this.hero(m.s);
        if (!target || !source || this.owners[source.idx] !== from) return;
        const n = Math.max(0, Math.min(400, Number(m.n) || 0));
        if (m.t === 'hit') g.applyRemoteHit(target, n, source, m.c === 1);
        else g.applyRemoteHeal(target, n, source);
        return;
      }
      case 'kill': {
        if (this.authority) return;
        const v = this.hero(m.v);
        if (!v) return;
        const k = this.hero(m.k);
        const assists = ((m.a as number[]) ?? []).map((x) => g.heroes[x]).filter(Boolean);
        g.remoteKill(v, k, assists, m.ab ? CODE_SLOT[m.ab as string] : undefined);
        return;
      }
      case 'spawn': {
        if (this.authority) return;
        const h = this.hero(m.i);
        if (!h) return;
        const p = this.v3(m.p);
        this.paths.set(h.idx, [{ t: performance.now() - INTERP - 1, s: [p.x, p.y, p.z, 0, 0, 0, m.y as number, 0, p.x, p.y, p.z, 0, 0, 1] }]);
        g.remoteRespawn(h, p, m.y as number);
        return;
      }
      case 'pick': {
        if (this.authority) return;
        const h = this.hero(m.i);
        if (h) g.takePickup(m.p as number, h);
        return;
      }
      case 'st': {
        if (this.authority) return;
        (m.h as number[][]).forEach((r, i) => {
          const h = g.heroes[i];
          if (!h) return;
          const s = h.stats;
          [s.kills, s.deaths, s.assists, s.damage, s.healing, s.streak, s.bestStreak] = r;
        });
        return;
      }
      case 'end': {
        if (this.authority) return;
        const sc = m.sc as number[];
        g.score[0] = sc[0]; g.score[1] = sc[1];
        g.endMatch(m.w as number, this.hero(m.f));
        return;
      }
    }
  }
}

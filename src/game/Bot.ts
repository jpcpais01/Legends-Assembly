import * as THREE from 'three';
import type { Hero } from './Hero';
import type { Game } from './Game';
import { angleDiff, clamp, rand } from '../core/math';

const DIFF = {
  easy: { err: 1.3, turn: 4.5, react: 0.7, fireCone: 0.12, think: 0.5 },
  normal: { err: 0.65, turn: 8, react: 0.4, fireCone: 0.09, think: 0.3 },
  hard: { err: 0.28, turn: 14, react: 0.2, fireCone: 0.06, think: 0.18 },
};
const PROJ_SPEED: Record<string, number> = { einstein: 95, yeat: 62, vangogh: 50, luffy: 150 };
const EFFECTIVE: Record<string, number> = { einstein: 45, yeat: 15, vangogh: 34, luffy: 20 };

/** Utility-style bot: target selection, ranged spacing, strafing, leading shots, and smart ability use. */
export class Bot {
  h: Hero;
  g: Game;
  p: (typeof DIFF)['normal'];
  target: Hero | null = null;
  private retarget = 0;
  private strafe = 1;
  private strafeT = 0;
  private seen = 0;
  private errVec = new THREE.Vector3();
  private errT = 0;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private abilityT = 0;
  private wander = new THREE.Vector3();
  private wanderT = 0;
  private path: THREE.Vector3[] | null = null;
  private pathGoal = new THREE.Vector3(1e9, 0, 0);
  private pathT = 0;

  constructor(h: Hero, g: Game, difficulty: keyof typeof DIFF) {
    this.h = h; this.g = g; this.p = DIFF[difficulty];
  }

  private visible(e: Hero) {
    const a = this.h.chest, b = e.chest;
    return this.g.los(a, b);
  }

  think(dt: number, frozen: boolean) {
    const h = this.h, g = this.g, inp = h.input;
    if (!h.alive) { inp.primary = inp.secondary = inp.ult = false; return; }
    inp.secondary = false; inp.ult = false; inp.jump = false;
    if (frozen) { inp.forward = inp.strafe = 0; inp.primary = false; return; }

    // ── target selection
    this.retarget -= dt;
    if (this.retarget <= 0 || (this.target && !this.target.alive)) {
      this.retarget = this.p.think + rand(0, 0.3);
      let best: Hero | null = null, bestScore = Infinity;
      for (const e of g.heroes) {
        if (!e.alive || e.team === h.team) continue;
        const d = e.pos.distanceTo(h.pos);
        if (d > 60) continue;
        const vis = this.visible(e);
        const score = d * (vis ? 1 : 2.2) * (0.6 + 0.4 * (e.hp / e.maxHp)) * (e === this.target ? 0.8 : 1);
        if (score < bestScore) { bestScore = score; best = e; }
      }
      if (best !== this.target) this.seen = 0;
      this.target = best;
    }
    const t = this.target;
    const vis = t ? this.visible(t) : false;
    this.seen = vis ? this.seen + dt : Math.max(0, this.seen - dt * 2);

    // ── movement goal
    const hpFrac = h.hp / h.maxHp;
    const goal = new THREE.Vector3();
    let combat = false;
    const lowHp = hpFrac < 0.35;
    if (lowHp) {
      // seek a health pack, an allied sunflower, or fall back toward spawn
      let bestD = Infinity;
      for (const p of g.pickups) if (p.ready) { const d = p.pos.distanceTo(h.pos); if (d < bestD) { bestD = d; goal.copy(p.pos); } }
      for (const z of g.zones) if (z.kind === 'sunflower' && z.team === h.team) { const d = z.pos.distanceTo(h.pos); if (d < bestD + 8) { bestD = d; goal.copy(z.pos); } }
      if (bestD === Infinity) goal.copy(g.world.spawns[h.team]);
      combat = !!t && vis;
    } else if (t) {
      const range = h.def.botRange;
      const away = h.pos.clone().sub(t.pos).setY(0);
      const d = away.length();
      if (d > 0.01) away.divideScalar(d);
      goal.copy(t.pos).addScaledVector(away, vis ? range : Math.min(range, 4));
      combat = vis && d < EFFECTIVE[h.def.id] + 5;
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = rand(3, 6);
        g.world.randomPoint(this.wander);
      }
      goal.copy(this.wander);
    }

    // ── steering (grid arenas: follow an A* path around big obstacles when the straight line is blocked)
    const grid = g.world.grid;
    let steer = goal;
    if (grid) {
      this.pathT -= dt;
      if (grid.lineClear(h.pos, goal)) this.path = null;
      else {
        if (!this.path || this.pathT <= 0 || this.pathGoal.distanceToSquared(goal) > 9) {
          this.path = grid.findPath(h.pos.x, h.pos.z, goal.x, goal.z);
          this.pathGoal.copy(goal); this.pathT = rand(0.5, 0.8);
        }
        while (this.path && this.path.length > 1 && (Math.hypot(this.path[0].x - h.pos.x, this.path[0].z - h.pos.z) < 1.3 || grid.lineClear(h.pos, this.path[1]))) this.path.shift();
        if (this.path?.length) steer = this.path[0];
      }
    }
    const to = steer.clone().sub(h.pos).setY(0);
    const dist = to.length();
    const move = new THREE.Vector3();
    if (dist > 1.2) move.copy(to).divideScalar(dist);
    else if (combat) move.set(0, 0, 0);
    if (combat) {
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.5, 1.6); this.strafe = Math.random() < 0.5 ? -1 : 1; }
      const toT = t!.pos.clone().sub(h.pos).setY(0).normalize();
      const perp = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this.strafe);
      move.multiplyScalar(dist > 3 ? 0.8 : 0.3).addScaledVector(perp, 0.85);
      if (Math.random() < dt * 0.5) inp.jump = true;
    }
    // obstacle avoidance
    const ahead = h.pos.clone().addScaledVector(move, 2.0);
    for (const c of g.world.colliders) {
      const dx = ahead.x - c.x, dz = ahead.z - c.z;
      const rr = c.kind === 'circle' ? c.r + 1.2 : Math.max(c.hx, c.hz) + 1.0;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        // steer sideways around it
        const side = new THREE.Vector3(-move.z, 0, move.x);
        const s = side.x * dx + side.z * dz >= 0 ? 1 : -1;
        move.addScaledVector(side, s * (1 - d / rr) * 1.6);
        move.x += (dx / d) * (1 - d / rr) * 0.6;
        move.z += (dz / d) * (1 - d / rr) * 0.6;
      }
    }
    // keep away from teammates
    for (const a of g.heroes) {
      if (a === h || !a.alive || a.team !== h.team) continue;
      const dx = h.pos.x - a.pos.x, dz = h.pos.z - a.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 4 && d2 > 1e-4) { const d = Math.sqrt(d2); move.x += (dx / d) * (2 - d) * 0.5; move.z += (dz / d) * (2 - d) * 0.5; }
    }
    if (move.lengthSq() > 1) move.normalize();
    // stuck detection
    if (move.lengthSq() > 0.2 && h.pos.distanceTo(this.lastPos) < 0.6 * dt * h.def.speed * 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 0.5) { inp.jump = true; this.strafe *= -1; this.strafeT = 0.8; this.wanderT = 0; this.stuckT = 0; }
    } else this.stuckT = 0;
    this.lastPos.copy(h.pos);

    // ── aim
    let aimPoint: THREE.Vector3;
    if (t && (vis || this.seen > 0)) {
      const sp = PROJ_SPEED[h.def.id];
      const chest = t.chest;
      const d = chest.distanceTo(h.chest);
      const lead = t.vel.clone().multiplyScalar(d / sp);
      this.errT -= dt;
      if (this.errT <= 0) {
        this.errT = rand(0.25, 0.6);
        this.errVec.set(rand(-1, 1), rand(-0.6, 0.8), rand(-1, 1)).multiplyScalar(this.p.err * (0.5 + d / 30));
      }
      aimPoint = chest.add(lead).add(this.errVec);
      if (h.def.id === 'vangogh') aimPoint.y += d * d * 0.0016; // arc compensation for paint
    } else {
      aimPoint = h.pos.clone().addScaledVector(move.lengthSq() > 0.01 ? move : h.forward, 10).setY(h.pos.y + 1.4);
    }
    const dir = aimPoint.clone().sub(h.chest);
    const wantYaw = Math.atan2(-dir.x, -dir.z);
    const wantPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    const k = 1 - Math.exp(-this.p.turn * dt);
    inp.yaw = h.yaw + angleDiff(h.yaw, wantYaw) * k;
    inp.pitch = h.pitch + (wantPitch - h.pitch) * k;
    inp.aim.copy(aimPoint);

    // move vector -> local axes
    const fwd = new THREE.Vector3(-Math.sin(inp.yaw), 0, -Math.cos(inp.yaw));
    const right = new THREE.Vector3(Math.cos(inp.yaw), 0, -Math.sin(inp.yaw));
    inp.forward = clamp(move.dot(fwd), -1, 1);
    inp.strafe = clamp(move.dot(right), -1, 1);

    // ── fire
    const yawErr = Math.abs(angleDiff(h.yaw, wantYaw));
    const tDist = t ? t.pos.distanceTo(h.pos) : Infinity;
    inp.primary = !!t && vis && this.seen > this.p.react && yawErr < this.p.fireCone + 0.4 / Math.max(2, tDist) && tDist < EFFECTIVE[h.def.id];

    // ── abilities
    this.abilityT -= dt;
    if (this.abilityT > 0 || !t) return;
    this.abilityT = this.p.think;
    const enemiesClose = (r: number) => g.enemiesNear(h.team, h.pos, r).length;
    switch (h.def.id) {
      case 'einstein':
        if (h.secondaryCd <= 0 && vis && tDist < 26 && tDist > 4 && Math.random() < 0.6) inp.secondary = true;
        if (h.ult >= 1 && (enemiesClose(9) >= 2 || (enemiesClose(6) >= 1 && t.hp > 90))) inp.ult = true;
        break;
      case 'yeat':
        // Tonka: needs a run-up and a straight line to the target
        if (h.secondaryCd <= 0 && vis && tDist > 7 && tDist < 24 && yawErr < 0.35 && !lowHp) inp.secondary = true;
        // The Bell: drop it on a visible target, ideally one that's busy fighting
        if (h.ult >= 1 && vis && tDist < 40 && (t.hp > 120 || g.enemiesNear(h.team, t.pos, 6).length >= 2)) inp.ult = true;
        break;
      case 'luffy': {
        const g5 = !!h.kitState.luffy?.gear;
        // Gum-Gum Rocket: dive onto a target in reach, or bail out of a losing fight toward cover
        if (h.secondaryCd <= 0 && vis && tDist > 6 && tDist < 24 && yawErr < 0.25 && (!lowHp || g5) && Math.random() < 0.55) inp.secondary = true;
        // Gear Fifth: when brawling at close range with a healthy target or several enemies around
        if (h.ult >= 1 && !g5 && (enemiesClose(8) >= 2 || (enemiesClose(7) >= 1 && t.hp > 120) || (lowHp && enemiesClose(6) >= 1))) inp.ult = true;
        break;
      }
      case 'vangogh': {
        if (h.secondaryCd <= 0) {
          let hurt: Hero | null = null;
          for (const a of g.alliesNear(h.team, h.pos, 16)) if (a.hp / a.maxHp < 0.65 && (!hurt || a.hp < hurt.hp)) hurt = a;
          if (hurt) { inp.aim.copy(hurt.pos); inp.secondary = true; }
        }
        if (h.ult >= 1 && (enemiesClose(11) >= 2 || (enemiesClose(10) >= 1 && g.alliesNear(h.team, h.pos, 10).length >= 2))) inp.ult = true;
        else if (h.ult >= 1 && enemiesClose(8) >= 1 && hpFrac < 0.5) inp.ult = true;
        break;
      }
    }
  }
}

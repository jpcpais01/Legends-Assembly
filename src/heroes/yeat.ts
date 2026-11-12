import * as THREE from 'three';
import type { HeroDef, HeroKit, Projectile } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { rand, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';

const GOLD = new THREE.Color(3.2, 2.2, 0.7);
const RAGE = new THREE.Color(3.6, 0.35, 1.4);
const RAGE_DEEP = new THREE.Color(2.2, 0.15, 0.6);
const Z = new THREE.Vector3(0, 0, 1);

function ringPool() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  return new InstancedPool(new THREE.TorusGeometry(1, 0.09, 6, 28), mat, 192, true);
}

class YeatKit implements HeroKit {
  primary(h: Hero, g: Game) {
    h.primaryCd = 0.62;
    const rage = !!h.kitState.mode;
    const m = h.muzzle('R');
    m.addScaledVector(h.right, -0.3); // both hands, center-ish
    const base = h.aimDir(m);
    h.anim.attack = 1;
    h.anim.attackSide = (h.anim.attackSide * -1) || 1;
    const col = rage ? RAGE : GOLD;
    g.play('bell', m, 0.8);
    g.vfx.p({ x: m.x, y: m.y, z: m.z, r: col.r, g: col.g, b: col.b, size: 0.3, grow: 4, life: 0.2, shape: Shape.Ring, aux: 0.15 });
    g.vfx.burst(m, col, 8, 5, 0.1, 0.25);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(base, up).normalize();
    const vup = new THREE.Vector3().crossVectors(side, base).normalize();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rand(-0.3, 0.3);
      const s = i === 0 ? 0 : rand(0.03, 0.075);
      const dir = base.clone().addScaledVector(side, Math.cos(a) * s).addScaledVector(vup, Math.sin(a) * s).normalize();
      g.spawnProjectile({
        owner: h, kind: 'bell', pos: m.clone(), vel: dir.multiplyScalar(62), gravity: 0, radius: 0.16, life: 0.36, damage: 10, color: col,
        render(p, g) {
          const pool = g.pool('bellRing', ringPool);
          _q1.setFromUnitVectors(Z, _v1.copy(p.vel).normalize());
          const sc = 0.12 + p.age * 1.1;
          _m1.compose(p.pos, _q1, new THREE.Vector3(sc, sc, sc));
          const fade = 1 - (p.age / p.life) * 0.6;
          pool.add(_m1, new THREE.Color(p.color.r * fade, p.color.g * fade, p.color.b * fade));
        },
        onHit(p, g, hit, point) {
          if (hit) {
            const crit = point.y > hit.pos.y + 1.42;
            const falloff = p.age > 0.2 ? 0.6 : 1;
            g.damage(hit, p.damage * falloff, p.owner, { crit, at: point, knock: _v1.copy(p.vel).setY(0).normalize().multiplyScalar(0.6) });
          }
          g.vfx.sparks(point, p.color, 4, 6);
          g.vfx.p({ x: point.x, y: point.y, z: point.z, r: p.color.r, g: p.color.g, b: p.color.b, size: 0.2, grow: 3, life: 0.15, shape: Shape.Ring, aux: 0.25 });
        },
      } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
    }
  }

  secondary(h: Hero, g: Game) {
    const f = h.lookDir();
    f.y = Math.max(-0.1, Math.min(0.25, f.y));
    f.normalize();
    h.kitState.dash = { t: 0, dir: f.clone(), hit: new Set<number>() };
    g.play('dash', h.pos, 1);
    g.play('bass808', h.pos, 0.7);
    g.vfx.shockwave(h.pos, RAGE, 3, 0.35, 0.15);
    g.vfx.smoke(h.pos, new THREE.Color(0.25, 0.08, 0.2), 6, 0.7, 0.8, 0.5);
    if (h.isLocal) { g.camRig.kick(14); g.camRig.shake(0.2); }
    return true;
  }

  ult(h: Hero, g: Game) {
    h.kitState.mode = { t: 0, pulse: 0 };
    const c = h.center;
    g.play('mode2093', h.pos, 1.2);
    g.vfx.shockwave(h.pos, RAGE, 9, 0.6, 0.08);
    g.vfx.shockwave(h.pos, new THREE.Color(3, 1.2, 3.5), 6, 0.45, 0.14);
    g.vfx.burst(c, RAGE, 90, 16, 0.14, 0.9, { drag: 2.5 });
    g.vfx.sparks(c, new THREE.Color(4, 1, 2.5), 40, 16);
    g.vfx.flash(c, new THREE.Color(1, 0.2, 0.5), 80, 1.0, 22);
    g.vfx.glyph('2093', c.clone().setY(c.y + 1.6), { color: '#ff4fa3', glow: '#ff1f4d', scale: 1.2, dur: 8, follow: () => (h.alive && h.kitState.mode ? _v1.copy(h.pos).setY(h.pos.y + 2.55) : null) });
    g.shake(h.pos, 0.7);
    for (const e of g.enemiesNear(h.team, h.pos, 7)) {
      const dir = e.center.sub(h.pos).setY(0).normalize();
      g.damage(e, 60, h, { knock: dir.multiplyScalar(12).setY(5) });
    }
    if (h.isLocal) g.events.onAnnounce('2093 MODE', 'Rage unlocked', 'red');
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    const st = h.kitState;
    // dash
    if (st.dash) {
      const d = st.dash;
      d.t += dt;
      h.dmgTakenMult *= 0.5;
      h.anim.dash = 1;
      h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).copy(d.dir).multiplyScalar(34);
      const c = h.center;
      for (let i = 0; i < 6; i++) {
        g.vfx.p({ x: c.x + rand(-0.4, 0.4), y: c.y + rand(-0.8, 0.7), z: c.z + rand(-0.4, 0.4), vx: -d.dir.x * 6, vy: rand(-0.5, 1), vz: -d.dir.z * 6, r: RAGE.r, g: RAGE.g, b: RAGE.b, size: rand(0.06, 0.14), life: rand(0.2, 0.45), shape: Shape.Spark, stretch: 0.06, drag: 3 });
      }
      g.vfx.pa({ x: c.x, y: c.y, z: c.z, r: 0.25, g: 0.05, b: 0.18, a: 0.35, size: 1.4, grow: 1.6, life: 0.35, shape: Shape.Smoke });
      for (const e of g.enemiesNear(h.team, h.pos, 1.8)) {
        if (d.hit.has(e.id)) continue;
        d.hit.add(e.id);
        g.damage(e, 40, h, { knock: _v1.copy(d.dir).setY(0).normalize().multiplyScalar(11).setY(4.5) });
        g.vfx.sparks(e.chest, RAGE, 20, 12);
        g.play('bass808', e.pos, 0.8);
        g.shake(e.pos, 0.35);
      }
      if (d.t >= 0.28) {
        st.dash = null;
        h.overrideVel = null;
        h.vel.multiplyScalar(0.35);
        h.anim.dash = 0;
        g.vfx.shockwave(h.pos, RAGE_DEEP, 2.5, 0.3, 0.2);
      }
    }
    // 2093 mode
    if (st.mode) {
      const m = st.mode;
      m.t += dt;
      m.pulse += dt;
      h.speedMult *= 1.35;
      h.dmgMult *= 1.4;
      h.dmgTakenMult *= 0.7;
      h.model.fx.uTintAmt.value = Math.min(1, m.t * 3) * 0.35;
      h.model.fx.uTint.value.setRGB(1.0, 0.35, 0.55);
      h.model.fx.uRim.value = 1.6 + Math.sin(m.t * 12) * 0.4;
      h.model.fx.uRimColor.value.setRGB(2.4, 0.2, 0.9);
      const c = h.center;
      // aura embers + crackle
      for (let i = 0; i < 3; i++) {
        const a = rand(0, TAU), r = rand(0.4, 0.8);
        g.vfx.p({ x: c.x + Math.cos(a) * r, y: h.pos.y + rand(0, 1.8), z: c.z + Math.sin(a) * r, vx: Math.cos(a) * 0.4, vy: rand(1.5, 3.5), vz: Math.sin(a) * 0.4, r: RAGE.r, g: RAGE.g * rand(0.5, 2), b: RAGE.b, size: rand(0.04, 0.09), life: rand(0.4, 0.8), shape: Shape.Spark, stretch: 0.03 });
      }
      if (Math.random() < dt * 8) g.vfx.sparks(_v1.copy(c).add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.5, 0.8), rand(-0.5, 0.5))), new THREE.Color(3.5, 1.5, 4), 5, 5);
      if (m.pulse >= 0.9) {
        m.pulse = 0;
        g.vfx.shockwave(h.pos, RAGE, 7, 0.45, 0.1);
        g.play('bass808', h.pos, 0.8);
        g.shake(h.pos, 0.15, 10);
        for (const e of g.enemiesNear(h.team, h.pos, 6.5)) g.damage(e, 30, h, { knock: e.center.sub(h.pos).setY(0).normalize().multiplyScalar(3) });
      }
      if (m.t >= 8) {
        st.mode = null;
        h.model.fx.uTintAmt.value = 0;
        h.model.fx.uRim.value = 0.35;
        h.model.fx.uRimColor.value.copy(h.team === 0 ? new THREE.Color('#3fb4ff') : new THREE.Color('#ff3d5a'));
      }
    }
  }

  onDeath(h: Hero) {
    h.kitState.dash = null;
    h.kitState.mode = null;
    h.anim.dash = 0;
    h.model.fx.uTintAmt.value = 0;
    h.model.fx.uRim.value = 0.35;
    h.model.fx.uRimColor.value.copy(h.team === 0 ? new THREE.Color('#3fb4ff') : new THREE.Color('#ff3d5a'));
  }
}

function buildYeat(r: RigBuilder) {
  r.base({ skin: '#d9a886', shirt: '#121216', pants: '#1d1d24', shoes: '#f1f1f1', sleeves: '#121216', torsoScale: [1.15, 1.05, 1.2], legR: 0.09, armR: 0.072, shoeScale: 1.3, eyes: false });
  const puffer = r.mat('#0e0e12', 0.32, 0.1);
  const gold = r.mat('#ffcf5a', 0.22, 1);
  const red = r.mat('#c0122c', 0.7);
  const shades = r.mat('#050507', 0.08, 0.9);
  const sole = r.mat('#d4142e', 0.5);
  // puffer jacket: stacked quilted rings
  for (let i = 0; i < 5; i++) {
    const y = 0.02 + i * 0.075;
    const rad = 0.2 - Math.abs(i - 2) * 0.012;
    r.add(r.spine, new THREE.TorusGeometry(rad, 0.045, 8, 24), puffer, [0, y, 0], [Math.PI / 2, 0, 0], [1.08, 0.82, 1]);
  }
  r.add(r.chest, new THREE.TorusGeometry(0.11, 0.05, 8, 20), puffer, [0, 0.1, 0], [Math.PI / 2, 0, 0]); // high collar
  for (const sh of [r.shoulderL, r.shoulderR]) {
    for (let i = 0; i < 3; i++) r.add(sh, new THREE.TorusGeometry(0.075, 0.035, 6, 16), puffer, [0, -0.05 - i * 0.085, 0], [Math.PI / 2, 0, 0]);
  }
  for (const el of [r.elbowL, r.elbowR]) for (let i = 0; i < 2; i++) r.add(el, new THREE.TorusGeometry(0.068, 0.032, 6, 16), puffer, [0, -0.04 - i * 0.09, 0], [Math.PI / 2, 0, 0]);
  // chains + bell pendant
  r.add(r.chest, new THREE.TorusGeometry(0.13, 0.012, 6, 32), gold, [0, 0.06, 0.04], [Math.PI / 2 - 0.5, 0, 0], [1, 1.25, 1]);
  r.add(r.chest, new THREE.TorusGeometry(0.15, 0.016, 6, 32), gold, [0, 0.02, 0.05], [Math.PI / 2 - 0.65, 0, 0], [1, 1.35, 1]);
  r.add(r.chest, new THREE.ConeGeometry(0.04, 0.06, 12, 1, true), gold, [0, -0.11, 0.19], [0.3, 0, 0]);
  r.add(r.chest, r.sphere(0.012, 6, 4), gold, [0, -0.145, 0.2]);
  // beanie
  r.add(r.head, r.sphere(0.128, 18, 12, ), red, [0, 0.11, -0.005], [0, 0, 0], [1.02, 0.85, 1.05]);
  r.add(r.head, new THREE.TorusGeometry(0.118, 0.025, 6, 24), red, [0, 0.075, 0], [Math.PI / 2, 0, 0], [1, 1.02, 1]);
  r.add(r.head, r.sphere(0.03, 8, 6), red, [0, 0.215, -0.01]);
  // wrap shades
  r.add(r.head, new THREE.TorusGeometry(0.11, 0.022, 6, 20, Math.PI * 0.9), shades, [0, 0.08, 0.005], [Math.PI / 2, 0, Math.PI * 0.05], [1, 1.05, 0.9]);
  // rings on fingers + chunky sole accents
  r.add(r.handR, r.sphere(0.02, 6, 4), gold, [0.02, -0.05, 0.02]);
  r.add(r.handL, r.sphere(0.02, 6, 4), gold, [-0.02, -0.05, 0.02]);
  for (const ft of [r.footL, r.footR]) r.add(ft, new THREE.BoxGeometry(0.13, 0.04, 0.3), sole, [0, -0.065, 0.06]);
}

export const YEAT: HeroDef = {
  id: 'yeat',
  name: 'Yeat',
  title: 'The Rage Icon',
  role: 'Vanguard',
  tagline: 'Twizzy rich. Bells ringing. Rage on.',
  color: '#ff3d7f',
  accent: '#ffcf5a',
  maxHp: 350,
  speed: 6.3,
  secondaryCd: 7,
  ultCost: 1350,
  botRange: 6,
  ratings: { damage: 0.75, mobility: 0.8, support: 0.1, difficulty: 0.35 },
  abilities: {
    primary: { key: 'LMB', name: 'Bell Ring', desc: 'Blast a spread of golden sound rings. Brutal up close, falls off at range.', stat: '7 × 10 dmg · close range', icon: ICONS.bell },
    secondary: { key: 'RMB', name: 'Rage Dash', desc: 'Explode forward in a burst of rage, smashing and launching enemies in your path.', stat: '40 dmg + knockback · 7 s cd', icon: ICONS.dash },
    ult: { key: 'SHIFT', name: '2093 Mode', desc: 'Go full 2093: +35% speed, +40% damage, 30% damage reduction and pulsing bass drops.', stat: '8 s transformation', icon: ICONS.mode2093 },
  },
  look: { build: buildYeat },
  createKit: () => new YeatKit(),
};

export function warmupYeat(g: Game): THREE.Object3D[] {
  g.pool('bellRing', ringPool);
  return [];
}

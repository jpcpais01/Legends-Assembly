import * as THREE from 'three';
import type { HeroDef, HeroKit, Projectile, Zone } from '../game/types';
import type { Hero } from '../game/Hero';
import type { Game } from '../game/Game';
import { InstancedPool } from '../vfx/Vfx';
import { Shape } from '../vfx/Particles';
import { globalUniforms } from '../render/materials';
import { rand, TAU, _m1, _q1, _v1 } from '../core/math';
import type { RigBuilder } from '../render/HeroRig';
import { ICONS } from './icons';
import { audio } from '../core/Audio';

const PHOTON = new THREE.Color(1.6, 3.2, 4.2);
const PHOTON_SOFT = new THREE.Color(0.5, 1.4, 2.6);
const VIOLET = new THREE.Color(1.6, 0.5, 3.2);
const GOLD = new THREE.Color(4, 2.8, 1.2);
const Z = new THREE.Vector3(0, 0, 1);

function photonPool() {
  return new InstancedPool(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 4.5, 6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    256,
  );
}

function orbPool() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: globalUniforms.uTime },
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.5); vec3 c = mix(vec3(0.0), vec3(1.4,0.5,3.4), f) + vec3(2.0,1.2,4.0) * pow(f, 6.0) * (1.0 + 0.3*sin(uTime*30.0)); gl_FragColor = vec4(c, 1.0); }`,
  });
  return new InstancedPool(new THREE.SphereGeometry(1, 20, 14), m, 32);
}

// ───────────────── Gravity Well visuals ─────────────────
let diskMat: THREE.ShaderMaterial | null = null;
let haloMat: THREE.ShaderMaterial | null = null;
let coreMat: THREE.ShaderMaterial | null = null;
function wellMaterials() {
  if (diskMat) return { diskMat, haloMat: haloMat!, coreMat: coreMat! };
  diskMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise, uFade: { value: 1 } },
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform sampler2D uNoise; uniform float uFade; varying vec2 vP;
      void main(){
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        // log-spiral arms swirling inward
        float sp = a / 6.2831 + log(max(r, 0.05)) * 0.55 - uTime * 0.45;
        float n = texture2D(uNoise, vec2(sp * 2.0, r * 0.12 - uTime * 0.1)).g;
        float arms = pow(0.5 + 0.5 * sin(sp * 6.2831 * 3.0 + n * 4.0), 3.0);
        float body = smoothstep(1.0, 0.25, r) * smoothstep(0.11, 0.2, r);
        float inner = smoothstep(0.32, 0.17, r) * smoothstep(0.12, 0.17, r);
        vec3 col = mix(vec3(0.5, 0.15, 1.2), vec3(1.4, 0.9, 2.6), arms) * (arms * 0.8 + 0.25) * body;
        col += vec3(3.0, 2.2, 4.0) * inner * 1.6;
        gl_FragColor = vec4(col * uFade, 1.0);
      }`,
  });
  haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: globalUniforms.uTime, uFade: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(0.0,0.0,0.0,1.0); float s = length(modelMatrix[0].xyz); mv.xy += position.xy * s; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime; uniform float uFade; varying vec2 vUv; void main(){ float r = length(vUv-0.5)*2.0; float ring = smoothstep(0.08, 0.0, abs(r-0.5)) * 1.5 + smoothstep(0.5, 0.0, abs(r-0.55)) * 0.25; float flick = 0.85 + 0.15*sin(uTime*20.0); gl_FragColor = vec4(vec3(1.6,1.1,3.0)*ring*flick*uFade, 1.0); }`,
  });
  coreMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(normalize(vN), vV)), 3.0); gl_FragColor = vec4(vec3(1.2,0.6,2.6) * f * 2.0, 1.0); }`,
  });
  return { diskMat, haloMat, coreMat };
}

function createGravityWell(g: Game, owner: Hero, at: THREE.Vector3) {
  const pos = at.clone();
  const ground = g.world.heightAt(pos.x, pos.z);
  if (pos.y - ground < 2.5) pos.y = ground + 1.1;
  const { diskMat, haloMat, coreMat } = wellMaterials();
  const group = new THREE.Group();
  group.position.copy(pos);
  const disk = new THREE.Mesh(new THREE.CircleGeometry(6.5, 64), diskMat.clone());
  disk.rotation.x = -Math.PI / 2 + 0.5;
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.75, 32, 20), coreMat);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMat.clone());
  halo.scale.setScalar(4);
  group.add(disk, core, halo);
  group.scale.setScalar(0.01);
  g.scene.add(group);
  g.play('gravity', pos);
  g.vfx.flash(pos, new THREE.Color(0.7, 0.3, 1.5), 25, 3.2, 14);
  g.shake(pos, 0.25);
  let tickT = 0;
  const zone: Zone = {
    owner, team: owner.team, pos, radius: 6.5, t: 0, dur: 3.2, dead: false, kind: 'gravityWell',
    update(z, g, dt) {
      const open = Math.min(1, z.t / 0.25);
      const close = z.t > z.dur - 0.3 ? Math.max(0, (z.dur - z.t) / 0.3) : 1;
      const s = (1 - Math.pow(1 - open, 3)) * (0.6 + 0.4 * close);
      group.scale.setScalar(Math.max(0.01, s));
      disk.rotation.z += dt * 1.6;
      (disk.material as THREE.ShaderMaterial).uniforms.uFade.value = close;
      (halo.material as THREE.ShaderMaterial).uniforms.uFade.value = close;
      core.scale.setScalar(1 + Math.sin(z.t * 18) * 0.04);
      // inward spiraling motes
      for (let i = 0; i < 5; i++) {
        const a = rand(0, TAU), r = rand(3, 6.5);
        const life = rand(0.6, 1.0);
        const px = Math.cos(a) * r, pz = Math.sin(a) * r;
        const tx = -Math.sin(a), tz = Math.cos(a);
        g.vfx.p({
          x: pos.x + px, y: pos.y + rand(-0.4, 0.6), z: pos.z + pz,
          vx: (-px / life) * 0.9 + tx * 4, vy: rand(-0.3, 0.3), vz: (-pz / life) * 0.9 + tz * 4,
          r: rand(0.6, 1.6), g: 0.5, b: 3.2, size: rand(0.05, 0.12), life, shape: Shape.Spark, stretch: 0.04,
        });
      }
      // pull + slow + damage ticks
      tickT += dt;
      const tick = tickT >= 0.4;
      if (tick) tickT = 0;
      for (const h of g.enemiesNear(z.team, pos, z.radius)) {
        const d = _v1.copy(pos).sub(h.center);
        const dist = d.length();
        if (dist > 0.3) {
          d.y *= 0.3;
          d.normalize();
          const pull = (8.5 * (1 - dist / z.radius) + 2.5) * dt;
          h.pos.addScaledVector(d, pull);
        }
        h.applySlow(0.4, 0.35);
        if (tick) g.damage(h, 7, owner, { at: h.chest });
      }
    },
    dispose(z, g) {
      // collapse pop
      g.vfx.burst(pos, VIOLET, 50, 9, 0.14, 0.6);
      g.vfx.shockwave(pos, new THREE.Color(1.2, 0.5, 2.6), 3.5, 0.4, 0.15, false);
      for (const h of g.enemiesNear(z.team, pos, 3)) g.damage(h, 25, owner);
      g.scene.remove(group);
      disk.geometry.dispose(); (disk.material as THREE.Material).dispose();
      halo.geometry.dispose(); (halo.material as THREE.Material).dispose();
      core.geometry.dispose();
    },
  };
  g.addZone(zone);
}

// ───────────────── E = mc² blast ─────────────────
let blastMat: THREE.ShaderMaterial | null = null;
function createBlastMaterial() {
  {
    blastMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uNoise: globalUniforms.uNoise, uK: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uNoise; uniform float uK; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = pow(1.0 - abs(dot(normalize(vN), vV)), 2.0);
          float n = texture2D(uNoise, vP.xz * 0.6 + vP.y * 0.3 + uTime * 0.5).g;
          vec3 hot = mix(vec3(4.0, 3.2, 2.2), vec3(4.0, 1.6, 0.5), uK);
          vec3 c = hot * (0.25 + f * 1.6) * (0.7 + n * 0.6);
          float a = (1.0 - uK) * (1.0 - uK);
          gl_FragColor = vec4(c * a, 1.0);
        }`,
    });
  }
}
function createBlast(g: Game, owner: Hero, at: THREE.Vector3) {
  if (!blastMat) createBlastMaterial();
  const mat = blastMat!.clone();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), mat);
  sphere.position.copy(at);
  g.scene.add(sphere);
  const ground = at.clone(); ground.y = g.world.heightAt(at.x, at.z);
  g.vfx.shockwave(ground, GOLD, 13, 0.7, 0.06);
  g.vfx.shockwave(ground, new THREE.Color(3, 3.5, 4), 9, 0.5, 0.12);
  g.vfx.shockwave(at, new THREE.Color(4, 3, 2), 12, 0.6, 0.05, false);
  g.vfx.burst(at, GOLD, 140, 26, 0.16, 1.2, { drag: 2 });
  g.vfx.sparks(at, new THREE.Color(4, 3, 1.5), 60, 22);
  g.vfx.smoke(ground, new THREE.Color(0.6, 0.5, 0.45), 18, 1.6, 2.2, 0.35);
  g.vfx.flash(at, new THREE.Color(1, 0.85, 0.6), 160, 1.0, 40);
  g.vfx.glyph('E = mc²', at.clone().setY(at.y + 2.5), { color: '#fff6dc', glow: '#ffb347', scale: 3.2, dur: 1.6, vy: 1.2 });
  g.shake(at, 1.0, 40);
  g.camRig.kick(owner.isLocal ? 10 : 0);
  g.play('emcBlast', at, 1.3);
  audio.duck(1.4, 0.85, 0.4);
  // light pillar
  for (let i = 0; i < 40; i++) g.vfx.p({ x: at.x + rand(-0.5, 0.5), y: ground.y + rand(0, 2), z: at.z + rand(-0.5, 0.5), vy: rand(10, 26), r: 4, g: 3.2, b: 2, size: rand(0.2, 0.5), life: rand(0.4, 0.8), shape: Shape.Spark, stretch: 0.05, drag: 1.5 });
  for (const h of g.enemiesNear(owner.team, at, 11)) {
    const d = h.center.distanceTo(at);
    const dmg = 230 - (d / 11) * 120;
    const dir = h.center.sub(at).setY(0).normalize();
    g.damage(h, dmg, owner, { knock: dir.multiplyScalar(15).setY(7) });
  }
  g.addZone({
    owner, team: owner.team, pos: at.clone(), radius: 0, t: 0, dur: 0.9, dead: false, kind: 'blast',
    update(z) {
      const k = z.t / z.dur;
      sphere.scale.setScalar(1 + (1 - Math.pow(1 - Math.min(1, k * 1.6), 3)) * 11);
      mat.uniforms.uK.value = k;
    },
    dispose() { g.scene.remove(sphere); sphere.geometry.dispose(); mat.dispose(); },
  });
}

// ───────────────── Kit ─────────────────
class EinsteinKit implements HeroKit {
  primary(h: Hero, g: Game) {
    h.primaryCd = 0.2;
    h.hand = (h.hand * -1) as 1 | -1;
    const side = h.hand > 0 ? 'R' : 'L';
    const m = h.muzzle(side);
    const dir = h.aimDir(m);
    h.anim.attack = 1;
    h.anim.attackSide = h.hand;
    g.vfx.burst(m, PHOTON, 5, 3, 0.1, 0.15);
    g.play('photon', m, 0.55);
    g.spawnProjectile({
      owner: h, kind: 'photon', pos: m.clone(), vel: dir.multiplyScalar(95), gravity: 0, radius: 0.12, life: 1.1, damage: 20, color: PHOTON,
      render(p, g) {
        const pool = g.pool('photon', photonPool);
        _q1.setFromUnitVectors(Z, _v1.copy(p.vel).normalize());
        _m1.compose(p.pos, _q1, new THREE.Vector3(0.09, 0.09, 0.9));
        pool.add(_m1);
        g.vfx.p({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), r: PHOTON_SOFT.r, g: PHOTON_SOFT.g, b: PHOTON_SOFT.b, size: 0.09, life: 0.18, shape: Shape.Dot });
      },
      onHit(p, g, hit, point) {
        if (hit) {
          const crit = point.y > hit.pos.y + 1.42;
          g.damage(hit, p.damage, p.owner, { crit, at: point });
        }
        g.play('photonHit', point, hit ? 0.7 : 0.45);
        g.vfx.sparks(point, PHOTON, 10, 8);
        g.vfx.burst(point, PHOTON_SOFT, 6, 2, 0.16, 0.2);
        g.vfx.p({ x: point.x, y: point.y, z: point.z, r: 2, g: 3.5, b: 4.5, size: 0.25, grow: 3.5, life: 0.18, shape: Shape.Ring, aux: 0.2 });
      },
    } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
  }

  secondary(h: Hero, g: Game) {
    const m = h.muzzle('R');
    const dir = h.aimDir(m);
    h.anim.attack = 1; h.anim.attackSide = 1;
    g.play('gravityThrow', m, 0.8);
    g.spawnProjectile({
      owner: h, kind: 'gravityOrb', pos: m.clone(), vel: dir.multiplyScalar(30).add(new THREE.Vector3(0, 2.5, 0)), gravity: 9, radius: 0.32, life: 1.0, damage: 0, color: VIOLET,
      render(p, g) {
        const pool = g.pool('gravityOrb', orbPool);
        _m1.compose(p.pos, _q1.identity(), new THREE.Vector3(0.32, 0.32, 0.32));
        pool.add(_m1);
        for (let i = 0; i < 2; i++) g.vfx.p({ x: p.pos.x + rand(-0.2, 0.2), y: p.pos.y + rand(-0.2, 0.2), z: p.pos.z + rand(-0.2, 0.2), r: 1, g: 0.4, b: 2.6, size: rand(0.08, 0.16), life: 0.35, shape: Shape.Dot, drag: 3 });
      },
      onHit(p, g, _hit, point) { createGravityWell(g, p.owner, point); },
      onExpire(p, g) { createGravityWell(g, p.owner, p.pos); },
    } as Omit<Projectile, 'prev' | 'age' | 'dead' | 'seed'>);
    return true;
  }

  ult(h: Hero, g: Game) {
    h.kitState.ultT = 0;
    h.kitState.ultOn = true;
    h.channel = 1.15;
    g.play('emcCharge', h.pos, 1);
    g.vfx.glyph('E = mc²', h.center, { color: '#ffffff', glow: '#7fd3ff', scale: 1.4, dur: 1.15, follow: () => (h.alive ? _v1.copy(h.pos).setY(h.pos.y + 2.7) : null) });
    if (h.isLocal) g.events.onAnnounce('E = mc²', 'Mass becomes energy', 'gold');
    return true;
  }

  update(h: Hero, g: Game, dt: number) {
    const st = h.kitState;
    if (st.ultOn) {
      st.ultT += dt;
      h.dmgTakenMult = 0.5;
      h.anim.levitate = Math.min(1, st.ultT * 3);
      h.anim.cast = Math.min(1, st.ultT * 2);
      h.overrideVel = (h.overrideVel ?? new THREE.Vector3()).set(0, st.ultT < 0.85 ? 2.4 : 0.2, 0);
      // orbiting equation light
      const c = h.center;
      for (let i = 0; i < 4; i++) {
        const a = st.ultT * 7 + (i / 4) * TAU;
        const r = 1.6 - st.ultT * 0.6;
        g.vfx.p({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a * 0.5) * 0.6, z: c.z + Math.sin(a) * r, r: 3, g: 2.6, b: 1.6, size: 0.14, life: 0.35, shape: Shape.Star });
      }
      if (Math.random() < dt * 30) {
        const a = rand(0, TAU), r = rand(3, 6);
        g.vfx.p({ x: c.x + Math.cos(a) * r, y: c.y + rand(-1, 2), z: c.z + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.5, vz: -Math.sin(a) * r * 2.5, r: 2.5, g: 3, b: 4, size: 0.08, life: 0.4, shape: Shape.Spark, stretch: 0.05 });
      }
      if (st.ultT >= 1.15) {
        st.ultOn = false;
        h.overrideVel = null;
        h.anim.levitate = 0; h.anim.cast = 0;
        createBlast(g, h, h.center);
      }
    }
  }

  onDeath(h: Hero) {
    h.kitState.ultOn = false;
    h.anim.levitate = 0; h.anim.cast = 0;
  }
}

// ───────────────── Look ─────────────────
function buildEinstein(r: RigBuilder) {
  const { skin } = r.base({ skin: '#e9c3a6', shirt: '#7b634c', pants: '#55545e', shoes: '#2b1e16', sleeves: '#7b634c', torsoScale: [1.02, 1, 1.05] });
  const hair = r.mat('#f2efe9', 0.95);
  const white = r.mat('#f4f1ea', 0.6);
  const knit = r.mat('#6a5442', 0.95);
  // cardigan front panels + buttons, shirt collar, bow-ish tie
  r.add(r.spine, r.capsule(0.03, 0.26, 6), white, [0, 0.2, 0.135], [0, 0, 0], [1.6, 1, 0.5]);
  for (const x of [0.07, -0.07]) r.add(r.spine, r.capsule(0.075, 0.22, 8), knit, [x, 0.17, 0.11], [0, 0, x > 0 ? -0.06 : 0.06], [1, 1, 0.45]);
  const btn = r.mat('#2b2018', 0.4, 0.2);
  for (let i = 0; i < 4; i++) r.add(r.spine, r.sphere(0.012, 6, 4), btn, [0.03, 0.06 + i * 0.07, 0.15]);
  r.add(r.chest, new THREE.TorusGeometry(0.075, 0.025, 6, 16), white, [0, 0.13, 0], [Math.PI / 2, 0, 0], [1, 1.1, 1]);
  // pocket watch chain
  r.add(r.spine, new THREE.TorusGeometry(0.06, 0.006, 4, 16, Math.PI), r.mat('#e8b85a', 0.25, 1), [-0.06, 0.05, 0.15], [0, 0, Math.PI], [1, 0.6, 1]);
  // wild hair: radial tufts around the back and sides, a few rebels on top
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU;
    const back = Math.cos(a - Math.PI);
    if (back < -0.55) continue; // keep the face clear
    const y = 0.11 + Math.sin(i * 2.3) * 0.04;
    const rr = 0.12;
    const m = r.add(r.head, r.capsule(0.032, 0.12 + (i % 3) * 0.03, 6), hair, [Math.sin(a) * rr, y, Math.cos(a) * rr * 0.9 - 0.01]);
    const dir = new THREE.Vector3(Math.sin(a), 0.45 + Math.sin(i * 1.7) * 0.35, Math.cos(a)).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const m = r.add(r.head, r.capsule(0.03, 0.1, 6), hair, [Math.sin(a) * 0.05, 0.17, Math.cos(a) * 0.05 - 0.02]);
    m.rotation.set(Math.cos(a) * 0.9, 0, -Math.sin(a) * 0.9);
  }
  r.add(r.head, r.sphere(0.115, 14, 10), hair, [0, 0.1, -0.03], [0, 0, 0], [1.05, 0.85, 1.05]);
  // bushy mustache + brows
  for (const x of [-0.035, 0, 0.035]) r.add(r.head, r.sphere(0.03, 8, 6), hair, [x, 0.012, 0.108], [0, 0, 0], [1.2, 0.65, 0.8]);
  for (const x of [0.042, -0.042]) r.add(r.head, r.capsule(0.012, 0.035, 4), hair, [x, 0.112, 0.105], [0, 0, Math.PI / 2 + (x > 0 ? -0.2 : 0.2)]);
  // chalk
  r.add(r.handR, new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), r.mat('#ffffff', 0.9), [0, -0.06, 0.03], [Math.PI / 2, 0, 0]);
  void skin;
}

export const EINSTEIN: HeroDef = {
  id: 'einstein',
  name: 'Albert Einstein',
  title: 'The Theorist',
  role: 'Duelist',
  tagline: 'Imagination is more important than knowledge.',
  color: '#7fd3ff',
  accent: '#b48cff',
  maxHp: 250,
  modelUrl: '/models/heroes/einstein.glb',
  speed: 6.0,
  secondaryCd: 10,
  ultCost: 1500,
  botRange: 16,
  ratings: { damage: 0.85, mobility: 0.45, support: 0.2, difficulty: 0.55 },
  abilities: {
    primary: { key: 'LMB', name: 'Photon Burst', desc: 'Fire twin streams of light quanta. Headshots deal 50% bonus damage.', stat: '20 dmg · 5 shots/s', icon: ICONS.photon },
    secondary: { key: 'RMB', name: 'Gravity Well', desc: 'Lob a singularity that collapses spacetime: pulls and slows enemies, then implodes.', stat: '3.2 s pull · 10 s cd', icon: ICONS.gravity },
    ult: { key: 'SHIFT', name: 'E = mc²', desc: 'Levitate and convert mass into pure energy — a devastating blast around you.', stat: '230 dmg · 11 m radius', icon: ICONS.emc },
  },
  look: { build: buildEinstein },
  createKit: () => new EinsteinKit(),
};

/** Pre-create pools/materials so shaders compile during loading, not mid-fight. */
export function warmupEinstein(g: Game): THREE.Object3D[] {
  g.pool('photon', photonPool);
  g.pool('gravityOrb', orbPool);
  const { diskMat, haloMat, coreMat } = wellMaterials();
  const geo = new THREE.PlaneGeometry(1, 1);
  const out: THREE.Object3D[] = [new THREE.Mesh(geo, diskMat), new THREE.Mesh(geo, haloMat), new THREE.Mesh(geo, coreMat)];
  if (!blastMat) createBlastMaterial();
  out.push(new THREE.Mesh(geo, blastMat!));
  return out;
}

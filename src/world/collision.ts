import * as THREE from 'three';
import { smoothstep } from '../core/math';

export interface CircleCollider { kind: 'circle'; x: number; z: number; r: number; top: number }
export interface BoxCollider { kind: 'box'; x: number; z: number; hx: number; hz: number; rot: number; top: number; cos: number; sin: number }
export type Collider = CircleCollider | BoxCollider;

export const ARENA_RADIUS = 40;
export const SPAWNS: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(-33, 0, 0), new THREE.Vector3(33, 0, 0)];

export class World {
  colliders: Collider[] = [];

  addCircle(x: number, z: number, r: number, top = 8) {
    this.colliders.push({ kind: 'circle', x, z, r, top });
  }
  addBox(x: number, z: number, hx: number, hz: number, rot: number, top = 3) {
    this.colliders.push({ kind: 'box', x, z, hx, hz, rot, top, cos: Math.cos(rot), sin: Math.sin(rot) });
  }

  /** Analytic terrain height. Shared by terrain mesh, grass placement, and character physics. */
  heightAt(x: number, z: number) {
    const r = Math.sqrt(x * x + z * z);
    let h = 0;
    // rolling meadow undulation, flat in the center
    const und = (Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.09 - 0.4) + Math.sin((x + z) * 0.05) * 0.8) * 0.28;
    h += und * smoothstep(9, 22, r);
    // central dais
    h = Math.max(h, 1.0 * (1 - smoothstep(6.2, 8.6, r)));
    // spawn platforms
    for (const s of SPAWNS) {
      const d = Math.hypot(x - s.x, z - s.z);
      h = Math.max(h, 0.45 * (1 - smoothstep(4.2, 5.8, d)));
    }
    // island rim falls away into the lake
    h -= smoothstep(45, 52, r) * 7.5;
    return h;
  }

  /** Push a vertical capsule (xz circle) out of colliders. Mutates pos. Returns true if collided. */
  resolve(pos: THREE.Vector3, radius: number, feetY: number) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.colliders) {
        if (feetY > c.top - 0.05) continue;
        if (c.kind === 'circle') {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const rr = c.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 0.0001;
            pos.x = c.x + (dx / d) * rr;
            pos.z = c.z + (dz / d) * rr;
            hit = true;
          }
        } else {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const lx = dx * c.cos + dz * c.sin;
          const lz = -dx * c.sin + dz * c.cos;
          const qx = Math.max(-c.hx, Math.min(c.hx, lx));
          const qz = Math.max(-c.hz, Math.min(c.hz, lz));
          const ex = lx - qx, ez = lz - qz;
          const d2 = ex * ex + ez * ez;
          if (d2 < radius * radius) {
            let nx: number, nz: number;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              nx = (ex / d) * (radius - d); nz = (ez / d) * (radius - d);
            } else {
              // inside the box: push out along the shallowest axis
              const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
              if (px < pz) { nx = Math.sign(lx) * (px + radius); nz = 0; } else { nx = 0; nz = Math.sign(lz) * (pz + radius); }
            }
            pos.x += nx * c.cos - nz * c.sin;
            pos.z += nx * c.sin + nz * c.cos;
            hit = true;
          }
        }
      }
    }
    // arena boundary
    const r = Math.hypot(pos.x, pos.z);
    const lim = ARENA_RADIUS - radius;
    if (r > lim) { pos.x *= lim / r; pos.z *= lim / r; hit = true; }
    return hit;
  }

  /**
   * First hit param t∈[0,1] of segment a->b against static geometry (colliders + terrain), or -1.
   * `pad` inflates colliders (for camera / thick projectiles).
   */
  raycast(a: THREE.Vector3, b: THREE.Vector3, pad = 0): number {
    let best = 2;
    const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
    for (const c of this.colliders) {
      let t = -1;
      if (c.kind === 'circle') {
        const fx = a.x - c.x, fz = a.z - c.z;
        const r = c.r + pad;
        const A = dx * dx + dz * dz;
        const B = 2 * (fx * dx + fz * dz);
        const C = fx * fx + fz * fz - r * r;
        if (C <= 0) { t = 0; } else if (A > 1e-9) {
          const disc = B * B - 4 * A * C;
          if (disc >= 0) {
            const t0 = (-B - Math.sqrt(disc)) / (2 * A);
            if (t0 >= 0 && t0 <= 1) t = t0;
          }
        }
      } else {
        // slab test in box local space
        const ox = a.x - c.x, oz = a.z - c.z;
        const lx = ox * c.cos + oz * c.sin, lz = -ox * c.sin + oz * c.cos;
        const ldx = dx * c.cos + dz * c.sin, ldz = -dx * c.sin + dz * c.cos;
        const hx = c.hx + pad, hz = c.hz + pad;
        let tmin = 0, tmax = 1;
        let ok = true;
        for (const [o, d, h] of [[lx, ldx, hx], [lz, ldz, hz]] as const) {
          if (Math.abs(d) < 1e-9) { if (o < -h || o > h) { ok = false; break; } }
          else {
            let t1 = (-h - o) / d, t2 = (h - o) / d;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
            if (tmin > tmax) { ok = false; break; }
          }
        }
        if (ok) t = tmin;
      }
      if (t >= 0 && t < best) {
        const y = a.y + dy * t;
        if (y < c.top + pad) best = t;
      }
    }
    // terrain: march coarse steps
    const len = Math.hypot(dx, dy, dz);
    const steps = Math.min(48, Math.max(2, Math.ceil(len / 1.5)));
    let prevAbove = a.y - this.heightAt(a.x, a.z);
    if (prevAbove >= 0) {
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (t >= best) break;
        const x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
        const above = y - this.heightAt(x, z);
        if (above < 0) {
          const tt = (i - 1 + prevAbove / (prevAbove - above)) / steps;
          best = Math.min(best, tt);
          break;
        }
        prevAbove = above;
      }
    }
    return best <= 1 ? best : -1;
  }
}

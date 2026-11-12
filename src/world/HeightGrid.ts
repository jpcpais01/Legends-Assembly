import * as THREE from 'three';

/** Heights below this (above the floor) are treated as floor clutter: papers, leather grain. */
const CLUTTER = 0.3;
/** Characters step up anything this high without jumping. */
export const STEP = 0.55;
/** Vertical clearance a character needs (overhangs higher than this can be walked under). */
export const CLEAR = 1.9;

/**
 * 2.5D collision built from real meshes: each xz cell stores the lowest and highest solid point above
 * the floor. Gives walkable tops (stand on an eraser), blocking walls (book stacks), overhangs you can
 * walk under (the pencil bridge), ray hits, and a walkability map for bot pathing.
 */
export class HeightGrid {
  readonly nx: number; readonly nz: number;
  readonly top: Float32Array; readonly bot: Float32Array;
  constructor(readonly x0: number, readonly z0: number, readonly x1: number, readonly z1: number, readonly cell: number, readonly floor = 0) {
    this.nx = Math.ceil((x1 - x0) / cell);
    this.nz = Math.ceil((z1 - z0) / cell);
    this.top = new Float32Array(this.nx * this.nz).fill(-Infinity);
    this.bot = new Float32Array(this.nx * this.nz).fill(Infinity);
  }

  /** Rasterize a geometry (in its own space) transformed by `m`. Triangles are sampled densely so big faces fill every cell they cover. */
  addGeometry(geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    const pos = geo.getAttribute('position');
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const { x0, z0, cell, nx, nz, top, bot } = this;
    const minY = this.floor + CLUTTER;
    const half = cell * 0.5;
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      if (a.y < minY && b.y < minY && c.y < minY) continue;
      const e = Math.max(Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(b.x - c.x, b.z - c.z), Math.hypot(c.x - a.x, c.z - a.z));
      const k = Math.max(1, Math.ceil(e / half));
      for (let u = 0; u <= k; u++) {
        for (let v = 0; v <= k - u; v++) {
          const w = k - u - v;
          const px = (a.x * u + b.x * v + c.x * w) / k, py = (a.y * u + b.y * v + c.y * w) / k, pz = (a.z * u + b.z * v + c.z * w) / k;
          if (py < minY) continue;
          const cx = Math.floor((px - x0) / cell), cz = Math.floor((pz - z0) / cell);
          if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
          const j = cz * nx + cx;
          if (py > top[j]) top[j] = py;
          if (py < bot[j]) bot[j] = py;
        }
      }
    }
  }

  /** Solid columns that touch the floor get their bottom snapped to it (closes small gaps under rounded bases). */
  finalize() {
    for (let j = 0; j < this.top.length; j++) if (this.bot[j] < this.floor + CLUTTER + 0.35) this.bot[j] = this.floor;
  }

  index(x: number, z: number) {
    const cx = Math.floor((x - this.x0) / this.cell), cz = Math.floor((z - this.z0) / this.cell);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return -1;
    return cz * this.nx + cx;
  }

  /** Standing surface for something whose feet are at `refY`: the column top if reachable/overhead-free, else the floor. */
  surface(x: number, z: number, refY: number) {
    const j = this.index(x, z);
    if (j < 0 || this.top[j] === -Infinity) return this.floor;
    const t = this.top[j];
    if (t <= refY + STEP) return t;
    if (this.bot[j] > refY + CLEAR) return this.floor; // overhang above us
    return t;
  }

  /** Does cell j block a body whose feet are at feetY? */
  blocks(j: number, feetY: number) {
    const t = this.top[j];
    return t > feetY + STEP && this.bot[j] < feetY + CLEAR;
  }

  /** Push a circle out of blocking cells. */
  resolve(pos: THREE.Vector3, r: number, feetY: number) {
    const { x0, z0, cell, nx, nz } = this;
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      const cx0 = Math.max(0, Math.floor((pos.x - r - x0) / cell)), cx1 = Math.min(nx - 1, Math.floor((pos.x + r - x0) / cell));
      const cz0 = Math.max(0, Math.floor((pos.z - r - z0) / cell)), cz1 = Math.min(nz - 1, Math.floor((pos.z + r - z0) / cell));
      let px = 0, pz = 0, cnt = 0;
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const j = cz * nx + cx;
          if (!this.blocks(j, feetY)) continue;
          const minx = x0 + cx * cell, minz = z0 + cz * cell;
          const qx = Math.max(minx, Math.min(minx + cell, pos.x)), qz = Math.max(minz, Math.min(minz + cell, pos.z));
          let dx = pos.x - qx, dz = pos.z - qz;
          let d = Math.hypot(dx, dz);
          if (d >= r) continue;
          if (d < 1e-5) { // center inside the cell: push toward the cell's nearest edge
            const ccx = minx + cell / 2, ccz = minz + cell / 2;
            dx = pos.x - ccx; dz = pos.z - ccz; d = Math.hypot(dx, dz) || 1;
            px += (dx / d) * r; pz += (dz / d) * r;
          } else { px += (dx / d) * (r - d); pz += (dz / d) * (r - d); }
          cnt++;
        }
      }
      if (!cnt) break;
      // average pushes from adjacent cells so flat walls feel flat, not bumpy
      const s = cnt > 1 ? 1 / Math.sqrt(cnt) : 1;
      pos.x += px * s; pos.z += pz * s;
      hit = true;
    }
    return hit;
  }

  /** Segment a->b: first t in [0,1] inside a solid column, or 2. DDA over cells. */
  raycast(a: THREE.Vector3, b: THREE.Vector3, pad = 0) {
    const { x0, z0, cell, nx, nz } = this;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    let cx = Math.floor((a.x - x0) / cell), cz = Math.floor((a.z - z0) / cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? cell / Math.abs(dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-9 ? cell / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (cx + 1) * cell + x0 - a.x : a.x - (cx * cell + x0)) / Math.abs(dx)) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (cz + 1) * cell + z0 - a.z : a.z - (cz * cell + z0)) / Math.abs(dz)) : Infinity;
    let t = 0;
    for (let guard = 0; guard < 4096 && t <= 1; guard++) {
      const tn = Math.min(tmx, tmz, 1);
      if (cx >= 0 && cz >= 0 && cx < nx && cz < nz) {
        const j = cz * nx + cx;
        const top = this.top[j];
        if (top !== -Infinity) {
          const ya = a.y + dy * t, yb = a.y + dy * tn;
          const lo = Math.min(ya, yb), hi = Math.max(ya, yb);
          if (lo < top + pad && hi > this.bot[j] - pad) {
            // entry point: where the ray crosses into [bot, top]
            if (ya < top + pad && ya > this.bot[j] - pad) return t;
            const tt = dy !== 0 ? ((ya >= top + pad ? top + pad : this.bot[j] - pad) - a.y) / dy : t;
            return Math.min(tn, Math.max(t, tt));
          }
        }
      }
      if (tn >= 1) break;
      if (tmx < tmz) { cx += stepX; t = tmx; tmx += tdx; } else { cz += stepZ; t = tmz; tmz += tdz; }
    }
    return 2;
  }

  // ───────── bot navigation (coarse walkability + A*) ─────────
  private navCell = 1;
  private nav: Uint8Array | null = null;
  private nnx = 0; private nnz = 0;

  buildNav(radius: number, inBounds: (x: number, z: number) => boolean) {
    const nc = this.navCell;
    this.nnx = Math.ceil((this.x1 - this.x0) / nc); this.nnz = Math.ceil((this.z1 - this.z0) / nc);
    const nav = new Uint8Array(this.nnx * this.nnz);
    const p = new THREE.Vector3();
    for (let z = 0; z < this.nnz; z++) for (let x = 0; x < this.nnx; x++) {
      p.set(this.x0 + (x + 0.5) * nc, 0, this.z0 + (z + 0.5) * nc);
      if (!inBounds(p.x, p.z)) continue;
      let ok = true;
      // clear if no blocking cell within the body radius (+ a little margin)
      const rr = radius + 0.25;
      for (let oz = -rr; oz <= rr && ok; oz += this.cell * 0.5) for (let ox = -rr; ox <= rr && ok; ox += this.cell * 0.5) {
        const j = this.index(p.x + ox, p.z + oz);
        if (j >= 0 && this.blocks(j, this.floor)) ok = false;
      }
      nav[z * this.nnx + x] = ok ? 1 : 0;
    }
    // keep only the largest connected region: pockets walled in by book stacks are unreachable
    const W = this.nnx, N = W * this.nnz;
    const label = new Int32Array(N).fill(-1);
    let bestL = -1, bestN = 0;
    const stack: number[] = [];
    for (let i = 0, l = 0; i < N; i++) {
      if (!nav[i] || label[i] >= 0) continue;
      let n = 0;
      label[i] = l; stack.push(i);
      while (stack.length) {
        const c = stack.pop()!; n++;
        const cx = c % W;
        for (const nb of [cx > 0 ? c - 1 : -1, cx < W - 1 ? c + 1 : -1, c - W, c + W]) {
          if (nb < 0 || nb >= N || !nav[nb] || label[nb] >= 0) continue;
          label[nb] = l; stack.push(nb);
        }
      }
      if (n > bestN) { bestN = n; bestL = l; }
      l++;
    }
    for (let i = 0; i < N; i++) if (nav[i] && label[i] !== bestL) nav[i] = 0;
    this.nav = nav;
    this.clear = null;
  }

  walkable(x: number, z: number) {
    if (!this.nav) return true;
    const cx = Math.floor((x - this.x0) / this.navCell), cz = Math.floor((z - this.z0) / this.navCell);
    if (cx < 0 || cz < 0 || cx >= this.nnx || cz >= this.nnz) return false;
    return this.nav[cz * this.nnx + cx] === 1;
  }

  private clear: Float32Array | null = null;
  /** Distance (m) from each nav cell to the nearest blocked or out-of-bounds cell. */
  private clearance() {
    if (this.clear || !this.nav) return this.clear;
    const W = this.nnx, H = this.nnz, nav = this.nav;
    const d = new Float32Array(W * H).fill(1e9);
    for (let i = 0; i < W * H; i++) if (!nav[i]) d[i] = 0;
    // two-pass chamfer distance transform (1, 1.414)
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = z * W + x; if (!d[i]) continue;
      let v = (x === 0 || z === 0 || x === W - 1 || z === H - 1) ? 1 : d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (z > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 1.414); }
      d[i] = v;
    }
    for (let z = H - 1; z >= 0; z--) for (let x = W - 1; x >= 0; x--) {
      const i = z * W + x; if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
      if (z < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + 1.414); if (x > 0) v = Math.min(v, d[i + W - 1] + 1.414); }
      d[i] = v;
    }
    this.clear = d;
    return d;
  }

  /** The most open walkable spot within `radius` of (x, z): favors room to move, lightly penalizes drifting from the target. */
  openSpot(x: number, z: number, radius: number, out: THREE.Vector3, cap = 6) {
    const d = this.clearance();
    if (!d) return this.nearestWalkable(x, z, out);
    const nc = this.navCell, W = this.nnx;
    let best = -Infinity, bx = x, bz = z;
    const r = Math.ceil(radius / nc);
    const cx0 = Math.floor((x - this.x0) / nc), cz0 = Math.floor((z - this.z0) / nc);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const cx = cx0 + dx, cz = cz0 + dz;
      if (cx < 0 || cz < 0 || cx >= W || cz >= this.nnz) continue;
      const c = d[cz * W + cx];
      if (!c) continue;
      const score = Math.min(c, cap) - Math.hypot(dx, dz) * nc * 0.12;
      if (score > best) { best = score; bx = this.x0 + (cx + 0.5) * nc; bz = this.z0 + (cz + 0.5) * nc; }
    }
    return best === -Infinity ? this.nearestWalkable(x, z, out) : out.set(bx, this.floor, bz);
  }

  /** Nearest walkable nav cell center to (x, z). */
  nearestWalkable(x: number, z: number, out: THREE.Vector3) {
    if (this.walkable(x, z)) return out.set(x, this.floor, z);
    const nc = this.navCell;
    for (let r = 1; r < 40; r++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const px = x + Math.cos(ang) * r * nc, pz = z + Math.sin(ang) * r * nc;
        if (this.walkable(px, pz)) return out.set(px, this.floor, pz);
      }
    }
    return out.set(x, this.floor, z);
  }

  /** A* on the nav grid. Returns world waypoints (string-pulled) from start to goal, or null. */
  findPath(sx: number, sz: number, gx: number, gz: number, maxIter = 6000): THREE.Vector3[] | null {
    if (!this.nav) return null;
    const nc = this.navCell, W = this.nnx, H = this.nnz;
    const g0 = new THREE.Vector3();
    this.nearestWalkable(gx, gz, g0);
    const s0 = new THREE.Vector3();
    this.nearestWalkable(sx, sz, s0);
    const sc = Math.floor((s0.x - this.x0) / nc) + Math.floor((s0.z - this.z0) / nc) * W;
    const gc = Math.floor((g0.x - this.x0) / nc) + Math.floor((g0.z - this.z0) / nc) * W;
    if (sc === gc) return [g0];
    const N = W * H;
    const gs = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const open: number[] = [sc];
    const f = new Float32Array(N).fill(Infinity);
    const hx = gc % W, hz = (gc / W) | 0;
    const h = (c: number) => { const x = c % W, z = (c / W) | 0; const ax = Math.abs(x - hx), az = Math.abs(z - hz); return Math.max(ax, az) + 0.414 * Math.min(ax, az); };
    gs[sc] = 0; f[sc] = h(sc);
    const closed = new Uint8Array(N);
    let it = 0;
    while (open.length && it++ < maxIter) {
      // small open sets: linear min is fine and allocation-free
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const c = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (c === gc) break;
      closed[c] = 1;
      const x = c % W, z = (c / W) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
        const n = zz * W + xx;
        if (closed[n] || !this.nav[n]) continue;
        if (dx && dz && (!this.nav[z * W + xx] || !this.nav[zz * W + x])) continue; // no corner cutting
        const ng = gs[c] + (dx && dz ? 1.414 : 1);
        if (ng < gs[n]) {
          if (gs[n] === Infinity) open.push(n);
          gs[n] = ng; f[n] = ng + h(n); came[n] = c;
        }
      }
    }
    if (came[gc] === -1) return null;
    const cells: number[] = [];
    for (let c = gc; c !== -1 && c !== sc; c = came[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => new THREE.Vector3(this.x0 + ((c % W) + 0.5) * nc, this.floor, this.z0 + (((c / W) | 0) + 0.5) * nc));
    // string pull: drop waypoints that have a clear straight line from the previous kept one
    const out: THREE.Vector3[] = [];
    let from = new THREE.Vector3(sx, this.floor, sz);
    for (let i = 0; i < pts.length; i++) {
      const next = pts[i + 1];
      if (next && this.lineClear(from, next)) continue;
      out.push(pts[i]);
      from = pts[i];
    }
    return out.length ? out : [g0];
  }

  lineClear(a: THREE.Vector3, b: THREE.Vector3) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.ceil(d / (this.navCell * 0.5));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
}

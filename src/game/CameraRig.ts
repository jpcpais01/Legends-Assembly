import * as THREE from 'three';
import { clamp, damp, rand } from '../core/math';
import { settings } from '../core/settings';
import type { World } from '../world/collision';
import type { Hero } from './Hero';

/** Camera collision radius: about the near plane's half-diagonal plus a safety margin. */
const CAM_R = 0.22;
/** Closest the camera may get to the pivot. */
const MIN_DIST = 0.2;
/** Ray fan for the boom cast, in (right, up) units of CAM_R. */
const FAN: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** Over-the-shoulder third-person camera with collision, trauma shake, and FOV kicks. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI / 2;
  pitch = -0.05;
  private trauma = 0;
  private fovKick = 0;
  private dist = 3.6;
  /** 1 while the local hero is a vehicle (Yeat's Tonka): camera rises, centers and pulls back. */
  vehicle = 0;
  private vehicleK = 0;
  private pivot = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private shoulder = 1;
  private smoothY = 0;
  mode: 'play' | 'dead' | 'cinematic' | 'outro' = 'play';
  /** Who the death cam looks at (your killer) and who the outro orbits (the final blow). */
  focus: Hero | null = null;
  /** Visual-only view kick from firing (radians of pitch), springs back; never moves the aim. */
  private recoilP = 0; private recoilV = 0; private recoilYaw = 0;
  /** 0..1 ultimate beat: the boom swings out and wide for a moment when you cast your special. */
  private beat = 0; private beatT = 0;
  private modeT = 0;
  private orbitT = 0;
  private prevMode: CameraRig['mode'] = 'cinematic';
  private needSnap = true;
  /** Current boom length after collision (smoothed). */
  private curDist = 3.6;
  private shoulderCur = 0.62;
  private head = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  look(dx: number, dy: number) {
    const s = 0.0022 * settings.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.35, 1.25);
  }

  shake(amount: number) { if (settings.cameraShake) this.trauma = Math.min(1, this.trauma + amount); }
  kick(amount: number) { this.fovKick = Math.max(this.fovKick, amount); }
  /** Narrow the view by this many degrees this frame (drawing a bow). Re-apply every frame to hold it. */
  zoom(deg: number) { this.zoomWant = Math.max(this.zoomWant, deg); }
  private zoomWant = 0;
  private zoomCur = 0;
  recoil(pitch: number, yaw = 0) { this.recoilV += pitch * 60; this.recoilYaw += yaw; }
  ultBeat() { this.beatT = 0; this.beat = 1; }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** Skip smoothing next frame (spawns, respawns, teleports). */
  reset() { this.needSnap = true; }

  update(dt: number, hero: Hero, world: World) {
    const cam = this.camera;
    if (this.mode !== this.prevMode) { if (this.mode === 'play') this.needSnap = true; this.prevMode = this.mode; this.modeT = 0; }
    this.modeT += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    this.zoomCur = damp(this.zoomCur, this.zoomWant, 9, dt);
    this.zoomWant = 0;
    const targetFov = settings.fov + this.fovKick - this.zoomCur;
    if (Math.abs(cam.fov - targetFov) > 0.01) { cam.fov = damp(cam.fov, targetFov, 12, dt); cam.updateProjectionMatrix(); }

    if (this.mode === 'outro') {
      // final blow: a slow-motion orbit around whoever landed it, opening from in front of them
      const f = this.focus ?? hero;
      const c = f.pos;
      const a = f.bodyYaw + Math.PI + 0.55 - this.modeT * 0.32;
      const R = 4.6 - Math.min(1, this.modeT * 0.4) * 1.1;
      this.tmp.set(c.x - Math.sin(a) * R, c.y + 1.7 - this.modeT * 0.08, c.z - Math.cos(a) * R);
      const hit = world.raycast(this.tmp2.set(c.x, c.y + 1.4, c.z), this.tmp, 0.3);
      if (hit >= 0) this.tmp.lerpVectors(this.tmp2, this.tmp, Math.max(0.15, hit - 0.05));
      if (this.modeT < dt * 1.5) cam.position.copy(this.tmp); else cam.position.lerp(this.tmp, 1 - Math.exp(-5 * dt));
      cam.lookAt(c.x, c.y + 1.15, c.z);
      return;
    }
    if (this.mode === 'dead' && this.focus && this.focus.alive && this.focus !== hero && this.modeT < 2.6) {
      // death cam: from over your body, swing round to look at who got you
      const k = this.focus.center;
      const dx = k.x - hero.pos.x, dz = k.z - hero.pos.z, dl = Math.hypot(dx, dz) || 1;
      this.tmp.set(hero.pos.x - (dx / dl) * 3.2, hero.pos.y + 2.4, hero.pos.z - (dz / dl) * 3.2);
      const hit = world.raycast(this.tmp2.set(hero.pos.x, hero.pos.y + 1.5, hero.pos.z), this.tmp, 0.3);
      if (hit >= 0) this.tmp.lerpVectors(this.tmp2, this.tmp, Math.max(0.2, hit - 0.05));
      cam.position.lerp(this.tmp, 1 - Math.exp(-3.5 * dt));
      this.tmp2.lerpVectors(hero.center, k, Math.min(1, this.modeT * 1.6));
      cam.lookAt(this.tmp2);
      this.yaw = Math.atan2(-dx, -dz) + Math.PI;
      return;
    }
    if (this.mode === 'dead') {
      // slow orbit around where we fell
      this.orbitT += dt * 0.35;
      const c = hero.pos;
      const a = this.yaw + this.orbitT;
      this.tmp.set(c.x + Math.sin(a) * 6, c.y + 3.2, c.z + Math.cos(a) * 6);
      const hit = world.raycast(this.tmp2.set(c.x, c.y + 1.5, c.z), this.tmp, 0.3);
      if (hit >= 0) this.tmp.lerpVectors(this.tmp2, this.tmp, Math.max(0.2, hit - 0.05));
      cam.position.lerp(this.tmp, 1 - Math.exp(-4 * dt));
      cam.lookAt(c.x, c.y + 0.8, c.z);
      return;
    }
    this.orbitT = 0;
    const snap = this.needSnap;
    this.needSnap = false;

    this.smoothY = snap ? hero.pos.y : hero.grounded ? damp(this.smoothY, hero.pos.y, 14, dt) : damp(this.smoothY, hero.pos.y, 22, dt);
    const fwd = this.forward(this.tmp2);
    const right = this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = this.up.crossVectors(right, fwd);
    this.vehicleK = damp(this.vehicleK, this.vehicle, 5, dt);
    const vk = this.vehicleK;

    // 1) head: the always-clear anchor inside the hero's own capsule
    const head = this.head.set(hero.pos.x, this.smoothY + 1.62 + vk * 0.9, hero.pos.z);

    // ultimate beat: swing out fast, hold a breath, ease back in
    if (this.beat > 0) { this.beatT += dt; this.beat = this.beatT < 0.5 ? 1 : Math.max(0, 1 - (this.beatT - 0.5) / 0.7); }
    const bk = this.beat * this.beat * (3 - 2 * this.beat);
    // 2) shoulder: slide the over-the-shoulder offset in when a wall hugs the hero's side
    const shoulderMax = 0.62 * this.shoulder * (1 - vk) * (1 + bk * 0.6);
    const sEnd = this.tmp.copy(head).addScaledVector(right, shoulderMax + Math.sign(shoulderMax) * CAM_R);
    const st = Math.abs(shoulderMax) > 0.01 ? world.raycast(head, sEnd, 0) : -1;
    const shoulderTarget = st >= 0 ? Math.max(0, (Math.abs(shoulderMax) + CAM_R) * st - CAM_R) * Math.sign(shoulderMax) : shoulderMax;
    this.shoulderCur = snap || Math.abs(shoulderTarget) < Math.abs(this.shoulderCur) ? shoulderTarget : damp(this.shoulderCur, shoulderTarget, 6, dt);
    this.pivot.copy(head).addScaledVector(right, this.shoulderCur);

    // 3) boom: a fan of rays (center + near-plane corners) approximates a sphere cast,
    //    so the lens never pokes through a wall corner even with a coarse collision grid
    const maxDist = this.dist + vk * 3.2 + Math.max(0, -this.pitch) * 0.6 + bk * 1.5;
    let t = 1;
    for (let i = 0; i < FAN.length; i++) {
      const [ox, oy] = FAN[i];
      const end = this.tmp.copy(this.pivot).addScaledVector(fwd, -maxDist).addScaledVector(right, ox * CAM_R).addScaledVector(up, oy * CAM_R);
      end.y += 0.12;
      const hit = world.raycast(this.pivot, end, i === 0 ? CAM_R * 0.5 : 0);
      if (hit >= 0 && hit < t) t = hit;
    }
    // keep a fixed gap from whatever we hit (an absolute margin, not a fraction of the boom)
    const target = clamp(maxDist * t - CAM_R * 0.6, MIN_DIST, maxDist);
    // snap in instantly (never show the inside of a wall), ease back out (no popping along walls)
    this.curDist = snap || target < this.curDist ? target : damp(this.curDist, target, 5, dt);

    const desired = this.tmp.copy(this.pivot).addScaledVector(fwd, -this.curDist);
    desired.y += 0.12 * (this.curDist / maxDist);
    const minY = world.heightAt(desired.x, desired.z, desired.y) + CAM_R;
    if (desired.y < minY) desired.y = minY;
    cam.position.copy(desired);
    const lookAt = this.tmp.copy(cam.position).add(fwd);
    cam.lookAt(lookAt);
    // view kick: a stiff spring so shots feel punchy and settle in a few frames
    this.recoilV += (-this.recoilP * 900 - this.recoilV * 42) * dt;
    this.recoilP += this.recoilV * dt;
    this.recoilYaw *= Math.exp(-14 * dt);
    if (Math.abs(this.recoilP) > 1e-5 || Math.abs(this.recoilYaw) > 1e-5) { cam.rotateX(this.recoilP); cam.rotateY(this.recoilYaw); }

    // 4) when the lens is right behind the head, hide the hero instead of filling the screen with their hair
    if (hero.alive) hero.model.root.visible = cam.position.distanceToSquared(head) > 0.55 * 0.55;

    // trauma shake (squared for punch)
    const sh = this.trauma * this.trauma;
    if (sh > 0.0001) {
      cam.rotation.z += rand(-1, 1) * 0.035 * sh;
      cam.rotation.x += rand(-1, 1) * 0.03 * sh;
      cam.rotation.y += rand(-1, 1) * 0.03 * sh;
      cam.position.x += rand(-1, 1) * 0.12 * sh;
      cam.position.y += rand(-1, 1) * 0.12 * sh;
    }
  }

  /** World-space origin for aim rays: on the camera ray, level with the hero (skips geometry behind them). */
  aimOrigin(out: THREE.Vector3) {
    const fwd = this.forward();
    // use the live boom length: with the camera pulled in against a wall, a fixed offset would start
    // shots past the hero (through whatever is in front of them)
    return out.copy(this.camera.position).addScaledVector(fwd, Math.max(0, this.curDist - 0.25));
  }
}

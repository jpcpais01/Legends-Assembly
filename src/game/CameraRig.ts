import * as THREE from 'three';
import { clamp, damp, rand } from '../core/math';
import { settings } from '../core/settings';
import type { World } from '../world/collision';
import type { Hero } from './Hero';

/** Over-the-shoulder third-person camera with collision, trauma shake, and FOV kicks. */
export class CameraRig {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI / 2;
  pitch = -0.05;
  private trauma = 0;
  private fovKick = 0;
  private dist = 3.6;
  private pivot = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private shoulder = 1;
  private smoothY = 0;
  mode: 'play' | 'dead' | 'cinematic' = 'play';
  private orbitT = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  look(dx: number, dy: number) {
    const s = 0.0022 * settings.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s * (settings.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.35, 1.25);
  }

  shake(amount: number) { this.trauma = Math.min(1, this.trauma + amount); }
  kick(amount: number) { this.fovKick = Math.max(this.fovKick, amount); }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dt: number, hero: Hero, world: World) {
    const cam = this.camera;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.fovKick = damp(this.fovKick, 0, 6, dt);
    const targetFov = settings.fov + this.fovKick;
    if (Math.abs(cam.fov - targetFov) > 0.01) { cam.fov = damp(cam.fov, targetFov, 12, dt); cam.updateProjectionMatrix(); }

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

    this.smoothY = hero.grounded ? damp(this.smoothY, hero.pos.y, 14, dt) : damp(this.smoothY, hero.pos.y, 22, dt);
    const fwd = this.forward(this.tmp2);
    const right = this.tmp.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.pivot.set(hero.pos.x, this.smoothY + 1.62, hero.pos.z).addScaledVector(right, 0.62 * this.shoulder);
    const pitchDist = this.dist + Math.max(0, -this.pitch) * 0.6;
    const desired = new THREE.Vector3().copy(this.pivot).addScaledVector(fwd, -pitchDist);
    desired.y += 0.12;
    // pull in against geometry
    const t = world.raycast(this.pivot, desired, 0.25);
    if (t >= 0) desired.lerpVectors(this.pivot, desired, Math.max(0.15, t - 0.06));
    const minY = world.heightAt(desired.x, desired.z) + 0.25;
    if (desired.y < minY) desired.y = minY;
    cam.position.copy(desired);
    const lookAt = this.tmp.copy(cam.position).add(fwd);
    cam.lookAt(lookAt);

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
    return out.copy(this.camera.position).addScaledVector(fwd, this.dist * 0.9);
  }
}

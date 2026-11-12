import type * as THREE from 'three';
import type { World } from './collision';

/** What the game loop needs from an arena. */
export interface ArenaLike {
  scene: THREE.Scene;
  world: World;
  sun: THREE.DirectionalLight;
  /** Grass that heroes push aside (outdoor arenas only). */
  grass: { setPushers(p: THREE.Vector3[]): void } | null;
  readonly healthPadPositions: THREE.Vector3[];
  /** Where the menu showcase hero stands and the menu camera orbits. */
  readonly showcasePos: THREE.Vector3;
  /** Resolves once models and collision are in place. */
  ready?: Promise<void>;
  placeProps(): void;
  applyQuality(): void;
  setDoom(k: number): void;
  update(time: number, camera: THREE.Camera): void;
}

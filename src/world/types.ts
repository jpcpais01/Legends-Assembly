import * as THREE from 'three';
import type { World } from './collision';

/** Team colors (blue, red). */
export const TEAM_COLORS = [new THREE.Color('#3fb4ff'), new THREE.Color('#ff3d5a')];

/** What a footstep lands on. */
export type Surface = 'wood' | 'paper' | 'metal' | 'leather' | 'stone' | 'grass';

/** Where the arena's sounds come from (fireplace, windows, clocks…). */
export interface Soundscape {
  kind: 'study' | 'hall';
  fire?: THREE.Vector3;
  windows?: THREE.Vector3[];
  chandelier?: THREE.Vector3;
  watch?: THREE.Vector3;
  metronome?: THREE.Vector3;
  /** The Newton's cradle (clacks twice per 1.3 s cycle, on the arena clock). */
  cradle?: THREE.Vector3;
  /** The room's volume, for creaks in the walls and beams. */
  room?: THREE.Box3;
}

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
  soundscape?: Soundscape;
  /** What is underfoot at a point (default: the arena's floor). */
  surfaceAt?(x: number, y: number, z: number): Surface;
  /** Something big landed: the clutter jolts, rattles and the dust blows away. */
  shock?(pos: THREE.Vector3, strength: number): void;
}

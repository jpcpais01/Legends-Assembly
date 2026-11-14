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
  /** kind 0: toxic green (The Bell), 1: burning red (Extinction Event). */
  setDoom(k: number, kind?: number): void;
  update(time: number, camera: THREE.Camera): void;
  soundscape?: Soundscape;
  /** What is underfoot at a point (default: the arena's floor). */
  surfaceAt?(x: number, y: number, z: number): Surface;
  /** Something big landed: the clutter jolts, rattles and the dust blows away. */
  shock?(pos: THREE.Vector3, strength: number): void;
}

/** Doom skies: what fog, sun and sky shift toward while a special darkens the world. */
export const DOOM_SKY = [
  // toxic green (Yeat's The Bell)
  { fog: new THREE.Color(0.07, 0.26, 0.11), sun: new THREE.Color(0.45, 1.0, 0.5), sky: new THREE.Color(0.32, 0.8, 0.4), ground: new THREE.Color(0.02, 0.1, 0.03) },
  // burning red (the T-Rex's Extinction Event)
  { fog: new THREE.Color(0.32, 0.08, 0.03), sun: new THREE.Color(1.2, 0.42, 0.15), sky: new THREE.Color(0.9, 0.3, 0.12), ground: new THREE.Color(0.12, 0.03, 0.01) },
];

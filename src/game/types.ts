import type * as THREE from 'three';
import type { MotionStyle } from '../render/RigAnimator';
import type { Hero } from './Hero';
import type { Game } from './Game';
import type { RigLook } from '../render/HeroRig';
import type { PropName } from '../render/props';

export type HeroId = 'einstein' | 'yeat' | 'vangogh';
export type Role = 'Duelist' | 'Vanguard' | 'Strategist';

export interface AbilityInfo {
  key: 'LMB' | 'RMB' | 'SHIFT';
  name: string;
  desc: string;
  stat: string; // short stat line for the hero select card
  icon: string; // inline SVG path content
}

export interface HeroKit {
  /** Called while primary is held and the primary cooldown is ready. Must set h.primaryCd. */
  primary(h: Hero, g: Game): void;
  /** Called on secondary press with cooldown ready. Return true if it fired. */
  secondary(h: Hero, g: Game): boolean;
  /** Called on ult press with full charge. Return true if it fired. */
  ult(h: Hero, g: Game): boolean;
  update(h: Hero, g: Game, dt: number): void;
  onDeath?(h: Hero, g: Game): void;
  /** Online: a kit moment from the machine that drives this legend (see Game.net.kitEvent). */
  onNet?(h: Hero, g: Game, ev: string): void;
}

export interface HeroDef {
  id: HeroId;
  name: string;
  title: string;
  role: Role;
  tagline: string;
  color: string;
  accent: string;
  maxHp: number;
  speed: number;
  secondaryCd: number;
  ultCost: number;
  /** Preferred engagement distance for bots. */
  botRange: number;
  abilities: { primary: AbilityInfo; secondary: AbilityInfo; ult: AbilityInfo };
  /** Optional Meshy GLB. Falls back to the procedural rig while missing. */
  modelUrl?: string;
  /** Body language for the procedural animator (posture, arm swing, default attack gesture). */
  motion?: MotionStyle;
  /** Optional Meshy prop held in a hand of the GLB model (meters / radians in the hand bone's frame). */
  held?: {
    prop: PropName; hand: 'L' | 'R'; size: number; pos: [number, number, number]; rot: [number, number, number];
    /** Hang the prop from its top (pos is the grip) and swing it like a bell when attacking. */
    ring?: boolean;
  };
  look: RigLook;
  createKit(): HeroKit;
  /** Difficulty / stats for UI bars, 0..1. */
  ratings: { damage: number; mobility: number; support: number; difficulty: number };
}

export interface HeroInput {
  forward: number; // -1..1
  strafe: number; // -1..1 (right positive)
  jump: boolean;
  primary: boolean;
  secondary: boolean;
  ult: boolean;
  yaw: number;
  pitch: number;
  aim: THREE.Vector3; // world-space aim point
}

export interface Projectile {
  owner: Hero;
  kind: string;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  radius: number;
  life: number;
  age: number;
  damage: number;
  dead: boolean;
  color: THREE.Color;
  seed: number;
  /** hit = hero struck (or null for world). Return nothing; projectile dies after. */
  onHit(p: Projectile, g: Game, hit: Hero | null, point: THREE.Vector3): void;
  onExpire?(p: Projectile, g: Game): void;
  render(p: Projectile, g: Game, dt: number): void;
}

export interface Zone {
  owner: Hero;
  team: number;
  pos: THREE.Vector3;
  radius: number;
  t: number;
  dur: number;
  dead: boolean;
  kind: string;
  update(z: Zone, g: Game, dt: number): void;
  dispose(z: Zone, g: Game): void;
}

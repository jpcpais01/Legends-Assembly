import type { HeroDef, HeroId } from '../game/types';
import { EINSTEIN } from './einstein';
import { YEAT } from './yeat';
import { VANGOGH } from './vangogh';
import { IRONMAN } from './ironman';

export const HEROES: Record<HeroId, HeroDef> = { einstein: EINSTEIN, yeat: YEAT, vangogh: VANGOGH, ironman: IRONMAN };
export const HERO_LIST: HeroDef[] = [EINSTEIN, YEAT, VANGOGH, IRONMAN];
export { warmupEinstein } from './einstein';
export { warmupYeat } from './yeat';
export { warmupVanGogh } from './vangogh';
export { warmupIronMan } from './ironman';

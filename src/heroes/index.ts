import type { HeroDef, HeroId } from '../game/types';
import { EINSTEIN } from './einstein';
import { YEAT } from './yeat';
import { VANGOGH } from './vangogh';
import { BLITZCRANK } from './blitzcrank';
import { IRONMAN } from './ironman';

export const HEROES: Record<HeroId, HeroDef> = { einstein: EINSTEIN, yeat: YEAT, vangogh: VANGOGH, blitzcrank: BLITZCRANK, ironman: IRONMAN };
export const HERO_LIST: HeroDef[] = [EINSTEIN, YEAT, VANGOGH, BLITZCRANK, IRONMAN];
export { warmupEinstein } from './einstein';
export { warmupYeat } from './yeat';
export { warmupVanGogh } from './vangogh';
export { warmupBlitzcrank } from './blitzcrank';
export { warmupIronMan } from './ironman';

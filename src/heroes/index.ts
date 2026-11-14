import type { HeroDef, HeroId } from '../game/types';
import { EINSTEIN } from './einstein';
import { YEAT } from './yeat';
import { VANGOGH } from './vangogh';
import { LUFFY } from './luffy';

export const HEROES: Record<HeroId, HeroDef> = { einstein: EINSTEIN, yeat: YEAT, vangogh: VANGOGH, luffy: LUFFY };
export const HERO_LIST: HeroDef[] = [EINSTEIN, YEAT, VANGOGH, LUFFY];
export { warmupEinstein } from './einstein';
export { warmupYeat } from './yeat';
export { warmupVanGogh } from './vangogh';
export { warmupLuffy } from './luffy';

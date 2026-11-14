/** Dev tool: renders a named set of motion contact sheets. node dev/suite.mjs <outDir> <hero[,hero]> <name[,name]> */
import { open, sheet } from './shots.mjs';
const [out, heroes = 'einstein', names = 'idle,run'] = process.argv.slice(2);
const run = (set, cam = ['game', 'front', 'side'], dur = 0.7, every = 0.1, pre = 0.6) => ({ cols: 7, scale: 0.5, steps: [{ dur: pre, set }, { dur, every, cam }] });
const SC = {
  idle: { cols: 6, scale: 0.6, steps: [{ dur: 0.5 }, { dur: 0.1, every: 0.1, cam: ['front', 'side', 'back', 'q', 'face', 'faceS'] }] },
  run: run({ fwd: 6 }),
  walk: run({ fwd: 1.5 }, ['game', 'front', 'side'], 1.2, 0.2),
  back: run({ fwd: -6 }),
  left: run({ side: -6 }),
  right: run({ side: 6 }),
  diag: run({ fwd: 4.24, side: 4.24 }),
  bdiag: run({ fwd: -4.24, side: 4.24 }),
  startstop: { cols: 8, scale: 0.5, steps: [{ dur: 0.3 }, { dur: 0.8, set: { fwd: 6 }, every: 0.1, cam: 'side' }, { dur: 0.8, set: { fwd: 0 }, every: 0.1, cam: 'side' }] },
  turn: { cols: 8, scale: 0.5, steps: [{ dur: 0.3 }, { dur: 1.6, set: { turn: 1.6 }, every: 0.1, cam: 'top' }, { dur: 0.8, set: { turn: 0 }, every: 0.1, cam: 'front' }] },
  jump: { cols: 8, scale: 0.5, steps: [{ dur: 0.3 }, { dur: 1.2, set: { jump: true }, every: 0.075, cam: 'side' }] },
  runjump: { cols: 8, scale: 0.5, steps: [{ dur: 0.6, set: { fwd: 6 } }, { dur: 1.2, set: { jump: true }, every: 0.075, cam: 'side' }] },
  pitch: { cols: 6, scale: 0.5, steps: [{ dur: 0.4, set: { pitch: 0.7 } }, { dur: 0.1, every: 0.1, cam: ['side', 'front', 'game'] }, { dur: 0.4, set: { pitch: -0.7 } }, { dur: 0.1, every: 0.1, cam: ['side', 'front', 'game'] }] },
  death: { cols: 8, scale: 0.5, steps: [{ dur: 0.3 }, { dur: 2.4, set: { dead: true }, every: 0.15, cam: 'q' }] },
  hit: { cols: 8, scale: 0.5, steps: [{ dur: 0.3 }, { dur: 0.6, set: { hit: 1 }, every: 0.075, cam: 'q' }] },
  cast: { cols: 6, scale: 0.5, steps: [{ dur: 0.6, set: { cast: 1, levitate: 1 } }, { dur: 0.6, every: 0.2, cam: ['front', 'side'] }] },
};
for (const k of ['flick', 'ring', 'stroke', 'throw', 'toss', 'blast']) {
  SC[`atk_${k}`] = { cols: 8, scale: 0.5, steps: [{ dur: 0.3 }, { dur: 0.8, set: { attack: 1, attackKind: k, attackSide: 1 }, every: 0.05, cam: 'q' }, { dur: 0.05, set: { fwd: 6 } }, { dur: 0.6 }, { dur: 0.8, set: { attack: 1, attackKind: k, attackSide: 1 }, every: 0.05, cam: 'game' }] };
}
const { browser, page } = await open();
for (const hero of heroes.split(',')) for (const n of names.split(',')) {
  const k = await sheet(page, { hero, ...SC[n] }, `${out}/${hero}_${n}.jpg`);
  console.log(`${hero} ${n}: ${k} frames`);
}
await browser.close();

import '@fontsource-variable/inter';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-700-italic.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import './ui/ui.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Renderer } from './core/Renderer';
import { Input } from './core/Input';
import { audio } from './core/Audio';
import { settings } from './core/settings';
import { initGlobals, globalUniforms } from './render/materials';
import { Arena } from './world/Arena';
import { StudyArena } from './world/StudyArena';
import type { ArenaLike } from './world/types';
import { loadProps } from './render/props';
import { Game } from './game/Game';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { Subtitles } from './ui/Subtitles';
import { renderPortraits } from './ui/portraits';
import { warmupEinstein, warmupYeat, warmupVanGogh, HERO_LIST } from './heroes';
import { warmupHeroModels } from './render/GltfHeroModel';
import type { HeroId } from './game/types';
import type { Mode } from './game/Game';
import { damp } from './core/math';

registerSW({ immediate: true });

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function boot() {
  const bootEl = document.getElementById('boot')!;
  const bar = bootEl.querySelector('.bar i') as HTMLElement;
  const hint = bootEl.querySelector('.hint') as HTMLElement;
  const progress = async (p: number, label: string) => { bar.style.width = `${p}%`; hint.textContent = label; await nextFrame(); };

  await progress(5, 'Preparing the canvas');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 1400);
  camera.position.set(0, 3, 10);
  const container = document.getElementById('app')!;
  const renderer = new Renderer(container, scene, camera);
  initGlobals();

  const study = settings.arena !== 'ruins';
  await progress(20, study ? 'Opening the study' : 'Raising the ruins');
  const arena: ArenaLike = study ? new StudyArena(scene, renderer.gl) : new Arena(scene, renderer.gl);
  await progress(45, study ? 'Dusting the desk' : 'Growing the meadow');
  await Promise.all([loadProps(), arena.ready]);
  arena.placeProps();
  await progress(58, 'Placing the relics');

  const uiRoot = document.getElementById('ui')!;
  const input = new Input(renderer.gl.domElement);
  // eslint-disable-next-line prefer-const
  let hud: Hud;
  const game = new Game(scene, arena, camera, input, {
    onKill: (k, v, a) => hud.kill(k, v, a),
    onDamageNumber: (p, a, c, h) => hud.damageNumber(p, a, c, h),
    onHitmarker: (c, k) => hud.hitmarker(c, k),
    onLocalHurt: (_a, from) => hud.hurt(from),
    onAnnounce: (t, s, tone) => hud.announce(t, s, tone),
    onCountdown: (n) => hud.countdown(n),
    onMatchEnd: () => {
      setTimeout(() => {
        input.unlock();
        menu.results(game, () => startMatch(lastMode, lastHero), () => toMenu());
      }, 3200);
    },
  });
  hud = new Hud(uiRoot, game);
  const subs = new Subtitles(uiRoot);
  const REL_COLOR = { ally: '#7cc4ff', enemy: '#ff5a6e' } as const;
  game.voice.onLine = (l) => subs.show(l.name, l.rel === 'self' ? l.hero.def.color : REL_COLOR[l.rel], l.text, l.dur);
  (window as unknown as { __legends: unknown }).__legends = { game, renderer, settings };

  await progress(70, 'Painting the legends');
  await renderPortraits(renderer.gl, scene.environment);

  await progress(85, 'Warming up the shaders');
  const heroModels = await warmupHeroModels(HERO_LIST);
  const warm = [...warmupEinstein(game), ...warmupYeat(game), ...warmupVanGogh(game), ...heroModels.map((m) => m.root)];
  const warmGroup = new THREE.Group();
  warm.forEach((m) => { m.position.set(0, -50, 0); warmGroup.add(m); });
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending }));
  warmGroup.add(spr);
  scene.add(warmGroup);
  game.setShowcase('einstein');
  try { await renderer.gl.compileAsync(scene, camera); } catch { renderer.gl.compile(scene, camera); }
  renderer.render(0.016, 16);
  scene.remove(warmGroup);
  heroModels.forEach((m) => m.dispose());

  let lastMode: Mode = '3v3';
  let lastHero: HeroId = 'einstein';

  const menu = new Menu(uiRoot, {
    onStart: (mode, hero) => startMatch(mode, hero),
    onPreviewHero: (hero) => game.setShowcase(hero),
    onQualityChange: () => { renderer.applyQuality(); arena.applyQuality(); },
    onResume: () => { input.lock(); },
    onLeave: () => { menu.pause(false); toMenu(); },
  });
  menu.bindGame(game);
  menu.show(false);
  game.setShowcase(menu.hero);

  function startMatch(mode: Mode, hero: HeroId) {
    lastMode = mode; lastHero = hero;
    game.setShowcase(null);
    menu.show(false);
    menu.pause(false);
    subs.clear();
    audio.setWorldPaused(false);
    game.startMatch({ mode, heroId: hero, difficulty: settings.botDifficulty });
    hud.setup();
    hud.show(true);
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    input.lock();
    flash();
  }

  function toMenu() {
    subs.clear();
    audio.setWorldPaused(false);
    game.clearMatch();
    game.paused = false;
    hud.show(false);
    menu.show(true);
    game.setShowcase(menu.hero);
    renderer.setSaturation(0.12);
    flash();
  }

  function flash() {
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;background:#05060c;z-index:40;pointer-events:none;transition:opacity .7s ease';
    document.body.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = '0'; }));
    setTimeout(() => f.remove(), 800);
  }

  input.onLockChange = (locked) => {
    if (game.state === 'menu' || game.state === 'ended') return;
    game.paused = !locked;
    audio.setWorldPaused(game.paused);
    menu.pause(!locked);
  };
  // clicking the canvas during a match re-locks the mouse
  renderer.gl.domElement.addEventListener('click', () => {
    if (game.state !== 'menu' && game.state !== 'ended' && !input.locked && !document.querySelector('.panel')) input.lock();
  });

  await progress(100, 'Press any key to start');
  hint.classList.add('pulse');
  const enter = () => {
    audio.unlock();
    audio.setVolume(settings.volume);
    audio.setVoice(settings.voice);
    audio.startMusic();
    bootEl.classList.add('fade');
    setTimeout(() => bootEl.remove(), 900);
    menu.show(true);
    window.removeEventListener('pointerdown', enter);
    window.removeEventListener('keydown', enter);
  };
  window.addEventListener('pointerdown', enter);
  window.addEventListener('keydown', enter);

  // ───────── main loop ─────────
  let last = performance.now();
  let menuT = 0;
  const lookTarget = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const mc = { ...menu.cam };
  let sat = 0.12;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const ms = now - last;
    last = now;
    const dt = Math.min(0.1, ms / 1000);
    game.update(dt);
    if (game.state === 'menu' && !(window as unknown as { __freeCam?: boolean }).__freeCam) {
      menuT += dt;
      // ease toward the framing the current menu page asks for (closer on hero select)
      const want = menu.cam;
      mc.dist = damp(mc.dist, want.dist, 2.6, dt);
      mc.side = damp(mc.side, want.side, 2.6, dt);
      mc.look = damp(mc.look, want.look, 2.6, dt);
      mc.height = damp(mc.height, want.height, 2.6, dt);
      // slow cinematic drift around the showcase hero on the dais
      const a = Math.sin(menuT * 0.09) * 0.45 - 0.15;
      const R = mc.dist + Math.sin(menuT * 0.13) * 0.6 * (mc.dist / 7.2);
      // the menu framing is tuned for a showcase standing at y = 1 (the ruins dais)
      const sp = arena.showcasePos, dy = sp.y - 1;
      camTarget.set(sp.x + Math.sin(a) * R, dy + mc.height + Math.sin(menuT * 0.17) * 0.25, sp.z - Math.cos(a) * R);
      camera.position.lerp(camTarget, 1 - Math.exp(-2 * dt));
      // frame the hero off-center so the UI owns the left side
      camRight.subVectors(sp, camera.position).cross(UP).normalize();
      lookTarget.set(sp.x, dy + mc.look, sp.z).addScaledVector(camRight, -mc.side);
      camera.lookAt(lookTarget);
      if (camera.fov !== 42) { camera.fov = 42; camera.updateProjectionMatrix(); }
    }
    // cinematic low-health desaturation
    const h = game.local;
    const want = game.state !== 'menu' && h && h.alive ? 0.12 - Math.max(0, 0.35 - h.hp / h.maxHp) * 1.6 : game.state !== 'menu' && h && !h.alive ? -0.35 : 0.12;
    sat = damp(sat, want, 5, dt);
    renderer.setSaturation(sat);
    arena.setDoom(game.doom);
    audio.setDoom(game.doom);
    arena.update(globalUniforms.uTime.value, camera);
    renderer.render(dt, ms);
    if (game.state !== 'menu') hud.update(dt, camera, renderer.fps, renderer.gl.info.render.calls);
    input.endFrame();
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  const hint = document.querySelector('#boot .hint');
  if (hint) hint.textContent = 'WebGL2 is required. Please update your browser or enable hardware acceleration.';
});

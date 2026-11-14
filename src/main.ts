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
import { enterFullscreen, isFullscreen, isStandalone } from './core/Display';
import { audio } from './core/Audio';
import { music } from './audio/Music';
import { ambience } from './audio/Ambience';
import { settings } from './core/settings';
import { initGlobals, globalUniforms } from './render/materials';
import { GodRaysEffect } from './world/studyLight';
import { StudyArena } from './world/StudyArena';
import { MuseumArena } from './world/MuseumArena';
import type { ArenaLike, Soundscape } from './world/types';
import { loadProps } from './render/props';
import { Game } from './game/Game';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { MenuStage } from './world/MenuStage';
import { Subtitles } from './ui/Subtitles';
import { renderPortraits } from './ui/portraits';
import { warmupEinstein, warmupYeat, warmupVanGogh, HERO_LIST, HEROES } from './heroes';
import { warmupHeroModels } from './render/GltfHeroModel';
import type { HeroId } from './game/types';
import type { Mode, Lineup } from './game/Game';
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

  const kind = settings.arena;
  await progress(20, kind === 'museum' ? 'Unlocking the museum' : 'Opening the study');
  const arena: ArenaLike = kind === 'museum' ? new MuseumArena(scene, renderer.gl) : new StudyArena(scene, renderer.gl);
  await progress(45, kind === 'museum' ? 'Polishing the marble' : 'Dusting the desk');
  await Promise.all([loadProps(), arena.ready]);
  arena.placeProps();
  if (arena instanceof StudyArena && arena.hasRoomModel) renderer.setVolumetric(new GodRaysEffect(camera, 16));
  if (arena instanceof MuseumArena) renderer.setVolumetric(arena.raysEffect(camera, 16));
  await progress(58, 'Placing the relics');

  const uiRoot = document.getElementById('ui')!;
  const input = new Input(renderer.gl.domElement);
  // eslint-disable-next-line prefer-const
  let hud: Hud;
  const game = new Game(scene, arena, camera, input, {
    onKill: (k, v, a, ab) => hud.kill(k, v, a, ab),
    onUltCast: (h, near) => hud.ultCast(h, near),
    onOutro: (t, s) => hud.outro(t, s),
    onDamageNumber: (p, a, c, h, key) => hud.damageNumber(p, a, c, h, key),
    onHitmarker: (c, k, a) => hud.hitmarker(c, k, a),
    onLocalHurt: (a, from) => hud.hurt(from, a),
    onAnnounce: (t, s, tone) => hud.announce(t, s, tone),
    onCountdown: (n) => hud.countdown(n),
    onCallout: (c) => hud.callout(c),
    onMatchEnd: () => {
      setTimeout(() => {
        input.unlock();
        document.body.classList.remove('in-match');
        menu.results(game, () => startMatch(lastMode, lastHero), () => toMenu());
        music.play('menu', 4);
        if (game.playOfGame) setTimeout(() => audio.announce('playOfGame', 4), 500);
      }, 4200);
    },
  });
  hud = new Hud(uiRoot, game);
  const subs = new Subtitles(uiRoot);
  const REL_COLOR = { ally: '#7cc4ff', enemy: '#ff5a6e' } as const;
  game.voice.onLine = (l) => subs.show(l.name, l.rel === 'self' ? l.hero.def.color : REL_COLOR[l.rel], l.text, l.dur);
  (window as unknown as { __legends: unknown }).__legends = { game, renderer, settings, arena };

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
  const stage = new MenuStage(renderer.gl);
  try { await renderer.gl.compileAsync(scene, camera); } catch { renderer.gl.compile(scene, camera); }
  renderer.render(0.016, 16);
  scene.remove(warmGroup);
  heroModels.forEach((m) => m.dispose());

  let lastMode: Mode = '3v3';
  let lastHero: HeroId = 'einstein';

  const menu = new Menu(uiRoot, {
    onStart: (mode, hero, lineup) => startMatch(mode, hero, lineup),
    onPreviewHero: (hero) => showcase(hero),
    onLockIn: () => { stage.burst(); music.surge(true); },
    onQualityChange: () => { renderer.applyQuality(); arena.applyQuality(); },
    onResume: () => engage(),
    onEngage: () => engage(),
    onLeave: () => { menu.pause(false); toMenu(); },
  });
  menu.bindGame(game);
  menu.show(false);
  let shownHero: HeroId | null = null;
  /** The menu legend stands on the Assembly Hall stage, tinted to match. */
  function showcase(hero: HeroId) {
    if (hero !== shownHero) { shownHero = hero; audio.play('stageSwap'); }
    game.setShowcase(hero, stage);
    stage.setHero(HEROES[hero].color, HEROES[hero].accent);
  }
  Object.assign((window as unknown as { __legends: object }).__legends, { menu, hud, stage, startMatch: (m: Mode, h: HeroId) => startMatch(m, h) });
  showcase(menu.hero);
  try { await renderer.gl.compileAsync(stage.scene, camera); } catch { renderer.gl.compile(stage.scene, camera); }

  function startMatch(mode: Mode, hero: HeroId, lineup?: Lineup) {
    lastMode = mode; lastHero = hero;
    game.setShowcase(null);
    menu.show(false);
    menu.pause(false);
    subs.clear();
    audio.setWorldPaused(false);
    game.startMatch({ mode, heroId: hero, difficulty: settings.botDifficulty, lineup });
    enterWorld('arena');
    hud.setup();
    hud.show(true);
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    document.body.classList.add('in-match');
    engage();
    // Lock In already asked for the lock; if the browser refused it, don't leave the match
    // running with a free cursor: show the pause screen so one click picks it back up.
    setTimeout(() => { if (inMatch() && !input.locked) pauseFor(false); }, 600);
    flash();
  }

  function toMenu() {
    document.body.classList.remove('in-match');
    input.unlock();
    subs.clear();
    audio.setWorldPaused(false);
    game.clearMatch();
    enterWorld('hall');
    game.paused = false;
    hud.show(false);
    menu.show(true);
    showcase(menu.hero);
    renderer.setSaturation(0.12);
    flash();
  }

  /**
   * Which world you hear: the Assembly Hall behind the menus (its own drone, a vast airy room,
   * menu or hero select music by page), or the arena in a match (its placed soundscape and room).
   */
  const HALL: Soundscape = { kind: 'hall' };
  let menuPage = 'home';
  function enterWorld(w: 'hall' | 'arena') {
    if (w === 'hall') {
      ambience.start(HALL);
      audio.setRoom('hall');
      audio.setAmbience(0.8, 2);
      music.play(menuPage === 'select' ? 'select' : 'menu', 2.5);
    } else {
      if (arena.soundscape) ambience.start(arena.soundscape);
      audio.setRoom(kind === 'museum' ? 'hall' : 'study'); // the museum rings like the Assembly Hall
      audio.setAmbience(1, 1.5);
    }
  }
  // the menu reports each page change: hero select gets its own building cue
  window.addEventListener('la:menu', (e) => {
    menuPage = (e as CustomEvent<{ page: string }>).detail.page;
    if (game.state === 'menu' && audio.ctx) music.play(menuPage === 'select' ? 'select' : 'menu', 2);
  });

  function flash() {
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;background:#05060c;z-index:40;pointer-events:none;transition:opacity .7s ease';
    document.body.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.opacity = '0'; }));
    setTimeout(() => f.remove(), 800);
  }

  const inMatch = () => game.state !== 'menu' && game.state !== 'ended';

  /** Lock the mouse (and go fullscreen if wanted). Only works inside a user gesture. */
  function engage() {
    // Pointer lock first: in some browsers requestFullscreen consumes the click's
    // user activation, which would make the lock request that follows fail.
    input.lock();
    if (settings.fullscreen && !isFullscreen() && !isStandalone()) void enterFullscreen();
  }

  function pauseFor(locked: boolean) {
    game.paused = !locked;
    audio.setWorldPaused(game.paused);
    audio.setAmbience(game.paused ? 0.35 : 1, 0.5);
    menu.pause(!locked);
  }

  input.onLockChange = (locked) => { if (inMatch()) pauseFor(locked); };
  input.onLockError = () => { if (inMatch() && !input.locked) pauseFor(false); };
  // Esc is captured while fullscreen (keyboard lock), so open the pause menu ourselves
  // instead of letting the browser drop fullscreen.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && input.locked && inMatch()) { e.preventDefault(); input.unlock(); }
  });
  // Leaving fullscreen mid-match (holding Esc, F11, alt-tab on some platforms) drops the lock
  // in most browsers; make sure we land on the pause screen rather than a half-locked state.
  document.addEventListener('fullscreenchange', () => {
    if (!isFullscreen() && inMatch() && !game.paused && !input.locked) pauseFor(false);
  });
  // Tabbing away can lose the lock without a lockchange in some browsers.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && inMatch() && !game.paused) { input.unlock(); pauseFor(false); }
  });
  // clicking the canvas during a match re-locks the mouse
  renderer.gl.domElement.addEventListener('click', () => {
    if (inMatch() && !input.locked && !document.querySelector('.panel')) engage();
  });

  await progress(100, 'Press any key to start');
  hint.classList.add('pulse');
  const enter = () => {
    audio.unlock();
    audio.setVolume(settings.volume);
    audio.setVoice(settings.voice);
    enterWorld('hall');
    music.preload();
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
    const onStage = game.state === 'menu';
    renderer.setScene(onStage ? stage.scene : scene, !onStage);
    if (onStage) stage.update(dt);
    if (game.state === 'menu' && !(window as unknown as { __freeCam?: boolean }).__freeCam) {
      menuT += dt;
      // ease toward the framing the current menu page asks for (closer on hero select)
      const want = menu.cam;
      const snap = (window as unknown as { __snapCam?: boolean }).__snapCam; // dev screenshots: no easing
      const ck = snap ? 1e3 : 2.6;
      mc.dist = damp(mc.dist, want.dist, ck, dt);
      mc.side = damp(mc.side, want.side, ck, dt);
      mc.look = damp(mc.look, want.look, ck, dt);
      mc.height = damp(mc.height, want.height, ck, dt);
      // slow cinematic drift around the showcase hero on the dais
      const a = Math.sin(menuT * 0.09) * 0.45 - 0.15;
      const R = mc.dist + Math.sin(menuT * 0.13) * 0.6 * (mc.dist / 7.2);
      // the menu framing is tuned for a showcase standing at y = 1 
      const sp = stage.heroPos, dy = sp.y - 1;
      camTarget.set(sp.x + Math.sin(a) * R, dy + mc.height + Math.sin(menuT * 0.17) * 0.25, sp.z - Math.cos(a) * R);
      camera.position.lerp(camTarget, snap ? 1 : 1 - Math.exp(-2 * dt));
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
    if (!onStage) arena.update(globalUniforms.uTime.value, camera);
    ambience.update(dt, globalUniforms.uTime.value);
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

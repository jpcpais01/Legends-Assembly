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
import { settings, saveSettings } from './core/settings';
import { initGlobals, globalUniforms } from './render/materials';
import { GodRaysEffect } from './world/studyLight';
import { StudyArena } from './world/StudyArena';
import { MuseumArena } from './world/MuseumArena';
import type { ArenaLike, Soundscape } from './world/types';
import { loadProps, PROPS } from './render/props';
import { Game, partyRoster, rollLineup, type RosterSlot } from './game/Game';
import { Loading, type LoadSeat } from './ui/Loading';
import { NetMatch } from './net/NetMatch';
import { parseCode, type Party, type ArenaKind, type Msg } from './net/Party';
import { Hud } from './ui/Hud';
import { Menu } from './ui/Menu';
import { MenuStage } from './world/MenuStage';
import { Subtitles } from './ui/Subtitles';
import { renderPortraits } from './ui/portraits';
import { warmupEinstein, warmupYeat, warmupVanGogh, warmupBlitzcrank, warmupLuffy, warmupIronMan, warmupMickey, warmupSteve, warmupMarley, HERO_LIST, HEROES } from './heroes';
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
  let scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.1, 1400);
  camera.position.set(0, 3, 10);
  const container = document.getElementById('app')!;
  const renderer = new Renderer(container, scene, camera);
  initGlobals();

  let kind: ArenaKind = settings.arena;
  const makeArena = (k: ArenaKind, sc: THREE.Scene): ArenaLike => k === 'museum' ? new MuseumArena(sc, renderer.gl) : new StudyArena(sc, renderer.gl);
  const volumetricFor = (a: ArenaLike) => a instanceof StudyArena && a.hasRoomModel ? new GodRaysEffect(camera, 16) : a instanceof MuseumArena ? a.raysEffect(camera, 16) : null;
  await progress(20, kind === 'museum' ? 'Unlocking the museum' : 'Opening the study');
  let arena: ArenaLike = makeArena(kind, scene);
  await progress(45, kind === 'museum' ? 'Polishing the marble' : 'Dusting the desk');
  await Promise.all([loadProps(), arena.ready]);
  arena.placeProps();
  renderer.setVolumetric(volumetricFor(arena));
  await progress(58, 'Placing the relics');

  const uiRoot = document.getElementById('ui')!;
  const input = new Input(renderer.gl.domElement);
  // eslint-disable-next-line prefer-const
  let hud: Hud;
  const game = new Game(arena, camera, input, {
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
        menu.pause(false);
        input.unlock();
        document.body.classList.remove('in-match');
        hud.show(false); // the "Final Elimination" outro banner must not linger behind the results
        if (onlineParty) {
          const p = onlineParty;
          menu.results(game, () => { toMenu(); if (p.isHost) p.setPhase('select'); }, () => { toMenu(); menu.leaveParty(); }, true);
        } else menu.results(game, () => startMatch(lastMode, lastHero), () => toMenu());
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
  /** Compile every hero, ability and effect shader against an arena's lights, so the first fight doesn't hitch. */
  async function warmScene(sc: THREE.Scene, firstFrame = false) {
    const heroModels = await warmupHeroModels(HERO_LIST);
    const warm = [...warmupEinstein(game), ...warmupYeat(game), ...warmupVanGogh(game), ...warmupBlitzcrank(game), ...warmupLuffy(game), ...warmupIronMan(game), ...warmupMickey(game), ...warmupSteve(game), ...warmupMarley(game), ...heroModels.map((m) => m.root)];
    const warmGroup = new THREE.Group();
    warm.forEach((m) => { m.position.set(0, -50, 0); warmGroup.add(m); });
    warmGroup.add(new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending })));
    sc.add(warmGroup);
    try { await renderer.gl.compileAsync(sc, camera); } catch { renderer.gl.compile(sc, camera); }
    if (firstFrame) renderer.render(0.016, 16);
    sc.remove(warmGroup);
    heroModels.forEach((m) => m.dispose());
  }
  game.setShowcase('einstein');
  const stage = new MenuStage(renderer.gl);
  await warmScene(scene, true);

  let lastMode: Mode = '3v3';
  let lastHero: HeroId = 'einstein';
  const loading = new Loading();

  // ───────── arenas: loaded in place before a match (no page reload) ─────────

  /** Free the GPU side of an arena we left (shared prop templates stay: other arenas use them). */
  function disposeScene(sc: THREE.Scene) {
    const keep = new Set<object>();
    for (const t of Object.values(PROPS)) {
      if (!t) continue;
      keep.add(t.geometry); keep.add(t.material); if (t.glass) keep.add(t.glass);
      for (const v of Object.values(t.material)) if (v && (v as THREE.Texture).isTexture) keep.add(v);
    }
    const seen = new Set<object>();
    const free = (o: { dispose?: () => void } | null | undefined) => { if (!o || keep.has(o) || seen.has(o)) return; seen.add(o); o.dispose?.(); };
    sc.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) free(m.geometry);
      const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) free(v as THREE.Texture);
        const u = (mat as THREE.ShaderMaterial).uniforms;
        if (u) for (const x of Object.values(u)) if (x?.value && (x.value as THREE.Texture).isTexture && !(Object.values(globalUniforms) as { value: unknown }[]).some((g) => g.value === x.value)) free(x.value as THREE.Texture);
        free(mat);
      }
      const l = o as THREE.DirectionalLight;
      if (l.isLight && l.shadow?.map) { l.shadow.map.dispose(); (l.shadow as unknown as { map: null }).map = null; }
    });
    if (sc.environment) free(sc.environment);
    sc.clear();
  }

  const LOAD_COPY: Record<ArenaKind, [string, string]> = {
    study: ['Opening the study', 'Dusting the desk'],
    museum: ['Unlocking the museum', 'Polishing the marble'],
  };
  let arenaLoad: Promise<void> | null = null;
  /** Build an arena in its own scene, warm its shaders, then swap it in and free the old one. */
  async function loadArena(next: ArenaKind, report: (p: number, label: string) => void) {
    while (arenaLoad) await arenaLoad;
    if (next === kind) { report(1, 'Ready'); return; }
    let release!: () => void;
    arenaLoad = new Promise<void>((r) => { release = r; });
    try {
      report(0.08, LOAD_COPY[next][0]);
      await nextFrame();
      const sc = new THREE.Scene();
      const a = makeArena(next, sc);
      report(0.35, LOAD_COPY[next][1]);
      await a.ready;
      a.placeProps();
      report(0.7, 'Warming up the shaders');
      await warmScene(sc);
      report(0.95, 'Placing the relics');
      const old = scene;
      game.setArena(a);
      arena = a; scene = sc; kind = next;
      a.applyQuality();
      renderer.setVolumetric(volumetricFor(a));
      settings.arena = next; saveSettings(settings);
      (window as unknown as { __legends: { arena: ArenaLike } }).__legends.arena = a;
      disposeScene(old);
      report(1, 'Ready');
    } finally { arenaLoad = null; release(); }
  }

  function seatsFrom(roster: RosterSlot[], me: number): [LoadSeat[], LoadSeat[]] {
    const myTeam = roster[me]?.team ?? 0;
    const out: [LoadSeat[], LoadSeat[]] = [[], []];
    roster.forEach((r, i) => out[r.team === myTeam ? 0 : 1].push({ name: r.name, hero: r.id, me: i === me, bot: r.owner === null }));
    out[0].sort((a, b) => Number(!!b.me) - Number(!!a.me));
    return out;
  }

  /** Solo: lineup → arena → load → fight. */
  async function playSolo(mode: Mode, hero: HeroId, lineup: Lineup | undefined, next: ArenaKind) {
    const l = lineup ?? rollLineup(mode, hero);
    const me: LoadSeat = { name: settings.playerName || 'You', hero, me: true };
    loading.show({ arena: next, mode, teams: [[me, ...l[0].map((s) => ({ name: s.name, hero: s.id, bot: true }))], l[1].map((s) => ({ name: s.name, hero: s.id, bot: true }))] });
    menu.show(false);
    const t0 = performance.now();
    await loadArena(next, (p, label) => loading.progress(p, label));
    // let the versus screen breathe for a moment even when the arena was already loaded
    await new Promise((r) => setTimeout(r, Math.max(0, 1600 - (performance.now() - t0))));
    loading.hide();
    startMatch(mode, hero, l);
  }

  // ───────── online party: the match handshake ─────────
  // host: start (roster + arena) → everyone loads → 'loaded' back → host sends 'begin' → all start together

  let party: Party | null = null;
  let onlineParty: Party | null = null;
  let net: NetMatch | null = null;
  let pendingStart: { roster: RosterSlot[]; arena: ArenaKind; mode: Mode; diff: 'easy' | 'normal' | 'hard' } | null = null;
  let loadedFrom = new Set<string>();
  let beginTimer = 0;

  function onParty(p: Party | null) {
    party = p;
    if (!p) {
      if (onlineParty && inMatchOrLoading()) { onlineParty = null; net = null; loading.hide(true); toMenu(); }
      onlineParty = null;
      return;
    }
    p.onMsg = (m, from) => partyMsg(p, m, from);
    // the host took the party back to hero select: leave the results screen and follow
    const prevState = p.onState;
    p.onState = (st) => {
      if ((st.phase === 'select' || st.phase === 'lobby') && game.state !== 'menu' && !loading.visible && !pendingStart) { menu.closeResults(); toMenu(); }
      prevState?.(st);
    };
    const prevLeft = p.onLeft;
    p.onLeft = (id, name) => { prevLeft?.(id, name); net?.playerLeft(id); if (pendingStart) { loadedFrom.delete(id); maybeBegin(p); } };
  }

  const inMatchOrLoading = () => loading.visible || game.state !== 'menu';

  function partyMsg(p: Party, m: Msg, from: string) {
    if (m.t === 'start' && !p.isHost) { void launchOnline(p, m.roster as RosterSlot[], m.arena as ArenaKind, m.mode as Mode, m.diff as 'easy' | 'normal' | 'hard'); return; }
    if (m.t === 'loaded' && p.isHost) { loadedFrom.add(from); maybeBegin(p); return; }
    if (m.t === 'begin' && !p.isHost) { beginOnline(p); return; }
    net?.receive(m, from);
  }

  /** Host: everyone is locked in and the arena is picked. */
  function partyStart(next: ArenaKind) {
    const p = party;
    if (!p || !p.isHost) return;
    const st = p.state;
    const roster = partyRoster(st.mode, st.members);
    p.setPhase('loading', next);
    p.broadcast({ t: 'start', roster, arena: next, mode: st.mode, diff: st.diff });
    void launchOnline(p, roster, next, st.mode, st.diff);
  }

  async function launchOnline(p: Party, roster: RosterSlot[], next: ArenaKind, mode: Mode, diff: 'easy' | 'normal' | 'hard') {
    const me = roster.findIndex((r) => r.owner === p.selfId);
    if (me < 0) return;
    menu.closeResults();
    if (game.state !== 'menu') toMenu();
    pendingStart = { roster, arena: next, mode, diff };
    loadedFrom = new Set();
    loading.show({ arena: next, mode, teams: seatsFrom(roster, me), online: true });
    menu.show(false);
    await loadArena(next, (v, label) => loading.progress(v * 0.92, label));
    if (party !== p || !pendingStart) return;
    if (p.isHost) {
      loadedFrom.add(p.selfId);
      clearTimeout(beginTimer);
      // never wait forever on one slow machine: after 40 s the match goes ahead (their seat plays as a bot until they arrive)
      beginTimer = window.setTimeout(() => maybeBegin(p, true), 40000);
      maybeBegin(p);
    } else {
      p.send({ t: 'loaded' });
      loading.progress(0.96, `Waiting for ${p.state.members.find((m) => m.host)?.name ?? 'the host'}`);
    }
  }

  function maybeBegin(p: Party, force = false) {
    if (!p.isHost || !pendingStart || !loadedFrom.has(p.selfId)) return;
    const waiting = p.state.members.filter((m) => !loadedFrom.has(m.id));
    if (waiting.length && !force) { loading.progress(0.96, `Waiting for ${waiting.map((m) => m.name).join(', ')}`); return; }
    clearTimeout(beginTimer);
    p.broadcast({ t: 'begin' });
    p.setPhase('match');
    beginOnline(p);
  }

  function beginOnline(p: Party) {
    const s = pendingStart;
    if (!s) return;
    pendingStart = null;
    const me = s.roster.findIndex((r) => r.owner === p.selfId);
    net = new NetMatch(game, p, s.roster.map((r) => r.owner));
    onlineParty = p;
    loading.hide();
    lastMode = s.mode; lastHero = s.roster[me].id;
    beginMatch({ mode: s.mode, heroId: s.roster[me].id, difficulty: s.diff, roster: s.roster, me }, net);
    // a host whose guest never finished loading: that seat is a bot until they leave
    if (p.isHost) for (const m of p.state.members) if (!loadedFrom.has(m.id)) net.playerLeft(m.id);
  }

  const menu = new Menu(uiRoot, {
    onStart: (mode, hero, lineup, next) => void playSolo(mode, hero, lineup, next),
    onParty: (p) => onParty(p),
    onPartyStart: (next) => partyStart(next),
    onPreviewHero: (hero) => showcase(hero),
    onLockIn: () => { stage.burst(); music.surge(true); },
    onQualityChange: () => { renderer.applyQuality(); arena.applyQuality(); },
    onResume: () => engage(),
    onEngage: (lockMouse) => engage(lockMouse),
    onLeave: () => { menu.pause(false); const online = !!game.net; toMenu(); if (online) menu.leaveParty(); },
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
  Object.assign((window as unknown as { __legends: object }).__legends, { menu, hud, stage, startMatch: (m: Mode, h: HeroId, l?: Lineup) => startMatch(m, h, l) });
  showcase(menu.hero);
  try { await renderer.gl.compileAsync(stage.scene, camera); } catch { renderer.gl.compile(stage.scene, camera); }

  function startMatch(mode: Mode, hero: HeroId, lineup?: Lineup) {
    lastMode = mode; lastHero = hero;
    onlineParty = null; net = null;
    beginMatch({ mode, heroId: hero, difficulty: settings.botDifficulty, lineup }, null);
  }

  function beginMatch(cfg: Parameters<Game['startMatch']>[0], link: NetMatch | null) {
    game.setShowcase(null);
    menu.show(false);
    menu.pause(false);
    subs.clear();
    audio.setWorldPaused(false);
    game.startMatch(cfg, link);
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
  function engage(lockMouse = true) {
    // Pointer lock first: in some browsers requestFullscreen consumes the click's
    // user activation, which would make the lock request that follows fail.
    if (lockMouse) input.lock();
    if (settings.fullscreen && !isFullscreen() && !isStandalone()) void enterFullscreen();
  }

  function pauseFor(locked: boolean) {
    // online matches never stop: the menu opens over a running match
    game.paused = !locked && !game.net;
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
    // opened from an invite link: join that party straight away
    const code = parseCode(new URLSearchParams(location.search).get('join') ?? '');
    if (code) {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      history.replaceState(null, '', url.toString());
      void menu.joinParty(code);
    }
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
    renderer.setScene(onStage ? stage.scene : game.scene, !onStage);
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

  // A hidden tab gets no animation frames. Online that would freeze the match for everyone (the host runs it),
  // so a worker clock keeps the simulation and the network ticking until the tab is visible again.
  const ticker = new Worker(URL.createObjectURL(new Blob(['let t=0;onmessage=(e)=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),33)}'], { type: 'text/javascript' })));
  let hiddenLast = 0;
  ticker.onmessage = () => {
    if (!document.hidden || !game.net) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (hiddenLast || now - 33)) / 1000);
    hiddenLast = now;
    game.update(dt);
    input.endFrame();
  };
  document.addEventListener('visibilitychange', () => { hiddenLast = 0; ticker.postMessage(document.hidden && !!game.net); last = performance.now(); });
}

boot().catch((e) => {
  console.error(e);
  const hint = document.querySelector('#boot .hint');
  if (hint) hint.textContent = 'WebGL2 is required. Please update your browser or enable hardware acceleration.';
});

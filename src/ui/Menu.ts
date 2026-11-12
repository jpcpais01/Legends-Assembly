import { HERO_LIST, HEROES } from '../heroes';
import type { HeroId } from '../game/types';
import { MODE_INFO, type Mode } from '../game/Game';
import { portraits } from './portraits';
import { settings, saveSettings, type QualityLevel } from '../core/settings';
import { PATCH_NOTES } from '../data/patchNotes';
import { audio } from '../core/Audio';
import { scoreboardHtml } from './Hud';
import type { Game } from '../game/Game';

const svg = (inner: string) => `<svg viewBox="0 0 24 24">${inner}</svg>`;
const VERSION = PATCH_NOTES[0].version;

export interface MenuHooks {
  onStart(mode: Mode, hero: HeroId): void;
  onPreviewHero(hero: HeroId): void;
  onQualityChange(): void;
  onResume(): void;
  onLeave(): void;
}

export class Menu {
  root: HTMLDivElement;
  private hooks: MenuHooks;
  private mode: Mode = '3v3';
  hero: HeroId = 'einstein';
  private panel: HTMLElement | null = null;
  private main: HTMLElement;
  private tag: HTMLElement;
  private pauseEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;

  constructor(parent: HTMLElement, hooks: MenuHooks) {
    this.hooks = hooks;
    const saved = (() => { try { return localStorage.getItem('la:lastHero') as HeroId | null; } catch { return null; } })();
    if (saved && HEROES[saved]) this.hero = saved;
    const savedMode = (() => { try { return localStorage.getItem('la:lastMode') as Mode | null; } catch { return null; } })();
    if (savedMode && MODE_INFO[savedMode]) this.mode = savedMode;
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.root.innerHTML = `
      <div class="menu-side">
        <div class="logo"><span class="l1">Legends</span><span class="l2">Assembly</span></div>
        <nav class="menu-nav">
          <button class="nav-btn primary" data-a="play">Play</button>
          <button class="nav-btn" data-a="heroes">Heroes</button>
          <button class="nav-btn" data-a="controls">How to play</button>
          <button class="nav-btn" data-a="settings">Settings</button>
          <button class="nav-btn" data-a="notes">Patch notes</button>
        </nav>
        <div class="menu-foot">v${VERSION} · <b>${PATCH_NOTES[0].title}</b></div>
      </div>
      <div class="showcase-tag"></div>`;
    parent.appendChild(this.root);
    this.main = this.root;
    this.tag = this.root.querySelector('.showcase-tag') as HTMLElement;
    this.root.querySelectorAll<HTMLButtonElement>('.nav-btn').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.play('uiHover'));
      b.addEventListener('click', () => {
        audio.play('ui');
        const a = b.dataset.a!;
        if (a === 'play') this.openPlay();
        if (a === 'heroes') this.openPlay(true);
        if (a === 'settings') this.openSettings();
        if (a === 'notes') this.openNotes();
        if (a === 'controls') this.openControls();
      });
    });
    this.updateTag();
  }

  show(on: boolean) {
    this.main.classList.toggle('hidden', !on);
    if (!on) this.closePanel();
  }

  private updateTag() {
    const d = HEROES[this.hero];
    this.tag.style.setProperty('--hc', d.color);
    this.tag.innerHTML = `<div class="role">${d.role} · ${d.title}</div><h2>${d.name}</h2><p>“${d.tagline}”</p>`;
  }

  closePanel() {
    this.panel?.remove();
    this.panel = null;
    this.tag.classList.remove('hidden');
    this.root.classList.remove('panel-open');
  }

  private openPanel(html: string, wide = true) {
    this.closePanel();
    const p = document.createElement('div');
    p.className = 'panel';
    if (!wide) p.style.width = 'min(760px, 94vw)';
    p.innerHTML = `<button class="close" aria-label="Close">✕</button>${html}`;
    p.querySelector('.close')!.addEventListener('click', () => { audio.play('ui'); this.closePanel(); });
    this.root.appendChild(p);
    this.panel = p;
    this.tag.classList.add('hidden');
    this.root.classList.add('panel-open');
    return p;
  }

  openPlay(heroesOnly = false) {
    const p = this.openPanel(`
      <h1>${heroesOnly ? 'Heroes' : 'Assemble'}</h1>
      <p class="sub">${heroesOnly ? 'Meet the legends.' : 'Choose your mode and your legend.'}</p>
      <div class="play-grid">
        <div>
          ${heroesOnly ? '' : `<div class="section-label">Mode</div>
          <div class="modes">${(Object.keys(MODE_INFO) as Mode[]).map((m) => `<button class="mode${m === this.mode ? ' sel' : ''}" data-m="${m}"><b>${m}</b><span>${MODE_INFO[m].label}</span></button>`).join('')}</div>
          <div class="section-label">Bot difficulty</div>
          <div class="seg diff">${(['easy', 'normal', 'hard'] as const).map((d) => `<button data-d="${d}" class="${settings.botDifficulty === d ? 'sel' : ''}">${d}</button>`).join('')}</div>
          <div class="section-label">Arena</div>
          <div class="seg arena">${([['study', "Giant's Study"], ['ruins', 'Sunset Ruins']] as const).map(([k, n]) => `<button data-a="${k}" class="${settings.arena === k ? 'sel' : ''}">${n}</button>`).join('')}</div>`}
          <div class="section-label">Legend</div>
          <div class="heroes">${HERO_LIST.map((h) => `<button class="hcard${h.id === this.hero ? ' sel' : ''}" data-h="${h.id}" style="--hc:${h.color}"><img src="${portraits[h.id] ?? ''}" alt=""><div class="nm"><small>${h.role}</small>${h.name}</div></button>`).join('')}</div>
          ${heroesOnly ? '' : '<button class="cta start">Start match</button>'}
        </div>
        <div class="hero-detail"></div>
      </div>`);
    const detail = p.querySelector('.hero-detail') as HTMLElement;
    const renderDetail = () => {
      const d = HEROES[this.hero];
      detail.style.setProperty('--hc', d.color);
      const a = d.abilities;
      detail.innerHTML = `
        <div class="title">${d.title}</div>
        <h2>${d.name}<span class="badge">${d.role}</span></h2>
        <div class="quote">“${d.tagline}”</div>
        <div class="stats">
          <div class="stat">Health · ${d.maxHp}<i><b style="width:${(d.maxHp / 350) * 100}%"></b></i></div>
          <div class="stat">Damage<i><b style="width:${d.ratings.damage * 100}%"></b></i></div>
          <div class="stat">Mobility<i><b style="width:${d.ratings.mobility * 100}%"></b></i></div>
          <div class="stat">Support<i><b style="width:${d.ratings.support * 100}%"></b></i></div>
        </div>
        ${[a.primary, a.secondary, a.ult].map((ab) => `
          <div class="ability"><div class="ic">${svg(ab.icon)}<span class="key">${ab.key}</span></div>
          <div><h4>${ab.name}<span>${ab.stat}</span></h4><p>${ab.desc}</p></div></div>`).join('')}`;
    };
    renderDetail();
    p.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      this.mode = b.dataset.m as Mode;
      p.querySelectorAll('.mode').forEach((x) => x.classList.toggle('sel', x === b));
    }));
    p.querySelectorAll<HTMLButtonElement>('.diff button').forEach((b) => b.addEventListener('click', () => {
      audio.play('ui');
      settings.botDifficulty = b.dataset.d as typeof settings.botDifficulty;
      saveSettings(settings);
      p.querySelectorAll('.diff button').forEach((x) => x.classList.toggle('sel', x === b));
    }));
    p.querySelectorAll<HTMLButtonElement>('.arena button').forEach((b) => b.addEventListener('click', () => {
      if (settings.arena === b.dataset.a) return;
      audio.play('ui');
      settings.arena = b.dataset.a as typeof settings.arena;
      saveSettings(settings);
      // arenas are built at boot: reload straight back into this panel
      try { sessionStorage.setItem('la:reopen', 'play'); } catch { /* storage unavailable */ }
      location.reload();
    }));
    p.querySelectorAll<HTMLButtonElement>('.hcard').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.play('uiHover'));
      b.addEventListener('click', () => {
        audio.play('ui');
        this.hero = b.dataset.h as HeroId;
        try { localStorage.setItem('la:lastHero', this.hero); } catch { /* ignore */ }
        p.querySelectorAll('.hcard').forEach((x) => x.classList.toggle('sel', x === b));
        renderDetail();
        this.updateTag();
        this.hooks.onPreviewHero(this.hero);
      });
    });
    p.querySelector('.start')?.addEventListener('click', () => {
      audio.play('go');
      try { localStorage.setItem('la:lastMode', this.mode); } catch { /* ignore */ }
      this.closePanel();
      this.hooks.onStart(this.mode, this.hero);
    });
  }

  openSettings(inGame = false) {
    const q = (k: QualityLevel) => `<option value="${k}" ${settings.quality === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`;
    const toggle = (k: keyof typeof settings) => `<button class="toggle ${settings[k] ? 'on' : ''}" data-t="${k}"></button>`;
    const p = this.openPanel(`
      <h1>Settings</h1><p class="sub">Tuned automatically for your GPU. Tweak anything you like.</p>
      <div class="settings">
        <div class="row"><label>Graphics quality</label><select data-s="quality">${q('low')}${q('medium')}${q('high')}${q('ultra')}</select></div>
        <div class="row"><label>Dynamic resolution</label>${toggle('dynamicResolution')}</div>
        <div class="row"><label>Mouse sensitivity <b class="v-sens">${settings.sensitivity.toFixed(2)}</b></label><input type="range" min="0.2" max="3" step="0.05" value="${settings.sensitivity}" data-r="sensitivity"></div>
        <div class="row"><label>Field of view <b class="v-fov">${settings.fov}</b></label><input type="range" min="65" max="110" step="1" value="${settings.fov}" data-r="fov"></div>
        <div class="row"><label>Master volume</label><input type="range" min="0" max="1" step="0.01" value="${settings.volume}" data-r="volume"></div>
        <div class="row"><label>Music</label><input type="range" min="0" max="1" step="0.01" value="${settings.music}" data-r="music"></div>
        <div class="row"><label>Invert mouse Y</label>${toggle('invertY')}</div>
        <div class="row"><label>Show FPS</label>${toggle('showFps')}</div>
        <div class="row"><label>Player name</label><input type="text" maxlength="16" value="${settings.playerName.replace(/"/g, '')}" data-n="name"></div>
      </div>
      <p class="note">Grass density, shadows and particle budgets scale with quality. Particle budget changes apply from the next match.</p>`, false);
    p.querySelector<HTMLSelectElement>('[data-s=quality]')!.addEventListener('change', (e) => {
      settings.quality = (e.target as HTMLSelectElement).value as QualityLevel;
      saveSettings(settings);
      this.hooks.onQualityChange();
    });
    p.querySelectorAll<HTMLButtonElement>('.toggle').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.t as 'dynamicResolution' | 'invertY' | 'showFps';
      settings[k] = !settings[k];
      b.classList.toggle('on', settings[k]);
      saveSettings(settings);
      audio.play('ui');
    }));
    p.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((r) => r.addEventListener('input', () => {
      const k = r.dataset.r as 'sensitivity' | 'fov' | 'volume' | 'music';
      settings[k] = parseFloat(r.value);
      if (k === 'volume') audio.setVolume(settings.volume);
      if (k === 'music') audio.setMusic(settings.music);
      const lab = p.querySelector(k === 'sensitivity' ? '.v-sens' : k === 'fov' ? '.v-fov' : '.none');
      if (lab) lab.textContent = k === 'fov' ? String(settings.fov) : settings.sensitivity.toFixed(2);
      saveSettings(settings);
    }));
    p.querySelector<HTMLInputElement>('[data-n=name]')!.addEventListener('input', (e) => {
      settings.playerName = (e.target as HTMLInputElement).value.slice(0, 16) || 'Player';
      saveSettings(settings);
    });
    if (inGame) p.querySelector('.close')!.addEventListener('click', () => this.pause(true));
    return p;
  }

  openNotes() {
    this.openPanel(`<h1>Patch notes</h1><p class="sub">What’s new in Legends Assembly.</p><div class="notes">${PATCH_NOTES.map((n) => `
      <article><h3>v${n.version} · ${n.title}</h3><time>${new Date(n.date + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</time>
      ${n.sections.map((s) => `<h5>${s.heading}</h5><ul>${s.items.map((i) => `<li>${i}</li>`).join('')}</ul>`).join('')}</article>`).join('')}</div>`, false);
  }

  openControls() {
    const k = (key: string, what: string) => `<div class="kbd"><kbd>${key}</kbd>${what}</div>`;
    this.openPanel(`<h1>How to play</h1><p class="sub">Eliminate the enemy team. First team to the target wins.</p>
      <div class="controls-grid">
        ${k('WASD', 'Move')}${k('SPACE', 'Jump')}${k('MOUSE', 'Aim')}${k('LMB', 'Basic attack')}${k('RMB', 'Ability')}${k('SHIFT', 'Special (charges over time & from damage)')}${k('TAB', 'Scoreboard')}${k('ESC', 'Pause')}
      </div>
      <div class="section-label">Tips</div>
      <div class="notes"><ul>
        <li>Aim for the head: headshots deal 50% bonus damage.</li>
        <li>Your special charges from dealing damage, healing and eliminations. Watch the ring in the bottom right.</li>
        <li>Low on health? Grab a green health pad or stand near a friendly Van Gogh sunflower.</li>
        <li>Einstein’s Gravity Well sets up E = mc² perfectly. Yeat’s Rage Dash closes gaps for Bell Ring.</li>
      </ul></div>`, false);
  }

  pause(on: boolean, hooksOnly = false) {
    if (!on) { this.pauseEl?.remove(); this.pauseEl = null; this.closePanel(); return; }
    if (hooksOnly) return;
    this.pauseEl?.remove();
    const el = document.createElement('div');
    el.className = 'pause';
    el.innerHTML = `<div class="box"><h2>PAUSED</h2>
      <button class="cta resume">Resume</button>
      <button class="ghost settings">Settings</button>
      <button class="ghost leave">Leave match</button>
      <div class="hint">Click Resume to lock the mouse again</div></div>`;
    el.querySelector('.resume')!.addEventListener('click', () => { audio.play('ui'); this.hooks.onResume(); });
    el.querySelector('.settings')!.addEventListener('click', () => { audio.play('ui'); el.remove(); this.pauseEl = null; this.openSettings(true); });
    el.querySelector('.leave')!.addEventListener('click', () => { audio.play('ui'); this.hooks.onLeave(); });
    document.getElementById('ui')!.appendChild(el);
    this.pauseEl = el;
  }

  results(g: Game, onAgain: () => void, onMenu: () => void) {
    this.resultsEl?.remove();
    const win = g.winner === g.local.team;
    const mvp = [...g.heroes].sort((a, b) => (b.stats.kills * 3 + b.stats.assists + b.stats.damage / 200 + b.stats.healing / 200) - (a.stats.kills * 3 + a.stats.assists + a.stats.damage / 200 + a.stats.healing / 200))[0];
    const el = document.createElement('div');
    el.className = 'results';
    el.innerHTML = `<div class="box">
      <div class="verdict ${win ? 'win' : 'lose'}">${win ? 'VICTORY' : 'DEFEAT'}</div>
      <div class="final"><span class="b">${g.score[0]}</span> — <span class="r">${g.score[1]}</span></div>
      <div class="mvp"><img src="${portraits[mvp.def.id] ?? ''}"><div><small>MATCH MVP</small><div style="font-family:var(--display);font-size:20px">${mvp.name}</div><div style="color:var(--muted);font-size:13px">${mvp.def.name} · ${mvp.stats.kills}/${mvp.stats.deaths}/${mvp.stats.assists}</div></div></div>
      <div class="scoreboard" style="position:static;transform:none;margin:0 auto">${scoreboardHtml(g)}</div>
      <div class="actions"><button class="cta again">Play again</button><button class="ghost menu">Main menu</button></div>
    </div>`;
    el.querySelector('.again')!.addEventListener('click', () => { audio.play('go'); el.remove(); this.resultsEl = null; onAgain(); });
    el.querySelector('.menu')!.addEventListener('click', () => { audio.play('ui'); el.remove(); this.resultsEl = null; onMenu(); });
    document.getElementById('ui')!.appendChild(el);
    this.resultsEl = el;
  }

  get lastMode() { return this.mode; }
}

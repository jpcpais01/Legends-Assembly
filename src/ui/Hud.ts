import * as THREE from 'three';
import type { Game } from '../game/Game';
import type { Hero } from '../game/Hero';
import { portraits } from './portraits';
import { settings } from '../core/settings';
import { MODE_INFO } from '../game/Game';

const svg = (inner: string, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 24 24">${inner}</svg>`;

interface DmgNum { el: HTMLDivElement; pos: THREE.Vector3; t: number; vx: number }
interface Plate { el: HTMLDivElement; bar: HTMLElement; hero: Hero }

export class Hud {
  root: HTMLDivElement;
  private g: Game;
  private els: Record<string, HTMLElement> = {};
  private nums: DmgNum[] = [];
  private plates: Plate[] = [];
  private v = new THREE.Vector3();
  private lastHp = 0;
  private dirs: { el: HTMLElement; t: number; from: THREE.Vector3 }[] = [];
  private announceTimer = 0;
  private ultWasReady = false;
  private scoreboardOn = false;

  constructor(parent: HTMLElement, g: Game) {
    this.g = g;
    const root = document.createElement('div');
    root.className = 'hud hidden';
    root.innerHTML = `
      <div class="vignette"></div>
      <div class="dmgdir">${'<i></i>'.repeat(6)}</div>
      <div class="fps"></div>
      <div class="topbar">
        <div class="team-row t0"></div>
        <div class="score"><div class="s b">0</div><div class="mid"><div class="t">6:00</div><div class="g">First to 10</div></div><div class="s r">0</div></div>
        <div class="team-row t1"></div>
      </div>
      <div class="feed"></div>
      <div class="crosshair"><div class="dot"></div></div>
      <div class="hitmarker"></div>
      <div class="announce"><div class="big"></div><div class="small"></div></div>
      <div class="countdown"></div>
      <div class="dead-overlay hidden"><div class="t">Respawning in</div><div class="n">5</div></div>
      <div class="vitals">
        <div class="portrait"><img alt=""></div>
        <div class="hpwrap">
          <div class="hpname"><span class="hname"></span><b><span class="hpv">250</span><small> / <span class="hpm">250</span></small></b></div>
          <div class="hpbar"><div class="trail"></div><div class="fill"></div><div class="ticks"></div></div>
        </div>
      </div>
      <div class="abilities">
        <div class="slot s-lmb"><span class="k">LMB</span></div>
        <div class="slot s-rmb"><div class="cd"></div><span class="num"></span><span class="k">RMB</span></div>
        <div class="slot ult s-ult"><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" stroke="rgba(255,255,255,.12)" stroke-width="5" fill="none"/><circle class="rc" cx="50" cy="50" r="46" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289"/></svg><span class="pct">0%</span><span class="k">SHIFT</span></div>
      </div>
      <div class="nums"></div>
      <div class="plates"></div>
      <div class="scoreboard hidden"></div>
    `;
    parent.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    for (const k of ['vignette', 'fps', 'feed', 'crosshair', 'hitmarker', 'announce', 'countdown', 'dead-overlay', 'hpbar', 'hpv', 'hpm', 'hname', 'nums', 'plates', 'scoreboard', 'portrait']) this.els[k] = q('.' + k);
    this.els.scoreB = q('.score .s.b'); this.els.scoreR = q('.score .s.r');
    this.els.timer = q('.score .t'); this.els.goal = q('.score .g');
    this.els.fill = q('.hpbar .fill'); this.els.trail = q('.hpbar .trail');
    this.els.rmb = q('.s-rmb'); this.els.ult = q('.s-ult'); this.els.lmb = q('.s-lmb');
    this.els.rmbCd = q('.s-rmb .cd'); this.els.rmbNum = q('.s-rmb .num');
    this.els.ultRing = q('.s-ult .rc'); this.els.ultPct = q('.s-ult .pct');
    this.els.t0 = q('.team-row.t0'); this.els.t1 = q('.team-row.t1');
    this.els.deadN = q('.dead-overlay .n');
    this.dirs = Array.from(root.querySelectorAll('.dmgdir i')).map((el) => ({ el: el as HTMLElement, t: 0, from: new THREE.Vector3() }));
    window.addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); this.scoreboardOn = true; } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Tab') this.scoreboardOn = false; });
  }

  show(on: boolean) { this.root.classList.toggle('hidden', !on); }

  /** Called at match start to bind the local hero visuals. */
  setup() {
    const h = this.g.local;
    const d = h.def;
    this.root.style.setProperty('--hc', d.color);
    (this.els.portrait.querySelector('img') as HTMLImageElement).src = portraits[d.id] ?? '';
    this.els.hname.textContent = d.name;
    this.els.hpm.textContent = String(d.maxHp);
    this.els.hpbar.style.setProperty('--tick', `${(25 / d.maxHp) * 100}%`);
    this.els.lmb.innerHTML = svg(d.abilities.primary.icon) + '<span class="k">LMB</span>';
    this.els.rmb.insertAdjacentHTML('afterbegin', '');
    this.els.rmb.innerHTML = svg(d.abilities.secondary.icon) + '<div class="cd"></div><span class="num"></span><span class="k">RMB</span>';
    this.els.rmbCd = this.els.rmb.querySelector('.cd') as HTMLElement;
    this.els.rmbNum = this.els.rmb.querySelector('.num') as HTMLElement;
    const ultSvg = this.els.ult.querySelector('svg.ring')!.outerHTML;
    this.els.ult.innerHTML = ultSvg + svg(d.abilities.ult.icon) + '<span class="pct">0%</span><span class="k">SHIFT</span>';
    this.els.ultRing = this.els.ult.querySelector('.rc') as HTMLElement;
    this.els.ultRing.setAttribute('stroke', d.color);
    this.els.ultPct = this.els.ult.querySelector('.pct') as HTMLElement;
    // crosshair style per hero
    const ch = this.els.crosshair;
    ch.innerHTML = '<div class="dot"></div>';
    if (d.id === 'yeat') ch.insertAdjacentHTML('beforeend', '<div class="ring"></div>');
    else {
      const gap = d.id === 'einstein' ? 7 : 9;
      for (const [x, y, w, hh] of [[-gap - 8, -1, 8, 2], [gap, -1, 8, 2], [-1, gap, 2, 8]] as const) {
        ch.insertAdjacentHTML('beforeend', `<div class="arm" style="left:${x}px;top:${y}px;width:${w}px;height:${hh}px"></div>`);
      }
    }
    this.els.goal.textContent = `First to ${MODE_INFO[this.g.config!.mode].target}`;
    // team rows
    for (const team of [0, 1]) {
      const row = team === 0 ? this.els.t0 : this.els.t1;
      row.style.setProperty('--tc', team === 0 ? 'var(--blue)' : 'var(--red)');
      row.innerHTML = this.g.heroes.filter((x) => x.team === team).map((x) => `<div class="tp" data-id="${x.id}"><img src="${portraits[x.def.id] ?? ''}"></div>`).join('');
    }
    // nameplates
    this.els.plates.innerHTML = '';
    this.plates = [];
    for (const hero of this.g.heroes) {
      if (hero.isLocal) continue;
      const el = document.createElement('div');
      el.className = 'plate ' + (hero.team === h.team ? 'ally' : 'enemy');
      el.innerHTML = `<div class="n">${hero.name} · ${hero.def.name.split(' ').pop()}</div><div class="b"><i></i></div>`;
      this.els.plates.appendChild(el);
      this.plates.push({ el, bar: el.querySelector('i') as HTMLElement, hero });
    }
    this.els.feed.innerHTML = '';
    this.lastHp = h.maxHp;
    this.ultWasReady = false;
  }

  damageNumber(pos: THREE.Vector3, amount: number, crit: boolean, heal: boolean) {
    const el = document.createElement('div');
    el.className = 'dmgnum' + (crit ? ' crit' : '') + (heal ? ' heal' : '');
    el.textContent = String(Math.round(amount));
    this.els.nums.appendChild(el);
    this.nums.push({ el, pos: pos.clone(), t: 0, vx: (Math.random() - 0.5) * 60 });
    if (this.nums.length > 40) { const n = this.nums.shift()!; n.el.remove(); }
  }

  hitmarker(crit: boolean, kill: boolean) {
    const el = this.els.hitmarker;
    el.className = 'hitmarker';
    void el.offsetWidth;
    el.className = 'hitmarker on' + (kill ? ' kill' : crit ? ' crit' : '');
  }

  hurt(from: THREE.Vector3 | null) {
    if (!from) return;
    let best = this.dirs[0];
    for (const d of this.dirs) if (d.t < best.t) best = d;
    best.t = 1.4;
    best.from.copy(from);
  }

  kill(killer: Hero | null, victim: Hero) {
    const me = this.g.local;
    const el = document.createElement('div');
    el.className = 'k' + (killer === me || victim === me ? ' me' : '');
    const cls = (h: Hero) => (h.team === me.team ? 'a' : 'e');
    el.innerHTML = killer
      ? `<span class="${cls(killer)}">${killer.name}</span><svg viewBox="0 0 24 24"><path d="M4 20L20 4M14 4h6v6M4 14l6 6"/></svg><span class="${cls(victim)}">${victim.name}</span>`
      : `<span class="${cls(victim)}">${victim.name}</span> was eliminated`;
    this.els.feed.prepend(el);
    while (this.els.feed.children.length > 5) this.els.feed.lastElementChild!.remove();
    setTimeout(() => el.remove(), 7000);
  }

  announce(text: string, sub = '', tone: 'gold' | 'red' | 'blue' = 'gold') {
    const a = this.els.announce;
    (a.querySelector('.big') as HTMLElement).textContent = text;
    (a.querySelector('.small') as HTMLElement).textContent = sub;
    a.className = 'announce ' + tone;
    void a.offsetWidth;
    a.className = 'announce show ' + tone;
    this.announceTimer = 2.4;
  }

  countdown(n: number) {
    const c = this.els.countdown;
    c.textContent = n === 0 ? 'FIGHT' : String(n);
    c.className = 'countdown' + (n === 0 ? ' go' : '');
    void c.offsetWidth;
    c.className = 'countdown pop' + (n === 0 ? ' go' : '');
  }

  update(dt: number, camera: THREE.PerspectiveCamera, fps: number, drawCalls: number) {
    const g = this.g, h = g.local;
    if (!h) return;
    this.els.fps.textContent = settings.showFps ? `${Math.round(fps)} FPS · ${drawCalls} draws` : '';
    // HP
    const hpFrac = Math.max(0, h.hp / h.maxHp);
    this.els.fill.style.transform = `scaleX(${hpFrac})`;
    this.els.trail.style.transform = `scaleX(${hpFrac})`;
    this.els.hpv.textContent = String(Math.ceil(h.hp));
    this.els.hpbar.classList.toggle('low', hpFrac < 0.35);
    const lowV = h.alive ? Math.max(0, (0.4 - hpFrac) / 0.4) * 0.8 : 0;
    const hurtPulse = h.hp < this.lastHp - 0.5 ? 0.6 : 0;
    this.lastHp = h.hp;
    const v = Math.max(lowV, hurtPulse, parseFloat(this.els.vignette.style.opacity || '0') - dt * 2);
    this.els.vignette.style.opacity = String(v);
    // cooldowns
    const rmbFrac = h.secondaryCd / h.def.secondaryCd;
    this.els.rmbCd.style.setProperty('--p', `${rmbFrac * 100}%`);
    this.els.rmbNum.textContent = h.secondaryCd > 0 ? (h.secondaryCd < 1 ? h.secondaryCd.toFixed(1) : String(Math.ceil(h.secondaryCd))) : '';
    this.els.ultRing.setAttribute('stroke-dashoffset', String(289 * (1 - h.ult)));
    this.els.ultPct.textContent = `${Math.floor(h.ult * 100)}%`;
    const ready = h.ult >= 1;
    if (ready !== this.ultWasReady) { this.els.ult.classList.toggle('ready', ready); this.ultWasReady = ready; }
    // score & time
    this.els.scoreB.textContent = String(g.score[0]);
    this.els.scoreR.textContent = String(g.score[1]);
    const t = Math.max(0, g.matchTime);
    const ot = g.matchTime <= 0;
    this.els.timer.textContent = ot ? 'OVERTIME' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    this.els.timer.classList.toggle('ot', ot);
    for (const tp of this.root.querySelectorAll<HTMLElement>('.team-row .tp')) {
      const hero = g.heroes.find((x) => x.id === Number(tp.dataset.id));
      if (!hero) continue;
      tp.classList.toggle('dead', !hero.alive);
      tp.dataset.t = hero.alive ? '' : String(Math.max(0, Math.ceil(hero.respawnT)));
    }
    // death overlay
    this.els['dead-overlay'].classList.toggle('hidden', h.alive || g.state === 'ended');
    if (!h.alive) this.els.deadN.textContent = String(Math.max(0, Math.ceil(h.respawnT)));
    this.els.crosshair.style.opacity = h.alive ? '1' : '0';
    // damage direction
    const camYaw = g.camRig.yaw;
    for (const d of this.dirs) {
      d.t = Math.max(0, d.t - dt);
      d.el.style.opacity = String(Math.min(1, d.t));
      if (d.t > 0) {
        const ang = Math.atan2(-(d.from.x - h.pos.x), -(d.from.z - h.pos.z));
        const rel = camYaw - ang;
        d.el.style.transform = `rotate(${rel}rad)`;
      }
    }
    // floating damage numbers
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t += dt;
      if (n.t > 0.9) { n.el.remove(); this.nums.splice(i, 1); continue; }
      this.v.copy(n.pos).project(camera);
      if (this.v.z > 1) { n.el.style.opacity = '0'; continue; }
      const x = (this.v.x * 0.5 + 0.5) * W + n.vx * n.t;
      const y = (-this.v.y * 0.5 + 0.5) * H - n.t * 70;
      const s = n.t < 0.1 ? 1.5 - n.t * 5 : 1;
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      n.el.style.opacity = String(Math.min(1, (0.9 - n.t) * 4));
    }
    // nameplates
    for (const p of this.plates) {
      const hero = p.hero;
      if (!hero.alive) { p.el.style.display = 'none'; continue; }
      this.v.set(hero.pos.x, hero.pos.y + 2.25, hero.pos.z);
      const dist = this.v.distanceTo(camera.position);
      const enemy = hero.team !== h.team;
      if (enemy && dist > 45) { p.el.style.display = 'none'; continue; }
      if (enemy && !g.los(camera.position, this.v)) { p.el.style.display = 'none'; continue; }
      this.v.project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      const x = (this.v.x * 0.5 + 0.5) * W, y = (-this.v.y * 0.5 + 0.5) * H;
      const s = Math.max(0.55, Math.min(1, 14 / dist));
      p.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) scale(${s})`;
      p.bar.style.width = `${(hero.hp / hero.maxHp) * 100}%`;
    }
    // scoreboard
    const sbOn = this.scoreboardOn && g.state !== 'ended';
    this.els.scoreboard.classList.toggle('hidden', !sbOn);
    if (sbOn) this.els.scoreboard.innerHTML = scoreboardHtml(g);
    this.announceTimer -= dt;
  }
}

export function scoreboardHtml(g: Game) {
  const rows = [...g.heroes].sort((a, b) => a.team - b.team || b.stats.kills - a.stats.kills);
  return `<table class="sb-table"><thead><tr><th>Player</th><th>K</th><th>D</th><th>A</th><th>Damage</th><th>Healing</th></tr></thead><tbody>${rows
    .map((h) => `<tr class="t${h.team}${h.isLocal ? ' me' : ''}"><td><div class="hn"><img src="${portraits[h.def.id] ?? ''}"><div>${h.name}<small>${h.def.name}</small></div></div></td><td>${h.stats.kills}</td><td>${h.stats.deaths}</td><td>${h.stats.assists}</td><td>${Math.round(h.stats.damage)}</td><td>${Math.round(h.stats.healing)}</td></tr>`)
    .join('')}</tbody></table>`;
}

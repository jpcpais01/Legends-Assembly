import './subtitles.css';

/** Voice-line subtitles: "YEAT  Tonka time!" stacked above the HUD, newest at the bottom. */
export class Subtitles {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'subs';
    parent.appendChild(this.el);
  }

  show(name: string, color: string, text: string, dur: number) {
    const row = document.createElement('div');
    row.className = 'sub';
    row.style.setProperty('--c', color);
    const b = document.createElement('b');
    b.textContent = name;
    const span = document.createElement('span');
    span.textContent = text;
    row.append(b, span);
    this.el.appendChild(row);
    while (this.el.children.length > 3) this.el.firstElementChild!.remove();
    setTimeout(() => row.classList.add('out'), dur * 1000);
    setTimeout(() => row.remove(), dur * 1000 + 450);
  }

  clear() { this.el.replaceChildren(); }
}

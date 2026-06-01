const STEPS = [
  {
    title: 'Welcome to Pixel Ants',
    body: 'Your queen — the red ant — is the heart of the colony. She lays eggs that hatch into workers, diggers, foragers, and nurses. Keep her fed and she keeps the colony growing.',
  },
  {
    title: 'Drop food on the surface',
    body: 'Click anywhere on the golden surface strip at the top of the ant farm to drop food. Foragers will climb up, collect it, and leave pheromone trails so others follow the same route.',
  },
  {
    title: 'Read the dashboard',
    body: 'Food Store and Water Store are your critical stats. Vitality and Happiness track queen health. The Ant News reports hatches, deaths, and warnings in real time.',
  },
  {
    title: 'Survival mode',   // overwritten at show() time
    body: '',
  },
];

const MODE_STEPS = {
  survival: {
    title: 'Survival mode',
    body: 'The queen can die. If food or water hits zero, her health falls fast. Drop supplies regularly, boost foragers in the ROLES panel, and watch the Ant News for critical warnings.',
  },
  screensaver: {
    title: 'Screensaver mode',
    body: 'Sit back. Food and water replenish automatically, the colony grows indefinitely, and diggers never stop expanding. Put it full-screen and watch a master colony build itself.',
  },
};

const STORAGE_KEY = 'pixelants_tutorial_done';

export class Tutorial {
  constructor() {
    this._step  = 0;
    this._el    = document.getElementById('tutorial');
    this._title = document.getElementById('tut-title');
    this._body  = document.getElementById('tut-body');
    this._dots  = document.getElementById('tut-dots');
    this._next  = document.getElementById('tut-next');
    this._skip  = document.getElementById('tut-skip');

    this._next?.addEventListener('click', () => this._advance());
    this._skip?.addEventListener('click', () => this._done());
    document.addEventListener('keydown', e => {
      if (this._el?.classList.contains('hidden')) return;
      if (e.key === 'Escape') this._done();
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._advance(); }
    });
  }

  show(mode) {
    if (localStorage.getItem(STORAGE_KEY)) return;
    STEPS[3] = MODE_STEPS[mode] ?? MODE_STEPS.screensaver;
    this._step = 0;
    this._render();
    this._el?.classList.remove('hidden');
  }

  _render() {
    const s = STEPS[this._step];
    if (this._title) this._title.textContent = s.title;
    if (this._body)  this._body.textContent  = s.body;
    if (this._dots) {
      this._dots.innerHTML = STEPS.map((_, i) =>
        `<span class="tut-dot${i === this._step ? ' active' : ''}"></span>`
      ).join('');
    }
    if (this._next) {
      this._next.textContent = this._step === STEPS.length - 1 ? 'Got it' : 'Next →';
    }
  }

  _advance() {
    if (this._step < STEPS.length - 1) { this._step++; this._render(); }
    else this._done();
  }

  _done() {
    localStorage.setItem(STORAGE_KEY, '1');
    this._el?.classList.add('hidden');
  }
}

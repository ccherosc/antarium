const STEPS = [
  {
    title: 'Welcome to Pixel Ants',
    body: 'Behind the glass a queen and her first workers are settling in. She lays her eggs in the royal chamber, nurses carry them to the nursery, foragers stock the granaries, and diggers keep extending the nest so the colony has room to grow.',
  },
  {
    title: 'Feed the colony',
    body: 'Click on the grass to drop food, or straight into a tunnel. Pick Water in the TOOLS panel to add water the same way. Foragers carry it home and leave scent trails for the others to follow.',
  },
  {
    title: 'A living world',
    body: 'Days turn into nights: foragers set out at dawn and the nest beds down after dark. Rain sends them below, visitors wander in across the meadow, and once the colony is big enough its winged ants take to the sky.',
  },
  {
    title: 'Read the dashboard',
    body: 'Food Store and Water Store show what is laid by. Vitality and Happiness follow the queen. Nest Capacity is how many ants the tunnels dug so far can house. Ant News reports hatchings, losses and visitors as they happen.',
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
    body: 'Sit back. Leave the mouse alone for a few seconds and the camera sets off on a tour of the nest by itself; move it to take over again. F is full screen, C starts or stops the tour, H hides the panel.',
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
    STEPS[STEPS.length - 1] = MODE_STEPS[mode] ?? MODE_STEPS.screensaver;
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

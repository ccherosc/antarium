const MAX = 7;
const entries = [];
const listeners = [];

// Hear about each event as it is logged
export function onEvent(fn) {
  listeners.push(fn);
}

export function logEvent(msg) {
  if (entries.length && entries[0] === msg) return;
  entries.unshift(msg);
  if (entries.length > MAX) entries.pop();
  _render();
  for (const fn of listeners) fn(msg);
}

function _render() {
  const el = document.getElementById('event-log');
  if (!el) return;
  el.innerHTML = entries.map((msg, i) =>
    `<div class="ev${i === 0 ? ' ev-new' : ''}">${i === 0 ? '&#9654; ' : '&nbsp;&nbsp;'}${msg}</div>`
  ).join('');
}

// Typed game events: on('hatch', fn) hears every emit('hatch', { x, y }), so a system can react
// to what the simulation does without reaching into it.
// type -> registrations. A Map, so a type called 'constructor' is just a name. A list is replaced
// on every change, never edited, so an emit in progress walks the list it started with.
const handlers = new Map();

// Returns a function that removes just this registration. Once it has been called fn is not
// called again, not even by an emit already under way.
export function on(type, fn) {
  const reg = { fn, live: true };
  handlers.set(type, [...(handlers.get(type) || []), reg]);
  return () => {
    reg.live = false;
    handlers.set(type, handlers.get(type).filter(r => r !== reg));
  };
}

// A handler that throws is reported and skipped: one broken listener must not stop the others,
// or the simulation that emitted the event.
export function emit(type, data) {
  const list = handlers.get(type);
  if (!list) return;
  for (const reg of list) {
    if (!reg.live) continue;
    try { reg.fn(data); }
    catch (e) { console.error(`Handler for '${type}' threw:`, e); }
  }
}

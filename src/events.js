const MAX = 7;
const entries = [];

export function logEvent(msg) {
  if (entries.length && entries[0] === msg) return;
  entries.unshift(msg);
  if (entries.length > MAX) entries.pop();
  _render();
}

function _render() {
  const el = document.getElementById('event-log');
  if (!el) return;
  el.innerHTML = entries.map((msg, i) =>
    `<div class="ev${i === 0 ? ' ev-new' : ''}">${i === 0 ? '&#9654; ' : '&nbsp;&nbsp;'}${msg}</div>`
  ).join('');
}

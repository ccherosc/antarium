// What the full-screen dialogs have in common (settingsMenu.js, pauseMenu.js)

// Is one of these overlays showing? They are elements of the page, hidden with the class `hidden`.
export function overlayUp(ids) {
  return ids.some(id => document.getElementById(id)?.classList.contains('hidden') === false);
}

// Tab goes round the dialog, never out to the farm behind it
export function keepFocus(dialog, e) {
  const stops = [...dialog.querySelectorAll('input, select, button')].filter(el => el.offsetParent);
  const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
  if (!dialog.contains(at) || (e.shiftKey && at === first)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (!e.shiftKey && at === last) {
    e.preventDefault();
    first.focus();
  }
}

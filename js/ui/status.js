// Status bar (bottom: tool hints, cursor position) plus a toast at the top of the canvas for
// things the user must not miss — errors and confirmations like "Saved" or "Closed the loop".

const msg = document.getElementById('status-msg');
const cursor = document.getElementById('status-cursor');
const toastEl = document.getElementById('toast');
let toastTimer = null;

// Hint-level message: status bar only. Errors also pop a toast.
export function status(text, isError = false) {
  msg.textContent = text;
  msg.classList.toggle('error', isError);
  if (isError) toast(text, true);
}

// Event-level message: status bar + toast.
export function notify(text, isError = false) {
  msg.textContent = text;
  msg.classList.toggle('error', isError);
  toast(text, isError);
}

function toast(text, isError) {
  toastEl.textContent = text;
  toastEl.classList.toggle('error', isError);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, isError ? 6000 : 3500);
}

export function cursorStatus(text) { cursor.textContent = text; }

// Status bar: one message line on the left, cursor position on the right.

const msg = document.getElementById('status-msg');
const cursor = document.getElementById('status-cursor');

export function status(text, isError = false) {
  msg.textContent = text;
  msg.classList.toggle('error', isError);
}

export function cursorStatus(text) { cursor.textContent = text; }

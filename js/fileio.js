// File System Access API: open and save the house JSON in place (Chrome/Edge only).
// The last file handle is kept in IndexedDB so "Reopen last" works across sessions.

import { migrate, validate } from './model.js';

const PICKER_OPTS = {
  types: [{ description: 'House electrical JSON', accept: { 'application/json': ['.json'] } }],
  excludeAcceptAllOption: false,
};

export const supported = 'showOpenFilePicker' in window;

let currentHandle = null;
export function currentFileName() { return currentHandle?.name ?? null; }
export function clearHandle() { currentHandle = null; }

// --- IndexedDB (tiny key/value store for the handle) ---
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('house-electrical', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kvSet(key, value) {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function kvGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
}

async function ensurePermission(handle, mode) {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}

async function readHandle(handle) {
  const file = await handle.getFile();
  const raw = JSON.parse(await file.text());
  const { doc, readOnly, warning } = migrate(raw);
  const problems = validate(doc);
  currentHandle = handle;
  await kvSet('lastHandle', handle);
  return { doc, readOnly, warning, problems, name: handle.name };
}

export async function openFile() {
  const [handle] = await window.showOpenFilePicker(PICKER_OPTS);
  return readHandle(handle);
}

export async function lastFileName() {
  try { return (await kvGet('lastHandle'))?.name ?? null; } catch { return null; }
}

export async function reopenLast() {
  const handle = await kvGet('lastHandle');
  if (!handle) throw new Error('No recent file.');
  if (!(await ensurePermission(handle, 'readwrite'))) throw new Error('Permission to the file was not granted.');
  return readHandle(handle);
}

function serialize(doc) {
  doc.meta.modified = new Date().toISOString();
  return JSON.stringify(doc, null, 2) + '\n';
}

async function writeHandle(handle, doc) {
  if (!(await ensurePermission(handle, 'readwrite'))) throw new Error('Permission to write the file was not granted.');
  const w = await handle.createWritable();
  await w.write(serialize(doc));
  await w.close();
}

// Save in place; falls back to Save As when no file is open yet. Returns the file name.
export async function saveFile(doc) {
  if (!currentHandle) return saveFileAs(doc);
  await writeHandle(currentHandle, doc);
  return currentHandle.name;
}

export async function saveFileAs(doc) {
  const handle = await window.showSaveFilePicker({
    ...PICKER_OPTS,
    suggestedName: `${(doc.meta.name || 'house').replace(/[^\w\- ]+/g, '').trim() || 'house'}.json`,
  });
  await writeHandle(handle, doc);
  currentHandle = handle;
  await kvSet('lastHandle', handle);
  return handle.name;
}

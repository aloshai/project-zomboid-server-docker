'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const cfg = require('./config');

const ROOT = path.resolve(cfg.ZOMBOID_DIR);

// Resolve a user-supplied relative path against the sandbox root and refuse
// anything that escapes it (path traversal guard).
function resolveSafe(rel) {
  const clean = (rel || '').replace(/^[/\\]+/, '');
  const abs = path.resolve(ROOT, clean);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    throw new Error('Path outside allowed directory');
  }
  return abs;
}

function relOf(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  return rel;
}

async function list(rel) {
  const abs = resolveSafe(rel);
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(abs, e.name);
    let size = 0;
    let mtime = 0;
    try {
      const st = await fsp.stat(full);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      /* ignore unreadable entries */
    }
    out.push({
      name: e.name,
      dir: e.isDirectory(),
      size,
      mtime,
      path: relOf(full)
    });
  }
  out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { cwd: relOf(abs), parent: abs === ROOT ? null : relOf(path.dirname(abs)), entries: out };
}

const MAX_EDIT_BYTES = 2 * 1024 * 1024;

async function readText(rel) {
  const abs = resolveSafe(rel);
  const st = await fsp.stat(abs);
  if (st.isDirectory()) throw new Error('Is a directory');
  if (st.size > MAX_EDIT_BYTES) throw new Error('File too large to edit in browser');
  return fsp.readFile(abs, 'utf8');
}

async function writeText(rel, content) {
  const abs = resolveSafe(rel);
  await fsp.writeFile(abs, content, 'utf8');
}

async function remove(rel) {
  const abs = resolveSafe(rel);
  if (abs === ROOT) throw new Error('Refusing to delete root');
  await fsp.rm(abs, { recursive: true, force: true });
}

async function mkdir(rel) {
  const abs = resolveSafe(rel);
  await fsp.mkdir(abs, { recursive: true });
}

// Returns an absolute path safe for streaming a download.
function downloadPath(rel) {
  return resolveSafe(rel);
}

// Returns a write stream for an uploaded file placed in `relDir`.
function uploadStream(relDir, filename) {
  const safeName = path.basename(filename).replace(/[/\\]/g, '_');
  const absDir = resolveSafe(relDir);
  const abs = path.join(absDir, safeName);
  // Ensure the final path is still inside the sandbox.
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error('Invalid path');
  return { stream: fs.createWriteStream(abs), name: safeName };
}

module.exports = {
  ROOT,
  resolveSafe,
  relOf,
  list,
  readText,
  writeText,
  remove,
  mkdir,
  downloadPath,
  uploadStream
};

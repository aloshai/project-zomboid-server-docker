'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const cfg = require('./config');
const supervisor = require('./supervisor');

const DIR = path.join(cfg.adminStateDir, 'backups');
// Subfolders of the Zomboid data dir worth backing up, if present.
const TARGETS = ['Saves', 'Server', 'db'];

async function ensureDir() {
  await fsp.mkdir(DIR, { recursive: true });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `${cmd} exited ${code}`))));
  });
}

// Create a tar.gz of the existing target folders. Returns the file name.
async function create() {
  await ensureDir();
  const present = [];
  for (const t of TARGETS) {
    try {
      await fsp.access(path.join(cfg.ZOMBOID_DIR, t));
      present.push(t);
    } catch {
      /* skip missing */
    }
  }
  if (!present.length) throw new Error('Nothing to back up yet (no Saves/Server).');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `backup-${ts}.tar.gz`;
  await run('tar', ['czf', path.join(DIR, name), '-C', cfg.ZOMBOID_DIR, ...present]);
  return name;
}

async function list() {
  await ensureDir();
  const files = (await fsp.readdir(DIR)).filter((f) => f.endsWith('.tar.gz'));
  const out = [];
  for (const name of files) {
    const st = await fsp.stat(path.join(DIR, name));
    out.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

function safeName(name) {
  const base = path.basename(name);
  if (!/^backup-[\w.-]+\.tar\.gz$/.test(base)) throw new Error('Invalid backup name');
  return base;
}

function filePath(name) {
  return path.join(DIR, safeName(name));
}

async function remove(name) {
  await fsp.rm(filePath(name), { force: true });
}

// Keep the newest `retention` backups, delete the rest.
async function prune(retention) {
  if (!retention || retention < 1) return;
  const files = await list();
  for (const f of files.slice(retention)) await remove(f.name);
}

// Stop the server, extract the backup over the data dir, start it again.
async function restore(name) {
  const fp = filePath(name);
  await fsp.access(fp);
  await supervisor.stop().catch(() => {});
  await run('tar', ['xzf', fp, '-C', cfg.ZOMBOID_DIR]);
  await supervisor.start();
}

module.exports = { DIR, create, list, remove, prune, restore, filePath };

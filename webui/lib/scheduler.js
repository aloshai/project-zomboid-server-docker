'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const cron = require('node-cron');
const cfg = require('./config');
const supervisor = require('./supervisor');
const pzconsole = require('./console');
const backups = require('./backups');

const CONFIG_PATH = path.join(cfg.adminStateDir, 'schedule.json');

const DEFAULTS = {
  restart: { enabled: false, cron: '0 5 * * *', warnMinutes: 5 },
  backup: { enabled: false, cron: '0 4 * * *', retention: 7 }
};

let state = JSON.parse(JSON.stringify(DEFAULTS));
let jobs = [];

async function load() {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      restart: { ...DEFAULTS.restart, ...(parsed.restart || {}) },
      backup: { ...DEFAULTS.backup, ...(parsed.backup || {}) }
    };
  } catch {
    state = JSON.parse(JSON.stringify(DEFAULTS));
  }
  return state;
}

async function save(next) {
  state = {
    restart: { ...DEFAULTS.restart, ...(next.restart || {}) },
    backup: { ...DEFAULTS.backup, ...(next.backup || {}) }
  };
  await fsp.mkdir(cfg.adminStateDir, { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(state, null, 2), 'utf8');
  reload();
  return state;
}

function get() {
  return state;
}

// Warn players, save the world, then restart the server.
async function doScheduledRestart(warnMinutes) {
  const mins = Math.max(0, parseInt(warnMinutes, 10) || 0);
  try {
    if (mins > 0) {
      await pzconsole.send(`servermsg "Server restarting in ${mins} minute(s)."`);
      // one-minute final warning
      setTimeout(() => pzconsole.send('servermsg "Server restarting in 1 minute."').catch(() => {}), (mins - 1) * 60000);
    }
    setTimeout(async () => {
      try {
        await pzconsole.send('save');
      } catch {
        /* ignore */
      }
      setTimeout(() => supervisor.restart().catch(() => {}), 5000);
    }, mins * 60000);
  } catch {
    // If console isn't reachable, just restart.
    await supervisor.restart().catch(() => {});
  }
}

async function doScheduledBackup(retention) {
  try {
    await backups.create();
    await backups.prune(retention);
  } catch (e) {
    console.error('[pz-admin] scheduled backup failed:', e.message);
  }
}

function reload() {
  for (const j of jobs) j.stop();
  jobs = [];

  if (state.restart.enabled && cron.validate(state.restart.cron)) {
    jobs.push(cron.schedule(state.restart.cron, () => doScheduledRestart(state.restart.warnMinutes)));
  }
  if (state.backup.enabled && cron.validate(state.backup.cron)) {
    jobs.push(cron.schedule(state.backup.cron, () => doScheduledBackup(state.backup.retention)));
  }
}

async function start() {
  await load();
  reload();
}

module.exports = { start, load, save, get, reload, validate: cron.validate };

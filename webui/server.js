'use strict';

const path = require('path');
const fsp = require('fs/promises');
const express = require('express');
const session = require('express-session');
const Busboy = require('busboy');

const cfg = require('./lib/config');
const auth = require('./lib/auth');
const ini = require('./lib/ini');
const sandbox = require('./lib/sandbox');
const supervisor = require('./lib/supervisor');
const pzconsole = require('./lib/console');
const workshop = require('./lib/workshop');
const stats = require('./lib/stats');
const files = require('./lib/files');
const backups = require('./lib/backups');
const scheduler = require('./lib/scheduler');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '4mb' }));
app.use(express.json({ limit: '4mb' }));
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use(
  session({
    name: 'pzadmin.sid',
    secret: cfg.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  })
);

app.use((req, res, next) => {
  res.locals.serverName = cfg.SERVERNAME;
  res.locals.restartPending = req.session ? !!req.session.restartPending : false;
  res.locals.path = req.path;
  next();
});

async function readFileOrNull(p) {
  try {
    return await fsp.readFile(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function splitList(value) {
  return (value || '')
    .split(/[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- Auth ----------
app.get('/login', (req, res) => {
  res.render('login', { error: null, noPassword: !cfg.adminPassword });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (auth.check(username, password)) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.status(401).render('login', { error: 'Invalid credentials', noPassword: !cfg.adminPassword });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use(auth.requireAuth);

// ---------- Dashboard ----------
app.get('/', async (req, res, next) => {
  try {
    const st = await supervisor.status();
    res.render('dashboard', { status: st, cpus: stats.numCpus });
  } catch (e) {
    next(e);
  }
});

app.post('/server/:action', async (req, res) => {
  const action = req.params.action;
  const map = { start: supervisor.start, stop: supervisor.stop, restart: supervisor.restart };
  if (!map[action]) return res.status(400).send('Unknown action');
  try {
    const out = await map[action]();
    if (action === 'restart' || action === 'start') req.session.restartPending = false;
    req.session.flash = `Server ${action}: ${out || 'ok'}`;
  } catch (e) {
    req.session.flash = `Error: ${e.message}`;
  }
  res.redirect('/');
});

// Send an admin console command to the running server.
app.post('/console', async (req, res) => {
  try {
    const line = await pzconsole.send(req.body.command);
    res.json({ ok: true, line });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Live log stream (SSE).
app.get('/logs/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  const child = supervisor.tailLog((chunk) => {
    for (const line of chunk.split('\n')) res.write(`data: ${line}\n\n`);
  });
  req.on('close', () => {
    try { child.kill(); } catch (_) { /* ignore */ }
  });
});

// Resource stats history (CPU/RAM) for the dashboard chart.
app.get('/api/stats', (req, res) => {
  res.json({ cpus: stats.numCpus, history: stats.history() });
});

// ---------- Server .ini settings ----------
app.get('/settings/server', async (req, res, next) => {
  try {
    const text = await readFileOrNull(cfg.iniPath);
    if (text === null) return res.render('server', { missing: true, pairs: [], raw: '' });
    const entries = ini.parse(text);
    res.render('server', { missing: false, pairs: ini.pairs(entries), raw: text });
  } catch (e) {
    next(e);
  }
});

app.post('/settings/server', async (req, res, next) => {
  try {
    const text = await readFileOrNull(cfg.iniPath);
    if (text === null) return res.status(409).send('Config not generated yet. Start the server once.');
    const entries = ini.parse(text);
    ini.applyValues(entries, req.body);
    await fsp.writeFile(cfg.iniPath, ini.serialize(entries), 'utf8');
    req.session.restartPending = true;
    req.session.flash = 'Server settings saved. Restart to apply.';
    res.redirect('/settings/server');
  } catch (e) {
    next(e);
  }
});

// ---------- Sandbox settings ----------
app.get('/settings/sandbox', async (req, res, next) => {
  try {
    const text = await readFileOrNull(cfg.sandboxPath);
    if (text === null) return res.render('sandbox', { missing: true, fields: [], parseError: null, raw: '' });
    try {
      const root = sandbox.parse(text);
      res.render('sandbox', { missing: false, fields: sandbox.fields(root), parseError: null, raw: text });
    } catch (pe) {
      res.render('sandbox', { missing: false, fields: [], parseError: pe.message, raw: text });
    }
  } catch (e) {
    next(e);
  }
});

app.post('/settings/sandbox', async (req, res, next) => {
  try {
    if (req.body.__raw !== undefined) {
      await fsp.writeFile(cfg.sandboxPath, req.body.__raw, 'utf8');
    } else {
      const text = await readFileOrNull(cfg.sandboxPath);
      if (text === null) return res.status(409).send('Config not generated yet. Start the server once.');
      const root = sandbox.parse(text);
      sandbox.applyValues(root, req.body);
      await fsp.writeFile(cfg.sandboxPath, sandbox.serialize(root), 'utf8');
    }
    req.session.restartPending = true;
    req.session.flash = 'Sandbox settings saved. Restart to apply.';
    res.redirect('/settings/sandbox');
  } catch (e) {
    next(e);
  }
});

// ---------- Mods / Workshop ----------
app.get('/mods', async (req, res, next) => {
  try {
    const text = await readFileOrNull(cfg.iniPath);
    const entries = text === null ? null : ini.parse(text);
    const get = (k) => {
      if (!entries) return '';
      const e = entries.find((x) => x.type === 'kv' && x.key === k);
      return e ? e.value : '';
    };
    const activeMods = splitList(get('Mods'));
    const activeWorkshop = splitList(get('WorkshopItems'));

    const installed = await workshop.scanInstalled();
    const detailIds = Array.from(new Set([...activeWorkshop, ...installed.map((i) => i.workshopId)]));
    const details = await workshop.fetchDetails(detailIds);

    res.render('mods', {
      missing: text === null,
      activeMods,
      activeWorkshop,
      installed,
      details
    });
  } catch (e) {
    next(e);
  }
});

app.post('/mods', async (req, res, next) => {
  try {
    const text = await readFileOrNull(cfg.iniPath);
    if (text === null) return res.status(409).send('Config not generated yet. Start the server once.');
    const entries = ini.parse(text);
    ini.applyValues(entries, {
      Mods: splitList(req.body.mods).join(';'),
      WorkshopItems: splitList(req.body.workshop).join(';')
    });
    await fsp.writeFile(cfg.iniPath, ini.serialize(entries), 'utf8');
    req.session.restartPending = true;
    req.session.flash = 'Mods saved. Restart to download new Workshop items and apply.';
    res.redirect('/mods');
  } catch (e) {
    next(e);
  }
});

// ---------- Backups & schedule ----------
app.get('/backups', async (req, res, next) => {
  try {
    res.render('backups', { list: await backups.list(), schedule: scheduler.get() });
  } catch (e) {
    next(e);
  }
});

app.post('/backups/create', async (req, res) => {
  try {
    const name = await backups.create();
    req.session.flash = `Backup created: ${name}`;
  } catch (e) {
    req.session.flash = `Backup failed: ${e.message}`;
  }
  res.redirect('/backups');
});

app.post('/backups/restore', async (req, res) => {
  try {
    await backups.restore(req.body.name);
    req.session.flash = `Restored ${req.body.name}. Server restarting.`;
  } catch (e) {
    req.session.flash = `Restore failed: ${e.message}`;
  }
  res.redirect('/backups');
});

app.post('/backups/delete', async (req, res) => {
  try {
    await backups.remove(req.body.name);
    req.session.flash = `Deleted ${req.body.name}`;
  } catch (e) {
    req.session.flash = `Delete failed: ${e.message}`;
  }
  res.redirect('/backups');
});

app.get('/backups/download', async (req, res, next) => {
  try {
    res.download(backups.filePath(req.query.name));
  } catch (e) {
    next(e);
  }
});

app.post('/schedule', async (req, res) => {
  try {
    await scheduler.save({
      restart: {
        enabled: req.body.restartEnabled === 'on' || req.body.restartEnabled === 'true',
        cron: req.body.restartCron,
        warnMinutes: parseInt(req.body.restartWarn, 10) || 0
      },
      backup: {
        enabled: req.body.backupEnabled === 'on' || req.body.backupEnabled === 'true',
        cron: req.body.backupCron,
        retention: parseInt(req.body.backupRetention, 10) || 7
      }
    });
    req.session.flash = 'Schedule saved.';
  } catch (e) {
    req.session.flash = `Schedule error: ${e.message}`;
  }
  res.redirect('/backups');
});

// ---------- File manager ----------
app.get('/files', async (req, res, next) => {
  try {
    res.render('files', { listing: await files.list(req.query.path || ''), edit: null });
  } catch (e) {
    next(e);
  }
});

app.get('/files/edit', async (req, res, next) => {
  try {
    const content = await files.readText(req.query.path);
    res.render('files', { listing: null, edit: { path: req.query.path, content } });
  } catch (e) {
    next(e);
  }
});

app.post('/files/save', async (req, res, next) => {
  try {
    await files.writeText(req.body.path, req.body.content);
    req.session.flash = `Saved ${req.body.path}`;
    res.redirect('/files/edit?path=' + encodeURIComponent(req.body.path));
  } catch (e) {
    next(e);
  }
});

app.post('/files/delete', async (req, res, next) => {
  try {
    await files.remove(req.body.path);
    req.session.flash = `Deleted ${req.body.path}`;
    res.redirect('/files?path=' + encodeURIComponent(req.body.parent || ''));
  } catch (e) {
    next(e);
  }
});

app.post('/files/mkdir', async (req, res, next) => {
  try {
    const target = (req.body.parent ? req.body.parent + '/' : '') + req.body.name;
    await files.mkdir(target);
    res.redirect('/files?path=' + encodeURIComponent(req.body.parent || ''));
  } catch (e) {
    next(e);
  }
});

app.get('/files/download', (req, res, next) => {
  try {
    res.download(files.downloadPath(req.query.path));
  } catch (e) {
    next(e);
  }
});

app.post('/files/upload', (req, res) => {
  const dir = req.query.path || '';
  let bb;
  try {
    bb = Busboy({ headers: req.headers, limits: { fileSize: 200 * 1024 * 1024 } });
  } catch (e) {
    return res.status(400).send(e.message);
  }
  let pending = 0;
  let done = false;
  const finish = () => {
    if (done && pending === 0) {
      req.session.flash = 'Upload complete.';
      res.redirect('/files?path=' + encodeURIComponent(dir));
    }
  };
  bb.on('file', (name, file, info) => {
    try {
      const { stream } = files.uploadStream(dir, info.filename);
      pending++;
      file.pipe(stream);
      stream.on('close', () => {
        pending--;
        finish();
      });
    } catch (e) {
      file.resume();
      res.status(400).send(e.message);
    }
  });
  bb.on('close', () => {
    done = true;
    finish();
  });
  req.pipe(bb);
});

// ---------- Errors + flash ----------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: err.message });
  res.status(500).send(`Error: ${err.message}`);
});

const origRender = app.response.render;
app.response.render = function (view, opts, cb) {
  const o = opts || {};
  if (this.req.session && this.req.session.flash) {
    o.flash = this.req.session.flash;
    delete this.req.session.flash;
  } else {
    o.flash = o.flash || null;
  }
  return origRender.call(this, view, o, cb);
};

if (require.main === module) {
  if (!cfg.adminPassword) {
    console.warn('[pz-admin] WARNING: UI_ADMIN_PASSWORD is not set — login is disabled until you set it.');
  }
  stats.start();
  scheduler.start().catch((e) => console.error('[pz-admin] scheduler start failed:', e.message));
  app.listen(cfg.port, () => {
    console.log(`[pz-admin] listening on :${cfg.port} (server "${cfg.SERVERNAME}")`);
  });
}

module.exports = app;

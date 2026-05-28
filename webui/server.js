'use strict';

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const express = require('express');
const session = require('express-session');

const cfg = require('./lib/config');
const auth = require('./lib/auth');
const ini = require('./lib/ini');
const sandbox = require('./lib/sandbox');
const supervisor = require('./lib/supervisor');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
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

// Make a "restart required" flag and server name available to all views.
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

// Everything below requires auth.
app.use(auth.requireAuth);

// ---------- Dashboard ----------
app.get('/', async (req, res, next) => {
  try {
    const st = await supervisor.status();
    res.render('dashboard', { status: st });
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

// Live log stream (SSE).
app.get('/logs/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  const child = supervisor.tailLog((chunk) => {
    for (const line of chunk.split('\n')) {
      res.write(`data: ${line}\n\n`);
    }
  });
  req.on('close', () => {
    try { child.kill(); } catch (_) { /* ignore */ }
  });
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
      // Fall back to raw editor on parse failure.
      res.render('sandbox', { missing: false, fields: [], parseError: pe.message, raw: text });
    }
  } catch (e) {
    next(e);
  }
});

app.post('/settings/sandbox', async (req, res, next) => {
  try {
    if (req.body.__raw !== undefined) {
      // Raw editor save.
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
// Accepts both the .ini form (semicolon-separated) and the textarea form
// (newline-separated) and normalises to a clean array.
function splitList(value) {
  return (value || '')
    .split(/[;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

app.get('/mods', async (req, res, next) => {
  try {
    const text = await readFileOrNull(cfg.iniPath);
    if (text === null) return res.render('mods', { missing: true, mods: [], workshop: [] });
    const entries = ini.parse(text);
    const get = (k) => {
      const e = entries.find((x) => x.type === 'kv' && x.key === k);
      return e ? e.value : '';
    };
    res.render('mods', {
      missing: false,
      mods: splitList(get('Mods')),
      workshop: splitList(get('WorkshopItems'))
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
    const mods = splitList(req.body.mods).join(';');
    const workshop = splitList(req.body.workshop).join(';');
    ini.applyValues(entries, { Mods: mods, WorkshopItems: workshop });
    await fsp.writeFile(cfg.iniPath, ini.serialize(entries), 'utf8');
    req.session.restartPending = true;
    req.session.flash = 'Mods saved. Restart to download new Workshop items and apply.';
    res.redirect('/mods');
  } catch (e) {
    next(e);
  }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send(`Error: ${err.message}`);
});

// Inject flash into render locals.
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
  app.listen(cfg.port, () => {
    console.log(`[pz-admin] listening on :${cfg.port} (server "${cfg.SERVERNAME}")`);
  });
}

module.exports = app;

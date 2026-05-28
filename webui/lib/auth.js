'use strict';

const crypto = require('crypto');
const cfg = require('./config');

// Constant-time string compare that tolerates length differences.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still spend time to avoid trivial length leak.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function check(username, password) {
  if (!cfg.adminPassword) return false; // refuse login if no password configured
  return safeEqual(username, cfg.adminUser) && safeEqual(password, cfg.adminPassword);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (req.path.startsWith('/api/') || req.get('accept') === 'text/event-stream') {
    return res.status(401).end();
  }
  return res.redirect('/login');
}

module.exports = { check, requireAuth };

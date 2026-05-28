'use strict';

const { execFile, spawn } = require('child_process');
const cfg = require('./config');

function ctl(args) {
  return new Promise((resolve, reject) => {
    execFile('supervisorctl', args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr || stdout || err.message).trim()));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// Returns { state, raw } e.g. { state: 'RUNNING', raw: '...' }.
async function status() {
  try {
    const raw = await ctl(['status', cfg.pzProgram]);
    const m = raw.match(/^\S+\s+(\w+)/);
    return { state: m ? m[1] : 'UNKNOWN', raw };
  } catch (e) {
    // supervisorctl exits non-zero when a program is stopped; still parse it.
    const raw = e.message || '';
    const m = raw.match(/^\S+\s+(\w+)/);
    return { state: m ? m[1] : 'UNKNOWN', raw };
  }
}

const start = () => ctl(['start', cfg.pzProgram]);
const stop = () => ctl(['stop', cfg.pzProgram]);
const restart = () => ctl(['restart', cfg.pzProgram]);

// Streams the tail of the server log. Returns the spawned process so the caller
// can kill it when the client disconnects. `onLine` gets each text chunk.
function tailLog(onData) {
  const child = spawn('tail', ['-n', '300', '-F', cfg.logPath]);
  child.stdout.on('data', (d) => onData(d.toString()));
  child.stderr.on('data', (d) => onData(d.toString()));
  return child;
}

module.exports = { status, start, stop, restart, tailLog };

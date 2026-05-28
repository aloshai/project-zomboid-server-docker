'use strict';

const fsp = require('fs/promises');
const cfg = require('./config');

// Sends a single admin command to the running game server by appending a line
// to its stdin FIFO. CR/LF are collapsed so one call sends exactly one command.
async function send(command) {
  const line = String(command).replace(/[\r\n]+/g, ' ').trim();
  if (!line) throw new Error('Empty command');
  // Opening the FIFO for append succeeds immediately because the server holds
  // it open read-write; the write delivers the line to the server's stdin.
  await fsp.appendFile(cfg.stdinPath, line + '\n');
  return line;
}

module.exports = { send };

'use strict';

const path = require('path');

// Root of the Zomboid data folder (lives in the named volume on Dokploy).
const ZOMBOID_DIR = process.env.ZOMBOID_DIR || '/home/steam/Zomboid';

// Server name decides the config file names. Matches entry.sh default.
const SERVERNAME = process.env.SERVERNAME && process.env.SERVERNAME.trim()
  ? process.env.SERVERNAME.trim()
  : 'servertest';

const SERVER_DIR = path.join(ZOMBOID_DIR, 'Server');

module.exports = {
  ZOMBOID_DIR,
  SERVERNAME,
  SERVER_DIR,
  iniPath: path.join(SERVER_DIR, `${SERVERNAME}.ini`),
  sandboxPath: path.join(SERVER_DIR, `${SERVERNAME}_SandboxVars.lua`),
  // supervisord writes the game server stdout here (see config/supervisord.conf).
  logPath: process.env.PZ_LOG_PATH || '/var/log/supervisor/pzserver-stdout.log',
  port: parseInt(process.env.UI_PORT || '8080', 10),
  adminUser: process.env.UI_ADMIN_USER || 'admin',
  adminPassword: process.env.UI_ADMIN_PASSWORD || '',
  sessionSecret: process.env.UI_SESSION_SECRET || 'change-me-please',
  // Name of the supervisord program controlling the game server.
  pzProgram: process.env.PZ_PROGRAM || 'pzserver',
  // FIFO used as the game server stdin (see scripts/launch_pz.sh).
  stdinPath: process.env.PZ_STDIN || '/tmp/pz-stdin',
  // Steam workshop content for Project Zomboid (app 108600) inside the image.
  workshopDir:
    process.env.PZ_WORKSHOP_DIR ||
    '/home/steam/pz-dedicated/steamapps/workshop/content/108600',
  // Where panel state (schedule, backups) is persisted, inside the data volume.
  adminStateDir: process.env.PZ_ADMIN_DIR || `${ZOMBOID_DIR}/.pz-admin`,
  // Optional Steam Web API key to enable Workshop keyword search.
  steamApiKey: process.env.STEAM_API_KEY || ''
};

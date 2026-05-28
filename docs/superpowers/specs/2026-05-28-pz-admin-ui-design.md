# Project Zomboid Server — Web Admin UI

Date: 2026-05-28

## Goal

A simple web UI bundled with the dedicated server image so the operator can edit
server settings, sandbox/game settings, and mods, and start/stop/restart the
server with live log viewing — without editing files by hand or rebuilding.

## Constraints

- Deployed on Dokploy. No bind-mounting local repo files into the container;
  config lives inside the `zomboid-data` named volume at
  `/home/steam/Zomboid/Server/`.
- Game traffic is raw UDP/TCP (no domain routing possible). The UI is HTTP, so it
  *can* and does go through Traefik with a domain + TLS.

## Architecture

Single container, `supervisord` as PID 1 managing two programs:

- `pzserver` — the existing `start-server.sh` (args computed by `entry.sh`),
  runs as the `steam` user.
- `webui` — Node.js / Express app on port `8080`, runs as the `steam` user so
  config files stay `steam`-owned.

`entry.sh` keeps doing one-time bootstrap (steamclient.so fix, optional force
update, locale, permission fixups, first-run admin/server-name) then writes a
`launch_pz.sh` with the computed server args and `exec`s `supervisord`.

The `supervisord` unix socket is chowned to `steam` so the web UI can drive
`supervisorctl` (start/stop/restart/status) without root or docker.sock.

### Ports

- Game: `16261/udp`, `16262/udp`, `27015/tcp` — exposed via Traefik UDP/TCP
  entrypoints (existing setup).
- UI: `8080/tcp` — exposed via Traefik HTTP router with `Host(${UI_DOMAIN})` + TLS.

## Components

### Web UI (Express + EJS, server-rendered)

- **Auth:** single admin (`UI_ADMIN_USER` / `UI_ADMIN_PASSWORD` from env),
  `express-session` cookie. All routes behind auth except `/login` and static.
- **Pages:** Login · Dashboard (status + start/stop/restart + live log via SSE) ·
  Server Settings (`.ini`) · Sandbox Settings (`SandboxVars.lua`) · Mods/Workshop.

### Config parsers (`webui/lib`)

- `ini.js` — parse `servertest.ini` into ordered entries (kv / raw), serialize
  back preserving order and comments; update by key.
- `sandbox.js` — recursive parser for the `SandboxVars = { ... }` Lua table
  (numbers, booleans, strings, nested tables), preserving key order; serialize
  back to clean valid Lua. Type inference drives form widgets
  (number → number input, boolean → select true/false, string → text).
  Parse failure → raw-editor fallback.
- `supervisor.js` — `supervisorctl` wrapper for status/start/stop/restart and a
  `tail -F` based SSE log stream.
- `config.js` — resolves file paths from `SERVERNAME` / `ZOMBOID_DIR`.

## Data flow

Edit form → POST → validate/coerce by original type → write file → set
"restart required" banner → operator clicks Restart → `supervisorctl restart
pzserver` → server reloads config from disk.

## Config source of truth

Env vars are used only for **first-run bootstrap** (admin password, server name).
The per-boot `Mods=` / `WorkshopItems=` sed-injection in `entry.sh` is removed so
the UI is the single source of truth for mods after the server has run once.

## Error handling

- Config files missing (server never started) → "start the server once to
  generate config" empty state.
- Lua parse error → raw editor fallback for that file.
- Restart/supervisor errors → surface stderr in the UI.

## Testing

- Unit tests (`node:test`) for `ini.js` and `sandbox.js` round-trips: parse →
  serialize → re-parse yields an equivalent structure.
- Manual: run the container, change settings, restart, confirm the server picks
  up the new values.

## Out of scope (YAGNI)

- Multiple users / roles.
- In-game RCON command console (restart via supervisor is enough for v1).
- Editing `spawnregions.lua` (handled automatically by the existing map script).

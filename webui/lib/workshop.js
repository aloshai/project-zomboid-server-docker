'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const cfg = require('./config');

// Parse a PZ mod.info file (simple key=value lines) into an object.
function parseModInfo(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key === 'id') (out.ids = out.ids || []).push(val);
    else if (!(key in out)) out[key] = val;
  }
  return out;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

// Scan installed Workshop items and the Mod IDs / maps each one provides.
// Returns: [{ workshopId, name, mods: [{id, name}], maps: [string] }]
async function scanInstalled() {
  const root = cfg.workshopDir;
  if (!(await exists(root))) return [];

  const items = [];
  const ids = (await fsp.readdir(root, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const workshopId of ids) {
    const modsDir = path.join(root, workshopId, 'mods');
    const item = { workshopId, name: workshopId, mods: [], maps: [] };
    if (await exists(modsDir)) {
      const modFolders = (await fsp.readdir(modsDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      for (const folder of modFolders) {
        const infoPath = path.join(modsDir, folder, 'mod.info');
        if (await exists(infoPath)) {
          const info = parseModInfo(await fsp.readFile(infoPath, 'utf8'));
          const modIds = info.ids && info.ids.length ? info.ids : [folder];
          for (const id of modIds) item.mods.push({ id, name: info.name || id });
          if (info.name && item.name === workshopId) item.name = info.name;
        }
        // Detect bundled maps
        const mapsDir = path.join(modsDir, folder, 'media', 'maps');
        if (await exists(mapsDir)) {
          const maps = (await fsp.readdir(mapsDir, { withFileTypes: true }))
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
          item.maps.push(...maps);
        }
      }
    }
    items.push(item);
  }
  return items;
}

// Fetch public details (title, preview image) for Workshop IDs. No API key
// required. Returns a map: { [id]: { title, preview } }.
async function fetchDetails(ids) {
  const result = {};
  const list = (ids || []).filter(Boolean);
  if (!list.length) return result;
  try {
    const body = new URLSearchParams();
    body.set('itemcount', String(list.length));
    list.forEach((id, i) => body.set(`publishedfileids[${i}]`, id));
    const res = await fetch(
      'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
      { method: 'POST', body, signal: AbortSignal.timeout(8000) }
    );
    const json = await res.json();
    for (const d of json?.response?.publishedfiledetails || []) {
      result[d.publishedfileid] = {
        title: d.title || d.publishedfileid,
        preview: d.preview_url || ''
      };
    }
  } catch {
    /* network/details optional — fall back to bare IDs */
  }
  return result;
}

module.exports = { parseModInfo, scanInstalled, fetchDetails };

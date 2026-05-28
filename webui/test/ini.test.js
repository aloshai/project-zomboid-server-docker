'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ini = require('../lib/ini');

const sample = [
  '# Server config',
  'PVP=true',
  'PauseEmpty=true',
  'GlobalChat=true',
  'Mods=',
  'WorkshopItems=',
  'MaxPlayers=16',
  '',
  '# end'
].join('\n') + '\n';

test('parse preserves comments and blanks as raw', () => {
  const entries = ini.parse(sample);
  assert.equal(entries[0].type, 'raw');
  assert.equal(entries[0].raw, '# Server config');
  const kv = entries.find((e) => e.type === 'kv' && e.key === 'MaxPlayers');
  assert.equal(kv.value, '16');
});

test('round-trip is identical for an untouched file', () => {
  const entries = ini.parse(sample);
  assert.equal(ini.serialize(entries), sample);
});

test('applyValues updates only known keys and keeps order', () => {
  const entries = ini.parse(sample);
  ini.applyValues(entries, { PVP: 'false', MaxPlayers: '32', Unknown: 'x' });
  const out = ini.serialize(entries);
  assert.match(out, /PVP=false/);
  assert.match(out, /MaxPlayers=32/);
  assert.doesNotMatch(out, /Unknown/);
  // order preserved: PVP still before MaxPlayers
  assert.ok(out.indexOf('PVP=') < out.indexOf('MaxPlayers='));
});

test('pairs returns only kv entries', () => {
  const entries = ini.parse(sample);
  const p = ini.pairs(entries);
  assert.ok(p.every((x) => typeof x.key === 'string'));
  assert.ok(p.some((x) => x.key === 'WorkshopItems'));
});

test('handles empty values', () => {
  const entries = ini.parse('Mods=\nWorkshopItems=\n');
  ini.applyValues(entries, { Mods: 'A;B' });
  assert.match(ini.serialize(entries), /Mods=A;B/);
  assert.match(ini.serialize(entries), /WorkshopItems=\n/);
});

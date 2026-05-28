'use strict';

const test = require('node:test');
const assert = require('node:assert');
const sandbox = require('../lib/sandbox');

const sample = `SandboxVars = {
\tVERSION = 5,
\tZombies = 3,
\tDistribution = 1,
\tDayLength = 3,
\tStartYear = 1,
\tWaterShutModifier = 14,
\tXpMultiplier = 1.0,
\tPVP = true,
\tName = "My Server",
\tMap = {
\t\tAllowMiniMap = false,
\t\tAllowWorldMap = true,
\t\tMapAllKnown = false,
\t},
\tZombieConfig = {
\t\tSpeed = 2,
\t\tStrength = 2,
\t},
}
`;

test('parse reads scalars and nested tables', () => {
  const root = sandbox.parse(sample);
  const get = (k) => root.find((e) => e.key === k);
  assert.equal(get('Zombies').value, 3);
  assert.equal(get('Zombies').kind, 'number');
  assert.equal(get('XpMultiplier').value, 1.0);
  assert.equal(get('PVP').value, true);
  assert.equal(get('PVP').kind, 'boolean');
  assert.equal(get('Name').value, 'My Server');
  assert.equal(get('Name').kind, 'string');
  assert.equal(get('Map').kind, 'table');
  assert.equal(get('Map').value.find((e) => e.key === 'AllowWorldMap').value, true);
});

test('round-trip: parse -> serialize -> parse yields equivalent structure', () => {
  const root1 = sandbox.parse(sample);
  const text2 = sandbox.serialize(root1);
  const root2 = sandbox.parse(text2);
  assert.deepEqual(root2, root1);
});

test('serialized output is parseable and starts with SandboxVars', () => {
  const root = sandbox.parse(sample);
  const out = sandbox.serialize(root);
  assert.match(out, /^SandboxVars = \{/);
  assert.doesNotThrow(() => sandbox.parse(out));
});

test('fields flattens leaves with section paths', () => {
  const root = sandbox.parse(sample);
  const f = sandbox.fields(root);
  const map = f.find((x) => x.path === 'Map.AllowMiniMap');
  assert.ok(map);
  assert.equal(map.section, 'Map');
  assert.equal(map.kind, 'boolean');
  const top = f.find((x) => x.path === 'Zombies');
  assert.equal(top.section, '');
});

test('applyValues coerces by original kind', () => {
  const root = sandbox.parse(sample);
  sandbox.applyValues(root, {
    Zombies: '4',
    PVP: 'false',
    'Map.AllowMiniMap': 'true',
    'ZombieConfig.Speed': '1',
    Name: 'Renamed'
  });
  const get = (k) => root.find((e) => e.key === k);
  assert.strictEqual(get('Zombies').value, 4);
  assert.strictEqual(get('PVP').value, false);
  assert.strictEqual(get('Name').value, 'Renamed');
  assert.strictEqual(get('Map').value.find((e) => e.key === 'AllowMiniMap').value, true);
  assert.strictEqual(get('ZombieConfig').value.find((e) => e.key === 'Speed').value, 1);
});

test('tolerates comments and trailing separators', () => {
  const withComments = `SandboxVars = {
\t-- a comment
\tZombies = 3, -- inline
\tName = "x";
}
`;
  const root = sandbox.parse(withComments);
  assert.equal(root.find((e) => e.key === 'Zombies').value, 3);
  assert.equal(root.find((e) => e.key === 'Name').value, 'x');
});

test('negative and decimal numbers', () => {
  const root = sandbox.parse('SandboxVars = {\n\tA = -2,\n\tB = 0.5,\n\tC = .25,\n}\n');
  assert.equal(root.find((e) => e.key === 'A').value, -2);
  assert.equal(root.find((e) => e.key === 'B').value, 0.5);
  assert.equal(root.find((e) => e.key === 'C').value, 0.25);
});

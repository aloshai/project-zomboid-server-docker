'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Point the sandbox root somewhere deterministic before loading the module.
process.env.ZOMBOID_DIR = process.platform === 'win32' ? 'C:\\pz-root' : '/pz-root';
const files = require('../lib/files');

test('resolveSafe allows paths inside the root', () => {
  const abs = files.resolveSafe('Server/servertest.ini');
  assert.ok(abs.startsWith(files.ROOT));
  assert.equal(path.basename(abs), 'servertest.ini');
});

test('resolveSafe allows the root itself', () => {
  assert.equal(files.resolveSafe(''), files.ROOT);
});

test('resolveSafe rejects traversal with ..', () => {
  assert.throws(() => files.resolveSafe('../etc/passwd'), /outside/);
  assert.throws(() => files.resolveSafe('Server/../../etc/passwd'), /outside/);
});

test('resolveSafe strips leading slashes (no absolute escape)', () => {
  const abs = files.resolveSafe('/Server/x');
  assert.ok(abs.startsWith(files.ROOT));
});

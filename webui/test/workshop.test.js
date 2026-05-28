'use strict';

const test = require('node:test');
const assert = require('node:assert');
const workshop = require('../lib/workshop');

test('parseModInfo extracts id(s) and name', () => {
  const info = workshop.parseModInfo(
    'name=Cool Mod\nid=CoolModID\nposter=poster.png\ndescription=stuff'
  );
  assert.equal(info.name, 'Cool Mod');
  assert.deepEqual(info.ids, ['CoolModID']);
});

test('parseModInfo supports multiple ids', () => {
  const info = workshop.parseModInfo('name=Pack\nid=ModA\nid=ModB\n');
  assert.deepEqual(info.ids, ['ModA', 'ModB']);
});

test('parseModInfo ignores comments and blanks', () => {
  const info = workshop.parseModInfo('# comment\n\nname=X\nid=Y\n');
  assert.equal(info.name, 'X');
  assert.deepEqual(info.ids, ['Y']);
});

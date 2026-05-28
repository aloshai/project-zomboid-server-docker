'use strict';

// Tolerant parser/serializer for Project Zomboid `SandboxVars.lua`.
//
// The file is a single Lua table assigned to `SandboxVars`, e.g.:
//
//   SandboxVars = {
//       VERSION = 5,
//       Zombies = 3,
//       Map = {
//           AllowMiniMap = false,
//       },
//   }
//
// We parse it into an ordered tree of { key, kind, value } nodes so the UI can
// render typed form fields, then serialize back to clean, valid Lua. The server
// only needs valid Lua assigning the table, so we normalise formatting.

function isIdentStart(c) {
  return /[A-Za-z_]/.test(c);
}
function isIdent(c) {
  return /[A-Za-z0-9_]/.test(c);
}

function skipWs(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
    } else if (c === '-' && s[i + 1] === '-') {
      // Block comment --[[ ... ]] or line comment -- ...
      if (s[i + 2] === '[' && s[i + 3] === '[') {
        const end = s.indexOf(']]', i + 4);
        i = end === -1 ? s.length : end + 2;
      } else {
        const nl = s.indexOf('\n', i + 2);
        i = nl === -1 ? s.length : nl + 1;
      }
    } else {
      break;
    }
  }
  return i;
}

function parseString(s, i) {
  const quote = s[i];
  i++;
  let out = '';
  while (i < s.length && s[i] !== quote) {
    if (s[i] === '\\') {
      out += s[i + 1];
      i += 2;
    } else {
      out += s[i];
      i++;
    }
  }
  return { value: out, kind: 'string', i: i + 1 };
}

function parseKey(s, i) {
  i = skipWs(s, i);
  if (s[i] === '[') {
    // ["name"] or [123]
    i = skipWs(s, i + 1);
    let key;
    if (s[i] === '"' || s[i] === "'") {
      const r = parseString(s, i);
      key = r.value;
      i = r.i;
    } else {
      let j = i;
      while (j < s.length && s[j] !== ']') j++;
      key = s.slice(i, j).trim();
      i = j;
    }
    i = skipWs(s, i);
    if (s[i] === ']') i++;
    return { key, i };
  }
  let j = i;
  if (!isIdentStart(s[j])) return null;
  while (j < s.length && isIdent(s[j])) j++;
  return { key: s.slice(i, j), i: j };
}

function parseValue(s, i) {
  i = skipWs(s, i);
  const c = s[i];
  if (c === '{') {
    return parseTable(s, i);
  }
  if (c === '"' || c === "'") {
    return parseString(s, i);
  }
  // boolean / nil
  if (s.startsWith('true', i)) return { value: true, kind: 'boolean', i: i + 4 };
  if (s.startsWith('false', i)) return { value: false, kind: 'boolean', i: i + 5 };
  if (s.startsWith('nil', i)) return { value: null, kind: 'nil', i: i + 3 };
  // number
  const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s.slice(i));
  if (m) {
    return { value: Number(m[0]), kind: 'number', i: i + m[0].length };
  }
  throw new Error(`SandboxVars: cannot parse value at offset ${i}: "${s.slice(i, i + 20)}"`);
}

function parseTable(s, i) {
  i = skipWs(s, i);
  if (s[i] !== '{') throw new Error(`SandboxVars: expected '{' at offset ${i}`);
  i++;
  const entries = [];
  while (true) {
    i = skipWs(s, i);
    if (s[i] === '}') {
      i++;
      break;
    }
    if (i >= s.length) throw new Error('SandboxVars: unexpected end of input');

    const k = parseKey(s, i);
    if (!k) throw new Error(`SandboxVars: expected key at offset ${i}`);
    i = skipWs(s, k.i);
    if (s[i] !== '=') throw new Error(`SandboxVars: expected '=' after key "${k.key}"`);
    i++;
    const v = parseValue(s, i);
    i = v.i;
    entries.push({ key: k.key, kind: v.kind, value: v.value });

    i = skipWs(s, i);
    if (s[i] === ',' || s[i] === ';') i++;
  }
  return { value: entries, kind: 'table', i };
}

// Parse the whole file. Returns the ordered root entries array.
function parse(text) {
  const idx = text.indexOf('SandboxVars');
  if (idx === -1) throw new Error('SandboxVars table not found');
  let i = idx + 'SandboxVars'.length;
  i = skipWs(text, i);
  if (text[i] !== '=') throw new Error("SandboxVars: expected '=' after name");
  i++;
  const t = parseTable(text, i);
  return t.value;
}

function serializeValue(node, depth) {
  if (node.kind === 'table') {
    return serializeTable(node.value, depth);
  }
  if (node.kind === 'boolean') return node.value ? 'true' : 'false';
  if (node.kind === 'nil') return 'nil';
  if (node.kind === 'string') return JSON.stringify(node.value);
  return String(node.value); // number
}

function serializeTable(entries, depth) {
  const pad = '\t'.repeat(depth + 1);
  const closePad = '\t'.repeat(depth);
  const body = entries
    .map((e) => `${pad}${e.key} = ${serializeValue(e, depth + 1)},`)
    .join('\n');
  return `{\n${body}\n${closePad}}`;
}

function serialize(root) {
  return `SandboxVars = ${serializeTable(root, 0)}\n`;
}

// Flatten the tree into form fields. Nested tables become a "section".
// Returns [{ path, label, section, kind, value }] for leaf (non-table) nodes.
function fields(root) {
  const out = [];
  function walk(entries, prefix, section) {
    for (const e of entries) {
      const path = prefix ? `${prefix}.${e.key}` : e.key;
      if (e.kind === 'table') {
        walk(e.value, path, prefix ? section : e.key);
      } else if (e.kind !== 'nil') {
        out.push({
          path,
          label: e.key,
          section: section || '',
          kind: e.kind,
          value: e.value
        });
      }
    }
  }
  walk(root, '', '');
  return out;
}

// Apply a { dottedPath: stringValue } map onto the tree, coercing by kind.
function applyValues(root, values) {
  function walk(entries, prefix) {
    for (const e of entries) {
      const path = prefix ? `${prefix}.${e.key}` : e.key;
      if (e.kind === 'table') {
        walk(e.value, path);
      } else if (Object.prototype.hasOwnProperty.call(values, path)) {
        const raw = values[path];
        if (e.kind === 'number') {
          const n = Number(raw);
          if (!Number.isNaN(n)) e.value = n;
        } else if (e.kind === 'boolean') {
          e.value = raw === 'true' || raw === true || raw === 'on';
        } else if (e.kind === 'string') {
          e.value = String(raw);
        }
      }
    }
  }
  walk(root, '');
  return root;
}

module.exports = { parse, serialize, fields, applyValues };

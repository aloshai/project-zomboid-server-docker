'use strict';

// Parser/serializer for the Project Zomboid server .ini file.
// The format is flat `key=value` lines with `#` comments. We keep every line as
// an ordered entry so comments, blanks and ordering survive a round-trip.

function parse(text) {
  const lines = text.split(/\r?\n/);
  // Drop a single trailing empty line produced by a final newline.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  return lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      return { type: 'raw', raw: line };
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      return { type: 'raw', raw: line };
    }
    return {
      type: 'kv',
      key: line.slice(0, eq),
      value: line.slice(eq + 1)
    };
  });
}

function serialize(entries) {
  return entries
    .map((e) => (e.type === 'kv' ? `${e.key}=${e.value}` : e.raw))
    .join('\n') + '\n';
}

// Returns an ordered list of { key, value } for rendering a form.
function pairs(entries) {
  return entries.filter((e) => e.type === 'kv').map((e) => ({ key: e.key, value: e.value }));
}

// Applies a { key: value } map onto the parsed entries, in place, by key.
function applyValues(entries, values) {
  for (const e of entries) {
    if (e.type === 'kv' && Object.prototype.hasOwnProperty.call(values, e.key)) {
      e.value = String(values[e.key]);
    }
  }
  return entries;
}

module.exports = { parse, serialize, pairs, applyValues };

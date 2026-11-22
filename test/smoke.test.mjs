import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = (rel) => JSON.parse(readFileSync(root + rel, 'utf8'));

test('plugin manifest identifies darkforge 0.1.0 under MIT', () => {
  const m = readJson('.claude-plugin/plugin.json');
  assert.equal(m.name, 'darkforge');
  assert.equal(m.version, '0.1.0');
  assert.equal(m.license, 'MIT');
});

test('marketplace lists the darkforge plugin first', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.equal(m.plugins[0].name, 'darkforge');
});

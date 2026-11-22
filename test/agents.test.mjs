import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'agents');
const NAMES = ['builder', 'specialist', 'reviewer', 'security-reviewer', 'scaffolder', 'verifier'];

function parse(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  assert.ok(m, 'frontmatter present');
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return fm;
}

test('all six agent files exist', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, NAMES.map((n) => `${n}.md`).sort());
});

for (const n of NAMES) {
  const text = () => readFileSync(join(dir, `${n}.md`), 'utf8');
  test(`${n}: frontmatter name and description`, () => {
    const fm = parse(text());
    assert.equal(fm.name, n);
    assert.ok(fm.description && fm.description.length > 10);
  });
  test(`${n}: no forbidden words, under size budget`, () => {
    const t = text().toLowerCase();
    for (const w of ['fable', 'dark clipboard', 'darkshot', 'clipboard', 'cargo']) {
      assert.ok(!t.includes(w), `${n} contains "${w}"`);
    }
    assert.ok(Buffer.byteLength(t) <= 2800, `${n} is ${Buffer.byteLength(t)} bytes`);
  });
}

for (const n of ['reviewer', 'security-reviewer']) {
  test(`${n}: read-only tools`, () => {
    const fm = parse(readFileSync(join(dir, `${n}.md`), 'utf8'));
    assert.ok(fm.tools, 'tools declared');
    for (const t of ['Edit', 'Write', 'NotebookEdit']) {
      assert.ok(!fm.tools.split(/[,\s]+/).includes(t), `${n} has ${t}`);
    }
  });
}

test('no js fixtures under test/', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
  const bad = walk(join(root, 'test')).filter((f) => /fixtures/.test(f) && /\.(js|mjs|cjs)$/.test(f));
  assert.deepEqual(bad, []);
});

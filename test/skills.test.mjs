import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'skills');
// Per code.claude.com/docs/en/skills: `user-invocable` defaults to true; `false` hides the skill from the / menu.
const USER = ['init', 'plan-phase', 'next-task', 'phase-review', 'status'];
const MODEL_ONLY = ['grill', 'task-package-writing', 'model-routing'];
const FORBIDDEN = ['fable', 'dark clipboard', 'darkshot', 'clipboard'];
const MAX_BYTES = 4600;

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

const read = (n) => readFileSync(join(dir, n, 'SKILL.md'), 'utf8');

test('exactly the eight skills exist', () => {
  const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepEqual(names, [...USER, ...MODEL_ONLY].sort());
  for (const n of names) assert.ok(existsSync(join(dir, n, 'SKILL.md')), `${n}/SKILL.md`);
});

for (const n of [...USER, ...MODEL_ONLY]) {
  test(`${n}: name and description`, () => {
    const fm = parse(read(n));
    assert.equal(fm.name, n);
    assert.ok(fm.description && fm.description.length > 20, 'description says when to use it');
  });
  test(`${n}: no forbidden words, owner language, size budget`, () => {
    const text = read(n);
    const lower = text.toLowerCase();
    for (const w of FORBIDDEN) assert.ok(!lower.includes(w), `${n} contains "${w}"`);
    assert.ok(text.includes('ownerLanguage'), `${n} does not mention ownerLanguage`);
    assert.ok(Buffer.byteLength(text) <= MAX_BYTES, `${n} is ${Buffer.byteLength(text)} bytes`);
  });
}

for (const n of USER) {
  test(`${n}: user-invocable`, () => {
    assert.equal(parse(read(n))['user-invocable'], 'true');
  });
}

for (const n of MODEL_ONLY) {
  test(`${n}: not user-invocable`, () => {
    assert.equal(parse(read(n))['user-invocable'], 'false');
  });
}

test('next-task: same implementer via SendMessage, ledger phases, task start/merge', () => {
  const t = read('next-task');
  for (const s of ['SendMessage', 'ledger phase implement', 'ledger phase review', 'ledger phase fix',
    'ledger phase orchestrator', 'task start', 'task merge', 'memory lint', 'ledger report', 'model-routing']) {
    assert.ok(t.includes(s), `next-task lacks "${s}"`);
  }
});

test('hooks.json registers session-brief on SessionStart in exec form', () => {
  const h = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8'));
  const entry = h.hooks.SessionStart?.[0]?.hooks?.[0];
  assert.ok(entry, 'SessionStart entry');
  assert.equal(entry.type, 'command');
  assert.equal(entry.command, 'node');
  assert.deepEqual(entry.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/session-brief.mjs']);
});

test('specialist points to the reviewer method inside the plugin', () => {
  assert.ok(readFileSync(join(root, 'agents', 'specialist.md'), 'utf8').includes('${CLAUDE_PLUGIN_ROOT}/agents/reviewer.md'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../hooks/session-brief.mjs', import.meta.url));

function project({ config, state } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'darkforge brief '));
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.darkforge'));
    fs.writeFileSync(path.join(dir, '.darkforge', 'config.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  if (state) fs.writeFileSync(path.join(dir, '.darkforge', 'state.json'), JSON.stringify(state));
  return dir;
}

function runHook(cwd, input) {
  const stdin = input === undefined ? JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd }) : input;
  return spawnSync(process.execPath, [hook], { cwd, input: stdin, encoding: 'utf8' });
}

function context(r) {
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  return out.hookSpecificOutput.additionalContext.split('\n');
}

test('no config: silent exit 0', () => {
  const r = runHook(project());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('malformed stdin: silent exit 0', () => {
  const r = runHook(project({ config: { schemaVersion: 1 } }), 'not json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('config with active task: three lines with project, task, skills', () => {
  const r = runHook(project({ config: { schemaVersion: 1, project: { name: 'demo' } }, state: { task: '007', phase: 'review' } }));
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  const lines = context(r);
  assert.ok(lines.length <= 3, `${lines.length} lines`);
  assert.equal(lines[0], 'darkforge project: demo');
  assert.equal(lines[1], 'current task: 007');
  assert.match(lines[2], /\/darkforge:status/);
  assert.match(lines[2], /\/darkforge:next-task/);
});

test('config without state: current task none', () => {
  const lines = context(runHook(project({ config: { schemaVersion: 1, project: { name: 'demo' } } })));
  assert.equal(lines[1], 'current task: none');
});

test('subdirectory of a project finds the config', () => {
  const dir = project({ config: { schemaVersion: 1, project: { name: 'demo' } } });
  const sub = path.join(dir, 'src');
  fs.mkdirSync(sub);
  assert.equal(context(runHook(sub))[0], 'darkforge project: demo');
});

test('invalid config: one darkforge stderr line, no context, exit 0', () => {
  for (const config of [{ schemaVersion: 2 }, '{ broken']) {
    const r = runHook(project({ config }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const lines = r.stderr.split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, r.stderr);
    assert.match(lines[0], /^darkforge: /);
  }
});

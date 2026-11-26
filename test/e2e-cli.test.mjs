// End-to-end run of the mechanical layer: the real CLI and hooks as child processes, in a real git
// repository, local merge mode (no remote, no gh). The skills' judgment steps are covered by the
// manual checklist in docs/testing/e2e-checklist.md; this test covers everything they call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
const CLI = path.join(PLUGIN, "scripts", "darkforge.mjs");
const HOOK = (name) => path.join(PLUGIN, "hooks", `${name}.mjs`);
const SUBAGENT_TRANSCRIPT = path.join(PLUGIN, "test", "fixtures", "transcripts", "subagent.jsonl");

function sh(cmd, args, cwd, input) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: "utf8" });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const df = (cwd, ...args) => sh(process.execPath, [CLI, ...args], cwd);
const hook = (name, cwd, input) => sh(process.execPath, [HOOK(name)], cwd, JSON.stringify(input));
const git = (cwd, ...args) => {
  const r = sh("git", args, cwd);
  assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.err}`);
  return r.out.trim();
};

/** Temp dir removed when the test ends. */
function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("e2e (local merge): init, brief, start, guard, ledger, lint, gate, merge, report", (t) => {
  const root = tmp(t, "df e2e ");
  // Empty template and hooks dirs: global git templates or hooks on a developer machine must not interfere.
  const noHooks = tmp(t, "df hooks ");
  git(root, "init", "-q", "--template=");
  git(root, "config", "core.hooksPath", noHooks);
  git(root, "symbolic-ref", "HEAD", "refs/heads/main");
  git(root, "config", "user.name", "t");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(root, "check.js"), 'console.log("lint ok");\nconsole.log("ALL CHECKS PASSED");\n');
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");

  // init apply from answers (what /darkforge:init writes after the interview)
  const answers = path.join(tmp(t, "df answers "), "answers.json");
  fs.writeFileSync(
    answers,
    JSON.stringify({
      config: {
        project: { name: "e2e demo" },
        gate: { command: { windows: "node check.js", unix: "node check.js" } },
        models: { banned: ["fable"] },
        git: { remote: null, prFlow: false },
      },
    }),
  );
  let r = df(root, "init", "apply", "--answers", answers);
  assert.equal(r.code, 0, r.err);
  for (const f of [".darkforge/config.json", "memory-bank/activeContext.md", "memory-bank/progress.md", "CLAUDE.md", ".gitignore"]) {
    assert.ok(fs.existsSync(path.join(root, f)), `${f} written`);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "darkforge init");
  assert.equal(df(root, "memory", "lint").out, "memory: ok\n");

  // session brief names the project and no current task
  r = hook("session-brief", root, { session_id: "s1", cwd: root, hook_event_name: "SessionStart", source: "startup" });
  assert.equal(r.code, 0, r.err);
  const brief = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(brief, /darkforge project: e2e demo/);
  assert.match(brief, /current task: none/);

  // task start
  r = df(root, "task", "start", "001", "demo");
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(git(root, "branch", "--show-current"), "task/001-demo");

  // model guard: banned model denied, routed darkforge call allowed
  const agent = (tool_input) => hook("model-guard", root, { session_id: "s1", cwd: root, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input });
  r = agent({ subagent_type: "general-purpose", prompt: "x", model: "fable" });
  const deny = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(deny.permissionDecision, "deny");
  assert.match(deny.permissionDecisionReason, /banned/);
  r = agent({ subagent_type: "darkforge:builder", prompt: "x", model: "sonnet" });
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes('"deny"'), r.out);

  // implementer finishes: ledger records its tokens under task 001, phase implement
  assert.equal(df(root, "ledger", "phase", "implement").code, 0);
  r = hook("ledger", root, {
    session_id: "s1",
    cwd: root,
    hook_event_name: "SubagentStop",
    agent_type: "darkforge:builder",
    agent_transcript_path: SUBAGENT_TRANSCRIPT,
    transcript_path: SUBAGENT_TRANSCRIPT,
  });
  assert.equal(r.code, 0, r.err);

  // the work and the memory bank, committed on the task branch
  fs.writeFileSync(path.join(root, "feature.txt"), "x\n");
  fs.appendFileSync(path.join(root, "memory-bank", "progress.md"), "| 001 | task/001-demo | builder | sonnet | done | - |\n");
  const ac = path.join(root, "memory-bank", "activeContext.md");
  fs.writeFileSync(ac, fs.readFileSync(ac, "utf8").replace("## Where we are\n", "## Where we are\n\nTask 001 done.\n"));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "task 001");
  assert.equal(df(root, "memory", "lint").out, "memory: ok\n");

  // merge refuses before the gate, then the gate passes on this commit and the merge lands
  r = df(root, "task", "merge", "001", "--title", "Demo");
  assert.notEqual(r.code, 0);
  assert.match(r.out + r.err, /gate has not passed/);
  r = df(root, "gate");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^ALL CHECKS PASSED$/m);
  r = df(root, "task", "merge", "001", "--title", "Demo");
  assert.equal(r.code, 0, r.out + r.err);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "branch", "--list", "task/001-demo"), "", "merged task branch deleted");
  assert.ok(fs.existsSync(path.join(root, "feature.txt")));
  assert.equal(git(root, "status", "--porcelain"), "", "tree clean after merge");

  // ledger report lists the task; brief shows no current task again
  r = df(root, "ledger", "report");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\s*001\b/m);
  r = hook("session-brief", root, { session_id: "s2", cwd: root, hook_event_name: "SessionStart", source: "startup" });
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /current task: none/);
});

test("e2e: outside a darkforge project every hook is silent", (t) => {
  const dir = tmp(t, "df plain ");
  for (const [name, input] of [
    ["session-brief", { session_id: "s", cwd: dir, hook_event_name: "SessionStart" }],
    ["model-guard", { session_id: "s", cwd: dir, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input: { subagent_type: "x", model: "fable" } }],
    ["ledger", { session_id: "s", cwd: dir, hook_event_name: "Stop", transcript_path: SUBAGENT_TRANSCRIPT }],
  ]) {
    const r = hook(name, dir, input);
    assert.equal(r.code, 0, `${name}: ${r.err}`);
    assert.equal(r.out, "", `${name} printed ${r.out}`);
  }
  assert.ok(!fs.existsSync(path.join(dir, ".darkforge")));
});

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

test("e2e (local merge): init, brief, begin, guard and dispatch phase, ledger, finish, report", (t) => {
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
  // a task package, as plan-phase writes it
  fs.mkdirSync(path.join(root, "docs", "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "tasks", "001-demo.md"),
    "# Task 001: Demo\n\nAgent: builder · Model: sonnet · Branch: task/001-demo · Reviewer: reviewer/opus · Risk: medium\n",
  );
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "darkforge init");
  assert.equal(df(root, "memory", "lint").out, "memory: ok\n");

  // session brief names the project and no current task
  r = hook("session-brief", root, { session_id: "s1", cwd: root, hook_event_name: "SessionStart", source: "startup" });
  assert.equal(r.code, 0, r.err);
  const brief = JSON.parse(r.out).hookSpecificOutput.additionalContext;
  assert.match(brief, /darkforge project: e2e demo/);
  assert.match(brief, /current task: none/);

  // task begin: reads the package header, starts the branch, prints who does what
  r = df(root, "task", "begin", "001");
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /^implementer: darkforge:builder model sonnet$/m);
  assert.match(r.out, /^reviewer: darkforge:reviewer model opus$/m);
  assert.equal(git(root, "branch", "--show-current"), "task/001-demo");
  const phase = () => JSON.parse(fs.readFileSync(path.join(root, ".darkforge", "state.json"), "utf8")).phase;

  // model guard: banned model denied; allowed darkforge dispatches set the ledger phase
  const agent = (tool_input) => hook("model-guard", root, { session_id: "s1", cwd: root, hook_event_name: "PreToolUse", tool_name: "Agent", tool_input });
  r = agent({ subagent_type: "general-purpose", prompt: "x", model: "fable" });
  const deny = JSON.parse(r.out).hookSpecificOutput;
  assert.equal(deny.permissionDecision, "deny");
  assert.match(deny.permissionDecisionReason, /banned/);
  r = agent({ subagent_type: "darkforge:reviewer", prompt: "x", model: "opus" });
  assert.equal(r.code, 0);
  assert.ok(!r.out.includes('"deny"'), r.out);
  assert.equal(phase(), "review");
  r = agent({ subagent_type: "darkforge:builder", prompt: "x", model: "sonnet" });
  assert.equal(phase(), "implement");

  // implementer finishes: ledger records its tokens under task 001, phase implement
  r = hook("ledger", root, {
    session_id: "s1",
    cwd: root,
    hook_event_name: "SubagentStop",
    agent_type: "darkforge:builder",
    agent_transcript_path: SUBAGENT_TRANSCRIPT,
    transcript_path: SUBAGENT_TRANSCRIPT,
  });
  assert.equal(r.code, 0, r.err);

  // the implementer's commit; the memory bank edited by the main session and left for task finish
  fs.writeFileSync(path.join(root, "feature.txt"), "x\n");
  git(root, "add", "feature.txt");
  git(root, "commit", "-q", "-m", "task 001");
  fs.appendFileSync(path.join(root, "memory-bank", "progress.md"), "| 001 | task/001-demo | builder | sonnet | done | - |\n");
  const ac = path.join(root, "memory-bank", "activeContext.md");
  fs.writeFileSync(ac, fs.readFileSync(ac, "utf8").replace("## Where we are\n", "## Where we are\n\nTask 001 done.\n"));

  // task finish: tokens into progress.md, memory-bank commit, lint, gate, merge, ledger row
  r = df(root, "task", "finish", "001", "--title", "Demo");
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^memory: ok$/m);
  assert.match(r.out, /^ALL CHECKS PASSED$/m);
  assert.match(r.out, /^tokens 001: implement [1-9]\d* /m);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "branch", "--list", "task/001-demo"), "", "merged task branch deleted");
  assert.ok(fs.existsSync(path.join(root, "feature.txt")));
  assert.match(fs.readFileSync(path.join(root, "memory-bank", "progress.md"), "utf8"), /\| 001 \| task\/001-demo \| builder \| sonnet \| done \| [1-9]\d* \|/);
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

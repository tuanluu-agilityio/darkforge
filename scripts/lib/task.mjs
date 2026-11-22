// Task start and merge: the git/gh sequence around one task branch.
// merge is the last safety net before code lands on the base branch: every precondition is
// checked before any push, PR or merge command, and any failing step stops the sequence.
import { findProjectRoot, loadConfig } from "./config.mjs";
import { run } from "./exec.mjs";
import { gateFresh } from "./gate.mjs";
import { lintMemory } from "./memory.mjs";
import { writeState } from "./state.mjs";

const ID_RE = /^[A-Za-z0-9]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MEMORY_FILES = ["memory-bank/progress.md", "memory-bank/activeContext.md"];
const NO_REQUIRED_RE = /no required checks/i;
const NO_CHECKS_RE = /no checks reported/i;
const CHECK_RETRIES = 3;
const CHECK_RETRY_MS = 10_000;

const realSleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let sleep = realSleep;
/** Replace the synchronous sleep used between CI-check retries (tests). */
export function setSleep(fn) {
  sleep = fn;
}
export function resetSleep() {
  sleep = realSleep;
}

class Stop extends Error {}

const fail = (message) => ({ ok: false, message });
const output = (r) => [r.stdout, r.stderr].map((s) => (s ?? "").trim()).filter(Boolean).join("\n");

/** Run a git/gh step; a non-zero exit throws Stop with the step and its output. */
function step(root, cmd, args) {
  const r = run(cmd, args, { cwd: root });
  if (r.code !== 0) {
    const detail = output(r) || `exit ${r.code}`;
    throw new Stop(`${cmd} ${args[0]}${args[1] && !args[1].startsWith("-") ? " " + args[1] : ""} failed:\n${detail}`);
  }
  return r;
}

function config(root) {
  const loaded = loadConfig(root);
  if (!loaded.ok) throw new Stop(loaded.error);
  const git = loaded.config.git;
  // These values become git/gh arguments: refuse anything git could read as an option.
  const bad = (v) => typeof v !== "string" || v === "" || v.startsWith("-");
  if (bad(git.baseBranch)) {
    throw new Stop(`invalid git.baseBranch "${git.baseBranch}" in .darkforge/config.json: must be non-empty and not start with "-"`);
  }
  if (git.remote !== null && bad(git.remote)) {
    throw new Stop(`invalid git.remote "${git.remote}" in .darkforge/config.json: must be null, or non-empty and not start with "-"`);
  }
  return git;
}

function validId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Stop(`invalid id "${id ?? ""}": use letters and digits only`);
}

/** Create task/<id>-<slug> from the (remote) base branch and mark the task active. */
export function startTask(root, id, slug) {
  try {
    validId(id);
    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      throw new Stop(`invalid slug "${slug ?? ""}": use lowercase words joined by single hyphens`);
    }
    const git = config(root);
    const branch = `task/${id}-${slug}`;

    const status = step(root, "git", ["status", "--porcelain", "--", ".", ":(exclude).darkforge"]);
    if (status.stdout.trim()) throw new Stop(`working tree has uncommitted changes; commit or stash them first:\n${status.stdout.trimEnd()}`);

    if (git.remote) step(root, "git", ["fetch", "--prune", git.remote]);
    const local = step(root, "git", ["branch", "--list", `task/${id}-*`]).stdout.trim();
    const remote = git.remote ? step(root, "git", ["branch", "-r", "--list", `${git.remote}/task/${id}-*`]).stdout.trim() : "";
    const existing = [local, remote].filter(Boolean).join("\n");
    if (existing) throw new Stop(`task ${id} already exists:\n${existing}`);

    const from = git.remote ? `${git.remote}/${git.baseBranch}` : git.baseBranch;
    step(root, "git", ["switch", "-c", branch, from]);
    writeState(root, { task: id, phase: "implement", lastTask: null });
    return { ok: true, message: `on ${branch} (from ${from}); task ${id} phase implement` };
  } catch (e) {
    if (e instanceof Stop) return fail(e.message);
    throw e;
  }
}

function prBody(id, title, shortSha) {
  return [`Task ${id}: ${title}`, "", `Gate: passed on ${shortSha}`, "Memory bank updated", "", "Merged with darkforge"].join("\n");
}

/** PR number from `gh pr create` output: last path segment of the last line (or of an "already exists" URL). */
function prNumber(r) {
  if (r.code === 0) {
    const last = r.stdout.trim().split(/\r?\n/).at(-1) ?? "";
    const n = last.trim().replace(/\/+$/, "").split("/").at(-1);
    return /^\d+$/.test(n) ? n : null;
  }
  if (/already exists/i.test(output(r))) {
    const m = output(r).match(/\/pull\/(\d+)\s*$/m);
    return m ? m[1] : null;
  }
  return null;
}

/** Refuse unless all merge preconditions hold. Returns the branch name and the gated full SHA. */
function checkPreconditions(root, git, id) {
  const branch = step(root, "git", ["branch", "--show-current"]).stdout.trim();
  if (!branch.startsWith(`task/${id}-`) || branch.length === `task/${id}-`.length) {
    throw new Stop(`refused: not on a task/${id}-* branch (current: ${branch || "detached HEAD"})`);
  }
  if (!gateFresh(root)) {
    throw new Stop("refused: gate has not passed on this commit with a clean tree; run `darkforge gate` after committing");
  }
  const head = step(root, "git", ["rev-parse", "HEAD"]).stdout.trim();
  const base = git.remote ? `${git.remote}/${git.baseBranch}` : git.baseBranch;
  const changed = step(root, "git", ["diff", "--name-only", `${base}...HEAD`]).stdout.split(/\r?\n/).map((l) => l.trim());
  const missing = MEMORY_FILES.filter((f) => !changed.includes(f));
  if (missing.length) {
    throw new Stop(`refused: memory bank not updated on this branch (vs ${base}); missing: ${missing.join(", ")}`);
  }
  const lint = lintMemory(root);
  if (!lint.ok) throw new Stop(`refused: memory lint failed:\n${lint.problems.join("\n")}`);
  return { branch, head };
}

/**
 * Wait for the PR's required checks. "no required checks" on stderr: the repo requires none, continue.
 * "no checks reported" right after PR creation can mean CI has not started yet: retry; if it never
 * reports, continue only when config.git.requiredChecks is empty. Any other failure stops.
 */
function waitForChecks(root, git, n) {
  for (let attempt = 0; ; attempt++) {
    const r = run("gh", ["pr", "checks", n, "--watch", "--required"], { cwd: root });
    if (r.code === 0) return;
    const err = r.stderr ?? "";
    if (NO_REQUIRED_RE.test(err)) return;
    if (!NO_CHECKS_RE.test(err)) {
      throw new Stop(`checks did not pass for PR #${n}; not merged:\n${output(r) || `exit ${r.code}`}`);
    }
    if (attempt < CHECK_RETRIES) {
      sleep(CHECK_RETRY_MS);
      continue;
    }
    if (git.requiredChecks.length) {
      throw new Stop(
        `no checks reported for PR #${n} after ${CHECK_RETRIES} retries; expected required checks: ${git.requiredChecks.join(", ")}; not merged`,
      );
    }
    return;
  }
}

/**
 * Merge the current task branch into the base branch (PR flow or local), then clear the task state.
 * `lastTask` keeps the id so the next Stop hook still attributes this turn's orchestrator tokens to it.
 */
export function mergeTask(root, id, { title } = {}) {
  let merged = null; // set once the merge has landed; later failures are cleanup failures
  try {
    validId(id);
    if (typeof title !== "string" || !title.trim()) throw new Stop("a non-empty --title is required");
    const git = config(root);
    const { branch, head } = checkPreconditions(root, git, id);
    const base = git.baseBranch;

    if (!git.prFlow || !git.remote) {
      step(root, "git", ["switch", base]);
      try {
        step(root, "git", ["merge", "--no-ff", branch, "-m", `Merge ${branch}`]);
      } catch (e) {
        throw new Stop(`${e.message}\nrun "git merge --abort" to undo the partial merge`);
      }
      writeState(root, { task: null, phase: null, lastTask: id });
      return { ok: true, message: `merged ${branch} into ${base} (local, no push)` };
    }

    const shortSha = head.slice(0, 7);
    step(root, "git", ["push", git.remote, branch]);
    const created = run("gh", ["pr", "create", "--base", base, "--head", branch, "--title", title.trim(), "--body", prBody(id, title.trim(), shortSha)], { cwd: root });
    const n = prNumber(created);
    if (!n) {
      const what = created.code === 0 ? "cannot read the PR number from gh output" : "gh pr create failed";
      throw new Stop(`${what}:\n${output(created) || `exit ${created.code}`}`);
    }
    const method = `--${git.mergeMethod}`;
    // Pin the merge to the gated commit: GitHub refuses it if the branch head moved after the gate.
    const pin = ["--match-head-commit", head];

    if (git.autoMerge) {
      step(root, "gh", ["pr", "merge", n, method, "--delete-branch", "--auto", ...pin]);
      writeState(root, { task: null, phase: null, lastTask: id });
      return { ok: true, message: `auto-merge enabled for PR #${n}; it merges when required checks pass` };
    }

    waitForChecks(root, git, n);
    step(root, "gh", ["pr", "merge", n, method, "--delete-branch", ...pin]);
    merged = n;
    writeState(root, { task: null, phase: null, lastTask: id });

    step(root, "git", ["switch", base]);
    step(root, "git", ["pull", "--ff-only", git.remote, base]);
    // gh pr merge --delete-branch may already have removed the local branch.
    if (step(root, "git", ["branch", "--list", branch]).stdout.trim()) step(root, "git", ["branch", "-d", branch]);
    return { ok: true, message: `PR #${n} merged into ${base}; on ${base}, up to date` };
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    return fail(merged ? `PR #${merged} merged, but local cleanup failed:\n${e.message}` : e.message);
  }
}

const USAGE = 'usage: darkforge task start <id> <slug>\n       darkforge task merge <id> --title "<title>"\n';

/** CLI handler: darkforge task start|merge ... */
export async function taskCommand(args, ctx) {
  const [sub, id, ...rest] = args;
  let call;
  if (sub === "start" && id && rest.length === 1) {
    call = (root) => startTask(root, id, rest[0]);
  } else if (sub === "merge" && id && rest.length === 2 && rest[0] === "--title") {
    call = (root) => mergeTask(root, id, { title: rest[1] });
  } else {
    ctx.stderr(USAGE);
    return 1;
  }
  const root = findProjectRoot(ctx.cwd);
  if (!root) {
    ctx.stderr("error: no .darkforge/config.json found; run /darkforge:init\n");
    return 1;
  }
  const r = call(root);
  (r.ok ? ctx.stdout : ctx.stderr)(r.message + "\n");
  return r.ok ? 0 : 1;
}

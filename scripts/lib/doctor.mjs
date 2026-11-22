import { run } from "./exec.mjs";
import { findProjectRoot, loadConfig } from "./config.mjs";

const first = (s) => String(s).trim().split(/\r?\n/)[0];

export function doctor(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const lines = [];
  let ok = true;

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 18) lines.push(`ok: node ${process.versions.node}`);
  else {
    ok = false;
    lines.push(`fail: node ${process.versions.node} is too old (need >= 18)`);
  }

  const git = run("git", ["--version"]);
  if (git.code === 0) lines.push(`ok: ${first(git.stdout) || "git"}`);
  else {
    ok = false;
    lines.push(`fail: git not available (${first(git.stderr) || "exit " + git.code})`);
  }

  const gh = run("gh", ["--version"]);
  const ghOk = gh.code === 0;
  if (ghOk) lines.push(`ok: ${first(gh.stdout) || "gh"}`);
  else lines.push(`warn: gh not available; PR flow will not work (${first(gh.stderr) || "exit " + gh.code})`);

  const root = findProjectRoot(cwd);
  if (!root) {
    lines.push("info: no .darkforge/config.json found (run init)");
    return { ok, lines };
  }
  const loaded = loadConfig(root);
  if (!loaded.ok) {
    lines.push(`warn: config problem: ${loaded.error}`);
    return { ok, lines };
  }
  const cfg = loaded.config;

  if (cfg.git.prFlow && ghOk) {
    const auth = run("gh", ["auth", "status"]);
    if (auth.code === 0) lines.push("ok: gh auth status");
    else lines.push("warn: gh auth status failed; run `gh auth login`");
  }

  for (const entry of cfg.models.banned) {
    if (typeof entry !== "string") continue;
    if (/^\d+$/.test(entry) || entry.toLowerCase() === "claude") {
      lines.push(`warn: models.banned entry ${JSON.stringify(entry)} would block almost every model`);
    }
  }
  return { ok, lines };
}

import { spawnSync } from "node:child_process";

const real = {
  run(cmd, args = [], opts = {}) {
    return normalize(spawnSync(cmd, args, { cwd: opts.cwd, input: opts.input, encoding: "utf8", windowsHide: true }));
  },
  runShell(command, opts = {}) {
    return normalize(spawnSync(command, { cwd: opts.cwd, input: opts.input, encoding: "utf8", shell: true, windowsHide: true }));
  },
};

function normalize(r) {
  if (r.error) {
    const missing = r.error.code === "ENOENT";
    return { code: missing ? 127 : r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr || r.error.message };
  }
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let runner = null;

/** Replace the subprocess runner (tests). fake(cmdOrCommand, args, opts) => {code, stdout, stderr}. */
export function setRunner(fake) {
  runner = fake;
}
export function resetRunner() {
  runner = null;
}

export function run(cmd, args = [], opts = {}) {
  return runner ? runner(cmd, args, opts) : real.run(cmd, args, opts);
}

export function runShell(command, opts = {}) {
  return runner ? runner(command, [], { ...opts, shell: true }) : real.runShell(command, opts);
}

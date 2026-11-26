import { test } from "node:test";
import assert from "node:assert/strict";
import { main, commands } from "../scripts/darkforge.mjs";
import { run, runShell, setRunner, resetRunner } from "../scripts/lib/exec.mjs";

const capture = () => {
  const out = { stdout: "", stderr: "" };
  return { out, ctx: { cwd: process.cwd(), stdout: (s) => (out.stdout += s), stderr: (s) => (out.stderr += s) } };
};

test("unknown command prints usage on stderr and exits 2", async () => {
  const { out, ctx } = capture();
  assert.equal(await main(["bogus"], ctx), 2);
  assert.match(out.stderr, /usage/i);
});

test("no command exits 2", async () => {
  const { ctx } = capture();
  assert.equal(await main([], ctx), 2);
});

test("registered command return value is the exit code", async () => {
  commands.__t = async (args, ctx) => (ctx.stdout("hi " + args.join(",")), 7);
  const { out, ctx } = capture();
  assert.equal(await main(["__t", "a", "b"], ctx), 7);
  assert.equal(out.stdout, "hi a,b");
  delete commands.__t;
});

test("run returns 127 for a missing executable and never throws", () => {
  const r = run("darkforge-no-such-binary-xyz", []);
  assert.equal(r.code, 127);
  assert.equal(r.stdout, "");
  assert.ok(r.stderr.length > 0);
});

test("run captures stdout and exit code of node", () => {
  const r = run(process.execPath, ["-e", "console.log('ok');process.exit(3)"]);
  assert.equal(r.code, 3);
  assert.equal(r.stdout.trim(), "ok");
});

test("runShell uses the platform shell", () => {
  const r = runShell("echo shell-ok");
  assert.equal(r.code, 0);
  assert.match(r.stdout, /shell-ok/);
});

test("setRunner injects a fake and resetRunner restores", () => {
  setRunner(() => ({ code: 0, stdout: "fake", stderr: "" }));
  assert.equal(run("x", []).stdout, "fake");
  assert.equal(runShell("x").stdout, "fake");
  resetRunner();
  assert.equal(run("darkforge-no-such-binary-xyz", []).code, 127);
});

test("CLI sets process.exitCode instead of calling process.exit, so piped output is not cut", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const fs = await import("node:fs");
  const src = fs.readFileSync(fileURLToPath(new URL("../scripts/darkforge.mjs", import.meta.url)), "utf8");
  assert.doesNotMatch(src, /process\.exit\(/);
  const cli = fileURLToPath(new URL("../scripts/darkforge.mjs", import.meta.url));
  const r = spawnSync(process.execPath, [cli, "bogus"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/);
});

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { doctor } from "../scripts/lib/doctor.mjs";
import { main } from "../scripts/darkforge.mjs";
import { setRunner, resetRunner } from "../scripts/lib/exec.mjs";

afterEach(() => resetRunner());

const fake = (fails = []) => (cmd, args) =>
  fails.includes(cmd) ? { code: 127, stdout: "", stderr: "not found" } : { code: 0, stdout: `${cmd} ok`, stderr: "" };

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dark forge "));
const withConfig = (cfg) => {
  const d = tmp();
  fs.mkdirSync(path.join(d, ".darkforge"));
  fs.writeFileSync(path.join(d, ".darkforge", "config.json"), JSON.stringify({ schemaVersion: 1, ...cfg }));
  return d;
};

test("all tools present and no config: ok", () => {
  setRunner(fake());
  const r = doctor({ cwd: tmp() });
  assert.equal(r.ok, true);
});

test("git failing gives ok:false and a line mentioning git", () => {
  setRunner(fake(["git"]));
  const r = doctor({ cwd: tmp() });
  assert.equal(r.ok, false);
  assert.ok(r.lines.some((l) => /git/.test(l) && /fail/i.test(l)));
});

test("gh missing is a warning only", () => {
  setRunner(fake(["gh"]));
  const r = doctor({ cwd: tmp() });
  assert.equal(r.ok, true);
  assert.ok(r.lines.some((l) => /warn/i.test(l) && /gh/.test(l)));
});

test("gh auth status checked only when git.prFlow is true", () => {
  const calls = [];
  setRunner((cmd, args) => (calls.push([cmd, ...args].join(" ")), { code: 0, stdout: "", stderr: "" }));
  doctor({ cwd: tmp() });
  assert.ok(!calls.some((c) => c.includes("auth")));
  doctor({ cwd: withConfig({ git: { prFlow: true } }) });
  assert.ok(calls.some((c) => c === "gh auth status"));
});

test("gh auth failure warns but stays ok", () => {
  setRunner((cmd, args) => (args[0] === "auth" ? { code: 1, stdout: "", stderr: "no" } : { code: 0, stdout: "v", stderr: "" }));
  const r = doctor({ cwd: withConfig({ git: { prFlow: true } }) });
  assert.equal(r.ok, true);
  assert.ok(r.lines.some((l) => /warn/i.test(l) && /auth/.test(l)));
});

test("banned entries that are numeric or 'claude' warn", () => {
  setRunner(fake());
  const r = doctor({ cwd: withConfig({ models: { banned: ["4", "claude", "fable"] } }) });
  assert.equal(r.ok, true);
  assert.ok(r.lines.some((l) => /warn/i.test(l) && /"4"/.test(l)));
  assert.ok(r.lines.some((l) => /warn/i.test(l) && /"claude"/.test(l)));
  assert.ok(!r.lines.some((l) => /"fable"/.test(l)));
});

test("doctor command exits 1 on failure, 0 on success", async () => {
  const mk = () => {
    const o = { s: "" };
    return [o, { cwd: tmp(), stdout: (s) => (o.s += s), stderr: (s) => (o.s += s) }];
  };
  setRunner(fake(["git"]));
  let [o, ctx] = mk();
  assert.equal(await main(["doctor"], ctx), 1);
  assert.match(o.s, /git/);
  setRunner(fake());
  [o, ctx] = mk();
  assert.equal(await main(["doctor"], ctx), 0);
});

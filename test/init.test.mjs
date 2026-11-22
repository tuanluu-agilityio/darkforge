import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyInit, saveDefaults, loadDefaults, render } from "../scripts/lib/init.mjs";
import { loadConfig } from "../scripts/lib/config.mjs";
import { lintMemory } from "../scripts/lib/memory.mjs";
import { main } from "../scripts/darkforge.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "darkforge init "));
const read = (d, f) => fs.readFileSync(path.join(d, f), "utf8");
const ANSWERS = {
  config: { project: { name: "Demo", ownerLanguage: "vi" }, models: { banned: ["fable"] } },
  constraints: ["No network.", "English only."],
  openQuestions: [{ id: "Q-1", question: "Which db?", blocks: "task 2" }],
  createGate: true,
};

test("fresh project: files written, config loads, memory lints clean", () => {
  const d = tmp();
  const r = applyInit(d, ANSWERS);
  for (const f of [".darkforge/config.json", "memory-bank/activeContext.md", "memory-bank/progress.md", "memory-bank/backlog.md",
    "memory-bank/decisions.md", "memory-bank/systemPatterns.md", "memory-bank/techContext.md", "memory-bank/projectbrief.md",
    "docs/plans/constraints.md", "CLAUDE.md", "scripts/check.ps1", "scripts/check.sh", ".gitignore"]) {
    assert.ok(r.written.includes(f), f);
  }
  const loaded = loadConfig(d);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.config.project.name, "Demo");
  assert.match(loaded.config.gate.command.unix, /check\.sh/);
  assert.deepEqual(lintMemory(d), { ok: true, problems: [] });
  assert.match(read(d, "memory-bank/activeContext.md"), /\| Q-1 \| Which db\? \| task 2 \|/);
  assert.match(read(d, "docs/plans/constraints.md"), /GC-02 English only\./);
  assert.match(read(d, "CLAUDE.md"), /Banned models: fable/);
  assert.match(read(d, "CLAUDE.md"), /vi\./);
  assert.match(read(d, "memory-bank/progress.md"), /\| Task \| Branch \| Agent \| Model \| Status \| Tokens \|/);
  assert.ok(read(d, "scripts/check.sh").includes("ALL CHECKS PASSED"));
});

test("no unknown placeholders remain in rendered output; renderer rejects unknown", () => {
  const d = tmp();
  applyInit(d, ANSWERS);
  for (const f of ["CLAUDE.md", "memory-bank/activeContext.md", "memory-bank/techContext.md", "scripts/check.ps1", "scripts/check.sh", "docs/plans/constraints.md"]) {
    assert.doesNotMatch(read(d, f), /\{\{\w+\}\}/, f);
  }
  assert.throws(() => render("hi {{nope}}", {}), /nope/);
});

test("re-run preserves edited files, existing gate, and only changes block + config", () => {
  const d = tmp();
  applyInit(d, ANSWERS);
  fs.writeFileSync(path.join(d, "memory-bank/activeContext.md"), "# mine\n## Where we are\n## Next\n## Waiting on owner\n");
  fs.writeFileSync(path.join(d, "scripts/check.sh"), "echo custom\n");
  fs.writeFileSync(path.join(d, "CLAUDE.md"), "# Hand\r\n\r\nkeep me\r\n");
  const r1 = applyInit(d, { ...ANSWERS, config: { models: { banned: ["fable", "haiku"] } } });
  assert.equal(read(d, "memory-bank/activeContext.md"), "# mine\n## Where we are\n## Next\n## Waiting on owner\n");
  assert.equal(read(d, "scripts/check.sh"), "echo custom\n");
  assert.ok(r1.skipped.includes("scripts/check.sh"));
  assert.ok(r1.skipped.includes("memory-bank/activeContext.md"));
  const c = read(d, "CLAUDE.md");
  assert.ok(c.startsWith("# Hand\r\n\r\nkeep me\r\n\r\n<!-- darkforge:begin -->\r\n"));
  assert.doesNotMatch(c, /[^\r]\n/);
  assert.match(c, /fable, haiku/);
  fs.writeFileSync(path.join(d, "CLAUDE.md"), "top\n" + read(d, "CLAUDE.md").replace(/\r\n/g, "\n") + "bottom\n");
  applyInit(d, ANSWERS);
  const c2 = read(d, "CLAUDE.md");
  assert.ok(c2.startsWith("top\n# Hand\n\nkeep me\n\n<!-- darkforge:begin -->"));
  assert.ok(c2.endsWith("<!-- darkforge:end -->\nbottom\n"));
  assert.equal(c2.split("darkforge:begin").length, 2);
  const cfg = loadConfig(d).config;
  assert.equal(cfg.project.name, "Demo");
  assert.deepEqual(cfg.models.banned, ["fable"]);
});

test("gate command already set is not overwritten; no gate when createGate false", () => {
  const d = tmp();
  applyInit(d, { config: { gate: { command: { unix: "make check" } } }, createGate: true });
  const cfg = loadConfig(d).config;
  assert.equal(cfg.gate.command.unix, "make check");
  assert.match(cfg.gate.command.windows, /check\.ps1/);
  const e = tmp();
  const r = applyInit(e, { createGate: false });
  assert.ok(!r.written.includes("scripts/check.sh"));
  assert.equal(fs.existsSync(path.join(e, "scripts")), false);
});

test(".gitignore: lines appended once, existing content kept", () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, ".gitignore"), "node_modules/\n.darkforge/gate.json");
  applyInit(d, {});
  applyInit(d, {});
  const lines = read(d, ".gitignore").split("\n");
  assert.deepEqual(lines.filter((l) => l), ["node_modules/", ".darkforge/gate.json", ".darkforge/state.json", ".darkforge/offsets/"]);
});

test("defaults round-trip via DARKFORGE_HOME; only policy fields saved", async () => {
  const home = tmp();
  const prev = process.env.DARKFORGE_HOME;
  process.env.DARKFORGE_HOME = home;
  try {
    assert.equal(loadDefaults(), null);
    saveDefaults({ config: { ...ANSWERS.config, gate: { successMarker: "X" }, routing: { low: {} } } });
    const d = loadDefaults();
    assert.deepEqual(Object.keys(d.config).sort(), ["models", "project", "routing"]);
    assert.deepEqual(d.config.project, { ownerLanguage: "vi" });
    const out = [];
    const ctx = { cwd: home, stdout: (s) => out.push(s), stderr: (s) => out.push(s) };
    assert.equal(await main(["init", "defaults"], ctx), 0);
    assert.match(out.join(""), /"ownerLanguage": "vi"/);
    fs.writeFileSync(path.join(home, "a.json"), JSON.stringify(ANSWERS));
    assert.equal(await main(["init", "defaults", "--save", "a.json"], ctx), 0);
  } finally {
    if (prev === undefined) delete process.env.DARKFORGE_HOME;
    else process.env.DARKFORGE_HOME = prev;
  }
});

test("CLI init apply runs in cwd (path with space)", async () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, "ans.json"), JSON.stringify(ANSWERS));
  const out = [];
  const code = await main(["init", "apply", "--answers", "ans.json"], { cwd: d, stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
  assert.equal(code, 0);
  assert.match(out.join(""), /written \.darkforge\/config\.json/);
  assert.equal(await main(["init", "apply"], { cwd: d, stdout() {}, stderr() {} }), 1);
});

function snapshot(d) {
  const out = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(d, p)] = fs.readFileSync(p, "utf8");
    }
  };
  walk(d);
  return out;
}

async function cli(d, ...args) {
  const err = [];
  const code = await main(args, { cwd: d, stdout() {}, stderr: (s) => err.push(s) });
  return { code, err: err.join("") };
}

test("malformed config.json: refused, nothing written, CLI exits 1", async () => {
  const d = tmp();
  fs.mkdirSync(path.join(d, ".darkforge"));
  fs.writeFileSync(path.join(d, ".darkforge", "config.json"), "{ not json");
  fs.writeFileSync(path.join(d, "ans.json"), JSON.stringify(ANSWERS));
  const before = snapshot(d);
  assert.throws(() => applyInit(d, ANSWERS), /not valid JSON/);
  const r = await cli(d, "init", "apply", "--answers", "ans.json");
  assert.equal(r.code, 1);
  assert.deepEqual(snapshot(d), before);
  fs.writeFileSync(path.join(d, ".darkforge", "config.json"), "[1]");
  assert.throws(() => applyInit(d, ANSWERS), /JSON object/);
});

test("wrong-typed answer is rejected and nothing is written", () => {
  const d = tmp();
  assert.throws(() => applyInit(d, { config: { riskAreas: "x" } }), /riskAreas/);
  assert.deepEqual(fs.readdirSync(d), []);
});

test("unchanged config is reported skipped", () => {
  const d = tmp();
  applyInit(d, ANSWERS);
  const r = applyInit(d, ANSWERS);
  assert.ok(r.skipped.includes(".darkforge/config.json"));
  assert.ok(!r.written.includes(".darkforge/config.json"));
});

test("CLAUDE.md markers: only whole lines count; unbalanced markers refused", () => {
  const d = tmp();
  const quoted = "use `<!-- darkforge:begin -->` markers\nand <!-- darkforge:end --> inline\n";
  fs.writeFileSync(path.join(d, "CLAUDE.md"), quoted);
  applyInit(d, ANSWERS);
  assert.ok(read(d, "CLAUDE.md").startsWith(quoted + "\n<!-- darkforge:begin -->\n"));
  for (const bad of [
    "keep\n<!-- darkforge:begin -->\nuser text\n",
    "x\n<!-- darkforge:end -->\n",
    "<!-- darkforge:end -->\nmid\n<!-- darkforge:begin -->\n",
    "<!-- darkforge:begin -->\na\n<!-- darkforge:end -->\n<!-- darkforge:begin -->\nb\n<!-- darkforge:end -->\n",
  ]) {
    const e = tmp();
    fs.writeFileSync(path.join(e, "CLAUDE.md"), bad);
    assert.throws(() => applyInit(e, ANSWERS), /unbalanced/);
    assert.equal(read(e, "CLAUDE.md"), bad);
    assert.equal(fs.existsSync(path.join(e, ".darkforge")), false);
  }
});

const available = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const psExe = ["powershell", "pwsh"].find((c) => available(c, ["-NoProfile", "-Command", "exit 0"]));
const hasBash = available("bash", ["-c", "true"]);

function gateRun(exe, args, file, edit) {
  const d = tmp();
  applyInit(d, { createGate: true });
  const f = path.join(d, "scripts", file);
  const text = fs.readFileSync(f, "utf8");
  const edited = edit(text);
  assert.notEqual(edited, text);
  fs.writeFileSync(f, edited);
  return spawnSync(exe, [...args, `scripts/${file}`], { cwd: d, encoding: "utf8" });
}
const hasMarker = (r) => r.stdout.split(/\r?\n/).some((l) => l.trim() === "ALL CHECKS PASSED");

test("check.sh skeleton: failing step -> no marker, non-zero, names the step", { skip: !hasBash && "bash not available" }, () => {
  const bad = gateRun("bash", [], "check.sh", (t) => t.replace("step build true", "step build false"));
  assert.notEqual(bad.status, 0);
  assert.equal(hasMarker(bad), false);
  assert.match(bad.stdout, /CHECK FAILED: build/);
  const good = gateRun("bash", [], "check.sh", (t) => t + "\n");
  assert.equal(good.status, 0);
  assert.equal(hasMarker(good), true);
});

test("check.ps1 skeleton: failing native step -> no marker, non-zero", { skip: !psExe && "powershell not available" }, () => {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];
  const failing = process.platform === "win32" ? "{ cmd /c exit 3 }" : "{ sh -c 'exit 3' }";
  const bad = gateRun(psExe, args, "check.ps1", (t) => t.replace("Invoke-Step 'build' { $true | Out-Null }", `Invoke-Step 'build' ${failing}`));
  assert.notEqual(bad.status, 0);
  assert.equal(hasMarker(bad), false);
  const thrown = gateRun(psExe, args, "check.ps1", (t) => t.replace("Invoke-Step 'build' { $true | Out-Null }", "Invoke-Step 'build' { throw 'x' }"));
  assert.notEqual(thrown.status, 0);
  assert.equal(hasMarker(thrown), false);
  const good = gateRun(psExe, args, "check.ps1", (t) => t + "\n");
  assert.equal(good.status, 0);
  assert.equal(hasMarker(good), true);
});

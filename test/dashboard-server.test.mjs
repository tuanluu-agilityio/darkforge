import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { applyInit } from "../scripts/lib/init.mjs";
import { writeState } from "../scripts/lib/state.mjs";
import { startLiveServer } from "../scripts/lib/dashboard-server.mjs";
import { main } from "../scripts/darkforge.mjs";

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "df live "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  applyInit(root, { config: { project: { name: "live", ownerLanguage: "en" } } });
  fs.mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "docs", "plans", "phase-1-core.md"),
    "# Phase 1: Core\n\n## Tasks\n\n| Task | Title | Depends | Risk |\n|---|---|---|---|\n| 001 | Add sum | none | low |\n| 002 | Two | 001 | low |\n",
  );
  fs.appendFileSync(path.join(root, "memory-bank", "backlog.md"), "- one\n");
  writeState(root, { task: "002", phase: "review" });
  return root;
}

const FAST = { pollMs: 50, debounceMs: 10, keepAliveMs: 100 };

async function serve(t, root, opts = {}) {
  const s = await startLiveServer(root, { ...FAST, ...opts });
  t.after(() => s.close());
  return s;
}

function get(s, p, { method = "GET", host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: s.port, path: p, method, headers: host ? { host } : {}, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const tokenPath = (s, rest = "") => new URL(s.url).pathname + rest;

/** An open event stream: collects text; wait(pred, ms) resolves when the predicate holds on the text so far. */
function stream(t, s) {
  const st = { text: "", status: 0, res: null, req: null };
  const waiters = new Set();
  st.ready = new Promise((resolve, reject) => {
    st.req = http.get({ host: "127.0.0.1", port: s.port, path: tokenPath(s, "events"), agent: false }, (res) => {
      st.res = res;
      st.status = res.statusCode;
      res.setEncoding("utf8");
      res.on("data", (c) => {
        st.text += c;
        for (const w of [...waiters]) w();
      });
      res.on("error", () => {});
      resolve(st);
    });
    st.req.on("error", reject);
  });
  st.wait = (pred, ms = 1000) =>
    new Promise((resolve, reject) => {
      const check = () => {
        if (pred(st.text)) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(st.text);
        }
      };
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error("timeout; got: " + st.text.slice(-300)));
      }, ms);
      waiters.add(check);
      check();
    });
  st.frames = () =>
    st.text
      .split("\n\n")
      .filter((f) => f.trim() !== "" && !f.startsWith(":"))
      .map((f) => ({ named: /^event: /m.test(f), data: f.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n") }));
  // payloads of unnamed (data) events only
  st.datas = () => st.frames().filter((f) => !f.named).map((f) => f.data);
  t.after(() => st.req.destroy());
  return st;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("token, path, method and Host are enforced", async (t) => {
  const s = await serve(t, project(t));
  for (const p of ["/", "/wrong/", "/wrong/events", tokenPath(s, "nope")]) {
    const r = await get(s, p);
    assert.equal(r.status, 404, p);
    assert.equal(r.body, "");
  }
  assert.equal((await get(s, tokenPath(s), { method: "POST" })).status, 405);
  assert.equal((await get(s, tokenPath(s), { host: `evil.test:${s.port}` })).status, 421);
  assert.equal((await get(s, tokenPath(s), { host: `localhost:${s.port}` })).status, 200);
  assert.equal((await get(s, tokenPath(s), { host: `127.0.0.1:${s.port}` })).status, 200);
});

test("the page is live and locked down", async (t) => {
  const s = await serve(t, project(t));
  const r = await get(s, tokenPath(s));
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.ok(r.body.includes("const LIVE=true"));
  assert.equal(r.headers["content-security-policy"], CSP);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["referrer-policy"], "no-referrer");
  assert.equal(r.headers["access-control-allow-origin"], undefined);
  const e = await get(s, "/wrong/");
  assert.equal(e.headers["cache-control"], "no-store");
  assert.equal(e.headers["x-content-type-options"], "nosniff");
});

test("a stream gets the data at once and one event per change", async (t) => {
  const root = project(t);
  const s = await serve(t, root);
  const st = stream(t, s);
  await st.ready;
  assert.match(st.res.headers["content-type"], /text\/event-stream/);
  await st.wait(() => st.datas().length >= 1);
  assert.equal(JSON.parse(st.datas()[0]).state.task, "002");
  writeState(root, { phase: "fix" });
  await st.wait(() => st.datas().length >= 2);
  assert.equal(JSON.parse(st.datas()[1]).state.phase, "fix");
  const n = st.datas().length;
  const bl = path.join(root, "memory-bank", "backlog.md");
  fs.writeFileSync(bl, fs.readFileSync(bl, "utf8"));
  await sleep(300);
  assert.equal(st.datas().length, n);
});

test("event data survives newlines, script tags and unicode", async (t) => {
  const root = project(t);
  const q = "a\nb </script> Gộp ngay?  ";
  writeState(root, { waiting: { since: "x", questions: [q] } });
  const s = await serve(t, root);
  const st = stream(t, s);
  await st.ready;
  await st.wait(() => st.datas().length >= 1);
  const raw = st.datas()[0];
  assert.ok(!raw.includes("<") && !raw.includes(" ") && !raw.includes(" "));
  assert.deepEqual(JSON.parse(raw).state.waiting.questions, [q]);
});

test("collect error is pushed and the server recovers", async (t) => {
  const root = project(t);
  const s = await serve(t, root);
  const st = stream(t, s);
  await st.ready;
  await st.wait(() => st.datas().length >= 1);
  const cfg = path.join(root, ".darkforge", "config.json");
  const good = fs.readFileSync(cfg, "utf8");
  fs.writeFileSync(cfg, "{ not json");
  await st.wait((x) => x.includes("event: failed\ndata: "));
  fs.writeFileSync(cfg, good);
  await st.wait(() => {
    const f = st.frames();
    const i = f.findIndex((x) => x.named);
    return i >= 0 && f.slice(i + 1).some((x) => !x.named);
  });
  assert.equal(st.text.split("event: failed").length, 2, "failed sent once");
  assert.ok(st.frames().at(-1).named === false, "last frame is data");
});

test("idle poll does not collect", async (t) => {
  let n = 0;
  const s = await serve(t, project(t), { onCollect: () => n++ });
  const st = stream(t, s);
  await st.ready;
  await st.wait(() => st.datas().length >= 1);
  await sleep(150); // let late watcher events from the fixture writes settle
  const before = n;
  assert.ok(before >= 1);
  await sleep(300);
  assert.equal(n, before);
});

test("stream limit", async (t) => {
  const s = await serve(t, project(t));
  for (let i = 0; i < 8; i++) {
    const st = stream(t, s);
    await st.ready;
    assert.equal(st.status, 200);
  }
  const ninth = stream(t, s);
  await ninth.ready;
  assert.equal(ninth.status, 503);
});

test("closed streams free their slot", async (t) => {
  const root = project(t);
  const s = await serve(t, root);
  const open = [];
  for (let i = 0; i < 8; i++) {
    const st = stream(t, s);
    await st.ready;
    open.push(st);
  }
  for (const st of open) st.req.destroy();
  // the server notices the client closes asynchronously: retry the connection until a slot is free
  let again;
  for (const deadline = Date.now() + 2000; ; ) {
    again = stream(t, s);
    await again.ready;
    if (again.status === 200 || Date.now() > deadline) break;
    again.req.destroy();
    await sleep(20);
  }
  assert.equal(again.status, 200);
  const errors = [];
  const onErr = (e) => errors.push(e);
  process.on("uncaughtException", onErr);
  t.after(() => process.off("uncaughtException", onErr));
  writeState(root, { phase: "fix" });
  await again.wait(() => again.datas().length >= 2);
  assert.deepEqual(errors, []);
});

test("busy port is an error", async (t) => {
  const root = project(t);
  const s = await serve(t, root);
  await assert.rejects(startLiveServer(root, { ...FAST, port: s.port }), (e) => e instanceof Error && e.message.includes(String(s.port)));
  let err = "";
  const code = await main(["dashboard", "--watch", "--port", String(s.port)], { cwd: root, stdout: () => {}, stderr: (x) => (err += x) });
  assert.equal(code, 1);
  assert.match(err, /^darkforge: .*\n$/);
  assert.ok(err.includes(String(s.port)));
});

test("keep-alive comments are sent", async (t) => {
  const s = await serve(t, project(t));
  const st = stream(t, s);
  await st.ready;
  await st.wait((x) => x.includes(": keep-alive\n\n"), 300);
});

test("close ends open streams", async (t) => {
  const s = await startLiveServer(project(t), FAST);
  const st = stream(t, s);
  await st.ready;
  const ended = new Promise((r) => st.res.on("close", r));
  await s.close();
  await ended;
});

test("CLI rejects --watch with --out and a bad --port", async (t) => {
  const root = project(t);
  for (const argv of [["--watch", "--out", "x.html"], ["--watch", "--port", "abc"], ["--watch", "--port", "70000"], ["--watch", "--port"], ["--port", "80"]]) {
    let err = "";
    const code = await main(["dashboard", ...argv], { cwd: root, stdout: () => {}, stderr: (x) => (err += x) });
    assert.equal(code, 1, argv.join(" "));
    assert.match(err, /usage: darkforge dashboard/);
  }
});

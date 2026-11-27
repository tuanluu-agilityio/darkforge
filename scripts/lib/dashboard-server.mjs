// Live dashboard: a loopback-only, read-only HTTP server. One page and one event stream, both under a secret token path.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { collect, embedJson, render } from "./dashboard.mjs";

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const BASE_HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

const WATCHED = [[".darkforge"], ["memory-bank"], ["docs", "plans"]];

/** size:mtime of every file collect() reads, as one string; changes when any of them changes. */
function signature(root) {
  const parts = [];
  const stat = (file) => {
    try {
      const st = fs.statSync(file);
      parts.push(`${file}|${st.size}:${st.mtimeMs}`);
    } catch {
      parts.push(`${file}|-`);
    }
  };
  const list = (dir, re) => {
    try {
      return fs.readdirSync(dir).filter((n) => re.test(n)).sort();
    } catch {
      return [];
    }
  };
  for (const f of ["config.json", "state.json", "ledger.jsonl"]) stat(path.join(root, ".darkforge", f));
  const mb = path.join(root, "memory-bank");
  for (const n of list(mb, /\.md$/)) stat(path.join(mb, n));
  const plans = path.join(root, "docs", "plans");
  for (const n of list(plans, /^phase-.*\.md$/)) stat(path.join(plans, n));
  return parts.join("\n");
}

/** The message is plain text shown with textContent; it is one line (no CR/LF, no U+2028/2029) so it is one data field. */
const failedFrame = (msg) => `event: failed\ndata: ${msg.replace(/\s+/g, " ")}\n\n`;

export function startLiveServer(
  root,
  { port = 0, pollMs = 2000, debounceMs = 200, keepAliveMs = 25000, maxStreams = 8, onCollect = null } = {},
) {
  const token = crypto.randomBytes(32).toString("base64url");
  const base = `/${token}/`;
  const streams = new Set();
  const watchers = new Map(); // dir -> fs.FSWatcher
  let closed = false;
  let lastEvent = null; // the last frame pushed: { key, frame }
  let lastFailed = null;
  let sig = "";
  let debounce = null;
  let pollTimer = null;
  let keepTimer = null;

  const embedKey = (data) => {
    const { generatedAt: _ignored, ...rest } = data;
    return JSON.stringify(rest);
  };

  function send(res, frame) {
    if (res.destroyed || res.writableEnded) return;
    res.write(frame);
  }
  function broadcast(frame) {
    for (const res of streams) send(res, frame);
  }

  /** Run collect() once; push only what changed. Returns nothing; errors become a failed event. */
  function refresh() {
    let data;
    try {
      onCollect?.();
      data = collect(root);
    } catch (e) {
      const msg = String(e?.message ?? e).replace(/[\r\n]+/g, " ");
      if (msg !== lastFailed) {
        lastFailed = msg;
        broadcast(failedFrame(msg));
      }
      return;
    }
    const recovered = lastFailed !== null;
    lastFailed = null;
    const key = embedKey(data);
    if (lastEvent && lastEvent.key === key) {
      // The page hides its failure banner only on a data event, so say so again after a recovery.
      if (recovered) broadcast(lastEvent.frame);
      return;
    }
    lastEvent = { key, frame: `data: ${embedJson(data)}\n\n` };
    broadcast(lastEvent.frame);
  }

  function schedule() {
    if (closed) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      sig = signature(root);
      refresh();
    }, debounceMs);
  }

  function watchDirs() {
    for (const parts of WATCHED) {
      const dir = path.join(root, ...parts);
      if (watchers.has(dir)) continue;
      try {
        const w = fs.watch(dir, { persistent: false }, schedule);
        w.on("error", () => {
          w.close();
          watchers.delete(dir); // retried on the next poll
        });
        watchers.set(dir, w);
      } catch {
        // missing directory: tried again on the next poll
      }
    }
  }

  function handle(req, res) {
    const reply = (status, headers = {}, body = "") => {
      res.writeHead(status, { ...BASE_HEADERS, ...headers });
      res.end(body);
    };
    const url = (req.url ?? "").split("?")[0];
    if (!url.startsWith(base)) return reply(404);
    if (req.method !== "GET") return reply(405, { Allow: "GET" });
    const host = req.headers.host ?? "";
    const p = server.address().port;
    if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) return reply(421);
    const rest = url.slice(base.length);
    if (rest === "") {
      try {
        return reply(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP }, render(collect(root), { live: true }));
      } catch (e) {
        return reply(500, { "Content-Type": "text/plain; charset=utf-8" }, `darkforge: ${e.message}\n`);
      }
    }
    if (rest === "events") {
      if (streams.size >= maxStreams) return reply(503);
      res.writeHead(200, { ...BASE_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
      streams.add(res);
      res.on("close", () => streams.delete(res));
      res.on("error", () => streams.delete(res));
      if (lastEvent) send(res, lastEvent.frame);
      if (lastFailed !== null) send(res, failedFrame(lastFailed));
      return;
    }
    return reply(404);
  }

  const server = http.createServer(handle);
  server.on("clientError", (_e, socket) => socket.destroy());

  return new Promise((resolve, reject) => {
    server.once("error", (e) => reject(new Error(`cannot listen on 127.0.0.1:${port}: ${e.message}`)));
    server.listen(port, "127.0.0.1", () => {
      server.removeAllListeners("error");
      server.on("error", () => {});
      const actual = server.address().port;
      sig = signature(root);
      refresh();
      watchDirs();
      pollTimer = setInterval(() => {
        watchDirs();
        const now = signature(root);
        if (now !== sig) {
          sig = now;
          schedule();
        }
      }, pollMs);
      keepTimer = setInterval(() => broadcast(": keep-alive\n\n"), keepAliveMs);
      resolve({
        url: `http://127.0.0.1:${actual}${base}`,
        port: actual,
        close() {
          if (closed) return Promise.resolve();
          closed = true;
          clearTimeout(debounce);
          clearInterval(pollTimer);
          clearInterval(keepTimer);
          for (const w of watchers.values()) w.close();
          watchers.clear();
          return new Promise((done) => {
            server.close(() => done());
            for (const res of streams) res.destroy();
            streams.clear();
            server.closeAllConnections?.();
          });
        },
      });
    });
  });
}

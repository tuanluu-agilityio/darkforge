#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { dashboardCommand } from "./lib/dashboard.mjs";
import { doctor } from "./lib/doctor.mjs";
import { gateCommand } from "./lib/gate.mjs";
import { ledgerCommand } from "./lib/ledger.mjs";
import { memoryCommand } from "./lib/memory.mjs";
import { initCommand } from "./lib/init.mjs";
import { taskCommand } from "./lib/task.mjs";

/** Command registry: name -> async (args, ctx) => exit code. Later tasks add entries here. */
export const commands = {
  dashboard: dashboardCommand,
  gate: gateCommand,
  init: initCommand,
  ledger: ledgerCommand,
  memory: memoryCommand,
  task: taskCommand,
  async doctor(_args, ctx) {
    const r = doctor({ cwd: ctx.cwd });
    ctx.stdout(r.lines.join("\n") + "\n");
    return r.ok ? 0 : 1;
  },
};

const defaultCtx = () => ({
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});

export async function main(argv, ctx = defaultCtx()) {
  const [name, ...args] = argv;
  const handler = name && Object.hasOwn(commands, name) ? commands[name] : null;
  if (!handler) {
    ctx.stderr(`usage: darkforge <command> [args]\ncommands: ${Object.keys(commands).join(", ")}\n`);
    return 2;
  }
  try {
    return await handler(args, ctx);
  } catch (e) {
    ctx.stderr(`error: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Set exitCode rather than exiting at once: an immediate exit can cut stdout still being written to a pipe.
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

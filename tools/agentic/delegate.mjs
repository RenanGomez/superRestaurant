#!/usr/bin/env node
// L3 CLI: calls the OpenRouter delegator MCP server (DeepSeek V4 Flash only) over stdio
// so the orchestrator can summarize large files without loading them into its context.
// Usage: node tools/agentic/delegate.mjs --task read|reason|write --prompt "..." [--file <abs path>]... [--out <file>]
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = { task: "read", prompt: "", files: [], out: "" };
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--task") opt.task = argv[++i];
  else if (a === "--prompt") opt.prompt = argv[++i];
  else if (a === "--file") opt.files.push(path.resolve(argv[++i]));
  else if (a === "--out") opt.out = argv[++i];
}
if (!opt.prompt) { console.error("--prompt es obligatorio"); process.exit(2); }
if (process.env.OPENROUTER_API_KEY === undefined) { console.error("OPENROUTER_API_KEY no está en el entorno"); process.exit(2); }
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const env = { ...process.env, DELEGATOR_CONFIG: process.env.DELEGATOR_CONFIG ?? path.join(repoRoot, ".claude", "delegator.json") };

const child = spawn("cmd", ["/c", "npx", "-y", "claude-code-deepseek-delegator"], { stdio: ["pipe", "pipe", "ignore"], env });
let buf = ""; const pending = new Map(); let id = 0;
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* not JSON */ }
  }
});
const call = (method, params) => new Promise((res) => { const m = { jsonrpc: "2.0", id: ++id, method, params }; pending.set(m.id, res); child.stdin.write(JSON.stringify(m) + "\n"); });

await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "superRestaurant-delegate", version: "1" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const args = { task: opt.task, prompt: opt.prompt };
if (opt.files.length > 0) args.files = opt.files;
const r = await call("tools/call", { name: "delegate", arguments: args });
child.kill();
if (r.error) { console.error(JSON.stringify(r.error)); process.exit(1); }
const text = (r.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const receipt = text.match(/⎿ delegate[^\n]*/)?.[0] ?? "";
const body = text.replace(/deepseek-cost:\{[^\n]*\n?/, "").replace(/⎿ delegate[^\n]*\n?/, "");
if (opt.out) { writeFileSync(opt.out, body, "utf8"); console.log(`escrito: ${opt.out}`); } else { console.log(body); }
if (receipt) console.log(receipt);
process.exit(0);

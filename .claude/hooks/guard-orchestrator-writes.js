#!/usr/bin/env node
// PreToolUse guard: the orchestrator (main session and any agent not listed in
// WRITER_AGENTS) may only write tracking docs, agent config and docs/**.
// Code writes must come from implementer-claude or from Codex in its worktree.
// Exit 2 blocks the tool call; stderr is shown to the model.
"use strict";
const path = require("node:path");

const WRITER_AGENTS = new Set(["implementer-claude"]);
const ALLOWED_FILES = new Set(["TODO.md", "HANDOFF.md", "PROJECT_NOTES.md", "AGENTS.md", "README.md", ".gitignore", ".mcp.json"]);
const ALLOWED_PREFIXES = ["docs/", ".claude/", "tools/agentic/"];

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const agentType = typeof input.agent_type === "string" ? input.agent_type : "";
  if (WRITER_AGENTS.has(agentType)) process.exit(0);

  const toolInput = input.tool_input ?? {};
  const target = toolInput.file_path ?? toolInput.notebook_path ?? "";
  if (typeof target !== "string" || target === "") process.exit(0);

  const root = path.resolve(input.cwd ?? process.cwd());
  const absolute = path.resolve(root, target);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  // Writes outside the repository (memory, scratchpad, other repos) are not this guard's business.
  if (relative.startsWith("..") || path.isAbsolute(relative)) process.exit(0);

  const allowed = ALLOWED_FILES.has(relative)
    || ALLOWED_PREFIXES.some((prefix) => relative.startsWith(prefix));
  if (allowed) process.exit(0);

  process.stderr.write(
    `guard-orchestrator-writes: "${relative}" es código fuente. El orquestador no edita código; ` +
    `delega a implementer-claude (L1) o a Codex (L2) con un paquete de contexto. Agente actual: "${agentType || "main"}".\n`);
  process.exit(2);
});

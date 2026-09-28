#!/usr/bin/env node
// Idempotently wires CLI hooks into the global Claude Code, Codex and OpenCode
// configurations. Backs up every file before changing it.
//
// Usage:
//   node hooks/install.mjs [--targets claude,codex,opencode]
//                          [--base-url http://127.0.0.1:8787] [--token TOKEN]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const bridge = path.join(__dirname, "hook-bridge.mjs");
const pluginDir = path.join(__dirname, "opencode-plugin");

const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const targets = (flag("targets") ?? "claude,codex,opencode").split(",");
const baseUrl = (flag("base-url") ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const token = flag("token") ?? process.env.SESSION_GATEWAY_TOKEN ?? detectGatewayToken();

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(file, `${file}.bak-fuluk-${stamp}`);
}

function installClaude() {
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  backup(settingsPath);
  settings.hooks ??= {};
  const command = `node ${bridge} claude`;
  for (const eventName of ["Stop", "Notification", "UserPromptSubmit"]) {
    const groups = (settings.hooks[eventName] ??= []);
    const existing = groups.some((group) =>
      group.hooks?.some((hook) => hook.command?.includes("hook-bridge.mjs"))
    );
    if (!existing) groups.push({ hooks: [{ type: "command", command }] });
  }
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log("claude: hooks installed");
}

function installCodex() {
  const configPath = path.join(os.homedir(), ".codex", "config.toml");
  const content = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  if (/^notify\s*=/m.test(content)) {
    console.log("codex: notify already configured, skipping (merge manually if needed)");
    return;
  }
  if (fs.existsSync(configPath)) backup(configPath);
  // notify is a top-level string array (one shell command per element), not a
  // table, so it must be inserted before the first [section] header.
  const block = [
    "# fuluk-gateway-hooks (managed by hooks/install.mjs)",
    `notify = [${JSON.stringify(`node ${bridge} codex`)}]`,
    "",
    ""
  ].join("\n");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const headerIndex = content.search(/^\s*\[/m);
  const next =
    headerIndex === -1 ? block + content : content.slice(0, headerIndex) + block + content.slice(headerIndex);
  fs.writeFileSync(configPath, next);
  console.log("codex: notify command installed");
}

function installOpenCode() {
  const configHome = path.join(os.homedir(), ".config", "opencode");
  const configPath = path.join(configHome, "opencode.jsonc");
  const config = JSON.parse(stripJsonComments(fs.readFileSync(configPath, "utf8")));
  backup(configPath);
  fs.mkdirSync(configHome, { recursive: true });
  const modulesDir = path.join(configHome, "node_modules", "fuluk-gateway-hooks");
  fs.rmSync(modulesDir, { recursive: true, force: true });
  fs.cpSync(pluginDir, modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(modulesDir, "hooks.json"),
    `${JSON.stringify({ baseUrl, token }, null, 2)}\n`
  );
  const pluginList = (config.plugin ??= []);
  if (!pluginList.includes("fuluk-gateway-hooks")) pluginList.push("fuluk-gateway-hooks");
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("opencode: plugin installed");
}

function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"])\/\/.*$/gm, "$1");
}

function detectGatewayToken() {
  try {
    const output = execFileSync("pgrep", ["-f", "node .*src/server.mjs"], { encoding: "utf8" });
    for (const pid of output.trim().split("\n")) {
      const environ = fs.readFileSync(`/proc/${pid}/environ`, "utf8");
      const match = environ.match(/SESSION_GATEWAY_TOKEN=([^\0]*)/);
      if (match?.[1]) return match[1];
    }
  } catch {
    // no running gateway or procfs unavailable
  }
  return "";
}

if (!token) {
  console.warn("warning: no gateway token found; pass --token for authenticated hooks");
}
if (targets.includes("claude")) installClaude();
if (targets.includes("codex")) installCodex();
if (targets.includes("opencode")) installOpenCode();

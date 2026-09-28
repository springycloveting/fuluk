#!/usr/bin/env node
// Receives a CLI hook payload on stdin and forwards it to the gateway's
// /api/hooks/<kind> endpoint. Usage: node hook-bridge.mjs <claude|codex|opencode>
// Never exits non-zero or prints to stdout/stderr: hook failures must not block
// or corrupt the CLI that invoked us.

import { readFile } from "node:fs/promises";

async function main() {
  const kind = process.argv[2];
  const rawText = await readFile(process.stdin, { encoding: "utf8" }).catch(() => "");
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return;
  }
  const baseUrl = (process.env.SESSION_GATEWAY_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
  const token = process.env.SESSION_GATEWAY_HOOK_TOKEN ?? "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  timer.unref?.();
  try {
    await fetch(`${baseUrl}/api/hooks/${encodeURIComponent(kind)}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch {
    // The gateway is unreachable or slow; the next lifecycle event retries.
  } finally {
    clearTimeout(timer);
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { normalizeHookEvent } from "../src/hooks.mjs";
import { SessionStore } from "../src/store.mjs";
import { handleSessionGatewayRequest } from "../src/server.mjs";

const SESSION_ID = "0193c2a1-7a0e-4d3b-9f1c-2e8a6b4c5d6e";
const THREAD_ID = "0193c2a1-1111-4d3b-9f1c-2e8a6b4c5d6e";
const OPENCODE_ID = "ses_01HXY9F8VQJZM4R2N6PTAKCDWX";

test("claude Stop maps to completed", () => {
  const event = normalizeHookEvent("claude", {
    hook_event_name: "Stop",
    session_id: SESSION_ID,
    cwd: "/workspace/app"
  });
  assert.equal(event.taskState, "completed");
  assert.equal(event.cliSessionId, SESSION_ID);
});

test("claude Notification distinguishes permission from idle", () => {
  const permission = normalizeHookEvent("claude", {
    hook_event_name: "Notification",
    session_id: SESSION_ID,
    cwd: "/workspace/app",
    message: "Claude needs your permission to use Bash"
  });
  assert.equal(permission.taskState, "needs_confirmation");

  const idle = normalizeHookEvent("claude", {
    hook_event_name: "Notification",
    session_id: SESSION_ID,
    cwd: "/workspace/app",
    message: "Claude is waiting for your input"
  });
  assert.equal(idle.taskState, "completed");
});

test("claude UserPromptSubmit maps to in_progress and SubagentStop is ignored", () => {
  const submit = normalizeHookEvent("claude", {
    hook_event_name: "UserPromptSubmit",
    session_id: SESSION_ID,
    cwd: "/workspace/app",
    prompt: "do something"
  });
  assert.equal(submit.taskState, "in_progress");
  assert.equal(
    normalizeHookEvent("claude", { hook_event_name: "SubagentStop", session_id: SESSION_ID }),
    null
  );
});

test("codex turn completion and approval map correctly", () => {
  const complete = normalizeHookEvent("codex", {
    type: "agent-turn-complete",
    thread_id: THREAD_ID,
    cwd: "/workspace/app"
  });
  assert.equal(complete.taskState, "completed");
  assert.equal(complete.cliSessionId, THREAD_ID);

  const approval = normalizeHookEvent("codex", {
    type: "exec-command-approval-available",
    thread_id: THREAD_ID,
    cwd: "/workspace/app",
    approval_request: { command: ["ls", "-la"] }
  });
  assert.equal(approval.taskState, "needs_confirmation");
  assert.equal(approval.detail, "ls -la");

  assert.equal(normalizeHookEvent("codex", { type: "thread-created" }), null);
});

test("opencode idle and permission events map correctly", () => {
  const idle = normalizeHookEvent("opencode", {
    event: "session.idle",
    sessionID: OPENCODE_ID,
    cwd: "/workspace/app"
  });
  assert.equal(idle.taskState, "completed");
  assert.equal(idle.cliSessionId, OPENCODE_ID);

  const asked = normalizeHookEvent("opencode", {
    event: "permission.asked",
    sessionID: OPENCODE_ID,
    cwd: "/workspace/app"
  });
  assert.equal(asked.taskState, "needs_confirmation");
});

test("POST /api/hooks/:kind persists hook state resolved by cwd", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hook-test-"));
  const store = new SessionStore(path.join(dir, "gateway.sqlite"));
  const session = store.create(
    { kind: "claude", name: "hook-test", cwd: "/workspace/app" },
    "claude",
    []
  );

  const req = Readable.from([
    JSON.stringify({
      hook_event_name: "Notification",
      session_id: SESSION_ID,
      cwd: "/workspace/app",
      message: "Claude needs your permission to use Bash"
    })
  ]);
  req.method = "POST";
  req.url = "/api/hooks/claude";
  req.headers = { host: "localhost", authorization: "Bearer secret" };
  const res = {
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, {
    config: { authToken: "secret", runtimeSettings: {}, runtimeSettingsEnabled: false },
    store,
    tmux: {},
    eventHub: { broadcast() {}, hasClients: () => false },
    sessionTaskStates: new Map(),
    pendingHookEvents: []
  });

  assert.equal(res.statusCode, 200);
  const hookState = store.getHookState(session.id);
  assert.equal(hookState.state, "needs_confirmation");
  assert.equal(store.findByIdOrName(session.id).cliSessionId, SESSION_ID);
});

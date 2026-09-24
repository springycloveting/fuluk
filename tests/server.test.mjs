import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createSessionGatewayServer, handleSessionGatewayRequest } from "../src/server.mjs";
import { SessionStore } from "../src/store.mjs";

function compactSession(session) {
  return {
    id: session.id,
    name: session.name,
    kind: session.kind,
    status: session.status,
    phase: session.status === "running" && session.taskState !== "completed" ? "active" : session.status === "running" ? "stopped" : "closed",
    project: session.project ?? null,
    cwd: session.cwd,
    taskState: session.taskState ?? null,
    ...(session.updatedAt !== undefined ? { updatedAt: session.updatedAt } : {})
  };
}

test("/api/nl output uses currentSessionId and returns JSON output", async () => {
  const session = {
    id: "session-1",
    name: "main",
    kind: "codex",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const saved = [];
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const captures = [];
  const tmux = {
    async capture(record, lines) {
      captures.push({ sessionId: record.id, lines });
      return "recent output";
    }
  };
  const req = Readable.from([JSON.stringify({ text: "查看会话", currentSessionId: "main" })]);
  req.method = "POST";
  req.url = "/api/nl";
  req.headers = {
    host: "localhost",
    authorization: "Bearer secret"
  };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.deepEqual(JSON.parse(res.body), {
    command: {
      type: "output",
      target: null,
      lines: 50,
      needsCurrentSession: true
    },
    session: compactSession(session),
    output: "recent output"
  });
  assert.deepEqual(captures, [{ sessionId: "session-1", lines: 50 }]);
  assert.deepEqual(saved, [{ sessionId: "session-1", lines: 50, text: "recent output" }]);
});

test("/api/nl send can target a session by list position", async () => {
  const sessions = [
    { id: "session-1", name: "first", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "session-1" },
    { id: "session-2", name: "second", kind: "codex", status: "running", cwd: "/two", tmuxSessionName: "session-2" }
  ];
  const touched = [];
  const saved = [];
  const store = {
    list() {
      return sessions;
    },
    touch(sessionId) {
      touched.push(sessionId);
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    },
    findByIdOrName() {
      throw new Error("current session should not be used for targetIndex send");
    }
  };
  const sent = [];
  const captures = [];
  const tmux = {
    async send(record, text) {
      sent.push({ sessionId: record.id, text });
    },
    async capture(record, lines) {
      captures.push({ sessionId: record.id, lines });
      return "sent output";
    }
  };
  const req = Readable.from([JSON.stringify({ text: "发送到第二个会话修改配置", currentSessionId: "first" })]);
  req.method = "POST";
  req.url = "/api/nl";
  req.headers = {
    host: "localhost",
    authorization: "Bearer secret"
  };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false,
      sendFollowupDelayMs: 0
    },
    store,
    tmux
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    command: {
      type: "send",
      target: null,
      targetIndex: 2,
      text: "修改配置",
      needsCurrentSession: false
    },
    ok: true,
    session: compactSession(sessions[1]),
    output: "sent output"
  });
  assert.deepEqual(sent, [{ sessionId: "session-2", text: "修改配置" }]);
  assert.deepEqual(touched, ["session-2"]);
  assert.deepEqual(captures, [{ sessionId: "session-2", lines: 30 }]);
  assert.deepEqual(saved, [{ sessionId: "session-2", lines: 30, text: "sent output" }]);
});

test("/api/nl output can target a session by list position", async () => {
  const sessions = [
    { id: "session-1", name: "first", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "session-1" },
    { id: "session-2", name: "second", kind: "codex", status: "running", cwd: "/two", tmuxSessionName: "session-2" },
    { id: "session-3", name: "third", kind: "codex", status: "running", cwd: "/three", tmuxSessionName: "session-3" }
  ];
  const saved = [];
  const store = {
    list() {
      return sessions;
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    },
    findByIdOrName() {
      throw new Error("current session should not be used for targetIndex output");
    }
  };
  const captures = [];
  const tmux = {
    async capture(record, lines) {
      captures.push({ sessionId: record.id, lines });
      return "third output";
    }
  };

  const { statusCode, body } = await postJson("/api/nl", {
    text: "查看第三个会话",
    currentSessionId: "session-1"
  }, {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(body), {
    command: {
      type: "output",
      target: null,
      targetIndex: 3,
      lines: 50,
      needsCurrentSession: false
    },
    session: compactSession(sessions[2]),
    output: "third output"
  });
  assert.deepEqual(captures, [{ sessionId: "session-3", lines: 50 }]);
  assert.deepEqual(saved, [{ sessionId: "session-3", lines: 50, text: "third output" }]);
});

test("/api/sessions output raw mode preserves terminal escapes", async () => {
  const session = {
    id: "session-1",
    name: "opencode",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const captures = [];
  const saved = [];
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const tmux = {
    async capture(record, lines, options) {
      captures.push({ sessionId: record.id, lines, options });
      return "\u001b[32mModel menu\u001b[0m";
    }
  };

  const { statusCode, body } = await getJson("/api/sessions/session-1/output?lines=300&format=json&raw=1", {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.equal(parsed.changed, true);
  assert.equal(parsed.output, "\u001b[32mModel menu\u001b[0m");
  assert.equal(typeof parsed.etag, "string");
  assert.deepEqual(captures, [
    {
      sessionId: "session-1",
      lines: 300,
      options: { preserveEscapes: true, alternateScreen: true, offset: 0 }
    }
  ]);
  assert.deepEqual(saved, [{ sessionId: "session-1", lines: 300, text: "\u001b[32mModel menu\u001b[0m" }]);
});

test("/api/sessions output forwards capture offset", async () => {
  const session = {
    id: "session-1",
    name: "opencode",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const captures = [];
  const saved = [];
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const tmux = {
    async capture(record, lines, options) {
      captures.push({ sessionId: record.id, lines, options });
      return "history window";
    }
  };

  const { statusCode, body } = await getJson("/api/sessions/session-1/output?lines=80&offset=40&format=json&raw=1", {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.equal(parsed.changed, true);
  assert.equal(parsed.output, "history window");
  assert.equal(typeof parsed.etag, "string");
  assert.deepEqual(captures, [
    {
      sessionId: "session-1",
      lines: 80,
      options: { preserveEscapes: true, alternateScreen: true, offset: 40 }
    }
  ]);
  assert.deepEqual(saved, []);
});

test("UI polling endpoints do not exhaust the default API rate limit", async () => {
  const session = {
    id: "session-1",
    name: "opencode",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    saveOutput() {}
  };
  const tmux = {
    async capture() {
      return "current output";
    }
  };
  const context = {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  };

  let lastResponse = null;
  for (let index = 0; index < 110; index += 1) {
    lastResponse = await getJson("/api/sessions/session-1/output?lines=20&format=json", context);
  }

  assert.equal(lastResponse.statusCode, 200);
});

test("/api/sessions/:id/keys allows tmux mouse wheel keys", async () => {
  const session = {
    id: "session-1",
    name: "opencode",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const sent = [];
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    touch() {}
  };
  const tmux = {
    async sendKeys(record, keys) {
      sent.push({ sessionId: record.id, keys });
    }
  };

  const { statusCode, body } = await postJson(
    "/api/sessions/session-1/keys",
    { keys: ["WheelUpPane", "WheelDownPane"] },
    {
      config: {
        authToken: "secret",
        allowRuntimeMode: true,
        runtimeSettings: {},
        runtimeSettingsEnabled: false
      },
      store,
      tmux
    }
  );

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
  assert.deepEqual(sent, [{ sessionId: "session-1", keys: ["WheelUpPane", "WheelDownPane"] }]);
});

test("/api/sessions/:id/keys normalizes browser page keys to tmux keys", async () => {
  const session = {
    id: "session-1",
    name: "opencode",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const sent = [];
  const touched = [];
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    touch(sessionId) {
      touched.push(sessionId);
    }
  };
  const tmux = {
    async sendKeys(record, keys) {
      sent.push({ sessionId: record.id, keys });
    }
  };

  const { statusCode, body } = await postJson(
    "/api/sessions/session-1/keys",
    { keys: ["PageUp", "PageDown", "Enter"] },
    {
      config: {
        authToken: "secret",
        allowRuntimeMode: true,
        runtimeSettings: {},
        runtimeSettingsEnabled: false
      },
      store,
      tmux
    }
  );

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
  assert.deepEqual(sent, [{ sessionId: "session-1", keys: ["PPage", "NPage", "Enter"] }]);
  assert.deepEqual(touched, ["session-1"]);
});

test("/api/sessions/:id/resize resizes only the selected session", async () => {
  const session = {
    id: "session-1",
    name: "main",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const resized = [];
  const { statusCode, body } = await postJson(
    "/api/sessions/main/resize",
    { cols: 132, rows: 40 },
    {
      config: {
        authToken: "secret",
        allowRuntimeMode: true,
        runtimeSettings: {},
        runtimeSettingsEnabled: false
      },
      store: {
        findByIdOrName(value) {
          return value === session.id || value === session.name ? session : null;
        }
      },
      tmux: {
        async resize(record, cols, rows) {
          resized.push({ sessionId: record.id, cols, rows });
        }
      }
    }
  );

  assert.equal(statusCode, 200);
  assert.deepEqual(JSON.parse(body), { ok: true });
  assert.deepEqual(resized, [{ sessionId: "session-1", cols: 132, rows: 40 }]);
});

test("/api/sessions/:id/resize rejects invalid terminal sizes", async () => {
  const session = {
    id: "session-1",
    name: "main",
    kind: "opencode",
    status: "running",
    cwd: "/workspace/app",
    tmuxSessionName: "session-1"
  };
  const resized = [];
  const { statusCode, body } = await postJson(
    "/api/sessions/main/resize",
    { cols: 10, rows: 40 },
    {
      config: {
        authToken: "secret",
        allowRuntimeMode: true,
        runtimeSettings: {},
        runtimeSettingsEnabled: false
      },
      store: {
        findByIdOrName(value) {
          return value === session.id || value === session.name ? session : null;
        }
      },
      tmux: {
        async resize(record, cols, rows) {
          resized.push({ sessionId: record.id, cols, rows });
        }
      }
    }
  );

  assert.equal(statusCode, 400);
  assert.match(JSON.parse(body).error, /cols must be an integer/);
  assert.deepEqual(resized, []);
});

test("/api/nl send can target a named session through the submitting send path", async () => {
  const glassSession = {
    id: "session-glass",
    name: "glass-to-ai",
    kind: "codex",
    status: "running",
    cwd: "/workspace/glass",
    tmuxSessionName: "glass-to-ai"
  };
  const touched = [];
  const saved = [];
  const store = {
    findByIdOrName(value) {
      return value === glassSession.id || value === glassSession.name ? glassSession : null;
    },
    touch(sessionId) {
      touched.push(sessionId);
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const sent = [];
  const captures = [];
  const tmux = {
    async send(record, text) {
      sent.push({ sessionId: record.id, text, submitted: true });
    },
    async capture(record, lines) {
      captures.push({ sessionId: record.id, lines });
      return "glass output";
    }
  };
  const req = Readable.from([JSON.stringify({ text: "发送到glass-to-ai会话修改配置", currentSessionId: "other" })]);
  req.method = "POST";
  req.url = "/api/nl";
  req.headers = {
    host: "localhost",
    authorization: "Bearer secret"
  };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false,
      sendFollowupDelayMs: 0
    },
    store,
    tmux
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    command: {
      type: "send",
      target: "glass-to-ai",
      text: "修改配置",
      needsCurrentSession: false
    },
    ok: true,
    session: compactSession(glassSession),
    output: "glass output"
  });
  assert.deepEqual(sent, [{ sessionId: "session-glass", text: "修改配置", submitted: true }]);
  assert.deepEqual(touched, ["session-glass"]);
  assert.deepEqual(captures, [{ sessionId: "session-glass", lines: 30 }]);
  assert.deepEqual(saved, [{ sessionId: "session-glass", lines: 30, text: "glass output" }]);
});

test("/api/nl send waits before returning 30 lines of current session output", async () => {
  const session = {
    id: "session-main",
    name: "main",
    kind: "codex",
    status: "running",
    cwd: "/workspace/main",
    tmuxSessionName: "main"
  };
  const sleeps = [];
  const saved = [];
  const store = {
    findByIdOrName(value) {
      return value === session.id || value === session.name ? session : null;
    },
    touch() {},
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const calls = [];
  const tmux = {
    async send(record, text) {
      calls.push({ type: "send", sessionId: record.id, text });
    },
    async sleep(ms) {
      sleeps.push(ms);
      calls.push({ type: "sleep", ms });
    },
    async capture(record, lines) {
      calls.push({ type: "capture", sessionId: record.id, lines });
      return "after send";
    }
  };

  const { statusCode, body } = await postJson("/api/nl", {
    text: "发送 查看状态",
    currentSessionId: "main"
  }, {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  assert.equal(JSON.parse(body).output, "after send");
  assert.deepEqual(sleeps, [5000]);
  assert.deepEqual(calls, [
    { type: "send", sessionId: "session-main", text: "查看状态" },
    { type: "sleep", ms: 5000 },
    { type: "capture", sessionId: "session-main", lines: 30 }
  ]);
  assert.deepEqual(saved, [{ sessionId: "session-main", lines: 30, text: "after send" }]);
});

test("/api/sessions marks sessions that are waiting for confirmation", async () => {
  const sessions = [
    { id: "session-1", name: "needs-allow", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "one" },
    { id: "session-2", name: "working", kind: "codex", status: "running", cwd: "/two", tmuxSessionName: "two" },
    { id: "session-3", name: "done", kind: "runtime", status: "stopped", cwd: "/three", tmuxSessionName: "three" }
  ];
  const saved = [];
  const store = {
    list() {
      return sessions;
    },
    updateStatus() {},
    latestOutputSnapshot() {
      return null;
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const tmux = {
    async exists(record) {
      return record.status === "running";
    },
    async capture(record) {
      return record.id === "session-1" ? "allow?YES?\n1) yes\n2) no" : "still working";
    }
  };

  const { statusCode, body } = await getJson("/api/sessions", {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.deepEqual(
    parsed.sessions.map((session) => ({ name: session.name, taskState: session.taskState })),
    [
      { name: "needs-allow", taskState: "needs_confirmation" },
      { name: "working", taskState: "in_progress" },
      { name: "done", taskState: "completed" }
    ]
  );
  assert.deepEqual(saved, [
    { sessionId: "session-1", lines: 80, text: "allow?YES?\n1) yes\n2) no" },
    { sessionId: "session-2", lines: 80, text: "still working" }
  ]);
});

test("/api/nl list hides closed sessions and reports active/stopped phases", async () => {
  const idleSnapshot = { text: "task finished", capturedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
  const sessions = [
    {
      id: "session-closed",
      name: "closed-demo",
      kind: "opencode",
      status: "stopped",
      cwd: "/home/v6/work/closed-demo",
      project: "closed-demo",
      command: "env",
      commandArgs: ["TERM=xterm"],
      tmuxSessionName: "closed-demo",
      updatedAt: "2026-09-01T10:00:00.000Z"
    },
    {
      id: "session-idle",
      name: "idle-demo",
      kind: "opencode",
      status: "running",
      cwd: "/home/v6/work/demo",
      project: "demo",
      command: "env",
      commandArgs: [],
      tmuxSessionName: "idle-demo",
      updatedAt: "2026-09-19T09:00:00.000Z"
    },
    {
      id: "session-web",
      name: "WEB-PI",
      kind: "codex",
      status: "running",
      cwd: "/home/v6/work/fuluk-gateway",
      project: "fuluk-gateway",
      command: "codex",
      commandArgs: [],
      tmuxSessionName: "WEB-PI",
      updatedAt: "2026-09-19T14:00:00.000Z"
    },
    {
      id: "session-wait",
      name: "secureAgent",
      kind: "opencode",
      status: "running",
      cwd: "/home/v6/work/Secure-AI",
      project: "Secure-AI",
      command: "env",
      commandArgs: [],
      tmuxSessionName: "secureAgent",
      updatedAt: "2026-09-19T11:00:00.000Z"
    }
  ];
  const store = {
    list() {
      return sessions;
    },
    updateStatus() {},
    latestOutputSnapshot(sessionId) {
      return sessionId === "session-idle" ? idleSnapshot : null;
    },
    saveOutput() {}
  };
  const tmux = {
    async exists(record) {
      return record.status === "running";
    },
    async capture(record) {
      if (record.name === "secureAgent") return "allow?YES?\n1) yes\n2) no";
      if (record.name === "idle-demo") return "task finished";
      return "working";
    }
  };
  const context = {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  };

  const parsed = JSON.parse((await postJson("/api/nl", { text: "列出会话" }, context)).body);
  assert.deepEqual(parsed.command, { type: "list", runningOnly: false });
  assert.deepEqual(
    parsed.sessions.map((session) => session.name),
    ["WEB-PI", "secureAgent", "idle-demo"]
  );
  assert.deepEqual(
    parsed.sessions.map((session) => session.phase),
    ["active", "active", "stopped"]
  );
  assert.deepEqual(Object.keys(parsed.sessions[0]).sort(), [
    "cwd",
    "id",
    "kind",
    "name",
    "phase",
    "project",
    "status",
    "taskState",
    "updatedAt"
  ]);
  assert.equal(parsed.sessions[0].command, undefined);
  assert.equal(parsed.sessions[0].commandArgs, undefined);
  assert.equal(parsed.sessions[0].tmuxSessionName, undefined);
  assert.match(parsed.summary, /^进行中 2：/);
  assert.match(parsed.summary, /已停止 1：/);
  assert.doesNotMatch(parsed.summary, /已关闭/);
  assert.match(parsed.summary, /secureAgent（待确认）/);

  const activeOnly = JSON.parse((await postJson("/api/nl", { text: "列出进行中的会话" }, context)).body);
  assert.equal(activeOnly.command.runningOnly, true);
  assert.deepEqual(activeOnly.sessions.map((session) => session.name), ["WEB-PI", "secureAgent"]);

  const stoppedOnly = JSON.parse((await postJson("/api/nl", { text: "列出已停止的会话" }, context)).body);
  assert.equal(stoppedOnly.command.stoppedOnly, true);
  assert.deepEqual(stoppedOnly.sessions.map((session) => session.name), ["idle-demo"]);

  const closedOnly = JSON.parse((await postJson("/api/nl", { text: "列出已关闭的会话" }, context)).body);
  assert.equal(closedOnly.command.closedOnly, true);
  assert.deepEqual(closedOnly.sessions.map((session) => session.name), ["closed-demo"]);
  assert.equal(closedOnly.sessions[0].phase, "closed");
  assert.match(closedOnly.summary, /已关闭 1：/);

  const includingClosed = JSON.parse(
    (await postJson("/api/nl", { text: "列出所有会话包括已关闭" }, context)).body
  );
  assert.equal(includingClosed.command.includeClosed, true);
  assert.equal(includingClosed.sessions.length, 4);

  const verbose = JSON.parse((await postJson("/api/nl", { text: "列出会话", verbose: true }, context)).body);
  assert.equal(verbose.sessions.length, 3);
  assert.equal(verbose.sessions[0].tmuxSessionName, "WEB-PI");
  assert.equal(verbose.sessions[0].project, "fuluk-gateway");
  assert.equal(verbose.summary, parsed.summary);

  const byProject = JSON.parse(
    (await postJson("/api/nl", { text: "列出项目 demo 的会话" }, context)).body
  );
  assert.equal(byProject.command.project, "demo");
  assert.deepEqual(byProject.sessions.map((session) => session.name), ["idle-demo"]);

  const byName = JSON.parse(
    (await postJson("/api/nl", { text: "列出 web 会话" }, context)).body
  );
  assert.equal(byName.command.nameQuery, "web");
  assert.deepEqual(byName.sessions.map((session) => session.name), ["WEB-PI"]);
});

test("/api/sessions recognizes allow variants in the latest 10 non-empty lines", async () => {
  const sessions = [
    { id: "session-1", name: "allow-dot", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "one" }
  ];
  const store = {
    list() {
      return sessions;
    },
    updateStatus() {},
    latestOutputSnapshot() {
      return null;
    },
    saveOutput() {}
  };
  const tmux = {
    async exists() {
      return true;
    },
    async capture() {
      return [
        "older line outside window",
        "padding 1",
        "padding 2",
        "padding 3",
        "padding 4",
        "padding 5",
        "padding 6",
        "padding 7",
        "padding 8",
        "1.Allow",
        "2.Allow once",
        "3.Allow allways"
      ].join("\n");
    }
  };

  const { statusCode, body } = await getJson("/api/sessions", {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  assert.equal(JSON.parse(body).sessions[0].taskState, "needs_confirmation");
});

test("/api/sessions recognizes opencode permission footer", async () => {
  const sessions = [
    { id: "session-1", name: "opencode-allow", kind: "opencode", status: "running", cwd: "/one", tmuxSessionName: "one" }
  ];
  const store = {
    list() {
      return sessions;
    },
    updateStatus() {},
    latestOutputSnapshot() {
      return null;
    },
    saveOutput() {}
  };
  const tmux = {
    async exists() {
      return true;
    },
    async capture() {
      return [
        "△ Permission required",
        "← Access external directory ~/.config/opencode",
        "Allow once   Allow always   Reject  ctrl+f fullscreen  ⇆ select  enter confirm"
      ].join("\n");
    }
  };

  const { statusCode, body } = await getJson("/api/sessions", {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  assert.equal(JSON.parse(body).sessions[0].taskState, "needs_confirmation");
});

test("/api/sessions marks unchanged output older than one minute as stopped", async () => {
  const staleTime = new Date(Date.now() - 61_000).toISOString();
  const sessions = [
    { id: "session-1", name: "idle", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "one" },
    { id: "session-2", name: "confirm", kind: "codex", status: "running", cwd: "/two", tmuxSessionName: "two" },
    { id: "session-3", name: "changed", kind: "codex", status: "running", cwd: "/three", tmuxSessionName: "three" }
  ];
  const saved = [];
  const store = {
    list() {
      return sessions;
    },
    updateStatus() {},
    latestOutputSnapshot(sessionId) {
      return {
        id: 1,
        sessionId,
        capturedAt: staleTime,
        lines: 80,
        text: sessionId === "session-2" ? "Allow once   Allow always   Reject" : "same output"
      };
    },
    saveOutput(sessionId, lines, text) {
      const snapshot = { id: 2, sessionId, capturedAt: new Date().toISOString(), lines, text };
      saved.push(snapshot);
      return snapshot;
    }
  };
  const tmux = {
    async exists() {
      return true;
    },
    async capture(record) {
      if (record.id === "session-2") return "Allow once   Allow always   Reject";
      if (record.id === "session-3") return "new output";
      return "same output";
    }
  };

  const { statusCode, body } = await getJson("/api/sessions", {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(statusCode, 200);
  const parsed = JSON.parse(body);
  assert.deepEqual(
    parsed.sessions.map((session) => ({ name: session.name, taskState: session.taskState })),
    [
      { name: "idle", taskState: "completed" },
      { name: "confirm", taskState: "needs_confirmation" },
      { name: "changed", taskState: "in_progress" }
    ]
  );
  assert.deepEqual(saved.map((snapshot) => snapshot.sessionId), ["session-3"]);
});

test("/api/sessions notifies when a session changes from in progress to stopped", async () => {
  const sessions = [
    { id: "session-1", name: "idle", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "one" }
  ];
  let captureCount = 0;
  const events = [];
  const webhookRequests = [];
  const context = {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false,
      notificationWebhookUrl: "https://hooks.example/session"
    },
    store: {
      list() {
        return sessions;
      },
      updateStatus() {},
      latestOutputSnapshot() {
        return {
          id: 1,
          sessionId: "session-1",
          capturedAt: new Date(Date.now() - (captureCount > 0 ? 61_000 : 1_000)).toISOString(),
          lines: 80,
          text: "same output"
        };
      },
      saveOutput() {}
    },
    tmux: {
      async exists() {
        return true;
      },
      async capture() {
        captureCount += 1;
        return "same output";
      }
    },
    eventHub: {
      broadcast(event) {
        events.push(event);
      }
    },
    sessionTaskStates: new Map(),
    async fetchImpl(url, options) {
      webhookRequests.push({ url, body: JSON.parse(options.body) });
      return { ok: true };
    }
  };

  assert.equal((await getJson("/api/sessions", context)).statusCode, 200);
  assert.equal((await getJson("/api/sessions", context)).statusCode, 200);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "session_task_state_changed");
  assert.equal(events[0].previousTaskState, "in_progress");
  assert.equal(events[0].taskState, "completed");
  assert.equal(events[0].session.name, "idle");
  assert.equal(webhookRequests.length, 1);
  assert.equal(webhookRequests[0].url, "https://hooks.example/session");
  assert.equal(webhookRequests[0].body.taskState, "completed");
});

test("/api/sessions notifies when a session changes from in progress to needs confirmation", async () => {
  const sessions = [
    { id: "session-1", name: "confirm", kind: "opencode", status: "running", cwd: "/one", tmuxSessionName: "one" }
  ];
  let captureCount = 0;
  const events = [];
  const context = {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: { notifications: { webhookUrl: "https://hooks.example/settings" } },
      runtimeSettingsEnabled: true
    },
    store: {
      list() {
        return sessions;
      },
      updateStatus() {},
      latestOutputSnapshot() {
        return {
          id: 1,
          sessionId: "session-1",
          capturedAt: new Date().toISOString(),
          lines: 80,
          text: captureCount > 0 ? "waiting" : "working"
        };
      },
      saveOutput(sessionId, lines, text) {
        return { id: 2, sessionId, capturedAt: new Date().toISOString(), lines, text };
      }
    },
    tmux: {
      async exists() {
        return true;
      },
      async capture() {
        captureCount += 1;
        return captureCount > 1 ? "Allow once   Allow always   Reject" : "working";
      }
    },
    eventHub: {
      broadcast(event) {
        events.push(event);
      }
    },
    sessionTaskStates: new Map(),
    async fetchImpl() {
      return { ok: true };
    }
  };

  assert.equal((await getJson("/api/sessions", context)).statusCode, 200);
  assert.equal((await getJson("/api/sessions", context)).statusCode, 200);

  assert.equal(events.length, 1);
  assert.equal(events[0].previousTaskState, "in_progress");
  assert.equal(events[0].taskState, "needs_confirmation");
  assert.equal(events[0].session.name, "confirm");
});

test("/api/nl switch can target a session by list position", async () => {
  const sessions = [
    { id: "session-1", name: "first", kind: "codex", status: "running", cwd: "/one", tmuxSessionName: "session-1" },
    { id: "session-2", name: "second", kind: "codex", status: "running", cwd: "/two", tmuxSessionName: "session-2" }
  ];
  const saved = [];
  const store = {
    list() {
      return sessions;
    },
    saveOutput(sessionId, lines, text) {
      saved.push({ sessionId, lines, text });
    }
  };
  const captures = [];
  const tmux = {
    async capture(record, lines) {
      captures.push({ sessionId: record.id, lines });
      return "second output";
    }
  };
  const req = Readable.from([JSON.stringify({ text: "切换到第二个会话", currentSessionId: "first" })]);
  req.method = "POST";
  req.url = "/api/nl";
  req.headers = {
    host: "localhost",
    authorization: "Bearer secret"
  };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store,
    tmux
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), {
    command: {
      type: "switch",
      target: null,
      targetIndex: 2
    },
    session: compactSession(sessions[1]),
    output: "second output"
  });
  assert.deepEqual(captures, [{ sessionId: "session-2", lines: 120 }]);
  assert.deepEqual(saved, [{ sessionId: "session-2", lines: 120, text: "second output" }]);
});

test("/api/sessions defaults missing cwd to /home/v6/work/session-name", async () => {
  const records = [];
  const context = createCreateSessionContext({ records });
  const { statusCode, body } = await postJson("/api/sessions", {
    kind: "runtime",
    name: "local-shell"
  }, context);

  assert.equal(statusCode, 201);
  const parsed = JSON.parse(body);
  assert.equal(parsed.session.cwd, "/home/v6/work/local-shell");
  assert.equal(records[0].cwd, "/home/v6/work/local-shell");
});

test("/api/nl create uses default cwd when command omits working directory", async () => {
  const records = [];
  const context = createCreateSessionContext({ records });
  const { statusCode, body } = await postJson("/api/nl", {
    text: "新建一个 codex 会话 web-ai-agent",
    currentSessionId: null
  }, context);

  assert.equal(statusCode, 201);
  const parsed = JSON.parse(body);
  assert.equal(parsed.command.input.cwd, undefined);
  assert.equal(parsed.session.cwd, "/home/v6/work/web-ai-agent");
  assert.equal(records[0].cwd, "/home/v6/work/web-ai-agent");
});

test("/api/nl rejects AI parser create guesses without explicit create intent", async () => {
  const records = [];
  const context = createCreateSessionContext({ records });
  context.config.runtimeSettings = {
    commandParser: {
      enabled: true,
      baseUrl: "http://parser.test/v1",
      model: "parser"
    }
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "create",
                input: { kind: "codex", name: "guessed-window", project: null }
              })
            }
          }
        ]
      };
    }
  });

  try {
    const { statusCode, body } = await postJson("/api/nl", {
      text: "整理一下当前项目结构",
      currentSessionId: "session-main"
    }, context);

    assert.equal(statusCode, 400);
    assert.match(JSON.parse(body).error, /explicit create-session request/);
    assert.equal(records.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/api/sessions rejects runtime session when allowRuntimeMode is false", async () => {
  const records = [];
  const context = createCreateSessionContext({ records });
  context.config.allowRuntimeMode = false;

  const { statusCode, body } = await postJson("/api/sessions", {
    kind: "runtime",
    name: "local-shell"
  }, context);

  assert.equal(statusCode, 400);
  const parsed = JSON.parse(body);
  assert.match(parsed.error, /Runtime mode is disabled/);
  assert.equal(records.length, 0);
});

test("/api/sessions allows runtime session when allowRuntimeMode is true", async () => {
  const records = [];
  const context = createCreateSessionContext({ cwdMode: "host", records });
  context.config.allowRuntimeMode = true;

  const { statusCode, body } = await postJson("/api/sessions", {
    kind: "runtime",
    name: "local-shell"
  }, context);

  assert.equal(statusCode, 201);
  assert.equal(records.length, 1);
  assert.equal(records[0].kind, "runtime");
});

test("security headers are added to responses", async () => {
  const context = createCreateSessionContext({ records: [] });
  const { statusCode, headers } = await postJson("/api/sessions", { kind: "codex", name: "test" }, context);

  assert.equal(statusCode, 201);
  // HTTP headers are case-sensitive in JS objects, match exact casing from SECURITY_HEADERS
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-XSS-Protection"], "1; mode=block");
});

test("/api/nl assistant enable/disable takes effect without a server restart", async () => {
  const emitJson = (server, method, url, payload) =>
    new Promise((resolve) => {
      const req = Readable.from(payload === null ? [] : [JSON.stringify(payload)]);
      req.method = method;
      req.url = url;
      req.headers = { host: "localhost", authorization: "Bearer secret", "content-type": "application/json" };
      req.socket = { remoteAddress: "127.0.0.1" };
      const res = {
        statusCode: null,
        headers: null,
        body: "",
        writeHead(statusCode, headers) {
          this.statusCode = statusCode;
          this.headers = headers;
        },
        end(body = "") {
          this.body = String(body);
          resolve(res);
        }
      };
      server.emit("request", req, res);
    });
  const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-agent-toggle-"));
  const settingsPath = path.join(settingsDir, "settings.json");
  const sessions = [
    {
      id: "session-1",
      name: "alpha",
      kind: "codex",
      status: "running",
      cwd: "/one",
      project: "alpha",
      tmuxSessionName: "alpha",
      updatedAt: "2026-09-19T10:00:00.000Z"
    }
  ];
  const store = {
    list() {
      return sessions;
    },
    updateStatus() {},
    latestOutputSnapshot() {
      return null;
    },
    saveOutput() {}
  };
  const tmux = {
    async exists(record) {
      return record.status === "running";
    },
    async capture() {
      return "working";
    }
  };
  let managerBuilds = 0;
  const server = createSessionGatewayServer({
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      databasePath: path.join(settingsDir, "test.sqlite"),
      settingsPath,
      runtimeSettingsEnabled: true,
      runtimeSettings: {
        commandParser: { enabled: false, mode: "rules-only" },
        notifications: { webhookUrl: "" },
        sessionAgent: { enabled: false, model: "openai:gpt-5.2", apiKey: "k", models: {}, resetOnConfigChange: false }
      }
    },
    store,
    tmux,
    createSessionAgentManager() {
      managerBuilds += 1;
      return {
        runCount: 0,
        async run(text) {
          this.runCount += 1;
          return { command: { type: "assistant", source: "fake" }, ok: true, answer: `llm:${text}` };
        },
        reset() {}
      };
    }
  });

  // Disabled at startup: /api/nl goes through the rule parser, not the LLM.
  const disabled = JSON.parse((await emitJson(server, "POST", "/api/nl", { text: "列出会话" })).body);
  assert.equal(disabled.command.type, "list");
  assert.equal(managerBuilds, 0);

  // Enable via PUT /api/config (what the web checkbox does): no restart.
  const enabledResponse = await emitJson(server, "PUT", "/api/config", {
      settings: { sessionAgent: { enabled: true, model: "openai:gpt-5.2", apiKey: "k", models: {}, resetOnConfigChange: false } }
    });
  const enabledSettings = JSON.parse(enabledResponse.body).settings;
  assert.equal(enabledSettings.sessionAgent.enabled, true);

  const enabled = JSON.parse((await emitJson(server, "POST", "/api/nl", { text: "你好" })).body);
  assert.equal(enabled.command.type, "assistant");
  assert.equal(enabled.answer, "llm:你好");
  assert.equal(managerBuilds, 1);

  // Disable again: immediately falls back to the rule parser.
  await emitJson(server, "PUT", "/api/config", {
    settings: { sessionAgent: { enabled: false, model: "openai:gpt-5.2", apiKey: "k", models: {}, resetOnConfigChange: false } }
  });
  const again = JSON.parse((await emitJson(server, "POST", "/api/nl", { text: "列出会话" })).body);
  assert.equal(again.command.type, "list");
  server.close();
});

test("/api/config preserves existing notifications and sessionAgent when saving partial settings", async () => {
  const writes = [];
  const context = createCreateSessionContext({ records: [] });
  context.config.settingsPath = "/tmp/session-gateway-test-settings.json";
  context.config.runtimeSettingsEnabled = true;
  context.config.runtimeSettings = {
    commandParser: { enabled: false, mode: "rules-only" },
    notifications: { webhookUrl: "https://hooks.example/settings" },
    sessionAgent: {
      model: "openai:gpt-5.2",
      apiKey: "agent-key",
      models: {
        local: {
          qwen: {
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:11434/v1",
            contextWindow: 128000,
            maxTokens: 4096
          }
        }
      }
    }
  };
  context.sessionAgentManager = {
    reset() {
      writes.push("reset");
    }
  };

  const { statusCode, body } = await putJson("/api/config", {
    settings: {
      commandParser: { enabled: false, mode: "rules-only" }
    }
  }, context);

  assert.equal(statusCode, 200);
  const settings = JSON.parse(body).settings;
  assert.equal(settings.notifications.webhookUrl, "https://hooks.example/settings");
  assert.equal(settings.sessionAgent.model, "openai:gpt-5.2");
  assert.equal(settings.sessionAgent.apiKey, "agent-key");
  assert.equal(settings.sessionAgent.models.local.qwen.baseUrl, "http://127.0.0.1:11434/v1");
  assert.deepEqual(writes, ["reset"]);
});

function createCreateSessionContext({ records }) {
  return {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {},
      runtimeSettingsEnabled: false
    },
    store: {
      findByIdOrName(idOrName) {
        return records.find((record) => record.id === idOrName || record.name === idOrName) ?? null;
      },
      create(input, command, commandArgs) {
        const record = {
          id: "session-1",
          name: input.name,
          kind: input.kind,
          cwd: input.cwd,
          project: input.project ?? null,
          tmuxSessionName: input.name,
          command,
          commandArgs,
          status: "running"
        };
        records.push(record);
        return record;
      },
      setCliSessionId(_id, _value) {}
    },
    tmux: {
      resolveCreateCommand(input) {
        const command = input.kind === "runtime" ? "/bin/bash" : input.kind === "claude" ? "claude" : input.kind;
        return { command, args: [] };
      },
      async ensureAvailable() {},
      async exists() {
        return false;
      },
      async validateCreateInput() {},
      async create() {}
    }
  };
}

async function postJson(url, payload, context) {
  return requestJson("POST", url, payload, context);
}

async function putJson(url, payload, context) {
  return requestJson("PUT", url, payload, context);
}

async function requestJson(method, url, payload, context) {
  const req = Readable.from([JSON.stringify(payload)]);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost",
    authorization: "Bearer secret"
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, context);
  return res;
}

async function getJson(url, context) {
  const req = Readable.from([]);
  req.method = "GET";
  req.url = url;
  req.headers = {
    host: "localhost",
    authorization: "Bearer secret"
  };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body);
    }
  };

  await handleSessionGatewayRequest(req, res, context);
  return res;
}

test("/api/sessions/:id/prompt returns approve and reject choices", async () => {
  const session = { id: "session-1", name: "main", kind: "codex", status: "running" };
  const store = {
    findByIdOrName(value) {
      return value === session.id ? session : null;
    }
  };
  const tmux = {
    async capture() {
      return "Do you want to run npm install?\n1) yes\n2) no";
    }
  };
  const context = {
    config: { authToken: "secret", runtimeSettings: {} },
    store,
    tmux
  };

  const confirmed = await getJson("/api/sessions/session-1/prompt", context);
  assert.equal(confirmed.statusCode, 200);
  const payload = JSON.parse(confirmed.body);
  assert.equal(payload.needsConfirmation, true);
  assert.deepEqual(payload.choices.approve, { send: "input", value: "1" });
  assert.deepEqual(payload.choices.reject, { send: "input", value: "2" });

  tmux.capture = async () => "plain output without a prompt";
  const idle = await getJson("/api/sessions/session-1/prompt", context);
  assert.deepEqual(JSON.parse(idle.body), { needsConfirmation: false });
});

test("/api/sessions publishes a transition to the configured ntfy server", async () => {
  const sessions = [
    { id: "session-1", name: "confirm", kind: "opencode", status: "running", cwd: "/one", tmuxSessionName: "one" }
  ];
  const ntfyRequests = [];
  const context = {
    config: {
      authToken: "secret",
      allowRuntimeMode: true,
      runtimeSettings: {
        notifications: {
          ntfy: { server: "https://ntfy.example", topic: "fuluk", token: "ntfy-token", enabled: true }
        }
      }
    },
    store: {
      list() {
        return sessions;
      },
      updateStatus() {},
      latestOutputSnapshot() {
        return { id: 1, sessionId: "session-1", capturedAt: new Date().toISOString(), lines: 80, text: "x" };
      },
      saveOutput() {}
    },
    tmux: {
      async exists() {
        return true;
      },
      captureCount: 0,
      async capture() {
        this.captureCount += 1;
        return this.captureCount === 1 ? "working on task" : "1) yes\n2) no";
      }
    },
    eventHub: { broadcast() {} },
    sessionTaskStates: new Map(),
    async fetchImpl(url, options) {
      ntfyRequests.push({ url, options, body: options.body });
      return { ok: true };
    }
  };

  assert.equal((await getJson("/api/sessions", context)).statusCode, 200);
  assert.equal((await getJson("/api/sessions", context)).statusCode, 200);
  assert.equal(ntfyRequests.length, 1);
  const parsedUrl = new URL(ntfyRequests[0].url);
  assert.equal(`${parsedUrl.origin}${parsedUrl.pathname}`, "https://ntfy.example/fuluk");
  assert.equal(parsedUrl.searchParams.get("title"), "confirm 等待确认");
  assert.equal(parsedUrl.searchParams.get("priority"), "4");
  assert.equal(parsedUrl.searchParams.get("tags"), "question");
  assert.equal(parsedUrl.searchParams.get("click"), "fuluk://session/session-1");
  assert.equal(ntfyRequests[0].options.headers.authorization, "Bearer ntfy-token");
  assert.equal(ntfyRequests[0].body, "confirm 等待确认");
});

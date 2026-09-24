import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CAPTURE_LINES,
  captureCliSessionId,
  checkResumeFailure,
  isResumableKind,
  parseCliSessionId,
  restartSession,
  runProbeWithBudget,
  readClaudeLocalSessionId,
  readCodexLocalSessionId,
  readOpencodeLocalSessionId,
  scheduleCaptureAfterCreate,
  stripAnsi
} from "../src/session_resume.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, "fixtures", "cli-session", name), "utf8");

test("isResumableKind only accepts codex/claude/opencode", () => {
  assert.equal(isResumableKind("codex"), true);
  assert.equal(isResumableKind("claude"), true);
  assert.equal(isResumableKind("opencode"), true);
  assert.equal(isResumableKind("runtime"), false);
  assert.equal(isResumableKind("pi-os"), false);
});

test("parseCliSessionId extracts a codex UUID from fixture output", () => {
  assert.equal(
    parseCliSessionId("codex", fixture("codex.txt")),
    "7a3f1c9e-4b2a-4f1c-9d8e-1a2b3c4d5e6f"
  );
});

test("parseCliSessionId extracts a codex UUID from /status output", () => {
  assert.equal(
    parseCliSessionId("codex", fixture("codex-status.txt")),
    "7a3f1c9e-4b2a-4f1c-9d8e-1a2b3c4d5e6f"
  );
});

test("parseCliSessionId extracts a claude UUID from fixture output", () => {
  assert.equal(
    parseCliSessionId("claude", fixture("claude.txt")),
    "8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a"
  );
});

test("parseCliSessionId extracts an opencode ses_ handle from fixture output", () => {
  assert.equal(
    parseCliSessionId("opencode", fixture("opencode.txt")),
    "ses_f98dfabb4ffeL107W2NGuKCelf"
  );
});

test("parseCliSessionId returns null when no handle is present", () => {
  assert.equal(parseCliSessionId("claude", "Welcome to Claude Code\nno id here"), null);
  assert.equal(parseCliSessionId("opencode", "opencode v1.18.27\nno id"), null);
  assert.equal(parseCliSessionId("codex", "codex-cli 0.152.0\nno id"), null);
});

test("parseCliSessionId rejects handles with shell-significant chars (injection defense)", () => {
  // A UUID cannot contain '; rm -rf', so this must not match.
  assert.equal(parseCliSessionId("claude", "session id: 8b2c4d6e; rm -rf /"), null);
  // opencode handle cannot contain spaces or shell metachars.
  assert.equal(parseCliSessionId("opencode", "session: ses_evil; rm -rf /"), null);
  assert.equal(parseCliSessionId("opencode", "session: ses_ with space"), null);
});

test("parseCliSessionId returns null for non-resumable kinds", () => {
  assert.equal(parseCliSessionId("runtime", "session id: 8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a"), null);
});

test("stripAnsi removes escape sequences", () => {
  assert.equal(stripAnsi("green text"), "green text");
});

test("CAPTURE_LINES is 80", () => {
  assert.equal(CAPTURE_LINES, 80);
});

test("runProbeWithBudget short-circuits on a truthy attempt", async () => {
  const budget = new Map();
  const sleeps = [];
  let attempts = 0;
  const result = await runProbeWithBudget("k1", async () => {
    attempts += 1;
    return attempts === 2;
  }, { max: 3, baseDelayMs: 10, factor: 2, sleep: async (ms) => sleeps.push(ms), budget });

  assert.equal(result, true);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [10]); // slept once between attempt 1 (false) and attempt 2 (true)
});

test("runProbeWithBudget retries up to max then returns false", async () => {
  const budget = new Map();
  const sleeps = [];
  let attempts = 0;
  const result = await runProbeWithBudget("k2", async () => {
    attempts += 1;
    return false;
  }, { max: 3, baseDelayMs: 10, factor: 2, sleep: async (ms) => sleeps.push(ms), budget });

  assert.equal(result, false);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [10, 20]); // base*factor^0, base*factor^1
  assert.equal(budget.get("k2"), 3);
});

test("runProbeWithBudget respects an already-exhausted budget", async () => {
  const budget = new Map([["k3", 3]]);
  let attempts = 0;
  await runProbeWithBudget("k3", async () => {
    attempts += 1;
    return true;
  }, { max: 3, sleep: async () => {}, budget });
  assert.equal(attempts, 0);
});

function fakeStore(session) {
  let stored = session.cliSessionId ?? null;
  return {
    current: () => ({ ...session, cliSessionId: stored }),
    findByIdOrName: () => ({ ...session, cliSessionId: stored }),
    setCliSessionId: (_id, value) => {
      stored = value;
    }
  };
}

test("captureCliSessionId stores a handle parsed from provided output", async () => {
  const session = {
    id: "s1", kind: "claude", status: "running", cliSessionId: null, tmuxSessionName: "sg-s1"
  };
  const store = fakeStore(session);
  let captured;
  const tmux = { capture: async () => (captured ?? fixture("claude.txt")) };

  const stored = await captureCliSessionId("s1", { store, tmux, config: { cliStartupDelayMs: 0 } }, {
    output: fixture("claude.txt")
  });

  assert.equal(stored, true);
  assert.equal(store.current().cliSessionId, "8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a");
});

test("captureCliSessionId skips when a handle is already stored", async () => {
  const session = {
    id: "s2", kind: "claude", status: "running",
    cliSessionId: "8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a", tmuxSessionName: "sg-s2"
  };
  const store = fakeStore(session);
  let captureCalls = 0;
  const tmux = { capture: async () => { captureCalls += 1; return ""; } };

  const stored = await captureCliSessionId("s2", { store, tmux, config: { cliStartupDelayMs: 0 } });

  assert.equal(stored, false);
  assert.equal(captureCalls, 0);
});

test("captureCliSessionId skips non-running and non-resumable sessions", async () => {
  const stopped = { id: "s3", kind: "claude", status: "stopped", cliSessionId: null, tmuxSessionName: "sg-s3" };
  const runtime = { id: "s4", kind: "runtime", status: "running", cliSessionId: null, tmuxSessionName: "sg-s4" };
  for (const session of [stopped, runtime]) {
    const store = fakeStore(session);
    const tmux = { capture: async () => "" };
    const stored = await captureCliSessionId(session.id, { store, tmux, config: { cliStartupDelayMs: 0 } });
    assert.equal(stored, false);
  }
});

test("readCodexLocalSessionId finds the rollout for the session cwd", () => {
  const session = { id: "s5", kind: "codex", cwd: "/tmp/codex-proj" };
  const id = readCodexLocalSessionId(
    session,
    path.join(__dirname, "fixtures", "codex-sessions")
  );
  assert.equal(id, "01a0d252-543f-7933-bc28-4989e08c1a78");
});

test("readCodexLocalSessionId ignores rollouts for other cwds", () => {
  const session = { id: "s5", kind: "codex", cwd: "/tmp/codex-proj" };
  const id = readCodexLocalSessionId(
    session,
    path.join(__dirname, "fixtures", "codex-sessions-other")
  );
  assert.equal(id, null);
});

test("captureCliSessionId stores codex id from local rollout without injecting /status", async () => {
  const session = { id: "s5", kind: "codex", status: "running", cliSessionId: null, tmuxSessionName: "sg-s5", cwd: "/tmp/codex-proj" };
  const store = fakeStore(session);
  const sends = [];
  const tmux = {
    capture: async () => "codex-cli 0.156.0\n(no id in banner)",
    send: async (_record, text) => sends.push(text),
    sleep: async () => {}
  };

  const stored = await captureCliSessionId(
    "s5",
    { store, tmux, config: { codexStorageHome: path.join(__dirname, "fixtures", "codex-sessions") } },
    { output: "codex-cli 0.156.0\n(no id)" }
  );

  assert.equal(stored, true);
  assert.deepEqual(sends, []); // nothing typed into the TUI
  assert.equal(store.current().cliSessionId, "01a0d252-543f-7933-bc28-4989e08c1a78");
});

test("captureCliSessionId returns false for codex when no rollout exists yet", async () => {
  const session = { id: "s6", kind: "codex", status: "running", cliSessionId: null, tmuxSessionName: "sg-s6", cwd: "/tmp/codex-proj" };
  const store = fakeStore(session);
  const sends = [];
  const tmux = {
    capture: async () => "codex-cli 0.152.0\n(no id)",
    send: async (_record, text) => sends.push(text),
    sleep: async () => {}
  };

  const stored = await captureCliSessionId(
    "s6",
    { store, tmux, config: { codexStorageHome: path.join(__dirname, "fixtures", "codex-sessions-other") } }
  );

  assert.equal(stored, false);
  assert.deepEqual(sends, []); // never injects /status
});

test("captureCliSessionId swallows errors and returns false", async () => {
  const session = { id: "s7", kind: "claude", status: "running", cliSessionId: null, tmuxSessionName: "sg-s7" };
  const store = fakeStore(session);
  const tmux = { capture: async () => { throw new Error("boom"); } };

  const stored = await captureCliSessionId("s7", { store, tmux, config: { cliStartupDelayMs: 0 } });
  assert.equal(stored, false);
});

test("checkResumeFailure detects a claude resume-failure signature", async () => {
  const session = {
    id: "s8", kind: "claude", status: "running",
    cliSessionId: "dead-id", tmuxSessionName: "sg-s8"
  };
  const store = fakeStore(session);
  const tmux = { capture: async () => "Error: could not resume session\n$ " };
  assert.equal(await checkResumeFailure("s8", { store, tmux }), true);
});

test("checkResumeFailure returns false on healthy output", async () => {
  const session = {
    id: "s9", kind: "claude", status: "running",
    cliSessionId: "alive-id", tmuxSessionName: "sg-s9"
  };
  const store = fakeStore(session);
  const tmux = { capture: async () => "Welcome to Claude Code\n> " };
  assert.equal(await checkResumeFailure("s9", { store, tmux }), false);
});

test("restartSession restarts, marks running, and clears a failed handle", async () => {
  const session = {
    id: "s10", kind: "claude", status: "stopped",
    cliSessionId: "dead-id", tmuxSessionName: "sg-s10"
  };
  const state = { status: "stopped", cliSessionId: "dead-id" };
  const store = {
    findByIdOrName: () => ({ ...session, status: state.status, cliSessionId: state.cliSessionId }),
    markRunning: () => { state.status = "running"; },
    setCliSessionId: (_id, value) => { state.cliSessionId = value; }
  };
  const events = [];
  const tmux = {
    restart: async () => {},
    capture: async () => "Error: could not resume session\n$ "
  };
  const context = {
    store, tmux,
    config: { cliStartupDelayMs: 0 },
    eventHub: { broadcast: (e) => events.push(e) }
  };

  await restartSession(session, context);
  // The post-restart probe runs on a 0ms timer; flush pending macrotasks.
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(state.cliSessionId, null);
  assert.deepEqual(events, [{ type: "session_resume_failed", sessionId: "s10", kind: "claude" }]);
});

test("restartSession does not clear a healthy resumed handle", async () => {
  const session = {
    id: "s11", kind: "claude", status: "stopped",
    cliSessionId: "alive-id", tmuxSessionName: "sg-s11"
  };
  const state = { status: "stopped", cliSessionId: "alive-id" };
  const store = {
    findByIdOrName: () => ({ ...session, status: state.status, cliSessionId: state.cliSessionId }),
    markRunning: () => { state.status = "running"; },
    setCliSessionId: (_id, value) => { state.cliSessionId = value; }
  };
  const events = [];
  const tmux = { restart: async () => {}, capture: async () => "Welcome to Claude Code\n> " };
  const context = {
    store, tmux,
    config: { cliStartupDelayMs: 0 },
    eventHub: { broadcast: (e) => events.push(e) }
  };

  await restartSession(session, context);
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(state.cliSessionId, "alive-id");
  assert.deepEqual(events, []);
});

test("restartSession skips the probe for non-resumable kinds", async () => {
  const restarted = [];
  const session = { id: "s12", kind: "runtime", status: "stopped", tmuxSessionName: "sg-s12" };
  const store = { markRunning: () => {} };
  const tmux = { restart: async () => restarted.push(true) };
  const context = { store, tmux, config: { cliStartupDelayMs: 0 }, eventHub: { broadcast: () => {} } };

  await restartSession(session, context);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(restarted, [true]);
});

test("scheduleCaptureAfterCreate is a no-op for non-resumable kinds", async () => {
  // Should not throw and should not schedule anything observable for runtime.
  scheduleCaptureAfterCreate(
    { id: "s13", kind: "runtime" },
    { store: {}, tmux: {}, config: { cliStartupDelayMs: 0 } }
  );
  assert.ok(true);
});


test("readClaudeLocalSessionId reads the newest local session file for a cwd", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-gw-"));
  const projDir = path.join(tmp, ".claude", "projects", "-home-v6-work");
  fs.mkdirSync(projDir, { recursive: true });
  const older = "11111111-2222-3333-4444-555555555555.jsonl";
  const newer = "d756cafc-31f7-41be-a1e2-7fbf3159be29.jsonl";
  fs.writeFileSync(path.join(projDir, older), "");
  fs.writeFileSync(path.join(projDir, newer), "");
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(projDir, older), past, past);
  assert.equal(
    readClaudeLocalSessionId({ cwd: "/home/v6/work" }, tmp),
    "d756cafc-31f7-41be-a1e2-7fbf3159be29"
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readClaudeLocalSessionId returns null when no session files exist", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-gw-"));
  fs.mkdirSync(path.join(tmp, "-home-v6-work"), { recursive: true });
  assert.equal(readClaudeLocalSessionId({ cwd: "/home/v6/work" }, tmp), null);
  assert.equal(readClaudeLocalSessionId({ cwd: "/home/v6/work/missing" }, tmp), null);
  assert.equal(readClaudeLocalSessionId({ cwd: "" }, tmp), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("captureCliSessionId stores claude handle read from local storage (Fallback B)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-gw-"));
  const projDir = path.join(tmp, ".claude", "projects", "-home-v6-work");
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, "d756cafc-31f7-41be-a1e2-7fbf3159be29.jsonl"), "");
  const session = {
    id: "s9", kind: "claude", status: "running", cliSessionId: null,
    tmuxSessionName: "sg-s9", cwd: "/home/v6/work"
  };
  const store = fakeStore(session);
  const tmux = { capture: async () => "Claude Code v2.1.193 - no plaintext handle in banner" };

  const stored = await captureCliSessionId("s9", { store, tmux, config: { cliStartupDelayMs: 0, claudeStorageHome: tmp } });

  assert.equal(stored, true);
  assert.equal(store.current().cliSessionId, "d756cafc-31f7-41be-a1e2-7fbf3159be29");
  fs.rmSync(tmp, { recursive: true, force: true });
});

function createOpencodeStorage() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gw-"));
  const db = new DatabaseSync(path.join(tmp, "opencode.db"));
  db.exec(`
    create table session (
      id text primary key,
      directory text not null,
      time_created integer not null,
      time_archived integer
    );
    create table message (
      id text primary key,
      session_id text not null,
      data text not null
    );
  `);
  return { tmp, db };
}

function insertOpencodeSession(db, id, directory, timeCreated, role, timeArchived = null) {
  db.prepare(
    "insert into session (id, directory, time_created, time_archived) values (?, ?, ?, ?)"
  ).run(id, directory, timeCreated, timeArchived);
  if (role) {
    db.prepare("insert into message (id, session_id, data) values (?, ?, ?)").run(
      `msg_${id}`,
      id,
      JSON.stringify({ role })
    );
  }
}

test("readOpencodeLocalSessionId reads the newest active session with a user message for a cwd", () => {
  const { tmp, db } = createOpencodeStorage();
  insertOpencodeSession(db, "ses_aaaaaaaaaaaaaaaaaaaaaaaa", "/home/v6/work", 100, "user");
  insertOpencodeSession(db, "ses_bbbbbbbbbbbbbbbbbbbbbbbb", "/home/v6/work", 200, "user");
  insertOpencodeSession(db, "ses_cccccccccccccccccccccccc", "/home/v6/work", 300, "assistant");
  insertOpencodeSession(db, "ses_dddddddddddddddddddddddd", "/home/v6/work", 400, "user", 401);
  insertOpencodeSession(db, "ses_eeeeeeeeeeeeeeeeeeeeeeee", "/home/v6/other", 500, "user");
  db.close();

  assert.equal(
    readOpencodeLocalSessionId({ cwd: "/home/v6/work" }, tmp),
    "ses_bbbbbbbbbbbbbbbbbbbbbbbb"
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readOpencodeLocalSessionId returns null when no usable session exists", () => {
  const { tmp, db } = createOpencodeStorage();
  insertOpencodeSession(db, "ses_cccccccccccccccccccccccc", "/home/v6/work", 300, "assistant");
  db.close();

  assert.equal(readOpencodeLocalSessionId({ cwd: "/home/v6/work" }, tmp), null);
  assert.equal(readOpencodeLocalSessionId({ cwd: "/home/v6/missing" }, tmp), null);
  assert.equal(readOpencodeLocalSessionId({ cwd: "" }, tmp), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("readOpencodeLocalSessionId ignores sessions created before this gateway session", () => {
  const { tmp, db } = createOpencodeStorage();
  insertOpencodeSession(db, "ses_aaaaaaaaaaaaaaaaaaaaaaaa", "/home/v6/work", 100, "user");
  db.close();

  assert.equal(
    readOpencodeLocalSessionId({ cwd: "/home/v6/work", createdAt: new Date().toISOString() }, tmp),
    null
  );
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("captureCliSessionId stores opencode handle read from local SQLite storage (Fallback B)", async () => {
  const { tmp, db } = createOpencodeStorage();
  insertOpencodeSession(db, "ses_f98dfabb4ffeL107W2NGuKCelf", "/home/v6/work", 200, "user");
  db.close();

  const session = {
    id: "s14", kind: "opencode", status: "running", cliSessionId: null,
    tmuxSessionName: "sg-s14", cwd: "/home/v6/work",
    createdAt: new Date(0).toISOString()
  };
  const store = fakeStore(session);
  const tmux = { capture: async () => "opencode TUI with no plaintext handle visible" };

  const stored = await captureCliSessionId("s14", {
    store,
    tmux,
    config: { cliStartupDelayMs: 0, opencodeStorageHome: tmp }
  });

  assert.equal(stored, true);
  assert.equal(store.current().cliSessionId, "ses_f98dfabb4ffeL107W2NGuKCelf");
  fs.rmSync(tmp, { recursive: true, force: true });
});

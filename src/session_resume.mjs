// Session resume orchestration: parse CLI session handles, capture them in the
// background, and resume on restart. See
// docs/superpowers/specs/2026-09-03-session-resume-design.md

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const CAPTURE_LINES = 80;
export const CAPTURE_DELAY_BUFFER_MS = 500;

const RESUMABLE_KINDS = new Set(["codex", "claude", "opencode"]);

const HANDLE_PATTERNS = {
  codex: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  claude: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  opencode: /ses_[0-9A-Za-z]{20,}/
};

export function isResumableKind(kind) {
  return RESUMABLE_KINDS.has(kind);
}

const claudeProjectDir = (cwd, home) =>
  cwd ? path.join(home, ".claude", "projects", cwd.replace(/[/.]/g, "-")) : null;

// Fallback B (claude): read the newest local session file claude writes after its
// first message. claude's --session-id flag does NOT create a resumable session
// (verified against claude 2.1.193), so the only reliable handle is the real
// <uuid>.jsonl under ~/.claude/projects/<escaped-cwd>/. baseDir overrides the home
// for tests; production uses os.homedir().
export function readClaudeLocalSessionId(session, baseDir) {
  const home = baseDir ?? os.homedir();
  const dir = claudeProjectDir(session.cwd, home);
  if (!dir) return null;
  try {
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const newest = files[0];
    return newest ? newest.name.replace(/\.jsonl$/, "") : null;
  } catch {
    return null;
  }
}

function defaultCodexStorageHome() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function listFilesRecursive(dir) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}

// Fallback B (codex): codex writes a rollout-<timestamp>-<uuid>.jsonl under
// ~/.codex/sessions/<year>/<month>/<day>/ as soon as the TUI starts. Its first
// line is a session_meta event carrying session_id + cwd, so the handle is
// available without injecting /status into the TUI (which newer codex builds
// fail to auto-submit while startup tips are showing).
export function readCodexLocalSessionId(session, baseDir) {
  if (!session?.cwd) return null;
  const storageHome = baseDir ?? defaultCodexStorageHome();
  if (!fs.existsSync(storageHome)) return null;
  const resolvedCwd = path.resolve(session.cwd);
  const createdAtMs = Number.isFinite(Date.parse(session.createdAt ?? ""))
    ? Date.parse(session.createdAt)
    : null;
  try {
    const files = listFilesRecursive(storageHome)
      .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const { file } of files) {
      let firstLine;
      try {
        firstLine = fs.readFileSync(file, "utf8").split("\n")[0];
      } catch {
        continue;
      }
      let meta;
      try {
        meta = JSON.parse(firstLine).payload;
      } catch {
        continue;
      }
      if (!meta || meta.cwd == null || path.resolve(meta.cwd) !== resolvedCwd) continue;
      const startedAtMs = Date.parse(meta.timestamp ?? "");
      if (createdAtMs !== null && Number.isFinite(startedAtMs) && startedAtMs < createdAtMs - 60_000) {
        continue;
      }
      const id = meta.session_id ?? meta.id;
      if (typeof id === "string" && HANDLE_PATTERNS.codex.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}

function defaultOpencodeStorageHome() {
  return path.join(os.homedir(), ".local", "share", "opencode");
}

// Fallback B (opencode): read the newest real session for this cwd from
// opencode's local SQLite database. A row exists before the first user message,
// so require a user message and exclude archived sessions. baseDir is the
// opencode data directory that contains opencode.db; production uses
// ~/.local/share/opencode.
export function readOpencodeLocalSessionId(session, baseDir) {
  if (!session?.cwd) return null;
  const storageHome = baseDir ?? defaultOpencodeStorageHome();
  const databasePath = path.join(storageHome, "opencode.db");
  if (!fs.existsSync(databasePath)) return null;

  let db;
  try {
    const createdAtMs = Date.parse(session.createdAt ?? "");
    const parameters = [path.resolve(session.cwd)];
    let createdAtFilter = "";
    if (Number.isFinite(createdAtMs)) {
      createdAtFilter = " and s.time_created >= ?";
      parameters.push(createdAtMs - 60_000);
    }
    db = new DatabaseSync(databasePath, { readOnly: true });
    const row = db
      .prepare(
        `select s.id
           from session s
          where s.directory = ?
            and s.time_archived is null
            ${createdAtFilter}
            and exists (
              select 1
                from message m
               where m.session_id = s.id
                 and json_extract(m.data, '$.role') = 'user'
            )
          order by s.time_created desc
          limit 1`
      )
      .get(...parameters);
    const id = row?.id;
    return typeof id === "string" && HANDLE_PATTERNS.opencode.test(id) ? id : null;
  } catch {
    return null;
  } finally {
    db?.close?.();
  }
}

export function stripAnsi(text) {
  return String(text ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

// Pure: extract + validate the CLI session handle from output, or null.
// The regex is format-anchored, so shell-significant chars never match.
export function parseCliSessionId(kind, text) {
  const pattern = HANDLE_PATTERNS[kind];
  if (!pattern) return null;
  const match = stripAnsi(text).match(pattern);
  return match ? match[0] : null;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const probeBudget = new Map(); // key -> attempt count; resets on process restart

// Generic budgeted retry driver. Runs `attempt` up to `max` times with
// exponential spacing, short-circuiting on a truthy return. `budget` is a Map
// shared across call sites by key (e.g. "capture:<id>", "failure:<id>").
export async function runProbeWithBudget(key, attempt, options = {}) {
  const {
    max = 3,
    baseDelayMs = 3000,
    factor = 2,
    sleep = defaultSleep,
    budget = probeBudget
  } = options;

  while ((budget.get(key) ?? 0) < max) {
    const attemptIndex = budget.get(key) ?? 0;
    budget.set(key, attemptIndex + 1);
    if (attemptIndex > 0) await sleep(baseDelayMs * factor ** (attemptIndex - 1));
    const result = await attempt(); // eslint-disable-line no-await-in-loop
    if (result) return true;
  }
  return false;
}
// Single capture attempt. Idempotent. Returns true if a handle was stored.
// Handles are read from each CLI's local storage; nothing is injected into the
// running TUI.
export async function captureCliSessionId(sessionId, context, { output } = {}) {
  const { store, tmux, config } = context;
  try {
    const session = store.findByIdOrName(sessionId);
    if (!session) return false;
    if (!isResumableKind(session.kind)) return false;
    if (session.cliSessionId) return false;
    if (session.status !== "running") return false;

    const captured = output ?? await tmux.capture(session, CAPTURE_LINES);
    let id = parseCliSessionId(session.kind, captured);
    if (id) {
      store.setCliSessionId(session.id, id);
      return true;
    }

    if (session.kind === "claude") {
      const local = readClaudeLocalSessionId(session, context.config?.claudeStorageHome);
      if (local) {
        store.setCliSessionId(session.id, local);
        return true;
      }
    }

    if (session.kind === "codex") {
      const local = readCodexLocalSessionId(session, context.config?.codexStorageHome);
      if (local) {
        store.setCliSessionId(session.id, local);
        return true;
      }
    }

    if (session.kind === "opencode") {
      const local = readOpencodeLocalSessionId(session, context.config?.opencodeStorageHome);
      if (local) {
        store.setCliSessionId(session.id, local);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
// Per-kind resume-failure signatures. Adjusted from real output captured in
// Task 1's feasibility check; first-cut guesses below.
const FAILURE_SIGNATURES = {
  codex: /(?:session[^\n]{0,40}not found|no session)/i,
  claude: /(?:no session|could not resume|session not found)/i,
  opencode: /(?:session not found|no session)/i
};

export async function checkResumeFailure(sessionId, context) {
  const { store, tmux } = context;
  try {
    const session = store.findByIdOrName(sessionId);
    if (!session || !isResumableKind(session.kind)) return false;
    if (session.status !== "running") return false;
    const output = stripAnsi(await tmux.capture(session, CAPTURE_LINES));
    const sig = FAILURE_SIGNATURES[session.kind];
    return sig ? sig.test(output) : false;
  } catch {
    return false;
  }
}

// Funnel for all restart call sites: restart tmux, mark running, and (when a
// handle was used) schedule a budgeted post-restart failure probe that clears
// the handle + broadcasts if resume failed.
export async function restartSession(session, context) {
  const { tmux, store, config } = context;
  await tmux.restart(session);
  store.markRunning(session.id);

  if (!isResumableKind(session.kind) || !session.cliSessionId) return;
  const delay = config.cliStartupDelayMs ?? 3000;
  const timer = setTimeout(() => {
    runProbeWithBudget(`failure:${session.id}`, () => checkResumeFailure(session.id, context), {
      max: 3,
      baseDelayMs: delay,
      factor: 2
    }).then((failed) => {
      if (!failed) return;
      store.setCliSessionId(session.id, null);
      context.eventHub?.broadcast({
        type: "session_resume_failed",
        sessionId: session.id,
        kind: session.kind
      });
    });
  }, delay);
  timer.unref?.();
}

// One-shot capture scheduled after a fresh create. Budgeted internally so
// headless creates retry without depending on the poll.
export function scheduleCaptureAfterCreate(session, context) {
  if (!isResumableKind(session.kind)) return;
  const delay = (context.config?.cliStartupDelayMs ?? 3000) + CAPTURE_DELAY_BUFFER_MS;
  const timer = setTimeout(() => {
    runProbeWithBudget(`capture:${session.id}`, () => captureCliSessionId(session.id, context), {
      max: 3,
      baseDelayMs: context.config?.cliStartupDelayMs ?? 3000,
      factor: 2
    });
  }, delay);
  timer.unref?.();
}

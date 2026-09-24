import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWithLocalModel } from "./ai_parser.mjs";
import { loadConfig, updateRuntimeSettings } from "./config.mjs";
import { isAuthorizedHeader } from "./auth.mjs";
import { parseNaturalCommand } from "./nl.mjs";
import { createSessionAgentManager } from "./session_agent.mjs";
import { SessionStore } from "./store.mjs";
import { TmuxBackend } from "./tmux.mjs";
import { newId, normalizeLines, outputEtag, readJsonBody, sanitizeTmuxName } from "./utils.mjs";
import {
  captureCliSessionId,
  isResumableKind,
  restartSession,
  scheduleCaptureAfterCreate,
  stripAnsi
} from "./session_resume.mjs";
import { findPrompt, hasConfirmationPrompt } from "./prompt.mjs";
import { GlassPairingStore } from "./glass_pairing.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");
const SEND_FOLLOWUP_DELAY_MS = 5_000;
const SEND_FOLLOWUP_LINES = 30;
const SESSION_LIST_OUTPUT_LINES = 80;
const IDLE_OUTPUT_STOPPED_MS = 60_000;

// Security headers for all responses
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 300;
const RATE_LIMIT_UI_POLL_MAX_REQUESTS = 1_200;
const rateLimitStore = new Map();

export function createSessionGatewayServer(options = {}) {
  const config = options.config ?? loadConfig();
  const store = options.store ?? new SessionStore(config.databasePath);
  const tmux = options.tmux ?? new TmuxBackend(config);
  const staticDir = options.publicDir ?? publicDir;
  const eventHub = options.eventHub ?? new SessionEventHub();
  const sessionTaskStates = options.sessionTaskStates ?? new Map();
  const glassPairingPath =
    options.glassPairingPath ?? path.resolve(path.dirname(config.databasePath), "glass-pairing.json");
  const glassPairingStore = options.glassPairingStore ?? new GlassPairingStore(glassPairingPath);
  const context = { config, store, tmux, publicDir: staticDir, eventHub, sessionTaskStates, glassPairingStore };
  const createManager = options.createSessionAgentManager ?? createSessionAgentManager;
  context.sessionAgentManager =
    options.sessionAgentManager ??
    (config.runtimeSettings?.sessionAgent?.enabled
      ? createManager(context, createSessionAgentOperations(context))
      : null);
  context.sessionAgentManagerInjected = options.sessionAgentManager !== undefined;
  // Lazily create the agent manager when the assistant is enabled at runtime
  // (the checkbox in the web UI only writes settings; without this, enabling
  // it required a server restart).
  context.ensureSessionAgentManager = () => {
    const enabled = Boolean(context.config.runtimeSettings?.sessionAgent?.enabled);
    if (enabled && !context.sessionAgentManager) {
      context.sessionAgentManager = createManager(
        context,
        createSessionAgentOperations(context)
      );
    }
    if (!enabled && !context.sessionAgentManagerInjected) return null;
    return context.sessionAgentManager;
  };

  let notificationPollTimer = null;
  const pollNotifications = async () => {
    try {
      await listSessionsWithTaskState(context);
    } catch (error) {
      console.warn(`Session task notification poll failed: ${errorMessage(error)}`);
    }
  };
  const scheduleNotificationPoll = () => {
    clearTimeout(notificationPollTimer);
    const hasWebhook = Boolean(config.notificationWebhookUrl || config.runtimeSettings?.notifications?.webhookUrl);
    const hasWebSocketClients = typeof eventHub.hasClients === "function" && eventHub.hasClients();
    if (!hasWebhook && !hasWebSocketClients) return;
    if (config.notificationPollMs <= 0) return;
    notificationPollTimer = setTimeout(async () => {
      await pollNotifications();
      scheduleNotificationPoll();
    }, config.notificationPollMs);
    notificationPollTimer.unref?.();
  };
  eventHub.onClientChange = scheduleNotificationPoll;
  const server = http.createServer((req, res) => handleRequest(req, res, context));
  server.on("upgrade", (req, socket, head) => handleWebSocketUpgrade(req, socket, head, context));
  server.on("listening", () => {
    scheduleNotificationPoll();
  });
  server.on("close", () => {
    clearTimeout(notificationPollTimer);
  });
  return server;
}

export async function handleSessionGatewayRequest(req, res, context) {
  return handleRequest(req, res, context);
}

async function handleRequest(req, res, context) {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const clientIp = getClientIp(req);
      const budget = rateLimitBudget(url, req.method ?? "GET");
      if (!checkRateLimit(`${clientIp}:${budget.bucket}`, budget.maxRequests)) {
        sendJson(res, 429, { error: "Too many requests. Please try again later." });
        return;
      }
    }

    if (url.pathname === "/health") {
      await handleHealth(res, context);
      return;
    }

    if (url.pathname === "/api/glass/pair" || url.pathname === "/api/glass/status") {
      await handleGlassPairingRequest(req, res, url, context);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (!isAuthorized(req, context)) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      try {
        await handleApi(req, res, url, context);
      } catch (error) {
        sendJson(res, 400, { error: errorMessage(error) });
      }
      return;
    }

    await serveStatic(res, url.pathname, context);
  } catch (error) {
    sendJson(res, 500, { error: errorMessage(error) });
  }
}

async function handleGlassAdmin(req, res, pathname, context) {
  const method = req.method ?? "GET";
  const store = context.glassPairingStore;
  if (pathname === "/api/glass/pending" && method === "GET") {
    sendJson(res, 200, { pending: store.listPending() });
    return;
  }
  if (pathname === "/api/glass/keys" && method === "GET") {
    sendJson(res, 200, { keys: store.listKeys() });
    return;
  }
  if (pathname === "/api/glass/approve" && method === "POST") {
    const body = await readJsonBody(req);
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!store.approve(key)) throw new Error("配对请求不存在或已过期");
    sendJson(res, 200, { ok: true });
    return;
  }
  if (pathname === "/api/glass/reject" && method === "POST") {
    const body = await readJsonBody(req);
    store.reject(typeof body.key === "string" ? body.key.trim() : "");
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: "Not found" });
}

async function handleGlassPairingRequest(req, res, url, context) {
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  try {
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const key = typeof body.key === "string" ? body.key.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!/^[a-f0-9]{32,128}$/.test(key)) {
        sendJson(res, 400, { error: "key is required" });
        return;
      }
      sendJson(res, 200, { status: context.glassPairingStore.requestPair({ key, name }) });
      return;
    }
    const key = url.searchParams.get("key") || "";
    if (!key) {
      sendJson(res, 400, { error: "key is required" });
      return;
    }
    sendJson(res, 200, { status: context.glassPairingStore.status(key) });
  } catch (error) {
    sendJson(res, 400, { error: errorMessage(error) });
  }
}

async function handleHealth(res, { tmux }) {
  try {
    await tmux.ensureAvailable();
    sendJson(res, 200, { ok: true, tmux: true });
  } catch (error) {
    sendJson(res, 503, { ok: false, tmux: false, error: errorMessage(error) });
  }
}

async function handleApi(req, res, url, context) {
  const method = req.method ?? "GET";
  const pathname = url.pathname;
  const { config, store } = context;

  if (method === "GET" && pathname === "/api/sessions") {
    const sessions = await listSessionsWithTaskState(context);
    sendJson(res, 200, { sessions });
    return;
  }

  if (method === "POST" && pathname === "/api/sessions") {
    const body = await readJsonBody(req);
    const input = parseCreateInput(body, context);
    const session = await createSession(input, context);
    sendJson(res, 201, { session });
    return;
  }

  if (method === "POST" && pathname === "/api/nl") {
    await handleNaturalLanguage(req, res, context);
    return;
  }

  if (
    pathname === "/api/glass/pending" ||
    pathname === "/api/glass/keys" ||
    pathname === "/api/glass/approve" ||
    pathname === "/api/glass/reject"
  ) {
    await handleGlassAdmin(req, res, pathname, context);
    return;
  }
  if (pathname === "/api/glass/revoke") {
    if (method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const body = await readJsonBody(req);
    const revoked = context.glassPairingStore.revoke(
      typeof body.key === "string" ? body.key.trim() : ""
    );
    sendJson(res, 200, { ok: revoked });
    return;
  }

  if (method === "GET" && pathname === "/api/history") {
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "200", 10) || 200));
    const history = store.listAllInputHistory(limit);
    sendJson(res, 200, { history });
    return;
  }

  if (method === "GET" && pathname === "/api/config") {
    sendJson(res, 200, { settings: config.runtimeSettings, enabled: config.runtimeSettingsEnabled });
    return;
  }

  if (method === "PUT" && pathname === "/api/config") {
    const body = await readJsonBody(req);
    const wasEnabled = Boolean(config.runtimeSettings?.sessionAgent?.enabled);
    const settings = updateRuntimeSettings(config, { ...config.runtimeSettings, ...(body.settings ?? body) });
    const isEnabled = Boolean(settings.sessionAgent?.enabled);
    if (isEnabled && !wasEnabled) {
      context.sessionAgentManager?.reset?.();
    } else if (wasEnabled && !isEnabled && !context.sessionAgentManagerInjected) {
      // Disabling takes effect immediately: drop the manager so /api/nl
      // falls back to the rule-based parser until it is enabled again.
      context.sessionAgentManager = null;
    } else {
      context.sessionAgentManager?.reset?.();
    }
    sendJson(res, 200, { settings });
    return;
  }

  const sessionRoute = pathname.match(/^\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
  if (sessionRoute) {
    const idOrName = decodeURIComponent(sessionRoute[1]);
    const action = sessionRoute[2] ?? "";
    await handleSessionAction(req, res, url, method, idOrName, action, context);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function handleSessionAction(req, res, url, method, idOrName, action, context) {
  const { store, tmux } = context;
  const session = requireSession(idOrName, context);

  if (method === "GET" && action === "output") {
    const lines = normalizeLines(url.searchParams.get("lines"));
    const offset = normalizeOutputOffset(url.searchParams.get("offset"));
    const raw = url.searchParams.get("raw") === "1";
    const captureOptions = raw
      ? { preserveEscapes: true, alternateScreen: true, offset }
      : { offset };
    const text = await tmux.capture(session, lines, captureOptions);
    const etag = outputEtag(text, String(lines) + ":" + String(offset));
    if (url.searchParams.get("format") === "json") {
      const changed = url.searchParams.get("etag") !== etag;
      if (changed && offset === 0) store.saveOutput(session.id, lines, text);
      sendJson(res, 200, changed ? { changed, etag, output: text } : { changed, etag });
      return;
    }
    if (offset === 0) store.saveOutput(session.id, lines, text);
    sendText(res, 200, text);
    return;
  }

  if (method === "GET" && action === "history") {
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    const history = store.listInputHistory(session.id, limit);
    sendJson(res, 200, { history });
    return;
  }

  if (method === "GET" && action === "prompt") {
    const lines = normalizeLines(url.searchParams.get("lines"));
    const output = await tmux.capture(session, lines);
    const prompt = findPrompt(output);
    if (!prompt) {
      sendJson(res, 200, { needsConfirmation: false });
      return;
    }
    sendJson(res, 200, {
      needsConfirmation: true,
      sessionId: session.id,
      signature: prompt.signature,
      context: prompt.context,
      choices: { approve: prompt.approve, reject: prompt.reject }
    });
    return;
  }

  if (method === "POST" && action === "input") {
    const body = await readJsonBody(req);
    if (typeof body.text !== "string" || !body.text.trim()) throw new Error("text is required");
    await tmux.send(session, body.text);
    store.saveInput(session.id, body.text);
    store.touch(session.id);
    if ((session.kind === "claude" || session.kind === "opencode") && !session.cliSessionId) {
      setTimeout(() => {
        captureCliSessionId(session.id, context).catch(() => {});
      }, 1500);
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && action === "keys") {
    const body = await readJsonBody(req);
    const keys = parseTmuxKeys(body.keys);
    await tmux.sendKeys(session, keys);
    store.touch(session.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && action === "resize") {
    const body = await readJsonBody(req);
    const size = parseTmuxSize(body);
    await tmux.resize(session, size.cols, size.rows);
    store.touch(session.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "POST" && action === "restart") {
    await restartSession(session, context);
    sendJson(res, 200, { session: store.findByIdOrName(session.id) });
    return;
  }

  if (method === "DELETE" && action === "") {
    await tmux.stop(session);
    store.updateStatus(session.id, "stopped");
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === "DELETE" && action === "delete") {
    await tmux.stop(session);
    store.delete(session.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function normalizeOutputOffset(value) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 5000);
}

function parseTmuxKeys(value) {
  if (!Array.isArray(value) || !value.length) throw new Error("keys are required");
  return value.map((key) => {
    if (typeof key !== "string" || !key.trim()) throw new Error("keys must be non-empty strings");
    const normalized = normalizeTmuxKey(key.trim());
    if (!isAllowedTmuxKey(normalized)) throw new Error(`tmux key is not allowed: ${normalized}`);
    return normalized;
  });
}

function parseTmuxSize(value) {
  const cols = Number(value?.cols);
  const rows = Number(value?.rows);
  if (!Number.isInteger(cols) || cols < 20 || cols > 500) throw new Error("cols must be an integer between 20 and 500");
  if (!Number.isInteger(rows) || rows < 5 || rows > 200) throw new Error("rows must be an integer between 5 and 200");
  return { cols, rows };
}

function normalizeTmuxKey(key) {
  if (key === "PageUp") return "PPage";
  if (key === "PageDown") return "NPage";
  return key;
}

function isAllowedTmuxKey(key) {
  return (
    /^[A-Za-z0-9]$/.test(key) ||
    /^C-[A-Za-z]$/.test(key) ||
    /^(Enter|Escape|Space|Tab|BTab|Up|Down|Left|Right|BSpace|DC|Home|End|PPage|NPage|WheelUpPane|WheelDownPane)$/.test(key)
  );
}

async function handleNaturalLanguage(req, res, context) {
  const body = await readJsonBody(req);
  if (typeof body.text !== "string") throw new Error("text is required");
  const sessionAgentManager =
    context.ensureSessionAgentManager?.() ?? context.sessionAgentManager;
  if (sessionAgentManager?.run) {
    const result = await context.sessionAgentManager.run(body.text, {
      currentSessionId: body.currentSessionId
    });
    sendJson(res, 200, result);
    return;
  }
  const { store, tmux } = context;

  const command = await parseCommand(body.text, context);
  if (command.type === "create") {
    const session = await createSession(command.input, context);
    sendJson(res, 201, { command, session });
    return;
  }

  if (command.type === "help") {
    sendJson(res, 200, { command, help: commandHelpText() });
    return;
  }

  if (command.type === "list") {
    let sessions = await listSessionsWithTaskState(context);
    sessions = filterListSessions(sessions, command, { includeClosed: body.includeClosed === true });
    if (command.project) {
      sessions = sessions.filter((session) => sessionMatchesProject(session, command.project));
    }
    if (command.nameQuery) {
      const query = command.nameQuery.toLowerCase();
      sessions = sessions.filter((session) => session.name.toLowerCase().includes(query));
    }
    sessions = sortSessionsByActivity(sessions);
    const summary = buildSessionsSummary(sessions);
    if (isVerboseRequestBody(body)) {
      sendJson(res, 200, { command, sessions, summary });
    } else {
      sendJson(res, 200, { command, sessions: sessions.map(summarizeSession), summary });
    }
    return;
  }

  if (command.type === "send") {
    const session = requireCommandSession(command, body, context);
    await tmux.send(session, command.text);
    saveInputIfSupported(store, session.id, command.text);
    store.touch(session.id);
    const output = await captureAfterSend(session, context);
    sendJson(res, 200, { command, ok: true, session: summarizeSession(session), output });
    return;
  }

  if (command.type === "output") {
    const session = requireCommandSession(command, body, context);
    const text = await tmux.capture(session, command.lines);
    store.saveOutput(session.id, command.lines, text);
    sendJson(res, 200, { command, session: summarizeSession(session), output: text });
    return;
  }

  if (command.type === "switch") {
    const session = requireCommandSession(command, body, context);
    const text = await tmux.capture(session, 120);
    store.saveOutput(session.id, 120, text);
    sendJson(res, 200, { command, session: summarizeSession(session), output: text });
    return;
  }

  if (command.type === "stop") {
    const session = requireCommandSession(command, body, context);
    await tmux.stop(session);
    store.updateStatus(session.id, "stopped");
    sendJson(res, 200, { command, ok: true });
    return;
  }

  if (command.type === "restart") {
    const session = requireCommandSession(command, body, context);
    await restartSession(session, context);
    sendJson(res, 200, { command, session: store.findByIdOrName(session.id) });
  }
}

function isVerboseRequestBody(body) {
  return body.verbose === true || body.detailed === true || body.full === true;
}

function summarizeSession(session) {
  return {
    id: session.id,
    name: session.name,
    kind: session.kind,
    status: session.status,
    taskState: session.taskState ?? null,
    phase: sessionPhase(session),
    project: session.project ?? null,
    cwd: session.cwd,
    updatedAt: session.updatedAt
  };
}

// active: tmux session alive and task running/waiting
// stopped: tmux session alive but task completed (can still be resumed)
// closed: tmux session no longer exists
function sessionPhase(session) {
  if (session.status !== "running") return "closed";
  return session.taskState === "completed" ? "stopped" : "active";
}

function filterListSessions(sessions, command = {}, options = {}) {
  let result = sessions;
  if (command.closedOnly) {
    return result.filter((session) => sessionPhase(session) === "closed");
  }
  if (!options.includeClosed && !command.includeClosed) {
    result = result.filter((session) => sessionPhase(session) !== "closed");
  }
  if (command.stoppedOnly) {
    result = result.filter((session) => sessionPhase(session) === "stopped");
  }
  if (command.runningOnly) {
    result = result.filter((session) => sessionPhase(session) === "active");
  }
  return result;
}

function sortSessionsByActivity(sessions) {
  return [...sessions].sort(
    (left, right) =>
      new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() -
      new Date(left.updatedAt ?? left.createdAt ?? 0).getTime()
  );
}

function sessionMatchesProject(session, project) {
  return (session.project ?? "").toLowerCase() === String(project).toLowerCase();
}

function buildSessionsSummary(sessions) {
  const groups = [
    { label: "进行中", phase: "active", items: [] },
    { label: "已停止", phase: "stopped", items: [] },
    { label: "已关闭", phase: "closed", items: [] }
  ];
  for (const session of sessions) {
    const phase = sessionPhase(session);
    groups.find((group) => group.phase === phase)?.items.push(session);
  }
  const parts = groups
    .filter((group) => group.items.length > 0)
    .map(
      (group) =>
        `${group.label} ${group.items.length}：${group.items.map(sessionSummaryLabel).join("、")}`
    );
  return parts.length ? parts.join("；") : "没有会话";
}

function sessionSummaryLabel(session) {
  const phase = sessionPhase(session);
  const baseName =
    phase === "active" && session.taskState === "needs_confirmation"
      ? `${session.name}（待确认）`
      : session.name;
  const project =
    session.project || session.cwd?.split("/").filter(Boolean).at(-1) || null;
  const suffixParts = [session.kind, project && project !== session.name ? project : null].filter(Boolean);
  return suffixParts.length ? `${baseName}(${suffixParts.join("/")})` : baseName;
}

function createSessionAgentOperations(context) {
  let currentRequest = {};
  const withCurrentRequest = (params = {}) => ({ ...currentRequest, ...params });
  const isSummaryRequest = () => /总结|摘要|概括|归纳|summary|summari[sz]e|recap/i.test(String(currentRequest.text ?? ""));
  return {
    setCurrentRequest(request = {}) {
      currentRequest = request;
    },
    async list_sessions(params = {}) {
      const sessions = sortSessionsByActivity(
        filterListSessions(await listSessionsWithTaskState(context), params, {
          includeClosed: params.includeClosed === true
        }).filter((session) => {
          if (params.project && !sessionMatchesProject(session, params.project)) return false;
          if (params.nameQuery && !session.name.toLowerCase().includes(String(params.nameQuery).toLowerCase())) {
            return false;
          }
          return true;
        })
      );
      const summary = buildSessionsSummary(sessions);
      // Return compact summaries by default; only full JSON when detailed=true
      if (params.detailed) {
        if (!params.includeOutputLines) return { sessions, summary };
        const lines = normalizeLines(params.includeOutputLines);
        const enriched = [];
        for (const session of sessions) {
          let output = "";
          if (session.status === "running") {
            try {
              output = await context.tmux.capture(session, lines);
              context.store.saveOutput(session.id, lines, output);
            } catch {
              output = "";
            }
          }
          enriched.push({ ...session, output });
        }
        return { sessions: enriched, summary };
      }
      return { sessions: sessions.map(summarizeSession), summary };
    },
    async get_session_output(params = {}) {
      const command = {
        type: "output",
        target: params.target ?? null,
        targetIndex: params.targetIndex,
        lines: params.lines ?? (isSummaryRequest() ? 50 : 50)
      };
      const session = requireCommandSession(command, withCurrentRequest(params), context);
      const output = await context.tmux.capture(session, command.lines);
      context.store.saveOutput(session.id, command.lines, output);
      return { session, output };
    },
    async send_to_session(params = {}) {
      const command = { type: "send", target: params.target ?? null, targetIndex: params.targetIndex, text: params.text };
      if (typeof command.text !== "string" || !command.text.trim()) throw new Error("text is required");
      const session = requireCommandSession(command, withCurrentRequest(params), context);
      await context.tmux.send(session, command.text);
      saveInputIfSupported(context.store, session.id, command.text);
      context.store.touch(session.id);
      const output = await captureAfterSend(session, context);
      return { ok: true, session, output };
    },
    async send_keys_to_session(params = {}) {
      const command = { type: "keys", target: params.target ?? null, targetIndex: params.targetIndex };
      const session = requireCommandSession(command, withCurrentRequest(params), context);
      const keys = parseTmuxKeys(params.keys);
      await context.tmux.sendKeys(session, keys);
      context.store.touch(session.id);
      return { ok: true, session, keys };
    },
    async switch_session(params = {}) {
      const command = { type: "switch", target: params.target ?? null, targetIndex: params.targetIndex };
      const session = requireCommandSession(command, withCurrentRequest(params), context);
      const output = await context.tmux.capture(session, 120);
      context.store.saveOutput(session.id, 120, output);
      return { session, output };
    },
    async stop_session(params = {}) {
      const command = { type: "stop", target: params.target ?? null, targetIndex: params.targetIndex };
      const session = requireCommandSession(command, withCurrentRequest(params), context);
      await context.tmux.stop(session);
      context.store.updateStatus(session.id, "stopped");
      return { ok: true, session: context.store.findByIdOrName(session.id) ?? { ...session, status: "stopped" } };
    },
    async restart_session(params = {}) {
      const command = { type: "restart", target: params.target ?? null, targetIndex: params.targetIndex };
      const session = requireCommandSession(command, withCurrentRequest(params), context);
      await restartSession(session, context);
      return { session: context.store.findByIdOrName(session.id) };
    },
    async create_session(params = {}) {
      if (!isSessionKind(params.kind)) throw new Error("kind must be codex, claude, opencode, pi-os, or runtime");
      if (params.kind === "runtime" && !context.config.allowRuntimeMode) {
        throw new Error("Runtime mode is disabled on this server. Set SESSION_GATEWAY_ALLOW_RUNTIME=true to enable.");
      }
      const session = await createSession({
        kind: params.kind,
        cwd: typeof params.cwd === "string" && params.cwd.trim() ? params.cwd.trim() : undefined,
        name: typeof params.name === "string" ? params.name : undefined,
        project: typeof params.project === "string" ? params.project : null,
        commandArgs: []
      }, context);
      return { session };
    },
    async summarize_session_states() {
      const sessions = await listSessionsWithTaskState(context);
      const groups = sessions.reduce((acc, session) => {
        const key = session.taskState ?? session.status;
        acc[key] = acc[key] ?? [];
        acc[key].push(session.name);
        return acc;
      }, {});
      return JSON.stringify({ groups }, null, 2);
    },

  };
}

async function captureAfterSend(session, { config, store, tmux }) {
  const delayMs = config.sendFollowupDelayMs ?? SEND_FOLLOWUP_DELAY_MS;
  if (delayMs > 0) {
    if (typeof tmux.sleep === "function") {
      await tmux.sleep(delayMs);
    } else {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  const output = await tmux.capture(session, SEND_FOLLOWUP_LINES);
  store.saveOutput(session.id, SEND_FOLLOWUP_LINES, output);
  return output;
}

function saveInputIfSupported(store, sessionId, text) {
  if (typeof store.saveInput === "function") store.saveInput(sessionId, text);
}

async function parseCommand(text, { config }) {
  let command;
  const parser = config.runtimeSettings?.commandParser;

  if (parser?.mode === "web-ai-agent-pi" && parser.webAiAgentPiUrl) {
    try {
      command = await parseWithWebAiAgentPi(text, parser);
    } catch (error) {
      console.warn(`web-ai-agent-pi parser failed, falling back to rules: ${errorMessage(error)}`);
      command = parseNaturalCommand(text);
    }
    assertAiCreateIntent(command, text);
    return command;
  }

  try {
    command = parseNaturalCommand(text);
  } catch (ruleError) {
    if (errorMessage(ruleError).startsWith("Ambiguous natural-language command:")) throw ruleError;
    if (!parser?.enabled) throw ruleError;
    command = await parseWithLocalModel(text, config.runtimeSettings);
    assertAiCreateIntent(command, text);
  }
  return command;
}

async function parseWithWebAiAgentPi(text, parser) {
  const headers = { "content-type": "application/json" };
  if (parser.webAiAgentPiToken) {
    headers["authorization"] = `Bearer ${parser.webAiAgentPiToken}`;
  }

  const response = await fetch(`${parser.webAiAgentPiUrl}/api/nl`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error(`web-ai-agent-pi request failed: ${response.status}`);
  }

  const data = await response.json();
  return convertWebAiAgentPiCommand(data);
}

function convertWebAiAgentPiCommand(data) {
  const type = data.command?.type;
  if (!type) throw new Error("Invalid web-ai-agent-pi response: missing command type");

  if (type === "list") {
    return { type: "list", runningOnly: false };
  }

  if (type === "create") {
    return {
      type: "create",
      input: {
        kind: data.command.kind || "codex",
        cwd: data.command.cwd,
        name: data.command.name,
        project: null
      }
    };
  }

  if (type === "send") {
    return {
      type: "send",
      target: data.session || null,
      text: data.output || ""
    };
  }

  if (type === "output") {
    return {
      type: "output",
      target: data.session || null,
      lines: 100
    };
  }

  if (type === "stop") {
    return { type: "stop", target: data.session || null };
  }

  if (type === "restart") {
    return { type: "restart", target: data.session || null };
  }

  return { type: "help" };
}

function assertAiCreateIntent(command, text) {
  if (command.type !== "create") return;
  if (hasExplicitCreateIntent(text)) return;
  throw new Error("Create command requires an explicit create-session request");
}

function hasExplicitCreateIntent(text) {
  const kind = "codex|claude\\s+code|claud\\s+code|claude|claud|opencode|open code|pi-os|pi os|runtime|本地";
  return (
    new RegExp(`(?:新建|创建|建|启动)(?:一个)?\\s*(?:${kind})?\\s*会话`, "iu").test(text) ||
    new RegExp(`(?:新建|创建|建|启动)(?:一个)?\\s*(?:${kind})`, "iu").test(text) ||
    new RegExp(`^(?:create|new|start)\\s+(?:a\\s+)?(?:${kind})(?:\\s+session)?\\b`, "iu").test(text) ||
    /^(?:create|new|start)\s+(?:a\s+)?session\b/iu.test(text)
  );
}

function currentSessionId(body) {
  if (typeof body.currentSessionId === "string" && body.currentSessionId.trim()) {
    return body.currentSessionId.trim();
  }
  throw new Error("Command requires a target session or selected current session");
}

function requireCommandSession(command, body, context) {
  if (command.targetIndex) return requireSessionByIndex(command.targetIndex, context);
  return requireSession(command.target ?? currentSessionId(body), context);
}

function requireSessionByIndex(index, { store }) {
  const sessions = store.list();
  const session = sessions[index - 1];
  if (!session) throw new Error(`Session not found at position: ${index}`);
  return session;
}

function commandHelpText() {
  return [
    "Run Command supports these safe actions:",
    "帮助 / help",
    "列出会话 / list sessions",
    "查询会话列表",
    "列出运行中的会话 / list running sessions",
    "新建 codex 会话 app，目录 /workspace/app",
    "create codex session app in /workspace/app",
    "查看会话 / 查看绘画：显示当前会话最近 50 行",
    "发送 修改一下返回的列数 / send inspect this repo",
    "发送到 web-ai-agent 会话 修改配置",
    "发送 修改配置 到 web-ai-agent 会话",
    "发送到第五个会话 修改配置",
    "把消息发给 codex-app：npm test / send npm test to codex-app",
    "codex-app 最近 200 行输出 / output codex-app 200",
    "进入 codex-app / use codex-app",
    "停止 codex-app / stop codex-app",
    "重启 codex-app / restart codex-app"
  ].join("\n");
}

async function createSession(input, context) {
  const { store, tmux } = context;
  const preparedInput = prepareCreateInput(input);
  const commandSpec = tmux.resolveCreateCommand(preparedInput);
  await tmux.ensureAvailable();
  const existingSession = findExistingNamedSession(preparedInput, context);
  if (existingSession) {
    const isRunning = await tmux.exists(existingSession);
    store.updateStatus(existingSession.id, isRunning ? "running" : "stopped");
    if (isRunning) {
      throw new Error(`Session name already exists and is running: ${existingSession.name}`);
    }
  }
  await tmux.validateCreateInput(preparedInput, commandSpec);

  const session = existingSession
    ? store.replace(existingSession.id, preparedInput, commandSpec.command, commandSpec.args)
    : store.create(preparedInput, commandSpec.command, commandSpec.args);


  try {
    await tmux.create(session);
    scheduleCaptureAfterCreate(session, context);
    return session;
  } catch (error) {
    store.updateStatus(session.id, "stopped");
    throw error;
  }
}

function prepareCreateInput(input) {
  const name = input.name?.trim() || `${input.kind}-${newId().slice(0, 8)}`;
  if (typeof input.cwd === "string" && input.cwd.trim()) {
    return { ...input, name, cwd: input.cwd.trim() };
  }

  return {
    ...input,
    name,
    cwd: defaultCwdForSession(name)
  };
}

function defaultCwdForSession(name) {
  return path.posix.join("/home/v6/work", sanitizeTmuxName(name));
}

async function refreshStatuses(sessions, { store, tmux }) {
  for (const session of sessions) {
    const exists = await tmux.exists(session);
    const nextStatus = exists ? "running" : "stopped";
    if (nextStatus !== session.status) store.updateStatus(session.id, nextStatus);
  }
  return store.list();
}

async function listSessionsWithTaskState(context) {
  const sessions = await refreshStatuses(context.store.list(), context);
  const annotated = await annotateSessionsTaskState(sessions, context);
  await dispatchSessionTaskTransitions(annotated, context);
  return annotated;
}

async function annotateSessionsTaskState(sessions, context) {
  const { store, tmux } = context;
  const annotated = [];
  for (const session of sessions) {
    let snapshot = typeof store.latestOutputSnapshot === "function" ? store.latestOutputSnapshot(session.id) : null;
    let output = snapshot?.text ?? "";
    if (session.status === "running" && typeof tmux.capture === "function") {
      try {
        const captured = await tmux.capture(session, SESSION_LIST_OUTPUT_LINES);
        if (captured !== output && typeof store.saveOutput === "function") {
          snapshot = store.saveOutput(session.id, SESSION_LIST_OUTPUT_LINES, captured, { touch: false });
        }
        output = captured;
      } catch {
        // Keep the status list useful even if one tmux pane cannot be captured.
      }
    }
    if (isResumableKind(session.kind) && !session.cliSessionId) {
      await captureCliSessionId(session.id, context, { output });
    }
    const taskState = detectTaskState(session, output, snapshot);
    annotated.push({ ...session, taskState, phase: sessionPhase({ ...session, taskState }) });
  }
  return annotated;
}

function detectTaskState(session, output, snapshot) {
  if (session.status !== "running") return "completed";
  if (hasConfirmationPrompt(output)) return "needs_confirmation";
  if (isOutputIdle(snapshot)) return "completed";
  return "in_progress";
}

function isOutputIdle(snapshot) {
  if (!snapshot?.capturedAt) return false;
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAt)) return false;
  return Date.now() - capturedAt >= IDLE_OUTPUT_STOPPED_MS;
}

async function dispatchSessionTaskTransitions(sessions, context) {
  if (!context.sessionTaskStates) context.sessionTaskStates = new Map();
  const notifications = [];
  for (const session of sessions) {
    const previousTaskState = context.sessionTaskStates.get(session.id);
    context.sessionTaskStates.set(session.id, session.taskState);
    if (!shouldNotifyTaskTransition(previousTaskState, session.taskState)) continue;
    notifications.push({
      type: "session_task_state_changed",
      session,
      previousTaskState,
      taskState: session.taskState,
      changedAt: new Date().toISOString()
    });
  }

  for (const event of notifications) {
    context.eventHub?.broadcast(event);
    await sendSessionWebhook(event, context);
    await sendNtfyNotification(event, context);
  }
}

function shouldNotifyTaskTransition(previousTaskState, taskState) {
  return previousTaskState === "in_progress" && (taskState === "completed" || taskState === "needs_confirmation");
}

async function sendSessionWebhook(event, { config, fetchImpl = fetch }) {
  const webhookUrl = config.notificationWebhookUrl || config.runtimeSettings?.notifications?.webhookUrl;
  if (!webhookUrl) return;
  try {
    await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });
  } catch (error) {
    console.warn(`Session task webhook failed: ${errorMessage(error)}`);
  }
}

async function sendNtfyNotification(event, { config, tmux, fetchImpl = fetch }) {
  const ntfy = config.runtimeSettings?.notifications?.ntfy;
  if (!ntfy?.enabled) return;
  const session = event.session;
  const needsConfirm = event.taskState === "needs_confirmation";
  const message = needsConfirm
    ? `会话:${session.name} 需要审核`
    : `会话:${session.name} 已完成`;
  const title = message;
  const payload = {
    topic: ntfy.topic,
    message,
    title,
    tags: [needsConfirm ? "question" : "white_check_mark"],
    priority: needsConfirm ? 4 : 3,
    click: `fuluk://session/${session.id}`
  };
  const headers = { "content-type": "application/json" };
  if (ntfy.token) {
    headers.authorization = /^(?:Bearer|Basic)\s/i.test(ntfy.token)
      ? ntfy.token
      : `Bearer ${ntfy.token}`;
  }
  try {
    await fetchImpl(`${ntfy.server}/${encodeURIComponent(ntfy.topic)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.warn(`ntfy notification failed: ${errorMessage(error)}`);
  }
}

function findExistingNamedSession(input, { store }) {
  const name = input.name?.trim();
  if (!name) return null;
  const existing = store.findByIdOrName(name);
  return existing?.name === name ? existing : null;
}

function parseCreateInput(body, context) {
  if (!isSessionKind(body.kind)) throw new Error("kind must be codex, claude, opencode, pi-os, or runtime");

  // Check if runtime mode is allowed
  if (body.kind === "runtime" && !context.config.allowRuntimeMode) {
    throw new Error("Runtime mode is disabled on this server. Set SESSION_GATEWAY_ALLOW_RUNTIME=true to enable.");
  }

  return {
    kind: body.kind,
    cwd: typeof body.cwd === "string" && body.cwd.trim() ? body.cwd.trim() : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    project: typeof body.project === "string" ? body.project : null,
    commandArgs: Array.isArray(body.commandArgs)
      ? body.commandArgs.map((item) => {
          if (typeof item !== "string") throw new Error("commandArgs must be strings");
          return item;
        })
      : []
  };
}

function isSessionKind(value) {
  return value === "codex" || value === "claude" || value === "opencode" || value === "pi-os" || value === "runtime";
}

function requireSession(idOrName, { store }) {
  const session = store.findByIdOrName(idOrName);
  if (!session) throw new Error(`Session not found: ${idOrName}`);
  return session;
}

function bearerToken(authorization) {
  if (typeof authorization !== "string") return "";
  const match = authorization.match(/^Bearer\s+(.+)$/);
  return match ? match[1].trim() : "";
}

function isAuthorized(req, context) {
  const { config, glassPairingStore } = context;
  if (isAuthorizedHeader(req.headers.authorization, config.authToken)) return true;
  return glassPairingStore.resolveKey(bearerToken(req.headers.authorization)) !== null;
}

function isAuthorizedWebSocket(url, req, context) {
  const { config, glassPairingStore } = context;
  const token = url.searchParams.get("token");
  if (token === config.authToken) return true;
  if (token && glassPairingStore.resolveKey(token)) return true;
  return isAuthorized(req, context);
}

function handleWebSocketUpgrade(req, socket, head, context) {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== "/api/session-events") {
      socket.destroy();
      return;
    }
    if (!isAuthorizedWebSocket(url, req, context)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const key = req.headers["sec-websocket-key"];
    if (req.headers.upgrade?.toLowerCase() !== "websocket" || typeof key !== "string") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n"
      ].join("\r\n")
    );
    context.eventHub?.add(socket);
    if (head?.length) socket.unshift(head);
  } catch {
    socket.destroy();
  }
}

class SessionEventHub {
  constructor() {
    this.clients = new Set();
  }

  add(socket) {
    this.clients.add(socket);
    socket.on("close", () => {
      this.clients.delete(socket);
      this.onClientChange?.();
    });
    socket.on("error", () => {
      this.clients.delete(socket);
      this.onClientChange?.();
    });
    this.onClientChange?.();
  }

  hasClients() {
    return this.clients.size > 0;
  }

  broadcast(event) {
    const frame = encodeWebSocketTextFrame(JSON.stringify(event));
    for (const socket of this.clients) {
      if (socket.destroyed || socket.writableEnded) {
        this.clients.delete(socket);
        continue;
      }
      socket.write(frame);
    }
  }
}

function encodeWebSocketTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

async function serveStatic(res, pathname, context) {
  const publicDir = context.publicDir;
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(publicDir, `.${safePath}`);

  try {
    // Resolve symlinks to prevent path traversal bypass
    const [resolvedPublic, resolvedFile] = await Promise.all([
      fs.realpath(publicDir),
      fs.realpath(filePath).catch(() => null)
    ]);

    if (!resolvedFile || !resolvedFile.startsWith(resolvedPublic)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    const data = await fs.readFile(resolvedFile);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    }[path.extname(resolvedFile)] ?? "application/octet-stream";

    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentType,
      ...SECURITY_HEADERS
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...SECURITY_HEADERS
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...SECURITY_HEADERS
  });
  res.end(text);
}

// Rate limiting implementation
function rateLimitBudget(url, method) {
  if (method === "GET" && isUiPollingPath(url.pathname)) {
    return { bucket: "ui-poll", maxRequests: RATE_LIMIT_UI_POLL_MAX_REQUESTS };
  }
  return { bucket: "api", maxRequests: RATE_LIMIT_MAX_REQUESTS };
}

function isUiPollingPath(pathname) {
  if (pathname === "/api/sessions") return true;
  const parts = pathname.split("/");
  return parts.length === 5 && parts[1] === "api" && parts[2] === "sessions" && parts[4] === "output";
}

function checkRateLimit(key, maxRequests = RATE_LIMIT_MAX_REQUESTS) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  let requests = rateLimitStore.get(key) || [];

  // Filter out old requests
  requests = requests.filter((t) => t > windowStart);

  if (requests.length >= maxRequests) {
    return false;
  }

  requests.push(now);
  rateLimitStore.set(key, requests);

  // Periodic cleanup of old entries
  if (rateLimitStore.size > 10000) {
    cleanupRateLimitStore(now);
  }

  return true;
}

function cleanupRateLimitStore(now) {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [ip, requests] of rateLimitStore.entries()) {
    const filtered = requests.filter((t) => t > windowStart);
    if (filtered.length === 0) {
      rateLimitStore.delete(ip);
    } else {
      rateLimitStore.set(ip, filtered);
    }
  }
}

function getClientIp(req) {
  // Check X-Forwarded-For header (for reverse proxy setups)
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    return ips[0] || req.socket?.remoteAddress || "unknown";
  }
  return req.socket?.remoteAddress || "unknown";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();

  // Security warning for runtime mode
  if (config.allowRuntimeMode) {
    console.warn("");
    console.warn("╔══════════════════════════════════════════════════════════════╗");
    console.warn("║  WARNING: Runtime mode is ENABLED                            ║");
    console.warn("║  Authenticated users can execute arbitrary shell commands!   ║");
    console.warn("║  Set SESSION_GATEWAY_ALLOW_RUNTIME=false to disable.         ║");
    console.warn("╚══════════════════════════════════════════════════════════════╝");
    console.warn("");
  }

  const server = createSessionGatewayServer({ config });
  server.listen(config.port, config.host, () => {
    console.log(`Session Gateway listening on http://${config.host}:${config.port}`);
  });
}

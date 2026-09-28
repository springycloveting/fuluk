// Normalizes hook payloads from Claude Code, Codex and OpenCode into the
// gateway's task-state vocabulary.
//
// Output: { kind, taskState, cliSessionId, cwd, eventName, detail, at }
//   taskState: "completed" | "needs_confirmation" | "in_progress"
// Returns null when the payload is not a lifecycle signal the gateway uses
// (e.g. SubagentStop) so the HTTP layer can acknowledge without changing state.

const UUID_PATTERN = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const OPENCODE_SESSION_PATTERN = /ses_[0-9A-Za-z]{20,}/;

export const HOOK_KINDS = ["claude", "codex", "opencode"];

export function isHookKind(value) {
  return HOOK_KINDS.includes(value);
}

export function normalizeHookEvent(kind, raw, options = {}) {
  if (!isHookKind(kind) || !raw || typeof raw !== "object") return null;
  const now = options.now ?? new Date().toISOString();
  const base = {
    kind,
    cliSessionId: extractSessionHandle(kind, raw),
    cwd: typeof raw.cwd === "string" ? raw.cwd.trim() : "",
    at: typeof raw.timestamp === "string" ? raw.timestamp : now
  };

  if (kind === "claude") return normalizeClaudeEvent(raw, base);
  if (kind === "codex") return normalizeCodexEvent(raw, base);
  return normalizeOpencodeEvent(raw, base);
}

function normalizeClaudeEvent(raw, base) {
  const eventName = String(raw.hook_event_name ?? "").trim();
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  switch (eventName) {
    case "Stop":
      return { ...base, eventName, taskState: "completed", detail: "" };
    case "UserPromptSubmit":
      return { ...base, eventName, taskState: "in_progress", detail: typeof raw.prompt === "string" ? raw.prompt : "" };
    case "Notification": {
      const needsPermission = /needs your permission|permission to use/i.test(message);
      return {
        ...base,
        eventName,
        taskState: needsPermission ? "needs_confirmation" : "completed",
        detail: message
      };
    }
    // SubagentStop fires when a delegated sub-agent finishes; the main turn may
    // still be running, so it must not flip the session to completed.
    case "SubagentStop":
    default:
      return null;
  }
}

function normalizeCodexEvent(raw, base) {
  const type = String(raw.type ?? raw.hook_event_name ?? "").trim();
  if (!type) return null;
  if (/approval-available$/i.test(type) || /^PermissionRequest$/i.test(type)) {
    return { ...base, eventName: type, taskState: "needs_confirmation", detail: approvalDetail(raw) };
  }
  if (/agent-turn-complete/i.test(type) || /^Stop$/i.test(type)) {
    return { ...base, eventName: type, taskState: "completed", detail: "" };
  }
  return null;
}

function normalizeOpencodeEvent(raw, base) {
  const eventName = String(raw.event ?? raw.hook_event_name ?? "").trim();
  if (!eventName) return null;
  if (eventName === "permission.asked" || /^PermissionRequest$/i.test(eventName)) {
    return { ...base, eventName, taskState: "needs_confirmation", detail: typeof raw.message === "string" ? raw.message : "" };
  }
  if (eventName === "session.idle" || /^Stop$/i.test(eventName)) {
    return { ...base, eventName, taskState: "completed", detail: "" };
  }
  if (eventName === "user.prompt.submit" || eventName === "session.connected") {
    return { ...base, eventName, taskState: "in_progress", detail: "" };
  }
  return null;
}

function approvalDetail(raw) {
  const command = raw.command ?? raw.approval_request?.command;
  if (Array.isArray(command)) return command.join(" ");
  return typeof command === "string" ? command : "";
}

function extractSessionHandle(kind, raw) {
  const candidates = [raw.thread_id, raw.session_id, raw.sessionID, raw.cli_session_id];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (kind === "opencode" && OPENCODE_SESSION_PATTERN.test(trimmed)) {
      return trimmed.match(OPENCODE_SESSION_PATTERN)[0];
    }
    if (UUID_PATTERN.test(trimmed)) return trimmed.match(UUID_PATTERN)[0];
  }
  return "";
}

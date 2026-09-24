export function canAutoYesSession(sessions, selectedSessionId, targetSessionId, options = {}) {
  const target = sessions.find((session) => session.id === targetSessionId);
  if (!target || target.status !== "running") return false;
  return options.allowBackground === true || selectedSessionId === targetSessionId;
}

export function shouldSendAutoYes(previous, signature, now = Date.now(), cooldownMs = 10_000) {
  if (!previous) return true;
  if (now - previous.sentAt < cooldownMs) return false;
  return previous.signature !== signature || now - previous.sentAt >= cooldownMs;
}

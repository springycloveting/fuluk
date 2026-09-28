// OpenCode plugin: forwards session lifecycle and permission events to the
// gateway. Installed by hooks/install.mjs, which writes hooks.json next to this
// file with { baseUrl, token }. Environment variables override it.

const EVENTS = ["session.idle", "permission.asked"];

export default function setup(ctx) {
  for (const name of EVENTS) {
    ctx.event?.subscribe?.(name, (event) => forward(name, event).catch(() => {}));
  }
}

async function forward(name, event) {
  const settings = await loadSettings();
  const session = event?.properties?.session ?? event?.session ?? null;
  const sessionID =
    session?.id ??
    event?.properties?.permission?.sessionID ??
    event?.properties?.sessionID ??
    "";
  const payload = {
    event: name,
    sessionID,
    cwd: cwdFromSession(session)
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(`${settings.baseUrl}/api/hooks/opencode`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(settings.token ? { authorization: `Bearer ${settings.token}` } : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch {
    // best effort
  } finally {
    clearTimeout(timer);
  }
}

function cwdFromSession(session) {
  const value = session?.cwd ?? session?.directory ?? "";
  return String(value).replace(/^file:\/\//, "");
}

async function loadSettings() {
  let fileSettings = {};
  try {
    fileSettings = await import("./hooks.json", { with: { type: "json" } }).then(
      (module) => module.default ?? {}
    );
  } catch {
    // hooks.json is optional; environment variables can configure the plugin.
  }
  return {
    baseUrl: (
      process.env.SESSION_GATEWAY_URL ??
      fileSettings.baseUrl ??
      "http://127.0.0.1:8787"
    ).replace(/\/+$/, ""),
    token: process.env.SESSION_GATEWAY_HOOK_TOKEN ?? fileSettings.token ?? ""
  };
}

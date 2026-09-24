import { canAutoYesSession, shouldSendAutoYes } from "./auto_yes.js";

const state = {
  sessions: [],
  selectedSessionId: "",
  selectionVersion: 0,
  selected: null,
  outputLoading: false,
  outputLoadingSessionId: null,
  outputEtags: new Map(),
  outputPollTimer: null,
  sessionPollTimer: null,
  sessionLoading: false,
  outputPollDelayMs: 1000,
  outputWheelLastSentAt: 0,
  outputScrollOffset: 0,
  latestOutputText: "",
  terminal: null,
  terminalUsingXterm: false,
  terminalRenderVersion: 0,
  terminalResizeBySession: new Map(),
  allYesMode: localStorage.getItem("sessionGatewayAllYesMode") || "off",
  autoYesSignatures: new Map(),
  notifications: {},
  sessionAgentSettings: {},
  pendingDeleteSession: null,
  assistantMessages: [],
  customQuickKeys: loadCustomQuickKeys(),
  language: localStorage.getItem("sessionGatewayLanguage") || "zh",
  theme: localStorage.getItem("sessionGatewayTheme") || "dark",
  phaseFilter: localStorage.getItem("sessionGatewayPhaseFilter") || "all",
  sessionSearch: ""
};

const OUTPUT_POLL_DELAYS_MS = [1000, 2000, 5000, 10000];

const translations = {
  zh: {
    sessions: "会话",
    create: "新建",
    command: "助手",
    restart: "重启",
    stop: "停止",
    config: "配置",
    refresh: "刷新",
    close: "关闭",
    save: "保存",
    cancel: "取消",
    delete: "删除",
    allYes: "All Yes",
    quickKeyTitle: "自定义快捷键",
    quickKeyText: "文本 + 回车",
    stopGeneration: "停止",
    pageUp: "上页",
    pageDown: "下页",
    send: "发送",
    run: "执行",
    language: "语言",
    theme: "主题",
    darkTheme: "黑暗",
    lightTheme: "明亮",
    configTitle: "配置",
    sessionsTitle: "会话",
    createTitle: "新建会话",
    commandTitle: "助手",
    deleteTitle: "删除会话",
    historyTitle: "输入历史",
    history: "历史",
    assistantEmpty: "和 web-pi 对话。它会通过工具管理会话，并把结果整理成回复。",
    assistantUser: "你",
    assistantError: "错误",
    deleteConfirm: "确认删除会话「{name}」？正在运行的会话会先停止。",
    commandParser: "助手与命令解析",
    webPiEnabled: "启用 web-pi AI 助手",
    aiParserFallback: "规则解析失败时用 AI 回退解析",
    token: "Bearer token",
    noSession: "未选择会话",
    selectRunning: "请先选择一个运行中的会话",
    selectSession: "请先选择一个会话",
    statusRunning: "运行",
    statusStopped: "停止",
    taskCompleted: "已完成",
    taskInProgress: "进行中",
    taskNeedsConfirmation: "需要确认",
    phaseActive: "进行中",
    phaseStopped: "已停止",
    phaseClosed: "已关闭",
    confirmAlert: "需要确认：{name}",
    sendPlaceholder: "发送到当前会话",
    namePlaceholder: "会话名，例如 codex-app",
    cwdPlaceholder: "工作目录，留空则使用默认会话目录",
    projectPlaceholder: "项目名",
    nlPlaceholder: "问 web-pi，例如：查看并总结当前会话。"
  },
  en: {
    sessions: "Sessions",
    create: "Create",
    command: "Assistant",
    restart: "Restart",
    stop: "Stop",
    config: "Config",
    refresh: "Refresh",
    close: "Close",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    allYes: "All Yes",
    quickKeyTitle: "Custom Quick Key",
    quickKeyText: "Text + Enter",
    stopGeneration: "Stop",
    pageUp: "Page Up",
    pageDown: "Page Down",
    send: "Send",
    run: "Run",
    language: "Language",
    theme: "Theme",
    darkTheme: "Dark",
    lightTheme: "Light",
    configTitle: "Config",
    sessionsTitle: "Sessions",
    createTitle: "Create Session",
    commandTitle: "Assistant",
    deleteTitle: "Delete Session",
    historyTitle: "Input History",
    history: "History",
    assistantEmpty: "Chat with web-pi. It manages sessions through tools and summarizes the result here.",
    assistantUser: "You",
    assistantError: "Error",
    deleteConfirm: "Delete session \"{name}\"? A running session will be stopped first.",
    commandParser: "Assistant & Command Parser",
    webPiEnabled: "Enable web-pi AI assistant",
    aiParserFallback: "Fall back to AI parsing when rule parsing fails",
    token: "Bearer token",
    noSession: "No session selected",
    selectRunning: "Select a running session first",
    selectSession: "Select a session first",
    statusRunning: "Running",
    statusStopped: "Stopped",
    taskCompleted: "Completed",
    taskInProgress: "In progress",
    taskNeedsConfirmation: "Needs confirmation",
    phaseActive: "Active",
    phaseStopped: "Stopped",
    phaseClosed: "Closed",
    confirmAlert: "Needs confirmation: {name}",
    sendPlaceholder: "Send text to selected session",
    namePlaceholder: "Session name, e.g. codex-app",
    cwdPlaceholder: "Working directory; leave blank for the default session folder",
    projectPlaceholder: "Project",
    nlPlaceholder: "Ask web-pi, e.g. summarize the current session."
  }
};

const els = {
  openSessions: document.querySelector("#open-sessions"),
  confirmAlert: document.querySelector("#confirm-alert"),
  closeSessions: document.querySelector("#close-sessions"),
  sessionsTitle: document.querySelector("[data-i18n='sessionsTitle']"),
  sessionsPanel: document.querySelector("#sessions-panel"),
  openConfig: document.querySelector("#open-config"),
  configDialog: document.querySelector("#config-dialog"),
  configForm: document.querySelector("#config-form"),
  glassPendingList: document.querySelector("#glass-pending-list"),
  glassKeysList: document.querySelector("#glass-keys-list"),
  language: document.querySelector("#language"),
  theme: document.querySelector("#theme"),
  allYes: document.querySelector("#all-yes"),
  openHistory: document.querySelector("#open-history"),
  historyDialog: document.querySelector("#history-dialog"),
  historyList: document.querySelector("#history-list"),
  openCreate: document.querySelector("#open-create"),
  createDialog: document.querySelector("#create-dialog"),
  createForm: document.querySelector("#create-form"),
  openRun: document.querySelector("#open-run"),
  runDialog: document.querySelector("#run-dialog"),
  runForm: document.querySelector("#run-form"),
  closeRun: document.querySelector("#close-run"),
  deleteDialog: document.querySelector("#delete-dialog"),
  deleteForm: document.querySelector("#delete-form"),
  deleteMessage: document.querySelector("#delete-message"),
  quickKeys: document.querySelector("#quick-keys"),
  addQuickKey: document.querySelector("#add-quick-key"),
  quickKeyDialog: document.querySelector("#quick-key-dialog"),
  quickKeyForm: document.querySelector("#quick-key-form"),
  quickKeyLabel: document.querySelector("#quick-key-label"),
  quickKeyValue: document.querySelector("#quick-key-value"),
  token: document.querySelector("#token"),
  aiParserBaseUrl: document.querySelector("#ai-parser-base-url"),
  aiParserModel: document.querySelector("#ai-parser-model"),
  aiParserApiKey: document.querySelector("#ai-parser-api-key"),
  webPiEnabled: document.querySelector("#web-pi-enabled"),
  aiParserFallback: document.querySelector("#ai-parser-fallback"),
  kind: document.querySelector("#kind"),
  name: document.querySelector("#name"),
  cwd: document.querySelector("#cwd"),
  project: document.querySelector("#project"),
  create: document.querySelector("#create"),
  nl: document.querySelector("#nl"),
  runNl: document.querySelector("#run-nl"),
  assistantMessages: document.querySelector("#assistant-messages"),
  refresh: document.querySelector("#refresh"),
  phaseFilter: document.querySelector("#phase-filter"),
  sessionSearch: document.querySelector("#session-search"),
  list: document.querySelector("#session-list"),
  title: document.querySelector("#selected-title"),
  terminalOutput: document.querySelector("#terminal-output"),
  xtermOutput: document.querySelector("#xterm-output"),
  output: document.querySelector("#output"),
  input: document.querySelector("#input"),
  send: document.querySelector("#send"),
  restart: document.querySelector("#restart"),
  stop: document.querySelector("#stop")
};

els.token.value = localStorage.getItem("sessionGatewayToken") || "";
els.language.value = state.language;
els.theme.value = state.theme;
updateAllYesButton();
els.token.addEventListener("input", () => {
  localStorage.setItem("sessionGatewayToken", els.token.value);
});
els.allYes.addEventListener("click", async () => {
  const modes = ["off", "session", "global"];
  const currentIndex = modes.indexOf(state.allYesMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  state.allYesMode = modes[nextIndex];
  localStorage.setItem("sessionGatewayAllYesMode", state.allYesMode);
  updateAllYesButton();
  
  if (state.allYesMode !== "off") {
    if (state.selected?.status === "running") {
      clearOutputEtag(state.selected.id);
      await loadOutput({ force: true });
    }
    if (state.allYesMode === "session") {
      maybeAutoYes(state.latestOutputText, { force: true });
    } else if (state.allYesMode === "global") {
      await autoYesAllSessions();
    }
  }
});
els.language.addEventListener("change", () => {
  state.language = els.language.value;
  localStorage.setItem("sessionGatewayLanguage", state.language);
  applyLanguage();
});
els.theme.addEventListener("change", () => {
  state.theme = els.theme.value;
  localStorage.setItem("sessionGatewayTheme", state.theme);
  applyTheme();
});

els.openSessions.addEventListener("click", () => {
  els.sessionsPanel.classList.add("open");
  els.sessionsPanel.setAttribute("aria-hidden", "false");
  refreshSessions();
});
els.confirmAlert.addEventListener("click", async () => {
  const session = firstSessionNeedingConfirmation();
  if (session) await selectSession(session);
});
els.closeSessions.addEventListener("click", closeSessionsPanel);
els.openConfig.addEventListener("click", async () => {
  try {
    await loadConfig();
  } catch (error) {
    showError(error);
  } finally {
    els.configDialog.showModal();
  }
});
els.openHistory.addEventListener("click", async () => {
  await loadHistory();
  els.historyDialog.showModal();
});
els.openCreate.addEventListener("click", () => {
  els.createDialog.showModal();
  els.cwd.focus();
});
els.openRun.addEventListener("click", () => {
  openAssistant();
  els.nl.focus();
});
els.closeRun.addEventListener("click", closeAssistant);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    closeDialog(button.dataset.closeDialog);
  });
});
els.refresh.addEventListener("click", refreshSessions);
els.phaseFilter.value = state.phaseFilter;
els.phaseFilter.addEventListener("change", () => {
  state.phaseFilter = els.phaseFilter.value;
  localStorage.setItem("sessionGatewayPhaseFilter", state.phaseFilter);
  renderSessions();
});
els.sessionSearch.addEventListener("input", () => {
  state.sessionSearch = els.sessionSearch.value;
  renderSessions();
});
els.configForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveConfig();
});

els.glassPendingList.addEventListener("click", async (event) => {
  const row = event.target.closest(".glass-row");
  if (!row) return;
  const key = row.dataset.key;
  if (event.target.classList.contains("glass-approve")) {
    await api("/api/glass/approve", {
      method: "POST",
      body: JSON.stringify({ key })
    });
    await loadGlassPairing();
  }
  if (event.target.classList.contains("glass-reject")) {
    await api("/api/glass/reject", {
      method: "POST",
      body: JSON.stringify({ key })
    });
    await loadGlassPairing();
  }
});

els.glassKeysList.addEventListener("click", async (event) => {
  const row = event.target.closest(".glass-row");
  if (!row || !event.target.classList.contains("glass-revoke")) return;
  await api("/api/glass/revoke", {
    method: "POST",
    body: JSON.stringify({ key: row.dataset.key })
  });
  await loadGlassPairing();
});
els.createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createSession();
});
els.send.addEventListener("click", sendInput);
els.restart.addEventListener("click", restartSession);
els.stop.addEventListener("click", stopSession);
els.runForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runNaturalCommand();
});
els.deleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  deletePendingSession();
});
els.addQuickKey.addEventListener("click", openQuickKeyDialog);
els.quickKeyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveQuickKey();
});
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendInput();
  if (event.key === "PageUp" || event.key === "PageDown") {
    const selected = currentSelectedSession();
    if (shouldUsePaneWheel(selected)) {
      event.preventDefault();
      sendQuickKeys([event.key === "PageUp" ? "WheelUpPane" : "WheelDownPane"]);
    }
  }
});
els.terminalOutput.addEventListener("wheel", handleOutputWheel, { passive: false, capture: true });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSessionsPanel();
    closeAssistant();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearOutputPoll();
    if (state.allYesMode !== "global") clearSessionPoll();
  } else {
    resetOutputPolling(1000);
    scheduleSessionPoll(1000);
  }
});

applyLanguage();
applyTheme();
await loadConfig();
await refreshSessions();
renderQuickKeys();
resetOutputPolling(1000);
scheduleSessionPoll(5000);

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { "content-type": "application/json" } : {}),
    authorization: `Bearer ${els.token.value}`,
    ...options.headers
  };
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "Request failed";
    throw new Error(message);
  }
  return payload;
}

async function loadConfig() {
  try {
    const data = await api("/api/config");
    applyServerSettings(data.settings);
    await loadGlassPairing();
  } catch (error) {
    showError(error);
  }
}

async function loadGlassPairing() {
  const [pendingData, keysData] = await Promise.all([
    api("/api/glass/pending"),
    api("/api/glass/keys")
  ]);
  renderGlassPending(pendingData.pending || []);
  renderGlassKeys(keysData.keys || []);
}

function shortKey(key) {
  return `${key.slice(0, 8)}…${key.slice(-6)}`;
}

function renderGlassPending(pending) {
  if (!pending.length) {
    els.glassPendingList.innerHTML = `<small class="muted">暂无待批准的眼镜</small>`;
    return;
  }
  els.glassPendingList.innerHTML = pending.map((item) => `
    <div class="glass-row" data-key="${escapeHtml(item.key)}">
      <span class="glass-name">${escapeHtml(item.name)}</span>
      <span class="glass-key">${escapeHtml(shortKey(item.key))}</span>
      <button type="button" class="glass-approve">批准</button>
      <button type="button" class="glass-reject ghost">拒绝</button>
    </div>
  `).join("");
}

function renderGlassKeys(keys) {
  if (!keys.length) {
    els.glassKeysList.innerHTML = `<small class="muted">暂无已授权眼镜</small>`;
    return;
  }
  els.glassKeysList.innerHTML = keys.map((item) => `
    <div class="glass-row" data-key="${escapeHtml(item.key)}">
      <span class="glass-name">${escapeHtml(item.name)}</span>
      <span class="glass-key">${escapeHtml(shortKey(item.key))}</span>
      <button type="button" class="glass-revoke ghost">撤销</button>
    </div>
  `).join("");
}

async function saveConfig() {
  try {
    localStorage.setItem("sessionGatewayToken", els.token.value);
    state.language = els.language.value;
    state.theme = els.theme.value;
    localStorage.setItem("sessionGatewayLanguage", state.language);
    localStorage.setItem("sessionGatewayTheme", state.theme);
    applyLanguage();
    applyTheme();

    const commandParser = {
      enabled: els.aiParserFallback.checked,
      mode: "rules-first-ai-fallback",
      baseUrl: els.aiParserBaseUrl.value,
      model: els.aiParserModel.value,
      apiKey: els.aiParserApiKey.value
    };

    localStorage.setItem("sessionGatewayAiParser", JSON.stringify({
      baseUrl: els.aiParserBaseUrl.value,
      model: els.aiParserModel.value,
      apiKey: els.aiParserApiKey.value
    }));

    const settings = {
      notifications: state.notifications,
      commandParser,
      sessionAgent: {
        ...state.sessionAgentSettings,
        enabled: els.webPiEnabled.checked
      }
    };
    const data = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ settings })
    });
    applyServerSettings(data.settings);
    els.configDialog.close();
  } catch (error) {
    showError(error);
  }
}

function numberInput(input, fallback) {
  const value = Number.parseInt(input.value, 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function numberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function secondsInputToMs(input, fallbackSeconds) {
  return numberInput(input, fallbackSeconds) * 1000;
}

function setSecondsInput(input, value, fallbackSeconds) {
  const milliseconds = numberOrFallback(value, fallbackSeconds * 1000);
  input.value = String(Math.round(milliseconds / 1000));
}

async function refreshSessions() {
  if (state.sessionLoading) return;
  state.sessionLoading = true;
  const selectionVersion = state.selectionVersion;
  try {
    const data = await api("/api/sessions");
    state.sessions = data.sessions;
    if (selectionVersion !== state.selectionVersion) return;
    if (state.selectedSessionId || state.selected) {
      const selectedId = state.selectedSessionId || state.selected?.id;
      const current = state.sessions.find((session) => session.id === selectedId);
      state.selected = current || null;
      state.selectedSessionId = state.selected?.id || "";
      renderSessions();
      renderTaskAlert();
      renderQuickKeys();
      if (state.selected?.status === "running") {
        await loadOutput();
        resetOutputPolling();
      } else if (state.selected) {
        clearOutputPoll();
        showSessionSummary(state.selected);
      } else {
        clearOutputPoll();
        els.title.textContent = t("noSession");
      }
      return;
    }
    state.selected = state.sessions.find((session) => session.status === "running") ?? state.sessions[0] ?? null;
    state.selectedSessionId = state.selected?.id || "";
    renderSessions();
    renderTaskAlert();
    renderQuickKeys();
    if (state.selected?.status === "running") {
      await loadOutput();
      resetOutputPolling();
    } else {
      clearOutputPoll();
    }
  } catch (error) {
    showError(error);
  } finally {
    state.sessionLoading = false;
    scheduleSessionPoll();
    if (state.allYesMode === "global") {
      autoYesAllSessions();
    }
  }
}

async function createSession() {
  try {
    const body = {
      kind: els.kind.value,
      name: els.name.value || undefined,
      cwd: els.cwd.value,
      project: els.project.value || undefined
    };
    const data = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify(body)
    });
    state.selected = data.session;
    state.selectedSessionId = data.session.id;
    state.selectionVersion += 1;
    clearOutputEtag(state.selected.id);
    els.createDialog.close();
    await refreshSessions();
  } catch (error) {
    showError(error);
  }
}

async function runNaturalCommand() {
  const text = els.nl.value.trim();
  if (!text) return;
  appendAssistantMessage("user", text);
  els.nl.value = "";
  els.runNl.disabled = true;
  try {
    const body = { text, currentSessionId: state.selected?.id };
    const result = await api("/api/nl", {
      method: "POST",
      body: JSON.stringify(body)
    });
    if (typeof result === "string") {
      appendAssistantMessage("assistant", result);
    } else {
      if (result.session) {
        state.selected = result.session;
        state.selectedSessionId = result.session.id;
        state.selectionVersion += 1;
      }
      appendAssistantMessage("assistant", formatCommandResult(result));
      const updateTerminal = result.presentation?.updateTerminal !== false;
      if (updateTerminal && typeof result.output === "string") {
        updateOutputText(result.output);
        if (state.selected) clearOutputEtag(state.selected.id);
      }
      await refreshSessions();
      if (updateTerminal) resetOutputPolling(500);
    }
  } catch (error) {
    appendAssistantMessage("error", error instanceof Error ? error.message : String(error));
  } finally {
    els.runNl.disabled = false;
    els.nl.focus();
  }
}

async function loadOutput(options = {}) {
  const selected = currentSelectedSession();
  if (!selected) return null;
  if (selected.status !== "running") {
    showSessionSummary(selected);
    return null;
  }
  const sessionId = selected.id;
  if (state.outputLoading && state.outputLoadingSessionId === sessionId) return null;
  state.outputLoading = true;
  state.outputLoadingSessionId = sessionId;
  try {
    const size = measureTerminalSize() ?? { cols: 80, rows: 24 };
    const params = new URLSearchParams({ format: "json" });
    params.set("lines", String(clampInteger(size.rows + 2, 20, 300)));
    if (state.outputScrollOffset > 0) params.set("offset", String(state.outputScrollOffset));
    if (selected.kind !== "runtime" && ensureTerminal()) params.set("raw", "1");
    const etag = state.outputEtags.get(sessionId);
    if (etag && !options.force) params.set("etag", etag);
    const data = await api(`/api/sessions/${encodeURIComponent(sessionId)}/output?${params}`);
    if (state.selectedSessionId !== sessionId) return null;
    if (typeof data === "string") {
      updateOutputText(data, { history: state.outputScrollOffset > 0 });
      clearOutputEtag(sessionId);
      return true;
    }
    if (data.etag) state.outputEtags.set(sessionId, data.etag);
    if (!data.changed) return false;
    updateOutputText(data.output ?? "", { history: state.outputScrollOffset > 0 });
    return true;
  } catch (error) {
    showError(error);
    return null;
  } finally {
    if (state.outputLoadingSessionId === sessionId) {
      state.outputLoading = false;
      state.outputLoadingSessionId = null;
    }
  }
}

async function resizeTerminalForSession(session) {
  const size = measureTerminalSize();
  if (!size) return false;
  const signature = `${size.cols}x${size.rows}`;
  if (state.terminalResizeBySession.get(session.id) === signature) return false;
  await api(`/api/sessions/${encodeURIComponent(session.id)}/resize`, {
    method: "POST",
    body: JSON.stringify(size)
  });
  state.terminalResizeBySession.set(session.id, signature);
  clearOutputEtag(session.id);
  return true;
}

function measureTerminalSize() {
  const target = terminalMeasureElement();
  if (!target || target.hidden) return null;
  const style = getComputedStyle(target);
  const width =
    target.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
  const height =
    target.clientHeight - parseFloat(style.paddingTop || "0") - parseFloat(style.paddingBottom || "0");
  if (width <= 0 || height <= 0) return null;

  // Prefer the cell size xterm actually rendered with. xterm sizes its
  // `.xterm-screen` element to exactly cols*cellWidth by rows*cellHeight,
  // accounting for canvas/DOM rendering and device pixel ratio. Measuring a
  // probe inside .xterm-rows is wrong because xterm scales that font for
  // hi-DPI, and CSS line-height overestimates rows, clipping the bottom.
  let charWidth = 0;
  let lineHeight = 0;
  if (state.terminalUsingXterm && state.terminal) {
    const screen = target.querySelector(".xterm-screen");
    if (screen && screen.clientWidth > 0 && screen.clientHeight > 0) {
      charWidth = screen.clientWidth / (state.terminal.cols || 80);
      lineHeight = screen.clientHeight / (state.terminal.rows || 24);
    }
  }

  if (!charWidth || !lineHeight) {
    // Fallback for the plain <pre> renderer or before xterm has laid out:
    // measure glyph metrics the way xterm's CharMeasure does (line-height
    // normal), then apply the terminal's line-height multiplier.
    const probe = document.createElement("span");
    probe.textContent = "M".repeat(10);
    probe.style.cssText =
      "position:absolute;visibility:hidden;white-space:pre;left:-9999px;top:-9999px;" +
      'font-family:"SFMono-Regular", Consolas, "Liberation Mono", monospace;' +
      "font-size:13px;line-height:normal;";
    target.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();
    charWidth = rect.width / 10;
    lineHeight = rect.height * 1.45;
  }

  if (!charWidth || !lineHeight) return null;
  return {
    cols: clampInteger(Math.floor(width / charWidth), 20, 500),
    rows: clampInteger(Math.floor(height / lineHeight), 5, 200)
  };
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateOutputText(text, options = {}) {
    const outputText = String(text ?? "");
    state.latestOutputText = outputText;
    const shouldStickToBottom =
      els.terminalOutput.scrollHeight - els.terminalOutput.scrollTop - els.terminalOutput.clientHeight < 48;
    const renderedWithXterm = renderTerminalText(outputText);
    if (!renderedWithXterm) {
      if (els.xtermOutput) els.xtermOutput.hidden = true;
      els.output.hidden = false;
    }
    els.output.textContent = renderedWithXterm ? "" : outputText;
    els.title.textContent = state.selected?.name ?? "";
    if (shouldStickToBottom) {
      els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
    }
    if (!options.history) {
      markSelectedTaskState(findYesOption(outputText) ? "needs_confirmation" : "in_progress");
      maybeAutoYes(outputText);
    }
}

function terminalMeasureElement() {
  return state.terminalUsingXterm ? els.xtermOutput : els.output;
}

function ensureTerminal() {
  if (state.terminal) return true;
  if (!els.xtermOutput || typeof window.Terminal !== "function") return false;
  els.xtermOutput.replaceChildren();
  state.terminal = new window.Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: false,
    disableStdin: true,
    fontFamily: "\"SFMono-Regular\", Consolas, \"Liberation Mono\", monospace",
    fontSize: 13,
    lineHeight: 1.45,
    scrollback: 5000,
    theme: terminalTheme()
  });
  state.terminal.open(els.xtermOutput);
  state.terminalUsingXterm = true;
  els.xtermOutput.hidden = false;
  els.output.hidden = true;
  return true;
}

function renderTerminalText(text) {
  if (!els.xtermOutput || typeof window.Terminal !== "function") return false;
  if (!ensureTerminal()) return false;
  const size = measureTerminalSize();
  if (size) state.terminal.resize(size.cols, size.rows);
  const version = (state.terminalRenderVersion += 1);
  const snapshot = visibleTerminalSnapshot(text, size?.rows);
  state.terminal.write("\x1b[3J\x1b[2J\x1b[H" + snapshot, () => {
    if (version === state.terminalRenderVersion) state.terminal.scrollToBottom();
  });
  return true;
}

function visibleTerminalSnapshot(text, rows) {
  const value = text ?? "";
  if (!Number.isFinite(rows) || rows <= 0) return value;
  const lines = value.split("\n");
  if (lines.length <= rows) return value;
  return lines.slice(lines.length - rows).join("\n");
}

function disposeTerminal() {
  if (state.terminal) {
    state.terminal.dispose();
    state.terminal = null;
  }
  state.terminalUsingXterm = false;
  if (els.xtermOutput) els.xtermOutput.replaceChildren();
}

function terminalTheme() {
  if (state.theme === "light") {
    return {
      background: "#ffffff",
      foreground: "#17202a",
      cursor: "#1f6feb",
      selectionBackground: "#c6d0dc"
    };
  }
  return {
    background: "#05080c",
    foreground: "#dbe7f3",
    cursor: "#2f81f7",
    selectionBackground: "#2b3745"
  };
}

function handleOutputWheel(event) {
  if (!shouldForwardOutputWheel(event)) return;
  event.preventDefault();
  const now = Date.now();
  if (now - state.outputWheelLastSentAt < 180) return;
  state.outputWheelLastSentAt = now;
  const selected = currentSelectedSession();
  if (shouldUsePaneWheel(selected)) {
    // opencode: forward wheel to tmux copy-mode pane scrolling
    const wheelKey = event.deltaY < 0 ? "WheelUpPane" : "WheelDownPane";
    sendQuickKeys(Array.from({ length: 5 }, () => wheelKey), { skipRefresh: true });
    return;
  }
  // claude/codex/etc.: xterm holds no scrollback (renderTerminalText clears it
  // every refresh and only writes the visible tail), so native wheel scrolling
  // does nothing. Scroll through tmux history via the server-side offset instead.
  scrollOutputHistory(event.deltaY < 0 ? -1 : 1);
}

function shouldUsePaneWheel(session) {
  return session?.kind === "opencode";
}

function shouldForwardOutputWheel(event) {
  const selected = currentSelectedSession();
  if (!selected || selected.status !== "running") return false;
  if (!event.deltaY) return false;
  return true;
}

function scrollOutputHistory(step) {
  const selected = currentSelectedSession();
  if (!selected || selected.status !== "running") return false;
  const direction = step < 0 ? -1 : 1;
  const absStep = Math.abs(step);
  const nextOffset = direction < 0
    ? Math.min(state.outputScrollOffset + absStep, 5000)
    : Math.max(state.outputScrollOffset - absStep, 0);
  if (nextOffset === state.outputScrollOffset) return false;
  state.outputScrollOffset = nextOffset;
  clearOutputEtag(selected.id);
  loadOutput({ force: true });
  return true;
}

function updateAllYesButton() {
  els.allYes.dataset.state = state.allYesMode;
}

function maybeAutoYes(text, options = {}) {
  if (state.allYesMode === "off") return;
  
  const selected = currentSelectedSession();
  if (state.allYesMode === "session") {
    if (!selected || selected.status !== "running") return;
    if (selected.kind === "runtime") return;
    const match = findYesOption(text);
    if (!match) return;
    const sessionId = selected.id;
    const signature = match.signature;
    if (!options.force && !shouldSendAutoYes(state.autoYesSignatures.get(sessionId), signature)) return;
    sendAutoYes(sessionId, signature, match.key, match.type);
  }
}

async function autoYesAllSessions() {
  const sessionsNeedingConfirmation = state.sessions.filter(
    (session) => session.taskState === "needs_confirmation" && session.status === "running"
  );
  
  for (const session of sessionsNeedingConfirmation) {
    try {
      const output = await api(`/api/sessions/${encodeURIComponent(session.id)}/output?lines=50`);
      const match = findYesOption(output);
      if (match) {
        const signature = match.signature;
        if (shouldSendAutoYes(state.autoYesSignatures.get(session.id), signature)) {
          await sendAutoYes(session.id, signature, match.key, match.type, { allowBackground: true });
        }
      }
    } catch (error) {
      console.error(`Auto-yes failed for session ${session.name}:`, error);
    }
  }
}

function findYesOption(text) {
  const normalized = stripAnsi(text);
  const lines = normalized
    .split("\n")
    .filter((line) => line.trim())
    .slice(-10);
  const context = lines.map((line) => line.trim()).join("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    // 匹配 opencode 权限底栏："Allow once   Allow always   Reject ... enter confirm"
    if (/\ballow\s+once\b.*\ballow\s+(?:always|allways)\b.*\breject\b/i.test(line)) {
      return { signature: context, key: "Enter", type: "key" };
    }
    // 匹配 "1) yes" / "1.Allow" / "2. Allow once" / "3: Allow always" 格式
    const numericAllow = line.match(
      /(?:^|[\s>❯›»])([1-9])\s*[\).:\]-]\s*(?:yes|allow(?:\s+(?:once|always|allways))?)\b/i
    );
    if (numericAllow) {
      return { signature: context, key: numericAllow[1] };
    }
    // 匹配 "a) allow" / "a. Allow once" / "a-Allow always" 格式
    if (/(?:^|[\s>❯›»])a\s*[\).:\]-]\s*allow(?:\s+(?:once|always|allways))?\b/i.test(line)) {
      return { signature: context, key: "a" };
    }
    // 匹配单独一行 "Allow" / "Allow once" / "Allow always"，默认选第一个选项
    if (/^\s*allow(?:\s+(?:once|always|allways))?\b/i.test(line)) {
      return { signature: context, key: "1" };
    }
    // 匹配 "y) yes" / "y. yes" 格式
    if (/(?:^|[\s>❯›»])y\s*[\).:\]-]\s*yes\b/i.test(line)) {
      return { signature: context, key: "y" };
    }
  }
  return null;
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

async function sendInput() {
  const session = currentSelectedSession();
  if (!session) {
    showError(new Error(t("selectRunning")));
    return;
  }
  if (session.status !== "running") {
    showSessionSummary(session);
    return;
  }
  if (!els.input.value.trim()) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(session.id)}/input`, {
      method: "POST",
      body: JSON.stringify({ text: els.input.value })
    });
    els.input.value = "";
    state.outputScrollOffset = 0;
    clearOutputEtag(session.id);
    resetOutputPolling(500);
  } catch (error) {
    showError(error);
  }
}

function currentSelectedSession() {
  if (state.selectedSessionId) {
    const current = state.sessions.find((session) => session.id === state.selectedSessionId);
    if (current) {
      state.selected = current;
      return current;
    }
  }
  return state.selected;
}

async function sendQuickText(text) {
  if (!state.selected || state.selected.status !== "running") {
    showError(new Error(t("selectRunning")));
    return;
  }
  try {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/input`, {
      method: "POST",
      body: JSON.stringify({ text })
    });
    state.outputScrollOffset = 0;
    clearOutputEtag(state.selected.id);
    resetOutputPolling(500);
  } catch (error) {
    showError(error);
  }
}

async function sendAutoYes(sessionId, signature, key = "1", type = "text", options = {}) {
  if (!canAutoYesSession(state.sessions, state.selected?.id, sessionId, options)) return;
  try {
    if (type === "key") {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/keys`, {
        method: "POST",
        body: JSON.stringify({ keys: [key] })
      });
    } else {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        body: JSON.stringify({ text: key })
      });
    }
    state.autoYesSignatures.set(sessionId, { signature, sentAt: Date.now() });
    clearOutputEtag(sessionId);
    if (state.selected?.id === sessionId) resetOutputPolling(500);
  } catch (error) {
    showError(error);
  }
}

async function sendQuickKeys(keys, options = {}) {
  if (!state.selected || state.selected.status !== "running") {
    showError(new Error(t("selectRunning")));
    return;
  }
  try {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/keys`, {
      method: "POST",
      body: JSON.stringify({ keys })
    });
    if (!options.skipRefresh) {
      state.outputScrollOffset = 0;
      clearOutputEtag(state.selected.id);
    }
    resetOutputPolling(500);
  } catch (error) {
    showError(error);
  }
}

async function restartSession() {
  if (!state.selected) {
    showError(new Error(t("selectSession")));
    return;
  }
  try {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}/restart`, { method: "POST" });
    clearOutputEtag(state.selected.id);
    await refreshSessions();
    resetOutputPolling(500);
  } catch (error) {
    showError(error);
  }
}

async function stopSession() {
  if (!state.selected) {
    showError(new Error(t("selectSession")));
    return;
  }
  try {
    await api(`/api/sessions/${encodeURIComponent(state.selected.id)}`, { method: "DELETE" });
    clearOutputEtag(state.selected.id);
    clearOutputPoll();
    await refreshSessions();
  } catch (error) {
    showError(error);
  }
}

function openDeleteDialog(session) {
  state.pendingDeleteSession = session;
  els.deleteMessage.textContent = t("deleteConfirm").replace("{name}", session.name);
  els.deleteDialog.showModal();
}

async function deletePendingSession() {
  const session = state.pendingDeleteSession;
  if (!session) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(session.id)}/delete`, { method: "DELETE" });
    clearOutputEtag(session.id);
    if (state.selected?.id === session.id) {
      state.selected = null;
      state.selectedSessionId = "";
      state.selectionVersion += 1;
      clearOutputPoll();
      els.output.textContent = "";
      els.title.textContent = t("noSession");
      renderQuickKeys();
    }
    state.pendingDeleteSession = null;
    els.deleteDialog.close();
    await refreshSessions();
  } catch (error) {
    showError(error);
  }
}

function renderQuickKeys() {
  els.quickKeys.innerHTML = "";
  for (const quickKey of currentQuickKeys()) {
    const button = document.createElement("button");
    button.className = "quick-key";
    button.type = "button";
    button.textContent = quickKey.label;
    button.title = quickKey.title ?? quickKey.label;
    button.addEventListener("click", () => activateQuickKey(quickKey));
    els.quickKeys.append(button);
  }
}

function currentQuickKeys() {
  return quickKeysForSession(state.selected);
}

function quickKeysForSession(session) {
  const base = ["1", "2", "3", "4"].map((value) => ({
    label: value,
    type: "text",
    value,
    title: `${value} + Enter`
  }));
  const kindKeys = session && session.kind !== "runtime" ? quickKeysForKind(session.kind) : [];
  return [...base, ...kindKeys, ...state.customQuickKeys];
}

function quickKeysForKind(kind) {
  if (kind === "codex" || kind === "claude" || kind === "opencode") {
    return [
      { label: t("stopGeneration"), type: "key", value: "Escape", title: "Escape" },
      { label: "Shift+Tab", type: "key", value: "BTab" },
      { label: "↑", type: "key", value: "Up", title: "Up" },
      { label: "↓", type: "key", value: "Down", title: "Down" },
      { label: "Enter", type: "key", value: "Enter", title: "Enter" },
      { label: t("pageUp"), type: "history-page", value: "up", title: "PageUp" },
      { label: t("pageDown"), type: "history-page", value: "down", title: "PageDown" }
    ];
  }
  return [];
}

function activateQuickKey(quickKey) {
  if (quickKey.type === "key") {
    sendQuickKeys([quickKey.value]);
    return;
  }
  if (quickKey.type === "history-page") {
    const selected = currentSelectedSession();
    if (shouldUsePaneWheel(selected)) {
      sendQuickKeys([quickKey.value === "up" ? "WheelUpPane" : "WheelDownPane"]);
    } else {
      // Scroll tmux history via the server-side offset (xterm holds no scrollback)
      const terminalSize = measureTerminalSize();
      const step = Math.max(5, Math.floor((terminalSize?.rows ?? 30) * 0.8));
      scrollOutputHistory(quickKey.value === "up" ? -step : step);
    }
    return;
  }
  sendQuickText(quickKey.value);
}

function openQuickKeyDialog() {
  els.quickKeyLabel.value = "";
  els.quickKeyValue.value = "";
  els.quickKeyDialog.showModal();
  els.quickKeyLabel.focus();
}

function saveQuickKey() {
  const label = els.quickKeyLabel.value.trim();
  const value = els.quickKeyValue.value.trim();
  if (!label || !value) return;
  state.customQuickKeys.push({ label, type: "text", value });
  localStorage.setItem("sessionGatewayCustomQuickKeys", JSON.stringify(state.customQuickKeys));
  els.quickKeyDialog.close();
  renderQuickKeys();
}

function loadCustomQuickKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem("sessionGatewayCustomQuickKeys") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.type !== "key" && typeof item.label === "string" && typeof item.value === "string")
      .map((item) => ({
        label: item.label.slice(0, 16),
        type: "text",
        value: item.value
      }));
  } catch {
    return [];
  }
}

function renderSessions() {
  els.list.innerHTML = "";
  const sessions = filteredSessions();
  const grouped = groupSessionsByPhase(sessions);
  for (const { phase, items } of grouped) {
    if (!items.length) continue;
    const heading = document.createElement("div");
    heading.className = `session-group phase-${phase}`;
    heading.textContent = `${phaseGroupLabel(phase)} ${items.length}`;
    els.list.append(heading);
    for (const session of items) {
      els.list.append(renderSessionItem(session));
    }
  }

  if (!sessions.length) {
    els.list.textContent = state.sessionSearch.trim()
      ? state.language === "zh" ? "没有匹配的会话。" : "No matching sessions."
      : state.language === "zh" ? "没有活动会话（已关闭的会话请切换状态筛选）" : "No active sessions (switch phase filter for closed)";
  }
}

function groupSessionsByPhase(sessions) {
  const order = ["active", "stopped", "closed"];
  return order
    .map((phase) => ({ phase, items: sessions.filter((session) => sessionPhase(session) === phase) }))
    .filter((group) => group.items.length);
}

function phaseGroupLabel(phase) {
  if (phase === "active") return state.language === "zh" ? "进行中" : "Active";
  if (phase === "stopped") return state.language === "zh" ? "已停止" : "Stopped";
  return state.language === "zh" ? "已关闭" : "Closed";
}

function renderSessionItem(session) {
    const item = document.createElement("button");
    const phase = sessionPhase(session);
    item.className = `session-item phase-${phase}${state.selected?.id === session.id ? " active" : ""}`;
    item.type = "button";
    const cwdLabel = shortCwd(session.cwd);
    const timeLabel = relativeTime(session.updatedAt ?? session.createdAt);
    item.innerHTML = `
      <span class="session-main">
        <span class="session-name">${escapeHtml(session.name)}</span>
        <span class="session-controls">
          ${timeLabel ? `<span class="session-time" title="${escapeHtml(session.updatedAt ?? session.createdAt ?? "")}">${escapeHtml(timeLabel)}</span>` : ""}
          <span class="task-state ${phaseClass(session)}">${escapeHtml(phaseLabel(session))}</span>
          <button class="session-delete" type="button" title="${escapeHtml(t("delete"))}">${escapeHtml(t("delete"))}</button>
        </span>
      </span>
      <span class="session-meta">
        <span class="kind-chip kind-${escapeHtml(session.kind)}">${escapeHtml(session.kind)}</span>
        <span class="session-cwd" title="${escapeHtml(session.cwd)}">${escapeHtml(cwdLabel)}</span>
      </span>
    `;
    item.addEventListener("click", () => selectSession(session));
    item.querySelector(".session-delete").addEventListener("click", (event) => {
      event.stopPropagation();
      openDeleteDialog(session);
    });
  return item;
}

function filteredSessions() {
  let sessions = state.sessions;
  const phaseFilter = state.phaseFilter || "all";
  if (phaseFilter !== "all") {
    sessions = sessions.filter((session) => sessionPhase(session) === phaseFilter);
  } else {
    sessions = sessions.filter((session) => sessionPhase(session) !== "closed");
  }
  const query = state.sessionSearch.trim().toLowerCase();
  if (query) {
    sessions = sessions.filter((session) => {
      const haystack = [
        session.name,
        session.project,
        session.cwd,
        session.kind
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }
  sessions = sortSessionsForDisplay(sessions);
  return sessions;
}

function sortSessionsForDisplay(sessions) {
  const phaseRank = { active: 0, stopped: 1, closed: 2 };
  return [...sessions].sort((left, right) => {
    const phaseDelta = (phaseRank[sessionPhase(left)] ?? 3) - (phaseRank[sessionPhase(right)] ?? 3);
    if (phaseDelta !== 0) return phaseDelta;
    return new Date(right.updatedAt ?? right.createdAt ?? 0).getTime() -
      new Date(left.updatedAt ?? left.createdAt ?? 0).getTime();
  });
}

async function selectSession(session) {
  state.selected = session;
  state.selectedSessionId = session.id;
  state.selectionVersion += 1;
  showTerminalView();
  renderSessions();
  renderTaskAlert();
  renderQuickKeys();
  closeSessionsPanel();
  if (session.status === "running") {
    state.outputScrollOffset = 0;
    clearOutputEtag(session.id);
    try {
      await resizeTerminalForSession(session);
    } catch (error) {
      console.warn(error);
    }
    await loadOutput({ force: true });
    resetOutputPolling(1000);
  } else {
    clearOutputPoll();
    showSessionSummary(session);
  }
}

function showTerminalView() {
  els.output.hidden = false;
  els.addQuickKey.hidden = false;
  if (!state.selected) {
    els.title.textContent = t("noSession");
    state.selectedSessionId = "";
    state.selectionVersion += 1;
  }
}

function closeSessionsPanel() {
  els.sessionsPanel.classList.remove("open");
  els.sessionsPanel.setAttribute("aria-hidden", "true");
}

function openAssistant() {
  els.runDialog.classList.add("open");
  els.runDialog.setAttribute("aria-hidden", "false");
  els.runDialog.querySelector(".assistant-subtitle").textContent = "web-pi";
  renderAssistantMessages();
}

function closeAssistant() {
  els.runDialog.classList.remove("open");
  els.runDialog.setAttribute("aria-hidden", "true");
  focusSessionInput();
}

function appendAssistantMessage(role, text) {
  state.assistantMessages.push({
    role,
    text: String(text ?? ""),
    createdAt: new Date().toISOString()
  });
  if (state.assistantMessages.length > 80) {
    state.assistantMessages = state.assistantMessages.slice(-80);
  }
  renderAssistantMessages();
}

function renderAssistantMessages() {
  if (!els.assistantMessages) return;
  if (!state.assistantMessages.length) {
    const emptyText = t("assistantEmpty");
    els.assistantMessages.innerHTML = `<div class="assistant-empty">${escapeHtml(emptyText)}</div>`;
    return;
  }
  els.assistantMessages.innerHTML = state.assistantMessages
    .map((message) => {
      const roleLabel =
        message.role === "user"
          ? t("assistantUser")
          : message.role === "error"
            ? t("assistantError")
            : "web-pi";
      return `
        <div class="assistant-message ${escapeHtml(message.role)}">
          <div class="assistant-role">${escapeHtml(roleLabel)}</div>
          <div class="assistant-text">${escapeHtml(message.text)}</div>
        </div>
      `;
    })
    .join("");
  els.assistantMessages.scrollTop = els.assistantMessages.scrollHeight;
}

function closeDialog(dialogId) {
  const dialog = document.querySelector(`#${dialogId}`);
  if (dialog?.open) dialog.close();
}

async function loadHistory() {
  try {
    const data = await api("/api/history");
    renderHistory(data.history ?? []);
  } catch (error) {
    els.historyList.textContent = `Error: ${error.message}`;
  }
}

function renderHistory(history) {
  if (!history.length) {
    els.historyList.textContent = t("noHistory");
    return;
  }
  els.historyList.innerHTML = history
    .map(
      (item) => `
    <div class="history-item">
      <div class="history-meta">
        <span class="history-session">${escapeHtml(item.sessionName || item.sessionId)}</span>
        <span class="history-kind">${escapeHtml(item.sessionKind || "")}</span>
        <span class="history-time">${formatTime(item.createdAt)}</span>
      </div>
      <div class="history-text">${escapeHtml(item.text)}</div>
    </div>
  `
    )
    .join("");
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString();
}

function focusSessionInput() {
  requestAnimationFrame(() => {
    if (state.selected?.status === "running") {
      els.input.focus();
    }
  });
}

function applyServerSettings(settings) {
  state.notifications = settings?.notifications ?? {};
  state.sessionAgentSettings = settings?.sessionAgent ?? {};
  const commandParser = settings?.commandParser ?? {};
  els.webPiEnabled.checked = Boolean(state.sessionAgentSettings.enabled);
  els.aiParserFallback.checked = Boolean(commandParser.enabled) && commandParser.mode !== "rules-only";

  const savedConfig = localStorage.getItem("sessionGatewayAiParser");
  if (savedConfig) {
    const saved = JSON.parse(savedConfig);
    if (saved.baseUrl && saved.model) {
      els.aiParserBaseUrl.value = saved.baseUrl;
      els.aiParserModel.value = saved.model || "";
      els.aiParserApiKey.value = saved.apiKey || "";
      return;
    }
  }

  els.aiParserBaseUrl.value = commandParser.baseUrl ?? "";
  els.aiParserModel.value = commandParser.model ?? "";
  els.aiParserApiKey.value = commandParser.apiKey ?? "";
}

function applyLanguage() {
  const text = translations[state.language] ?? translations.zh;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = text[element.dataset.i18n] ?? element.textContent;
  });
  els.openSessions.textContent = text.sessions;
  renderTaskAlert();
  els.openCreate.textContent = text.create;
  els.openRun.textContent = text.command;
  els.restart.textContent = text.restart;
  els.stop.textContent = text.stop;
  els.openConfig.textContent = text.config;
  els.sessionsTitle.textContent = text.sessionsTitle;
  els.closeSessions.textContent = text.close;
  els.refresh.textContent = text.refresh;
  els.send.textContent = text.send;
  els.create.textContent = text.create;
  els.runNl.textContent = text.send;
  document.querySelector("#confirm-delete").textContent = text.delete;
  els.input.placeholder = text.sendPlaceholder;
  els.name.placeholder = text.namePlaceholder;
  els.cwd.placeholder = text.cwdPlaceholder;
  els.project.placeholder = text.projectPlaceholder;
  els.nl.placeholder = text.nlPlaceholder;
  renderAssistantMessages();
  if (!state.selected) els.title.textContent = text.noSession;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  if (state.terminal) state.terminal.options.theme = terminalTheme();
}

function t(key) {
  return (translations[state.language] ?? translations.zh)[key] ?? key;
}

function showError(error) {
  updateOutputText(error instanceof Error ? error.message : String(error));
}

function formatCommandResult(result) {
  if (!result || typeof result !== "object") return String(result);
  if (result.command?.type === "assistant") {
    if (typeof result.answer === "string" && result.answer.trim()) {
      return result.answer;
    }
    if (!result.ok) {
      return state.language === "zh"
        ? "助手处理请求时遇到问题，请稍后重试。"
        : "The assistant encountered an issue processing your request. Please try again.";
    }
  }
  if (Array.isArray(result.sessions)) {
    if (typeof result.summary === "string" && result.summary.trim()) return result.summary;
    return formatSessionList(result.sessions);
  }
  if (result.command?.type === "help" && typeof result.help === "string") return result.help;
  if (result.command?.type === "send") return state.language === "zh" ? "已发送。" : "Sent.";
  if (result.command?.type === "output") return state.language === "zh" ? "已显示最近输出。" : "Recent output shown.";
  if (result.command?.type === "stop") return state.language === "zh" ? "已停止。" : "Stopped.";
  if (result.command?.type === "restart") return state.language === "zh" ? "已重启。" : "Restarted.";
  if (result.command?.type === "create" && result.session) {
    return formatSessionList([result.session]);
  }
  if (result.command?.type === "switch" && result.session) {
    return formatSessionList([result.session]);
  }
  const copy = { ...result };
  if (typeof copy.output === "string") copy.output = `${copy.output.length} characters shown in terminal`;
  return JSON.stringify(copy, null, 2);
}

function formatSessionList(sessions) {
  if (!sessions.length) return state.language === "zh" ? "没有会话。" : "No sessions.";
  return sessions
    .map((session) =>
      [
        `${session.name}  [${session.kind} / ${sessionStatusLabel(session)}]`,
        `cwd: ${session.cwd}`,
        session.project ? `project: ${session.project}` : null,
        session.updatedAt ? `updated: ${session.updatedAt}` : null
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}

function sessionStatusLabel(session) {
  return session.status === "running" ? t("statusRunning") : t("statusStopped");
}

function taskStateLabel(session) {
  if (session.taskState === "needs_confirmation") return t("taskNeedsConfirmation");
  if (session.taskState === "completed") return t("taskCompleted");
  return t("taskInProgress");
}

function taskStateClass(taskState) {
  if (taskState === "needs_confirmation") return "needs-confirmation";
  if (taskState === "completed") return "completed";
  return "in-progress";
}

function sessionPhase(session) {
  if (session.phase) return session.phase;
  if (session.status !== "running") return "closed";
  return session.taskState === "completed" ? "stopped" : "active";
}

function phaseLabel(session) {
  const phase = sessionPhase(session);
  if (phase === "closed") return t("phaseClosed");
  if (phase === "stopped") return t("phaseStopped");
  return session.taskState === "needs_confirmation" ? t("taskNeedsConfirmation") : t("phaseActive");
}

function phaseClass(session) {
  const phase = sessionPhase(session);
  if (phase === "closed") return "phase-closed";
  if (phase === "stopped") return "completed";
  return taskStateClass(session.taskState);
}

function shortCwd(cwd) {
  if (!cwd) return "";
  if (cwd.startsWith("/home/v6/work/")) return `~/work/${cwd.slice("/home/v6/work/".length)}`;
  if (cwd.startsWith("/home/")) {
    const parts = cwd.split("/").filter(Boolean);
    return `~/${parts.slice(1).join("/")}`;
  }
  return cwd;
}

function relativeTime(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const zh = state.language === "zh";
  if (diffMs < minute) return zh ? "刚刚" : "just now";
  if (diffMs < hour) return zh ? `${Math.floor(diffMs / minute)} 分钟前` : `${Math.floor(diffMs / minute)}m`;
  if (diffMs < day) return zh ? `${Math.floor(diffMs / hour)} 小时前` : `${Math.floor(diffMs / hour)}h`;
  if (diffMs < 7 * day) return zh ? `${Math.floor(diffMs / day)} 天前` : `${Math.floor(diffMs / day)}d`;
  const date = new Date(timestamp);
  return zh
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function refreshSelectedOutput() {
  const selected = currentSelectedSession();
  if (document.hidden || !selected || selected.status !== "running") {
    clearOutputPoll();
    return;
  }
  const changed = await loadOutput();
  if (changed === false && state.outputScrollOffset === 0) maybeAutoYes(state.latestOutputText);
  updateOutputPollDelay(changed);
  scheduleOutputPoll(state.outputPollDelayMs);
}

function resetOutputPolling(delayMs = 1000) {
  state.outputPollDelayMs = delayMs;
  scheduleOutputPoll(delayMs);
}

function updateOutputPollDelay(changed) {
  if (changed === true) {
    state.outputPollDelayMs = OUTPUT_POLL_DELAYS_MS[0];
    return;
  }
  const currentIndex = OUTPUT_POLL_DELAYS_MS.indexOf(state.outputPollDelayMs);
  const nextIndex = Math.min(currentIndex < 0 ? 1 : currentIndex + 1, OUTPUT_POLL_DELAYS_MS.length - 1);
  state.outputPollDelayMs = OUTPUT_POLL_DELAYS_MS[nextIndex];
}

function scheduleOutputPoll(delayMs) {
  clearOutputPoll();
  const selected = currentSelectedSession();
  if (document.hidden || !selected || selected.status !== "running") return;
  state.outputPollTimer = setTimeout(refreshSelectedOutput, delayMs);
}

function scheduleSessionPoll(delayMs = 5000) {
  clearSessionPoll();
  if (document.hidden && state.allYesMode !== "global") return;
  state.sessionPollTimer = setTimeout(refreshSessions, delayMs);
}

function clearSessionPoll() {
  if (state.sessionPollTimer) {
    clearTimeout(state.sessionPollTimer);
    state.sessionPollTimer = null;
  }
}

function clearOutputPoll() {
  if (state.outputPollTimer) {
    clearTimeout(state.outputPollTimer);
    state.outputPollTimer = null;
  }
}

function clearOutputEtag(sessionId) {
  state.outputEtags.delete(sessionId);
}

function showSessionSummary(session) {
  els.title.textContent = session.name;
  els.output.textContent = JSON.stringify(
    {
      name: session.name,
      kind: session.kind,
      status: session.status,
      taskState: taskStateLabel(session),
      cwd: session.cwd,
      project: session.project,
      tmuxSessionName: session.tmuxSessionName,
      command: [session.command, ...session.commandArgs].join(" ")
    },
    null,
    2
  );
}

function firstSessionNeedingConfirmation() {
  return state.sessions.find((session) => session.taskState === "needs_confirmation") ?? null;
}

function renderTaskAlert() {
  const session = firstSessionNeedingConfirmation();
  if (!session) {
    els.confirmAlert.hidden = true;
    els.confirmAlert.textContent = "";
    return;
  }
  els.confirmAlert.hidden = false;
  els.confirmAlert.textContent = t("confirmAlert").replace("{name}", session.name);
  els.confirmAlert.title = session.name;
}

function markSelectedTaskState(taskState) {
  if (!state.selected) return;
  state.selected = { ...state.selected, taskState };
  state.sessions = state.sessions.map((session) =>
    session.id === state.selected.id ? { ...session, taskState } : session
  );
  renderTaskAlert();
  renderSessions();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

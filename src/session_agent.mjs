import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, getModels, getProviders, Type } from "@earendil-works/pi-ai";
import { parseNaturalCommand } from "./nl.mjs";

const DEFAULT_MODEL_SPEC = "openai:gpt-5.2";

const SYSTEM_PROMPT = [
  "You are web-pi, the Session Gateway middle-layer assistant.",
  "The /api/nl endpoint sends user messages to you. Backend tool results are also sent back to you so you can produce the final user-facing answer.",
  "You can only operate Session Gateway sessions through the provided tools.",
  "You do not have shell, filesystem, project search, delete, or network tools. Refuse requests for those capabilities.",
  "Before acting, prefer checking current session state when the target or state is ambiguous.",
  "If the user clearly asks for a side-effect action such as stop, restart, create, switch, send text, or confirm permission, execute it with the appropriate tool.",
  "For stop requests that mention idle or completed sessions, only stop sessions whose taskState is completed unless the user names a specific target.",
  "When a session has needs_confirmation and the user asks to confirm, send Enter or a safe visible option with send_keys_to_session.",
  "When the user asks to summarize a session, read the needed output with get_session_output and summarize it in your final answer. Do not ask the user to inspect raw output.",
  "Session phases: 'active' means the tmux session is alive and the task is running or waiting; 'stopped' means the tmux session is still alive but the task completed; 'closed' means the tmux session no longer exists. list_sessions hides closed sessions by default; pass closedOnly=true to list closed ones, includeClosed=true to include them.",
  "MANDATORY TOOL USE: Any request to list, show, find, or count sessions (including active/stopped/closed only, by project, or by name) MUST call list_sessions first; never answer from memory or guess session names or states. Base the answer on the returned summary field and sessions array.",
  "Always call list_sessions again on every list/count request even if you listed sessions earlier in the conversation, because session states change. The default result excludes closed sessions; you must NOT infer that no closed sessions exist. Questions about closed sessions require list_sessions with closedOnly=true.",
  "MANDATORY TOOL USE: Any request to view/read/show a session's output or recent lines MUST call get_session_output (or switch_session) first. Never fabricate, abbreviate as '...', or guess terminal output.",
  "When list_sessions returns a summary string, you may relay that summary directly as the answer (optionally rephrased lightly); do not invent sessions that are absent from it.",
  "",
  "Never answer only with generic text such as '操作已完成' when backend output is available. Use the backend output to answer the user's actual request.",
  "Keep final answers concise and mention the concrete sessions you acted on.",
  "IMPORTANT: Be extremely concise. Answer in 1-3 sentences max. No explanations or elaborations unless explicitly asked. Direct answers only."
].join("\n");

export function createSessionAgentManager(context, operations, options = {}) {
  let agent = options.agent ?? null;
  let modelKey = "";

  function getEffectiveSettings() {
    const sessionAgent = context.config.runtimeSettings?.sessionAgent ?? {};
    const commandParser = context.config.runtimeSettings?.commandParser ?? {};
    // Use sessionAgent settings if model is configured, otherwise fall back to commandParser
    if (sessionAgent.model && sessionAgent.model.trim()) {
      return sessionAgent;
    }
    // Convert commandParser settings to sessionAgent format
    // commandParser uses baseUrl + model, sessionAgent uses provider:model format
    // We create a custom "openai:command-parser" model entry
    const baseUrl = commandParser.baseUrl || "";
    const modelId = commandParser.model || "";
    const apiKey = commandParser.apiKey || "local";
    if (!baseUrl || !modelId) {
      return { model: "", apiKey: "", models: {} };
    }
    return {
      model: "openai:command-parser",
      apiKey,
      models: {
        openai: {
          "command-parser": {
            api: "openai-completions",
            provider: "openai",
            baseUrl,
            id: modelId,
            name: modelId
          }
        }
      }
    };
  }

  async function buildAgent() {
    const settings = getEffectiveSettings();
    const resolved = resolveSessionAgentModel(settings);
    const tools = createSessionAgentTools(operations);
    modelKey = settingsKey(settings);
    agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model: resolved.model,
        thinkingLevel: "off",
        tools
      },
      getApiKey(provider) {
        return resolved.apiKeyByProvider.get(provider) ?? resolved.apiKey;
      },
      onPayload(payload, model) {
        return applyModelPayloadOptions(payload, model);
      },
      toolExecution: "sequential",
      sessionId: "session-gateway-global-nl-assistant"
    });
    return agent;
  }

  async function getAgent() {
    if (options.agent) return options.agent;
    const settings = getEffectiveSettings();
    const nextKey = settingsKey(settings);
    if (!agent || nextKey !== modelKey || settings.resetOnConfigChange) return buildAgent();
    return agent;
  }

  return {
    async run(text, request = {}) {
      operations.setCurrentRequest?.({ ...request, text });
      const currentAgent = await getAgent();
      const actions = [];
      const unsubscribe = currentAgent.subscribe((event) => {
        if (event.type !== "tool_execution_end") return;
        actions.push({
          tool: event.toolName,
          ok: !event.isError,
          details: event.result?.details ?? null
        });
      });
      try {
        if (typeof currentAgent.state?.tools !== "undefined") {
          currentAgent.state.tools = createSessionAgentTools(operations);
        }
        if (typeof currentAgent.state?.systemPrompt === "string") {
          const sessionState = await operations.summarize_session_states();
          currentAgent.state.systemPrompt = `${SYSTEM_PROMPT}\n\nCurrent session state:\n${sessionState}`;
        }
        // Small local models often skip tool calls entirely. Deterministically
        // execute read-only intents (list sessions, view session output) so the
        // answer is always based on real backend data.
        const presetActions = await planReadOnlyActions(text, request, operations);
        if (presetActions) {
          actions.push(...presetActions);
          await synthesizeBackendOutput(currentAgent, text, request, actions, { force: true });
          return buildAssistantResponse(currentAgent, actions, text);
        }
        await currentAgent.prompt(buildUserPrompt(text, request));
        await synthesizeBackendOutput(currentAgent, text, request, actions);
        return buildAssistantResponse(currentAgent, actions, text);
      } finally {
        unsubscribe?.();
      }
    },
    reset() {
      agent?.reset?.();
      agent = null;
      modelKey = "";
    }
  };
}

async function synthesizeBackendOutput(agent, text, request, actions, options = {}) {
  if (!options.force && !shouldSendBackendOutputToWebPi(text, actions, agent)) return;
  const previousTools = agent.state?.tools;
  if (agent.state && typeof previousTools !== "undefined") {
    agent.state.tools = [];
  }
  try {
    await agent.prompt(buildBackendOutputPrompt(text, request, actions));
  } finally {
    if (agent.state && typeof previousTools !== "undefined") {
      agent.state.tools = previousTools;
    }
  }
}

async function planReadOnlyActions(text, request, operations) {
  let command;
  try {
    command = parseNaturalCommand(text);
  } catch {
    return null;
  }
  if (!command || typeof command !== "object") return null;

  if (command.type === "list") {
    const params = {};
    for (const key of ["runningOnly", "stoppedOnly", "closedOnly", "includeClosed", "project", "nameQuery"]) {
      if (command[key] !== undefined && command[key] !== null && command[key] !== false) {
        params[key] = command[key];
      }
    }
    const details = await operations.list_sessions(params);
    return [{ tool: "list_sessions", ok: true, details }];
  }

  if (command.type === "output") {
    const params = {
      lines: command.lines ?? 50,
      currentSessionId: typeof request.currentSessionId === "string" ? request.currentSessionId : null
    };
    if (command.target) params.target = command.target;
    if (command.targetIndex) params.targetIndex = command.targetIndex;
    try {
      const details = await operations.get_session_output(params);
      return [{ tool: "get_session_output", ok: true, details }];
    } catch (error) {
      return [{ tool: "get_session_output", ok: false, details: { error: String(error?.message ?? error) } }];
    }
  }

  return null;
}

function createSessionAgentTools(operations) {
  return [
    tool("List Sessions", "list_sessions", "List Session Gateway sessions that still have a tmux session. Phases: active (task running or waiting), stopped (tmux alive but task completed), closed (tmux session gone; excluded by default, use closedOnly=true to list only closed ones, or includeClosed=true to include them). Filter by project or name substring when the user asks for them. Use detailed=true only when you need full session info (project, command, timestamps).", {
      runningOnly: Type.Optional(Type.Boolean()),
      stoppedOnly: Type.Optional(Type.Boolean({ description: "Only sessions whose tmux session is alive but task is completed" })),
      closedOnly: Type.Optional(Type.Boolean({ description: "Only sessions whose tmux session no longer exists" })),
      includeClosed: Type.Optional(Type.Boolean({ description: "Include closed sessions alongside active and stopped ones" })),
      project: Type.Optional(Type.String({ description: "Filter sessions by project label, e.g. igaDC" })),
      nameQuery: Type.Optional(Type.String({ description: "Filter sessions whose name contains this substring, e.g. resume" })),
      detailed: Type.Optional(Type.Boolean({ description: "Return full session details (project, command, timestamps). Default: compact (id, name, kind, status, cwd)." })),
      includeOutputLines: Type.Optional(Type.Number({ minimum: 0, maximum: 200 }))
    }, operations.list_sessions),
    tool("Get Session Output", "get_session_output", "Read recent terminal output from a target session.", targetSchema({
      lines: Type.Optional(Type.Number({ minimum: 1, maximum: 500 }))
    }), operations.get_session_output),
    tool("Send Text", "send_to_session", "Send submitted text to a target session.", targetSchema({
      text: Type.String({ minLength: 1 })
    }), operations.send_to_session),
    tool("Send Keys", "send_keys_to_session", "Send whitelisted tmux keys such as Enter or Escape to a target session.", targetSchema({
      keys: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 })
    }), operations.send_keys_to_session),
    tool("Switch Session", "switch_session", "Return the target session and recent output so the UI can switch selection.", targetSchema({}), operations.switch_session),
    tool("Stop Session", "stop_session", "Stop a target Session Gateway session.", targetSchema({}), operations.stop_session),
    tool("Restart Session", "restart_session", "Restart a target Session Gateway session.", targetSchema({}), operations.restart_session),
    tool("Create Session", "create_session", "Create a new codex, claude, opencode, pi-os, or runtime session.", {
      kind: Type.String({ description: "codex, claude, opencode, pi-os, or runtime" }),
      name: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
      project: Type.Optional(Type.String())
    }, operations.create_session),
    tool("Summarize Session States", "summarize_session_states", "Read-only summary of sessions by task state.", {}, async () => {
      const summary = await operations.summarize_session_states();
      return { summary };
    })
  ];
}

function tool(label, name, description, schema, execute) {
  const parameters = Type.Object(schema);
  return {
    label,
    name,
    description,
    parameters,
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      const details = await execute(params);
      return {
        content: [{ type: "text", text: JSON.stringify(details) }],
        details
      };
    }
  };
}

function targetSchema(extra) {
  return {
    target: Type.Optional(Type.String()),
    targetIndex: Type.Optional(Type.Number({ minimum: 1 })),
    currentSessionId: Type.Optional(Type.String()),
    ...extra
  };
}

function buildUserPrompt(text, request) {
  const currentSessionId =
    typeof request.currentSessionId === "string" && request.currentSessionId.trim()
      ? request.currentSessionId.trim()
      : null;
  return [
    `User request: ${text}`,
    `Current selected session id: ${currentSessionId ?? "none"}`,
    "Use tools when the request asks about or changes Session Gateway sessions.",
    "After tools return backend output, answer the user's actual request from that output."
  ].join("\n");
}

function buildBackendOutputPrompt(text, request, actions) {
  const currentSessionId =
    typeof request.currentSessionId === "string" && request.currentSessionId.trim()
      ? request.currentSessionId.trim()
      : null;
  const toolNames = actions.map((action) => action.tool);
  const intentHints = [];
  if (toolNames.includes("list_sessions")) {
    intentHints.push(
      "用户要列出/统计会话：必须基于 details.summary 用中文回答，严格按『进行中/已停止/已关闭』分组列出会话名称，不要混为一类，也不要编造结果中不存在的会话。默认结果不包含已关闭会话，除非结果中确实出现『已关闭』分组，否则不要声称没有已关闭会话。"
    );
  }
  if (toolNames.includes("get_session_output")) {
    intentHints.push(
      "用户要查看会话内容：请用中文总结 details.output 中该会话的近期终端内容（当前在做什么、最新进展、最后出现的提示或等待），不要只回答会话名称，禁止使用『[请在此处插入...』之类的占位文字。若 details 含有 error 字段，直接用中文说明无法查看的原因。"
    );
  }
  return [
    "Backend tool output for web-pi synthesis:",
    `Original user request: ${text}`,
    `Current selected session id: ${currentSessionId ?? "none"}`,
    "Do not call tools. Use the backend output below to produce the final answer.",
    "If the user asked for a summary, summarize the session output directly in Chinese.",
    ...intentHints,
    "If an action was performed, state the concrete result. Do not say only '操作已完成'.",
    truncateForModel(JSON.stringify(actions.map((action) => ({
      tool: action.tool,
      ok: action.ok,
      details: action.details
    })), null, 2), 40000)
  ].join("\n\n");
}

function buildAssistantResponse(agent, actions, requestText = "") {
  const assistant = [...(agent.state?.messages ?? [])].reverse().find((message) => message.role === "assistant");
  const answer = assistantText(assistant);
  const merged = mergeActionDetails(actions, requestText);
  const updateTerminal = shouldUpdateTerminal(actions, requestText);
  return {
    command: { type: "assistant", source: "web-pi" },
    ok: !agent.state?.errorMessage,
    answer,
    actions,
    presentation: { updateTerminal },
    ...merged
  };
}

function mergeActionDetails(actions, requestText = "") {
  const output = {};
  for (const action of actions) {
    const details = action.details;
    if (!details || typeof details !== "object") continue;
    if (details.session) output.session = details.session;
    if (typeof details.output === "string" && shouldExposeActionOutput(action, requestText)) {
      output.output = details.output;
    }
    if (Array.isArray(details.sessions)) output.sessions = details.sessions;
    if (typeof details.summary === "string") output.summary = details.summary;
  }
  return output;
}

function shouldUpdateTerminal(actions, requestText = "") {
  if (isSummaryIntent(requestText)) return false;
  return actions.some((action) => shouldExposeActionOutput(action, requestText));
}

function shouldExposeActionOutput(action, requestText = "") {
  if (isSummaryIntent(requestText)) return false;
  return action.tool === "get_session_output" || action.tool === "switch_session" || action.tool === "send_to_session";
}

function isSummaryIntent(text = "") {
  return /总结|摘要|概括|归纳|summary|summari[sz]e|recap/i.test(String(text));
}

function shouldSendBackendOutputToWebPi(text, actions, agent) {
  if (!actions.length) return false;
  if (isSummaryIntent(text)) return true;
  const answer = assistantText([...((agent.state?.messages) ?? [])].reverse().find((message) => message.role === "assistant"));
  if (/^(?:操作已完成|已完成|完成|done|completed)[。.!！\s]*$/iu.test(answer)) return true;
  return actions.some((action) => action.details && typeof action.details === "object" && "output" in action.details);
}

function truncateForModel(text, maxChars) {
  const value = String(text ?? "");
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function assistantText(message) {
  if (!message?.content) return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function resolveSessionAgentModel(settings = {}) {
  const registry = parseSettingsRegistry(settings.models);
  const modelSpec = settings.model || DEFAULT_MODEL_SPEC;
  const { provider, modelId } = splitModelSpec(modelSpec);
  const custom = registry.get(provider)?.get(modelId);
  const model = custom?.model ?? resolveBuiltInModel(provider, modelId);
  const apiKey = custom?.apiKey || settings.apiKey || "";
  return {
    model,
    apiKey,
    apiKeyByProvider: new Map([[model.provider, apiKey]])
  };
}

function parseSettingsRegistry(models = {}) {
  const registry = new Map();
  if (!models || typeof models !== "object" || Array.isArray(models)) return registry;
  for (const [provider, providerValue] of Object.entries(models)) {
    if (!providerValue || typeof providerValue !== "object" || Array.isArray(providerValue)) continue;
    const providerModels = new Map();
    for (const [modelId, entry] of Object.entries(providerValue)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      providerModels.set(modelId, {
        model: {
          id: entry.id || modelId,
          name: entry.name || modelId,
          api: entry.api,
          provider: entry.provider || provider,
          baseUrl: entry.baseUrl,
          reasoning: Boolean(entry.reasoning),
          input: Array.isArray(entry.input) && entry.input.length ? entry.input : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: entry.contextWindow || 128000,
          maxTokens: entry.maxTokens || 4096,
          headers: entry.headers || {}
        },
        apiKey: entry.apiKey || ""
      });
    }
    registry.set(provider, providerModels);
  }
  return registry;
}

function splitModelSpec(modelSpec) {
  const separator = modelSpec.indexOf(":");
  if (separator === -1) throw new Error(`sessionAgent.model must use provider:model-id format. Received: ${modelSpec}`);
  return { provider: modelSpec.slice(0, separator), modelId: modelSpec.slice(separator + 1) };
}

function resolveBuiltInModel(provider, modelId) {
  if (!getProviders().includes(provider)) throw new Error(`Unknown sessionAgent model provider: ${provider}`);
  const model = getModel(provider, modelId);
  if (!model) {
    const examples = getModels(provider).slice(0, 10).map((entry) => entry.id).join(", ");
    throw new Error(`Unknown sessionAgent model ${provider}:${modelId}. Available examples: ${examples}`);
  }
  return model;
}

function settingsKey(settings = {}) {
  return JSON.stringify({
    model: settings.model || DEFAULT_MODEL_SPEC,
    apiKey: settings.apiKey || "",
    models: settings.models || {}
  });
}

function applyModelPayloadOptions(payload, model) {
  if (!payload || typeof payload !== "object") return undefined;
  const next = { ...payload };
  if (model?.maxTokens && typeof next.max_tokens === "number") {
    next.max_tokens = Math.min(next.max_tokens, model.maxTokens);
  }
  if (model?.provider === "JD" && model?.id?.toLowerCase().includes("kimi")) {
    next.thinking = { type: "disabled" };
  }
  return next;
}

import { normalizeLines, sanitizeTmuxName } from "./utils.mjs";

const ALLOWED_TYPES = new Set(["create", "list", "send", "output", "switch", "stop", "restart", "help"]);
const ALLOWED_KINDS = new Set(["codex", "claude", "opencode", "pi-os", "runtime"]);

export async function parseWithLocalModel(text, settings, fetchImpl = fetch) {
  const parser = settings?.commandParser;
  if (!parser?.enabled) throw new Error("AI command parser is not enabled");
  if (!parser.baseUrl) throw new Error("AI command parser baseUrl is required");
  if (!parser.model) throw new Error("AI command parser model is required");

  const response = await fetchImpl(openAiChatUrl(parser.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(parser.apiKey ? { authorization: `Bearer ${parser.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: parser.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: commandManual()
        },
        { role: "user", content: `${text} /no_think` }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI command parser failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI command parser returned empty content");
  }

  return validateAiCommand(parseJsonContent(content));
}

export function commandManual() {
  return [
    "You are the command parser for Session Gateway. Do not generate any <|channel>thought tags or reasoning content. Just give the final answer directly.",
    "Read the user's natural-language command and return exactly one JSON object.",
    "Return JSON only. Do not use markdown. Do not explain.",
    "",
    "Security rules:",
    "- You are not an executor. You only classify intent into one allowed JSON action.",
    "- Never return shell commands, scripts, code, or arbitrary actions.",
    "- If the user asks for an unsupported operation, return {\"type\":\"help\"}.",
    "- Allowed type values: create, list, send, output, switch, stop, restart, help.",
    "- Allowed CLI kinds for create: codex, claude, opencode, pi-os, runtime.",
    "- Treat 'claude code', 'claud', and 'claud code' as the claude CLI kind.",
    "- Treat 'pi-os' and 'pi os' as the pi-os CLI kind.",
    "- Session names and project names should use letters, numbers, dot, underscore, or hyphen.",
    "- If the user says name is '<prefix>+folder name' or '<prefix>+文件夹名称', convert it to '<prefix>-<last path segment>'.",
    "",
    "Operation manual:",
    "- help: user asks for help, command list, usage, or examples.",
    "- list: user asks to query/list/view session lists. Set runningOnly true only when they ask for running/active sessions.",
    "- create: user asks to create/build/start a new codex, claude, opencode, or runtime session. Extract cwd from directory/folder/path wording when present. If no working directory is specified, omit cwd so the server can choose the default.",
    "- send: user asks to send text/message/instruction to a session. If no target session is named, omit target or set it to null. For text like '发送xxx', strip the send prefix and use only xxx as text. For '发送到web-ai-agent会话xxx', '发送xxx到web-ai-agent会话', or 'xxx到web-ai-agent会话', set target to web-ai-agent and text to xxx. For '发送到第五个会话xxx' or 'xxx到第五个会话', set targetIndex to 5, target to null, and text to xxx.",
    "- output: user asks to show/capture/recent output for a session. Default lines is 50 unless the user gives a number. If no target session is named, omit target or set it to null, meaning the current session. For '查看第二个会话' or '第二个会话最近输出', set targetIndex to 2 and target to null.",
    "- ASR-tolerant Chinese: 查看绘画, 查看回话, and 查看对话 mean 查看会话 and should return output target null lines 50.",
    "- switch: user asks to enter/use/switch to a session. For '切换到第二个会话', set targetIndex to 2 and target to null.",
    "- stop: user asks to stop/end a session. For ordinal session wording, use targetIndex.",
    "- restart: user asks to restart a session. For ordinal session wording, use targetIndex.",
    "",
    "Return schemas:",
    "{\"type\":\"create\",\"input\":{\"kind\":\"codex|claude|opencode|pi-os|runtime\",\"cwd\":\"optional /path\",\"name\":\"optional\",\"project\":null}}",
    "{\"type\":\"list\",\"runningOnly\":false}",
    "{\"type\":\"send\",\"target\":\"optional session name or null\",\"targetIndex\":\"optional one-based session position\",\"text\":\"message\"}",
    "{\"type\":\"output\",\"target\":\"optional session name or null\",\"targetIndex\":\"optional one-based session position\",\"lines\":50}",
    "{\"type\":\"switch\",\"target\":\"optional session name or null\",\"targetIndex\":\"optional one-based session position\"}",
    "{\"type\":\"stop\",\"target\":\"optional session name or null\",\"targetIndex\":\"optional one-based session position\"}",
    "{\"type\":\"restart\",\"target\":\"optional session name or null\",\"targetIndex\":\"optional one-based session position\"}",
    "{\"type\":\"help\"}",
    "",
    "Examples:",
    "User: 帮助",
    "JSON: {\"type\":\"help\"}",
    "User: 列出运行中的会话",
    "JSON: {\"type\":\"list\",\"runningOnly\":true}",
    "User: 查询会话列表",
    "JSON: {\"type\":\"list\",\"runningOnly\":false}",
    "User: 建一个opencode会话，用/workspace/OPCAid文件夹，会话名称用opencode+文件夹名称",
    "JSON: {\"type\":\"create\",\"input\":{\"kind\":\"opencode\",\"cwd\":\"/workspace/OPCAid\",\"name\":\"opencode-OPCAid\",\"project\":null}}",
    "User: 新建 codex 会话 app，目录 /workspace/app",
    "JSON: {\"type\":\"create\",\"input\":{\"kind\":\"codex\",\"cwd\":\"/workspace/app\",\"name\":\"app\",\"project\":null}}",
    "User: 发送 查看当前项目结构",
    "JSON: {\"type\":\"send\",\"target\":null,\"text\":\"查看当前项目结构\"}",
    "User: 发送修改一下返回的列数",
    "JSON: {\"type\":\"send\",\"target\":null,\"text\":\"修改一下返回的列数\"}",
    "User: 发送到web-ai-agent会话修改配置",
    "JSON: {\"type\":\"send\",\"target\":\"web-ai-agent\",\"text\":\"修改配置\"}",
    "User: 发送修改配置到web-ai-agent会话",
    "JSON: {\"type\":\"send\",\"target\":\"web-ai-agent\",\"text\":\"修改配置\"}",
    "User: 你好到web-ai-agent会话",
    "JSON: {\"type\":\"send\",\"target\":\"web-ai-agent\",\"text\":\"你好\"}",
    "User: 你好到第四个会话",
    "JSON: {\"type\":\"send\",\"target\":null,\"targetIndex\":4,\"text\":\"你好\"}",
    "User: 发送到第五个会话修改配置",
    "JSON: {\"type\":\"send\",\"target\":null,\"targetIndex\":5,\"text\":\"修改配置\"}",
    "User: 把 npm test 发给 codex-app",
    "JSON: {\"type\":\"send\",\"target\":\"codex-app\",\"text\":\"npm test\"}",
    "User: 查看绘画",
    "JSON: {\"type\":\"output\",\"target\":null,\"lines\":50}",
    "User: 查看会话",
    "JSON: {\"type\":\"output\",\"target\":null,\"lines\":50}",
    "User: codex-app 最近 200 行输出",
    "JSON: {\"type\":\"output\",\"target\":\"codex-app\",\"lines\":200}",
    "User: 查看第二个会话",
    "JSON: {\"type\":\"output\",\"target\":null,\"targetIndex\":2,\"lines\":50}",
    "User: 进入 local",
    "JSON: {\"type\":\"switch\",\"target\":\"local\"}",
    "User: 切换到第二个会话",
    "JSON: {\"type\":\"switch\",\"target\":null,\"targetIndex\":2}",
    "User: 停止 opencode-OPCAid",
    "JSON: {\"type\":\"stop\",\"target\":\"opencode-OPCAid\"}",
    "User: 重启 sessions",
    "JSON: {\"type\":\"restart\",\"target\":\"sessions\"}"
  ].join("\n");
}

export function validateAiCommand(command) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error("AI command must be an object");
  }
  if (!ALLOWED_TYPES.has(command.type)) {
    throw new Error("AI command type is not allowed");
  }

  if (command.type === "help") return { type: "help" };

  if (command.type === "list") {
    return { type: "list", runningOnly: Boolean(command.runningOnly) };
  }

  if (command.type === "create") {
    const input = command.input;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("AI create command requires input");
    }
    if (!ALLOWED_KINDS.has(input.kind)) {
      throw new Error("AI create command kind is not allowed");
    }
    return {
      type: "create",
      input: {
        kind: input.kind,
        cwd: typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined,
        name: optionalName(input.name, { sanitize: true }),
        project: optionalName(input.project, { sanitize: true }) ?? null
      }
    };
  }

  if (command.type === "send") {
    if (typeof command.text !== "string" || !command.text.trim()) {
      throw new Error("AI send command requires text");
    }
    const target = optionalName(command.target);
    const targetIndex = optionalTargetIndex(command.targetIndex);
    return {
      type: "send",
      target: target ?? null,
      ...(targetIndex ? { targetIndex } : {}),
      text: command.text.trim(),
      needsCurrentSession: !target && !targetIndex
    };
  }

  if (command.type === "output") {
    const target = optionalName(command.target);
    const targetIndex = optionalTargetIndex(command.targetIndex);
    return {
      type: "output",
      target: target ?? null,
      ...(targetIndex ? { targetIndex } : {}),
      lines: normalizeLines(command.lines, 50),
      needsCurrentSession: !target && !targetIndex
    };
  }

  const target = optionalName(command.target);
  const targetIndex = optionalTargetIndex(command.targetIndex);
  if (!target && !targetIndex) {
    throw new Error(`AI ${command.type} command requires target`);
  }
  return {
    type: command.type,
    target: target ?? null,
    ...(targetIndex ? { targetIndex } : {})
  };
}

function parseJsonContent(content) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI command parser did not return JSON");
    return JSON.parse(match[0]);
  }
}

function openAiChatUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/chat/completions")) return normalized;
  if (normalized.endsWith("/v1")) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function optionalName(value, options = {}) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (options.sanitize) return sanitizeTmuxName(trimmed.replaceAll("+", "-"));
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) throw new Error("AI command target/name contains invalid characters");
  return trimmed;
}

function requiredName(value, message) {
  return optionalName(value) ?? throwError(message);
}

function optionalTargetIndex(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2000) {
    throw new Error("AI command targetIndex must be a positive integer");
  }
  return parsed;
}

function throwError(message) {
  throw new Error(message);
}

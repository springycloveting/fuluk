const kindMap = {
  codex: "codex",
  claude: "claude",
  "claude code": "claude",
  claud: "claude",
  "claud code": "claude",
  opencode: "opencode",
  "open code": "opencode",
  runtime: "runtime",
  本地: "runtime"
};
const kindPattern = "codex|claude\\s+code|claud\\s+code|claude|claud|opencode|open code|pi-os|pi os|runtime|本地";

const targetPattern = "[A-Za-z0-9_.-]+";

export function parseNaturalCommand(text) {
  const raw = text.trim();
  if (!raw) throw new Error("Empty command");
  const normalized = normalizeCommandText(raw);

  if (/^(help|帮助|指令|命令帮助)[。.\s]*$/i.test(normalized)) {
    return { type: "help" };
  }

  const stop = normalized.match(new RegExp(`^(?:停止|stop)\\s*(${targetPattern})[。.\\s]*$`, "i"));
  if (stop) return { type: "stop", target: stop[1] };

  const restart = normalized.match(new RegExp(`^(?:重启|restart)\\s*(${targetPattern})[。.\\s]*$`, "i"));
  if (restart) return { type: "restart", target: restart[1] };

  if (isListSessionsCommand(normalized)) {
    return buildListCommand(normalized);
  }

  if (isCurrentOutputCommand(normalized)) {
    return { type: "output", target: null, lines: parseCurrentOutputLines(normalized), needsCurrentSession: true };
  }

  const zhCurrentContent = normalized.match(
    /^(?:当前|现在|选中|当前选中)?\s*会话\s*(?:的)?\s*(?:内容|输出)(?:\s*(?:最近|后)?\s*(\d+)?\s*行?)?[。.\s]*$/u
  );
  if (zhCurrentContent) {
    return { type: "output", target: null, lines: parseLines(zhCurrentContent[1], 50), needsCurrentSession: true };
  }

  const zhTargetedOutput = normalized.match(
    /^(?:查看|看|看看|看一下|显示|读取)\s*(.+?)\s*会话(?:\s*(?:最近|后)\s*(\d+)?\s*行?)?(?:\s*输[。.\s]*出)?[。.\s]*$/iu
  );
  if (zhTargetedOutput) {
    return buildOutputCommand(zhTargetedOutput[1], zhTargetedOutput[2]);
  }

  const zhTargetedContent = normalized.match(
    /^(?:查看|看|看看|看一下|显示|读取)\s*(.+?)\s*(?:会话)?\s*(?:的)?\s*(?:内容|输出内容|最近输出|终端内容)(?:\s*(?:最近|后)?\s*(\d+)?\s*行?)?[。.\s]*$/iu
  );
  if (zhTargetedContent) {
    return buildOutputCommand(zhTargetedContent[1], zhTargetedContent[2]);
  }

  const zhSuffixedOutput = normalized.match(
    /^(.+?)\s*会话\s*(?:(?:最近|后)\s*(\d+)?\s*行?)?\s*输[。.\s]*出[。.\s]*$/iu
  );
  if (zhSuffixedOutput) {
    return buildOutputCommand(zhSuffixedOutput[1], zhSuffixedOutput[2]);
  }

  const zhOutput = normalized.match(new RegExp(`^(${targetPattern})\\s*最近\\s*(\\d+)?\\s*行?\\s*输[。.\\s]*出[。.\\s]*$`, "i"));
  if (zhOutput) return { type: "output", target: zhOutput[1], lines: parseLines(zhOutput[2]) };

  const enCurrentOutput = normalized.match(/^(?:output|out|show output)(?:\s+(?:current|selected|session))?(?:\s+(\d+))?[。.\s]*$/i);
  if (enCurrentOutput) {
    return { type: "output", target: null, lines: parseLines(enCurrentOutput[1], 50), needsCurrentSession: true };
  }

  const enOutput = normalized.match(new RegExp(`^(?:output|out|show output)\\s+(${targetPattern})(?:\\s+(\\d+))?[。.\\s]*$`, "i"));
  if (enOutput) return { type: "output", target: enOutput[1], lines: parseLines(enOutput[2]) };

  const switchSessionOrdinal = normalized.match(/^(?:进入|切换到?|use|switch(?: to)?)\s*(.+?)\s*会话[。.\s]*$/iu);
  if (switchSessionOrdinal) return { type: "switch", ...parseSessionTarget(switchSessionOrdinal[1]) };

  const switchSession = normalized.match(new RegExp(`^(?:进入|切换到?|use|switch(?: to)?)\\s*(${targetPattern})[。.\\s]*$`, "i"));
  if (switchSession) return { type: "switch", target: switchSession[1] };

  const sendToPrefixedTarget = raw.match(/^发送到\s*(.+?)\s*会话\s*(.+?)\s*[。.]?$/iu);
  if (sendToPrefixedTarget) {
    return buildSendCommand(sendToPrefixedTarget[1], sendToPrefixedTarget[2]);
  }

  const sendToSuffixedTarget = raw.match(/^发送\s*(.+?)\s*到\s*(.+?)\s*会话\s*[。.]?$/iu);
  if (sendToSuffixedTarget) {
    return buildSendCommand(sendToSuffixedTarget[2], sendToSuffixedTarget[1]);
  }

  const implicitSendToSuffixedTarget = raw.match(/^(.+?)\s*到\s*(.+?)\s*会话\s*[。.]?$/iu);
  if (implicitSendToSuffixedTarget && !isReservedCommandPrefix(implicitSendToSuffixedTarget[1])) {
    return buildSendCommand(implicitSendToSuffixedTarget[2], implicitSendToSuffixedTarget[1]);
  }

  const send = raw.match(new RegExp(`^把(?:这句话|消息|文本)?\\s*发给\\s*(${targetPattern})\\s*[：:]\\s*(.+?)\\s*[。.]?$`, "i"));
  if (send) return { type: "send", target: send[1], text: send[2] };

  const enSend = raw.match(new RegExp(`^send\\s+(.+?)\\s+to\\s+(${targetPattern})[。.]?$`, "i"));
  if (enSend) return { type: "send", target: enSend[2], text: enSend[1] };

  if (/^发送.+到.+会话/u.test(raw)) {
    throw new Error("Ambiguous natural-language command: send target must end the command");
  }

  const currentSend = raw.match(/^(?:发送|send)\s*(.+?)\s*[。.]?$/i);
  if (currentSend) return { type: "send", target: null, text: currentSend[1], needsCurrentSession: true };

  const create = parseCreateMatch(normalized);
  if (create) {
    const kind = normalizeKind(create.kind);
    const cwd = parseCwd(normalized);
    const explicitName = parseName(normalized, kind, cwd);
    const inlineName = normalized.match(/会话\s*([A-Za-z0-9_.-]+)(?:\s*[，,.。]|$)/)?.[1];
    const name = explicitName ?? inlineName;
    const project = normalized.match(/(?:项目|project)\s*([A-Za-z0-9_.-]+)/i)?.[1] ?? null;
    return {
      type: "create",
      input: {
        kind,
        cwd,
        name,
        project
      }
    };
  }

  const looseZhCreate = normalized.match(new RegExp(`(?:新建|创建|建)(?:一个)?\\s*(${kindPattern})\\s*会话`, "iu"));
  if (looseZhCreate) {
    const kind = normalizeKind(looseZhCreate[1]);
    const cwd = parseCwd(normalized);
    return {
      type: "create",
      input: {
        kind,
        cwd,
        name: parseName(normalized, kind, cwd),
        project: normalized.match(/(?:项目|project)\s*([A-Za-z0-9_.-]+)/i)?.[1] ?? null
      }
    };
  }

  const enCreate = normalized.match(/^(?:create|new)\s+(codex|claude\s+code|claud\s+code|claude|claud|opencode|open code|runtime)\s+(?:session\s+)?(?:named\s+)?([A-Za-z0-9_.-]+)?(?:\s+)?(?:in|cwd|dir|directory)\s+([^\s，。]+)(?:.*?project\s+([A-Za-z0-9_.-]+))?[。.]?$/iu);
  if (enCreate) {
    return {
      type: "create",
      input: {
        kind: normalizeKind(enCreate[1]),
        cwd: enCreate[3],
        name: enCreate[2] || undefined,
        project: enCreate[4] ?? null
      }
    };
  }

  const enCreateDefaultCwd = normalized.match(/^(?:create|new)\s+(codex|claude\s+code|claud\s+code|claude|claud|opencode|open code|runtime)\s+(?:session\s+)?(?:named\s+)?([A-Za-z0-9_.-]+)?[。.]?$/iu);
  if (enCreateDefaultCwd) {
    return {
      type: "create",
      input: {
        kind: normalizeKind(enCreateDefaultCwd[1]),
        cwd: undefined,
        name: enCreateDefaultCwd[2] || undefined,
        project: null
      }
    };
  }

  throw new Error("Unsupported natural-language command");
}

const HOMOPHONE_MAP = {
  会话: ["绘画", "绘话", "回话", "汇话", "会画", "会化", "惠话", "慧话"],
  列表: ["列表", "烈表", "列biao"],
  列出: ["列出", "烈出"],
  查询: ["查询", "插询", "差询"],
  查看: ["查看", "茶看", "插看"],
  运行: ["运行", "云行", "允行"],
  创建: ["创建", "床建", "创贱"],
  新建: ["新建", "心建", "新见"],
  停止: ["停止", "庭止", "亭止"],
  重启: ["重启", "虫启", "冲启"],
  发送: ["发送", "法送", "发诵"],
  进入: ["进入", "经入", "近入"],
  切换: ["切换", "且换", "窃换"]
};

const HOMOPHONE_REPLACEMENTS = [];
for (const [correct, variants] of Object.entries(HOMOPHONE_MAP)) {
  for (const variant of variants) {
    HOMOPHONE_REPLACEMENTS.push({ pattern: new RegExp(variant, "gu"), replacement: correct });
  }
}

function normalizeCommandText(value) {
  let normalized = value;
  for (const { pattern, replacement } of HOMOPHONE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/[绘回对]画/gu, "会话").replace(/[绘回对]话/gu, "会话");
}

function normalizeKind(value) {
  return kindMap[value.toLowerCase().replace(/\s+/g, " ")] ?? kindMap[value];
}

function parseCreateMatch(raw) {
  const beforeSession = raw.match(
    new RegExp(`(?:新建|创建|建)(?:一个)?\\s*(${kindPattern})\\s*会话`, "iu")
  );
  if (beforeSession) return { kind: beforeSession[1] };

  const afterSession = raw.match(
    new RegExp(
      `(?:新建|创建|建)(?:一个)?\\s*会话\\s*(${kindPattern})`,
      "iu"
    )
  );
  if (afterSession) return { kind: afterSession[1] };

  return null;
}

function isListSessionsCommand(raw) {
  if (/内容|输出|\d+\s*行/.test(raw)) return false;
  if (/^(?:ls|list)(?:\s+[\w\s-]+)?\s*sessions?[。.\s]*$/i.test(raw)) return true;
  if (/会话\s*列表/.test(raw)) return true;
  if (/(?:查询|列出).{0,24}会话/.test(raw)) return true;
  if (/运行中.{0,20}会话/.test(raw)) return true;
  if (/查看.{0,24}会话.{0,4}列表/.test(raw)) return true;
  if (/会话\s*(?:有|都有|共有)?(?:哪些|几个|多少)/.test(raw)) return true;
  if (/(?:有哪些|有几个|有多少)\s*(?:会话|sessions?)/i.test(raw)) return true;
  if (/(?:所有|全部|各个)(?:的)?\s*会话/.test(raw)) return true;
  if (/(?:活跃|活动|active)(?:[^，。；]{0,8})会话/i.test(raw)) return true;
  if (/会话\s*(?:的)?\s*(?:状态|状况)/.test(raw)) return true;
  return false;
}

function buildListCommand(raw) {
  const command = { type: "list", runningOnly: /运行中|进行中|running/i.test(raw) };
  if (/已关闭|closed/i.test(raw)) {
    const closedOnly = /(?:列出|查询|查看|显示|list|ls)\s*(?:所有)?\s*(?:已关闭|closed)/i.test(raw);
    if (closedOnly && !/包括|包含|含有|including/i.test(raw)) command.closedOnly = true;
    if (!command.closedOnly) command.includeClosed = true;
  }
  if (!command.runningOnly && !command.closedOnly && /已停止|已结束|idle|stopped/i.test(raw)) {
    command.stoppedOnly = true;
  }
  if (!command.runningOnly && !command.stoppedOnly && !command.closedOnly && /(?:所有|全部|all\s+(?:sessions|tmux)|every)/i.test(raw)) {
    command.includeClosed = true;
  }

  const project =
    raw.match(/(?:项目|project)\s*(?:是|为|叫|叫做)?\s*([A-Za-z0-9_.-]+)/i)?.[1] ??
    raw.match(/([A-Za-z0-9_.-]+)\s*(?:项目|project)/i)?.[1] ??
    null;
  if (project) command.project = project;

  const nameQuery =
    raw.match(/(?:名称|名字|name)\s*(?:包含|含有|含|包括|like|contains?)\s*([A-Za-z0-9_.-]+)/i)?.[1] ??
    raw.match(
      /(?:列出|查询|查看|显示|list|ls)\s*(?:运行中|running)?\s*([A-Za-z0-9_.-]+)\s*会话/i
    )?.[1] ??
    null;
  if (nameQuery && nameQuery !== project) command.nameQuery = nameQuery;

  return command;
}

function isCurrentOutputCommand(raw) {
  if (!/会话/.test(raw)) return false;
  if (/列表/.test(raw)) return false;
  return /^(?:查看|看|看看|看一下|显示|读取)\s*(?:当前|最近的|最近)?\s*会话/.test(raw);
}

function parseCurrentOutputLines(raw) {
  const lines = raw.match(/(?:最近|后)\s*(\d+)\s*行/)?.[1];
  return parseLines(lines, 50);
}

function parseLines(value, fallback = 120) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 2000);
}

function buildSendCommand(targetText, text) {
  const target = parseSendTarget(targetText);
  return {
    type: "send",
    ...target,
    text: text.trim(),
    needsCurrentSession: !target.target && !target.targetIndex
  };
}

function buildOutputCommand(targetText, lines) {
  const target = parseSessionTarget(targetText);
  return {
    type: "output",
    ...target,
    lines: parseLines(lines, 50),
    needsCurrentSession: !target.target && !target.targetIndex
  };
}

function isReservedCommandPrefix(value) {
  const trimmed = value.trim();
  return (
    /^(?:进入|切换|查看|显示|读取|列出|查询|停止|重启|新建|建|创建)/u.test(trimmed) ||
    /^(?:help|list|stop|restart|switch|use)\b/iu.test(trimmed)
  );
}

function parseSendTarget(value) {
  return parseSessionTarget(value);
}

function parseSessionTarget(value) {
  const normalized = value.trim();
  if (/^(?:当前|现在|选中|当前选中|已选中)$/u.test(normalized)) return { target: null };
  const ordinal = parseSessionOrdinal(normalized);
  if (ordinal) return { target: null, targetIndex: ordinal };
  if (!new RegExp(`^${targetPattern}$`, "i").test(normalized)) {
    throw new Error("Send command target session name contains invalid characters");
  }
  return { target: normalized };
}

function parseSessionOrdinal(value) {
  const match = value.match(/^第?\s*([0-9]+|[一二两三四五六七八九十]+)\s*个?$/u);
  if (!match) return null;
  const parsed = /^\d+$/.test(match[1]) ? Number.parseInt(match[1], 10) : parseChineseOrdinal(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseChineseOrdinal(value) {
  const digits = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (digits[value]) return digits[value];
  if (value === "十") return 10;
  const teen = value.match(/^十([一二两三四五六七八九])$/u);
  if (teen) return 10 + digits[teen[1]];
  const tens = value.match(/^([一二两三四五六七八九])十([一二两三四五六七八九])?$/u);
  if (tens) return digits[tens[1]] * 10 + (digits[tens[2]] ?? 0);
  return null;
}

function parseCwd(raw) {
  return raw.match(/(?:目录|文件夹|路径|用)\s*([/][^\s，。]+)/)?.[1]?.replace(/(?:文件夹|目录|路径)$/u, "");
}

function parseName(raw, kind, cwd) {
  if (cwd && /名称\s*用\s*[^，。]*文件夹名称/.test(raw)) {
    return `${kind}-${folderName(cwd)}`;
  }
  const direct = raw.match(/(?:名字|名称|name)\s*(?:用|为|叫做|叫)?\s*([A-Za-z0-9_.+\-\s]+?)(?:[，。]|$)/i)?.[1];
  if (direct) return normalizeNameExpression(direct, kind, cwd);
  return undefined;
}

function normalizeNameExpression(value, kind, cwd) {
  const folder = folderName(cwd);
  return value
    .replaceAll("+文件夹名称", folder ? `-${folder}` : "")
    .replaceAll("+folder", folder ? `-${folder}` : "")
    .replaceAll("+", "-")
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function folderName(cwd) {
  return cwd?.split("/").filter(Boolean).at(-1) ?? "";
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10_000;

export class TmuxBackend {
  constructor(config, options = {}) {
    this.config = {
      ...config,
      submitKeyDelayMs: config.submitKeyDelayMs ?? 80,
      submitKeys: {
        codex: "Enter",
        claude: "Enter",
        opencode: "Enter",
        runtime: "Enter",
        ...(config.submitKeys ?? {})
      }
    };
    this.run = options.run ?? run;
    this.sleep = options.sleep ?? sleep;
  }

  async ensureAvailable() {
    try {
      await this.run("tmux", ["-V"], 3_000);
    } catch {
      throw new Error("tmux is required but was not found in PATH");
    }
  }

  resolveCreateCommand(input) {
    if (input.kind === "runtime") {
      return { command: this.config.defaultRuntimeCommand, args: [] };
    }
    const command = input.kind === "claude" ? "claude" : input.kind;
    return withCliEnvironment(input.kind, { command, args: [] });
  }

  async validateCreateInput(input, commandSpec) {
    await assertCommandExists(commandSpec.command);
    await ensureDirectoryExists(input.cwd);
  }

  async create(record) {
    const tokens = [record.command, ...record.commandArgs];
    const resumeArg = resumeTokenFor(record);
    if (resumeArg) tokens.push(...resumeArg);
    const shellCommand = tokens.map(shellQuote).join(" ");
    const args = ["new-session", "-d", "-s", record.tmuxSessionName, "-c", record.cwd];
    await this.run("tmux", args);
    await this.run("tmux", ["send-keys", "-t", exactTmuxPaneTarget(record.tmuxSessionName), "-l", "--", shellCommand]);
    await this.run("tmux", ["send-keys", "-t", exactTmuxPaneTarget(record.tmuxSessionName), "Enter"]);
  }

  async exists(record) {
    try {
      await this.run("tmux", ["has-session", "-t", exactTmuxSessionTarget(record.tmuxSessionName)], 3_000);
      return true;
    } catch (error) {
      // A missing session or no server means the session is genuinely gone.
      // Permission/socket errors mean we cannot tell (wrong user, sandbox);
      // surface them so callers don't persist a wrong "stopped" status.
      if (isTmuxAccessError(error)) throw error;
      return false;
    }
  }

  async send(record, text, options = {}) {
    await this.ensureSessionExists(record);
    await this.run("tmux", ["send-keys", "-t", exactTmuxPaneTarget(record.tmuxSessionName), "-l", "--", text]);
    await this.sleep(options.submitKeyDelayMs ?? this.config.submitKeyDelayMs);
    await this.run("tmux", [
      "send-keys",
      "-t",
      exactTmuxPaneTarget(record.tmuxSessionName),
      this.config.submitKeys[record.kind] || "Enter"
    ]);
  }

  async sendKeys(record, keys) {
    await this.ensureSessionExists(record);
    const target = exactTmuxPaneTarget(record.tmuxSessionName);
    const plainKeys = [];
    const wheelActions = [];
    for (const key of keys) {
      const tmuxWheel = tmuxWheelAction(key);
      if (tmuxWheel !== null) wheelActions.push(tmuxWheel);
      else plainKeys.push(key);
    }
    if (plainKeys.length) {
      await this.run("tmux", ["send-keys", "-t", target, ...plainKeys]);
    }
    if (wheelActions.length) {
      const altInfo = await this
        .run(
          "tmux",
          [
            "display-message",
            "-p",
            "-t",
            target,
            "#{alternate_on}\n#{pane_mode}"
          ],
          3_000
        )
        .catch(() => ({ stdout: "" }));
      const [altLine = "", modeLine = ""] = altInfo.stdout.split("\n");
      if (modeLine.includes("copy")) {
        await this.dispatchTmuxWheelKeys(target, wheelActions, { alreadyInCopyMode: true });
      } else if (altLine.trim() === "1") {
        const { stdout } = await this.run("tmux", [
        "display-message",
        "-p",
        "-t",
        target,
        "#{pane_width},#{pane_height}"
      ]);
        const { col, row } = parsePaneGeometry(stdout);
        const payload = wheelActions
          .map((action) => `\x1b[<${action === "up" ? 64 : 65};${col};${row}M`)
          .join("");
        await this.run("tmux", ["send-keys", "-t", target, "-l", "--", payload]);
      } else {
        await this.dispatchTmuxWheelKeys(target, wheelActions);
      }
    }
  }

  async dispatchTmuxWheelKeys(target, wheelKeys, options = {}) {
    if (!wheelKeys.length) return;
    let copyModeActive = options.alreadyInCopyMode === true;
    if (!copyModeActive) {
      const modeInfo = await this.run(
        "tmux",
        ["display-message", "-p", "-t", target, "#{pane_mode}"],
        3_000
      ).catch(() => ({ stdout: "" }));
      copyModeActive = /copy/.test(modeInfo.stdout.trim());
    }
    let pendingDir = null;
    let pendingCount = 0;
    const flush = async () => {
      if (!pendingDir || pendingCount === 0) return;
      if (pendingDir === "up") {
        if (!copyModeActive) {
          await this.run("tmux", ["copy-mode", "-t", target]);
          copyModeActive = true;
        }
        await this.run(
          "tmux",
          ["send-keys", "-t", target, "-N", String(pendingCount), "-X", "scroll-up"]
        );
      } else if (copyModeActive) {
        await this.run(
          "tmux",
          ["send-keys", "-t", target, "-N", String(pendingCount), "-X", "scroll-down"]
        );
        const posInfo = await this
          .run("tmux", ["display-message", "-p", "-t", target, "#{scroll_position}"], 3_000)
          .catch(() => ({ stdout: "" }));
        if (posInfo.stdout.trim() === "0") {
          await this.run("tmux", ["send-keys", "-t", target, "-X", "cancel"]);
          copyModeActive = false;
        }
      }
      pendingDir = null;
      pendingCount = 0;
    };
    for (const action of wheelKeys) {
      if (action === pendingDir) {
        pendingCount += 1;
      } else {
        await flush();
        pendingDir = action;
        pendingCount = 1;
      }
    }
    await flush();
  }

  async resize(record, cols, rows) {
    await this.ensureSessionExists(record);
    await this.run("tmux", [
      "resize-window",
      "-t",
      exactTmuxSessionTarget(record.tmuxSessionName),
      "-x",
      String(cols),
      "-y",
      String(rows)
    ]);
  }

  async capture(record, lines, options = {}) {
    await this.ensureSessionExists(record);
    const flags = options.preserveEscapes ? "-ept" : "-pt";
    const alternateFlags = options.preserveEscapes ? "-eapt" : "-apt";
    const offset = normalizeCaptureOffset(options.offset);
    const rangeArgs = offset > 0 ? ["-S", `-${lines + offset}`, "-E", `-${offset}`] : ["-S", `-${lines}`];
    const target = exactTmuxPaneTarget(record.tmuxSessionName);
    if (options.followCopyMode && await this.paneInCopyMode(target)) {
      const { stdout } = await this.run("tmux", ["capture-pane", flags, target]);
      return stdout;
    }
    let result;
    try {
      result = await this.run("tmux", [
        "capture-pane",
        flags,
        target,
        ...rangeArgs
      ]);
    } catch (error) {
      if (!options.alternateScreen) throw error;
      result = { stdout: "" };
    }
    if (options.alternateScreen && !result.stdout.trim()) {
      result = await this.run("tmux", [
        "capture-pane",
        alternateFlags,
        target,
        ...rangeArgs
      ]);
    }
    const { stdout } = result;
    return stdout;
  }

  async paneInCopyMode(target) {
    try {
      const { stdout } = await this.run(
        "tmux",
        ["display-message", "-p", "-t", target, "#{pane_mode}"],
        3_000
      );
      return /copy/.test(stdout.trim());
    } catch {
      return false;
    }
  }

  async stop(record) {
    if (await this.exists(record)) {
      await this.run("tmux", ["kill-session", "-t", exactTmuxSessionTarget(record.tmuxSessionName)]);
    }
  }

  async restart(record) {
    await this.stop(record);
    await this.create(record);
  }

  async ensureSessionExists(record) {
    if (!(await this.exists(record))) {
      throw new Error(`tmux session is not running: ${record.tmuxSessionName}`);
    }
  }
}

async function assertCommandExists(command) {
  try {
    await run("bash", ["-lc", `command -v ${shellQuote(command)}`], 3_000);
  } catch {
    throw new Error(`CLI command not found in PATH: ${command}`);
  }
}

async function ensureDirectoryExists(cwd) {
  try {
    await run("mkdir", ["-p", cwd], 3_000);
  } catch {
    throw new Error(`cwd could not be created or is not a directory: ${cwd}`);
  }
}

function withCliEnvironment(kind, commandSpec) {
  if (kind !== "opencode") return commandSpec;
  return {
    ...commandSpec,
    command: "env",
    args: ["TERM=screen-256color", commandSpec.command, ...commandSpec.args]
  };
}

const RESUME_TOKEN_BUILDERS = {
  codex: (id) => ["resume", id],
  claude: (id) => ["--resume", id],
  opencode: (id) => ["-s", id]
};

export function resumeTokenFor(record) {
  const builder = RESUME_TOKEN_BUILDERS[record?.kind];
  const id = record?.cliSessionId;
  if (!builder || typeof id !== "string" || !id.trim()) return null;
  return builder(id.trim());
}

export function exactTmuxSessionTarget(name) {
  return `=${name}`;
}

export function exactTmuxPaneTarget(name) {
  return `=${name}:`;
}

function normalizeCaptureOffset(value) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 5000);
}

export function tmuxWheelAction(key) {
  if (key === "WheelUpPane") return "up";
  if (key === "WheelDownPane") return "down";
  return null;
}

function parsePaneGeometry(stdout) {
  const match = /^(\d+),(\d+)/.exec(stdout.trim());
  if (!match) throw new Error(`could not parse tmux pane geometry: ${stdout}`);
  const width = Number.parseInt(match[1], 10);
  const height = Number.parseInt(match[2], 10);
  return {
    col: Math.floor(width / 2) + 1,
    row: Math.floor(height / 2) + 1
  };
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function run(command, args, timeout = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();
  const timeoutSeconds = Math.max(1, Math.ceil(timeout / 1000));
  const wrappedCommand = "timeout";
  const wrappedArgs = [`${timeoutSeconds}s`, command, ...args];
  debugCommand("start", wrappedCommand, wrappedArgs);

  try {
    const result = await execFileAsync(wrappedCommand, wrappedArgs, { timeout: timeout + 1_000 });
    debugCommand("ok", wrappedCommand, wrappedArgs, Date.now() - startedAt);
    return result;
  } catch (error) {
    debugCommand("fail", wrappedCommand, wrappedArgs, Date.now() - startedAt);
    const details = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`Command failed: ${wrappedCommand} ${wrappedArgs.join(" ")}${details ? `\n${details}` : ""}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTmuxAccessError(error) {
  const details = String(error?.message ?? "");
  return /permission denied|operation not permitted/i.test(details);
}

function debugCommand(status, command, args, durationMs) {
  if (process.env.SESSION_GATEWAY_DEBUG !== "1") return;
  const suffix = typeof durationMs === "number" ? ` ${durationMs}ms` : "";
  console.error(`[tmux:${status}] ${command} ${args.join(" ")}${suffix}`);
}

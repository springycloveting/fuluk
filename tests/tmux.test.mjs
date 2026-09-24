import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { exactTmuxPaneTarget, exactTmuxSessionTarget, resumeTokenFor, TmuxBackend } from "../src/tmux.mjs";

test("TmuxBackend maps AI CLIs to host commands", () => {
  const tmux = new TmuxBackend({ defaultRuntimeCommand: "/bin/bash" });

  assert.deepEqual(tmux.resolveCreateCommand({ kind: "codex", cwd: "/workspace/app" }), {
    command: "codex",
    args: []
  });
  assert.deepEqual(tmux.resolveCreateCommand({ kind: "claude", cwd: "/workspace/app" }), {
    command: "claude",
    args: []
  });
  assert.deepEqual(tmux.resolveCreateCommand({ kind: "opencode", cwd: "/workspace/test" }), {
    command: "env",
    args: ["TERM=screen-256color", "opencode"]
  });
  assert.deepEqual(tmux.resolveCreateCommand({ kind: "pi-os", cwd: "/workspace/app" }), {
    command: "pi-os",
    args: []
  });
  assert.deepEqual(tmux.resolveCreateCommand({ kind: "runtime", cwd: "/tmp" }), {
    command: "/bin/bash",
    args: []
  });
});

test("TmuxBackend creates missing host cwd before creating a session", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-gateway-"));
  const cwd = join(root, "missing", "nested");
  const tmux = new TmuxBackend({ defaultRuntimeCommand: "/bin/bash" });

  try {
    const commandSpec = tmux.resolveCreateCommand({ kind: "runtime", cwd });
    await tmux.validateCreateInput({ kind: "runtime", cwd }, commandSpec);

    assert.equal((await stat(cwd)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tmux targets use exact session matching", () => {
  assert.equal(exactTmuxSessionTarget("localshell"), "=localshell");
  assert.equal(exactTmuxPaneTarget("localshell"), "=localshell:");
});

test("TmuxBackend send submits text with the configured submit key", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      submitKeyDelayMs: 0,
      submitKeys: { codex: "C-j" },
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return { stdout: "" };
      },
      sleep: async () => {}
    }
  );

  await tmux.send(
    {
      id: "session-1",
      kind: "codex",
      tmuxSessionName: "glass-to-ai"
    },
    "修改配置"
  );

  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["has-session", "-t", "=glass-to-ai"],
      timeoutMs: 3000
    },
    {
      command: "tmux",
      args: ["send-keys", "-t", "=glass-to-ai:", "-l", "--", "修改配置"],
      timeoutMs: undefined
    },
    {
      command: "tmux",
      args: ["send-keys", "-t", "=glass-to-ai:", "C-j"],
      timeoutMs: undefined
    }
  ]);
});

test("TmuxBackend send can override the submit key delay per call", async () => {
  const sleeps = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      submitKeyDelayMs: 80,
      submitKeys: { codex: "Enter" },
      cliCommands: {}
    },
    {
      run: async () => ({ stdout: "" }),
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    }
  );

  await tmux.send(
    {
      id: "session-1",
      kind: "codex",
      tmuxSessionName: "glass-to-ai"
    },
    "long prompt",
    { submitKeyDelayMs: 700 }
  );

  assert.deepEqual(sleeps, [700]);
});

test("TmuxBackend resize updates the tmux window size", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return { stdout: "" };
      }
    }
  );

  await tmux.resize(
    {
      id: "session-1",
      kind: "opencode",
      tmuxSessionName: "opencode-work"
    },
    132,
    40
  );

  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["has-session", "-t", "=opencode-work"],
      timeoutMs: 3000
    },
    {
      command: "tmux",
      args: ["resize-window", "-t", "=opencode-work", "-x", "132", "-y", "40"],
      timeoutMs: undefined
    }
  ]);
});

test("TmuxBackend capture only falls back to alternate screen when current pane is empty", async () => {
  const calls = [];
  const outputs = ["   ", "\u001b[31malternate\u001b[0m"];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return { stdout: args[0] === "capture-pane" ? outputs.shift() ?? "" : "" };
      }
    }
  );

  const output = await tmux.capture(
    {
      id: "session-1",
      kind: "opencode",
      tmuxSessionName: "opencode-work"
    },
    300,
    { preserveEscapes: true, alternateScreen: true }
  );

  assert.equal(output, "\u001b[31malternate\u001b[0m");
  assert.deepEqual(calls.filter((call) => call.args[0] === "capture-pane").map((call) => call.args[1]), ["-ept", "-eapt"]);
});

test("TmuxBackend capture can read a scrolled history window", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return { stdout: "history window" };
      }
    }
  );

  const output = await tmux.capture(
    {
      id: "session-1",
      kind: "opencode",
      tmuxSessionName: "opencode-work"
    },
    80,
    { offset: 40 }
  );

  assert.equal(output, "history window");
  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["has-session", "-t", "=opencode-work"],
      timeoutMs: 3000
    },
    {
      command: "tmux",
      args: ["capture-pane", "-pt", "=opencode-work:", "-S", "-120", "-E", "-40"],
      timeoutMs: undefined
    }
  ]);
});

test("TmuxBackend capture can preserve terminal escapes and alternate screen", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        return { stdout: "\u001b[32mmenu\u001b[0m" };
      }
    }
  );

  const output = await tmux.capture(
    {
      id: "session-1",
      kind: "opencode",
      tmuxSessionName: "opencode-work"
    },
    300,
    { preserveEscapes: true, alternateScreen: true }
  );

  assert.equal(output, "\u001b[32mmenu\u001b[0m");
  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["has-session", "-t", "=opencode-work"],
      timeoutMs: 3000
    },
    {
      command: "tmux",
      args: ["capture-pane", "-ept", "=opencode-work:", "-S", "-300"],
      timeoutMs: undefined
    }
  ]);
});

test("TmuxBackend sendKeys translates wheel keys into SGR mouse sequences at pane center", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        if (args[0] === "display-message") return { stdout: "120,40" };
        return { stdout: "" };
      }
    }
  );

  await tmux.sendKeys(
    {
      id: "session-1",
      kind: "opencode",
      tmuxSessionName: "opencode-work"
    },
    ["WheelUpPane"]
  );

  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["has-session", "-t", "=opencode-work"],
      timeoutMs: 3000
    },
    {
      command: "tmux",
      args: ["display-message", "-p", "-t", "=opencode-work:", "#{pane_width},#{pane_height}"],
      timeoutMs: undefined
    },
    {
      command: "tmux",
      args: ["send-keys", "-t", "=opencode-work:", "-l", "--", "\u001b[<64;61;21M"],
      timeoutMs: undefined
    }
  ]);
});

test("TmuxBackend sendKeys splits plain keys and wheel keys into separate tmux calls", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    {
      defaultRuntimeCommand: "/bin/bash",
      cliCommands: {}
    },
    {
      run: async (command, args, timeoutMs) => {
        calls.push({ command, args, timeoutMs });
        if (args[0] === "display-message") return { stdout: "100,30" };
        return { stdout: "" };
      }
    }
  );

  await tmux.sendKeys(
    {
      id: "session-1",
      kind: "opencode",
      tmuxSessionName: "opencode-work"
    },
    ["WheelDownPane", "Enter"]
  );

  assert.deepEqual(calls, [
    {
      command: "tmux",
      args: ["has-session", "-t", "=opencode-work"],
      timeoutMs: 3000
    },
    {
      command: "tmux",
      args: ["send-keys", "-t", "=opencode-work:", "Enter"],
      timeoutMs: undefined
    },
    {
      command: "tmux",
      args: ["display-message", "-p", "-t", "=opencode-work:", "#{pane_width},#{pane_height}"],
      timeoutMs: undefined
    },
    {
      command: "tmux",
      args: ["send-keys", "-t", "=opencode-work:", "-l", "--", "\u001b[<65;51;16M"],
      timeoutMs: undefined
    }
  ]);
});


test("resumeTokenFor returns resume tokens for resumable kinds with an id", () => {
  assert.deepEqual(resumeTokenFor({ kind: "codex", cliSessionId: "7a3f1c9e-4b2a-4f1c-9d8e-1a2b3c4d5e6f" }), ["resume", "7a3f1c9e-4b2a-4f1c-9d8e-1a2b3c4d5e6f"]);
  assert.deepEqual(resumeTokenFor({ kind: "claude", cliSessionId: "8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a" }), ["--resume", "8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a"]);
  assert.deepEqual(resumeTokenFor({ kind: "opencode", cliSessionId: "ses_f98dfabb4ffeL107W2NGuKCelf" }), ["-s", "ses_f98dfabb4ffeL107W2NGuKCelf"]);
});

test("resumeTokenFor returns null when there is no id or kind is not resumable", () => {
  assert.equal(resumeTokenFor({ kind: "claude", cliSessionId: null }), null);
  assert.equal(resumeTokenFor({ kind: "claude" }), null);
  assert.equal(resumeTokenFor({ kind: "runtime", cliSessionId: "anything" }), null);
  assert.equal(resumeTokenFor({ kind: "pi-os", cliSessionId: "anything" }), null);
  assert.equal(resumeTokenFor({}), null);
});

test("TmuxBackend create appends resume tokens for claude host mode", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    { defaultRuntimeCommand: "/bin/bash", cliCommands: {} },
    {
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: "" };
      }
    }
  );

  await tmux.create({
    command: "claude",
    commandArgs: [],
    cwd: "/tmp/app",
    tmuxSessionName: "sg-claude",
    kind: "claude",
    cliSessionId: "8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a"
  });

  // calls[1] is the send-keys -l call carrying the assembled shell command.
  const shellPayload = calls[1].args[5];
  assert.equal(shellPayload, "'claude' '--resume' '8b2c4d6e-1a3b-4c5d-9e8f-2b3c4d5e6f7a'");
});

test("TmuxBackend create appends resume tokens for codex host mode", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    { defaultRuntimeCommand: "/bin/bash" },
    {
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: "" };
      }
    }
  );

  await tmux.create({
    command: "codex",
    commandArgs: [],
    cwd: "/work/app",
    tmuxSessionName: "sg-codex",
    kind: "codex",
    cliSessionId: "7a3f1c9e-4b2a-4f1c-9d8e-1a2b3c4d5e6f"
  });

  const shellPayload = calls[1].args[5];
  assert.equal(shellPayload, "'codex' 'resume' '7a3f1c9e-4b2a-4f1c-9d8e-1a2b3c4d5e6f'");
});

test("TmuxBackend create appends resume tokens for opencode host (env-wrapped) mode", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    { defaultRuntimeCommand: "/bin/bash", cliCommands: {} },
    {
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: "" };
      }
    }
  );

  await tmux.create({
    command: "env",
    commandArgs: ["TERM=screen-256color", "opencode"],
    cwd: "/tmp/app",
    tmuxSessionName: "sg-opencode",
    kind: "opencode",
    cliSessionId: "ses_f98dfabb4ffeL107W2NGuKCelf"
  });

  const shellPayload = calls[1].args[5];
  assert.equal(
    shellPayload,
    "'env' 'TERM=screen-256color' 'opencode' '-s' 'ses_f98dfabb4ffeL107W2NGuKCelf'"
  );
});

test("TmuxBackend create does not append tokens without a cli session id", async () => {
  const calls = [];
  const tmux = new TmuxBackend(
    { defaultRuntimeCommand: "/bin/bash", cliCommands: {} },
    {
      run: async (command, args) => {
        calls.push({ command, args });
        return { stdout: "" };
      }
    }
  );

  await tmux.create({
    command: "claude",
    commandArgs: [],
    cwd: "/tmp/app",
    tmuxSessionName: "sg-claude",
    kind: "claude",
    cliSessionId: null
  });

  assert.equal(calls[1].args[5], "'claude'");
});

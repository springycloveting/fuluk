import assert from "node:assert/strict";
import test from "node:test";
import { parseNaturalCommand } from "../src/nl.mjs";

test("parses create commands", () => {
  assert.deepEqual(parseNaturalCommand("新建一个 codex 会话 codex-app，目录 /workspace/app。"), {
    type: "create",
    input: {
      kind: "codex",
      cwd: "/workspace/app",
      name: "codex-app",
      project: null
    }
  });
});

test("parses compact create commands without spaces", () => {
  assert.deepEqual(parseNaturalCommand("新建一个opencode会话test,目录/workspace/test"), {
    type: "create",
    input: {
      kind: "opencode",
      cwd: "/workspace/test",
      name: "test",
      project: null
    }
  });
});

test("parses loose Chinese create commands with folder-derived names", () => {
  assert.deepEqual(parseNaturalCommand("建一个opencode会话，用/workspace/OPCAid文件夹，会话名称用opencode+文件夹名称"), {
    type: "create",
    input: {
      kind: "opencode",
      cwd: "/workspace/OPCAid",
      name: "opencode-OPCAid",
      project: null
    }
  });
});

test("parses create commands without cwd for server defaults", () => {
  assert.deepEqual(parseNaturalCommand("新建一个 codex 会话 web-ai-agent"), {
    type: "create",
    input: {
      kind: "codex",
      cwd: undefined,
      name: "web-ai-agent",
      project: null
    }
  });
  assert.deepEqual(parseNaturalCommand("新建claude code绘画，名字叫做claude.AI。"), {
    type: "create",
    input: {
      kind: "claude",
      cwd: undefined,
      name: "claude.AI",
      project: null
    }
  });
  assert.deepEqual(parseNaturalCommand("create runtime session named local-shell"), {
    type: "create",
    input: {
      kind: "runtime",
      cwd: undefined,
      name: "local-shell",
      project: null
    }
  });
});

test("parses send commands", () => {
  assert.deepEqual(parseNaturalCommand("把这句话发给 claude-main：查看。"), {
    type: "send",
    target: "claude-main",
    text: "查看"
  });
  assert.deepEqual(parseNaturalCommand("发送到web-ai-agent会话修改配置"), {
    type: "send",
    target: "web-ai-agent",
    text: "修改配置",
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("发送修改配置到web-ai-agent会话"), {
    type: "send",
    target: "web-ai-agent",
    text: "修改配置",
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("你好到第四个会话"), {
    type: "send",
    target: null,
    targetIndex: 4,
    text: "你好",
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("你好到web-ai-agent会话"), {
    type: "send",
    target: "web-ai-agent",
    text: "你好",
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("发送到第五个会话修改配置"), {
    type: "send",
    target: null,
    targetIndex: 5,
    text: "修改配置",
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("发送到第12个会话npm test"), {
    type: "send",
    target: null,
    targetIndex: 12,
    text: "npm test",
    needsCurrentSession: false
  });
  assert.throws(
    () => parseNaturalCommand("发送处理失败，Session gateway http 400到第一个会话，给你发了一堆日志"),
    /Ambiguous natural-language command/
  );
});

test("parses current-session send commands", () => {
  assert.deepEqual(parseNaturalCommand("发送 查看当前项目结构"), {
    type: "send",
    target: null,
    text: "查看当前项目结构",
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("发送修改一下返回的列数"), {
    type: "send",
    target: null,
    text: "修改一下返回的列数",
    needsCurrentSession: true
  });
});

test("parses output commands with accidental punctuation", () => {
  assert.deepEqual(parseNaturalCommand("codex-1 最近输。出"), {
    type: "output",
    target: "codex-1",
    lines: 120
  });
});

test("parses output commands with line counts", () => {
  assert.deepEqual(parseNaturalCommand("codex-1 最近 200 行输出"), {
    type: "output",
    target: "codex-1",
    lines: 200
  });
});

test("parses ordinal output commands", () => {
  assert.deepEqual(parseNaturalCommand("查看第二个会话"), {
    type: "output",
    target: null,
    targetIndex: 2,
    lines: 50,
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("查看第三个会话后 100 行"), {
    type: "output",
    target: null,
    targetIndex: 3,
    lines: 100,
    needsCurrentSession: false
  });
  assert.deepEqual(parseNaturalCommand("第二个会话最近输出"), {
    type: "output",
    target: null,
    targetIndex: 2,
    lines: 50,
    needsCurrentSession: false
  });
});

test("parses current-session output commands", () => {
  assert.deepEqual(parseNaturalCommand("查看会话"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("查看当前会话"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("显示会话"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("看一下会话"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("查看会话后 100 行"), {
    type: "output",
    target: null,
    lines: 100,
    needsCurrentSession: true
  });
});

test("parses ASR-tolerant current-session output commands", () => {
  assert.deepEqual(parseNaturalCommand("查看绘画"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("查看回话"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
  assert.deepEqual(parseNaturalCommand("查看对话"), {
    type: "output",
    target: null,
    lines: 50,
    needsCurrentSession: true
  });
});

test("parses session-list commands before send fallback", () => {
  assert.deepEqual(parseNaturalCommand("查询会话列表"), {
    type: "list",
    runningOnly: false
  });
  assert.deepEqual(parseNaturalCommand("列出会话"), {
    type: "list",
    runningOnly: false
  });
  assert.deepEqual(parseNaturalCommand("列出运行中的会话"), {
    type: "list",
    runningOnly: true
  });
});

test("parses running list commands", () => {
  assert.deepEqual(parseNaturalCommand("列出所有运行中的会话。"), {
    type: "list",
    runningOnly: true
  });
});

test("only explicit all-session requests include closed sessions", () => {
  assert.deepEqual(parseNaturalCommand("查看当前会话有哪些"), {
    type: "list",
    runningOnly: false
  });
  assert.deepEqual(parseNaturalCommand("列出所有会话"), {
    type: "list",
    runningOnly: false,
    includeClosed: true
  });
  assert.deepEqual(parseNaturalCommand("查看全部会话"), {
    type: "list",
    runningOnly: false,
    includeClosed: true
  });
  assert.deepEqual(parseNaturalCommand("列出所有运行中的会话。"), {
    type: "list",
    runningOnly: true
  });
});

test("parses list commands with project and name filters", () => {
  assert.deepEqual(parseNaturalCommand("列出项目 igaDC 的会话"), {
    type: "list",
    runningOnly: false,
    project: "igaDC"
  });
  assert.deepEqual(parseNaturalCommand("列出 fuluk-gateway 项目的会话"), {
    type: "list",
    runningOnly: false,
    project: "fuluk-gateway"
  });
  assert.deepEqual(parseNaturalCommand("列出 resume 会话"), {
    type: "list",
    runningOnly: false,
    nameQuery: "resume"
  });
  assert.deepEqual(parseNaturalCommand("列出运行中名称包含 test 的会话"), {
    type: "list",
    runningOnly: true,
    nameQuery: "test"
  });
});

test("parses list commands with session phase filters", () => {
  assert.deepEqual(parseNaturalCommand("列出进行中的会话"), {
    type: "list",
    runningOnly: true
  });
  assert.deepEqual(parseNaturalCommand("列出已停止的会话"), {
    type: "list",
    runningOnly: false,
    stoppedOnly: true
  });
  assert.deepEqual(parseNaturalCommand("列出已关闭的会话"), {
    type: "list",
    runningOnly: false,
    closedOnly: true
  });
  assert.deepEqual(parseNaturalCommand("列出所有会话包括已关闭"), {
    type: "list",
    runningOnly: false,
    includeClosed: true
  });
  assert.deepEqual(parseNaturalCommand("list closed sessions"), {
    type: "list",
    runningOnly: false,
    closedOnly: true
  });
});

test("parses stop commands", () => {
  assert.deepEqual(parseNaturalCommand("停止 opencode-test。"), {
    type: "stop",
    target: "opencode-test"
  });
});

test("parses ordinal switch commands", () => {
  assert.deepEqual(parseNaturalCommand("切换到第二个会话"), {
    type: "switch",
    target: null,
    targetIndex: 2
  });
  assert.deepEqual(parseNaturalCommand("进入第4个会话"), {
    type: "switch",
    target: null,
    targetIndex: 4
  });
});

test("parses English command aliases", () => {
  assert.deepEqual(parseNaturalCommand("help"), { type: "help" });
  assert.deepEqual(parseNaturalCommand("list running sessions"), { type: "list", runningOnly: true });
  assert.deepEqual(parseNaturalCommand("create codex session app in /workspace/app"), {
    type: "create",
    input: {
      kind: "codex",
      cwd: "/workspace/app",
      name: "app",
      project: null
    }
  });
  assert.deepEqual(parseNaturalCommand("send npm test to codex-app"), {
    type: "send",
    target: "codex-app",
    text: "npm test"
  });
  assert.deepEqual(parseNaturalCommand("output codex-app 200"), {
    type: "output",
    target: "codex-app",
    lines: 200
  });
  assert.deepEqual(parseNaturalCommand("use codex-app"), {
    type: "switch",
    target: "codex-app"
  });
  assert.deepEqual(parseNaturalCommand("restart codex-app"), {
    type: "restart",
    target: "codex-app"
  });
});

test("handles homophone variants for 会话", () => {
  assert.deepEqual(parseNaturalCommand("绘画列表"), { type: "list", runningOnly: false });
  assert.deepEqual(parseNaturalCommand("绘话列表"), { type: "list", runningOnly: false });
  assert.deepEqual(parseNaturalCommand("新建一个codex绘画，目录/workspace/app"), {
    type: "create",
    input: {
      kind: "codex",
      cwd: "/workspace/app",
      name: undefined,
      project: null
    }
  });
  assert.deepEqual(parseNaturalCommand("列出所有绘话"), { type: "list", runningOnly: false, includeClosed: true });
});

test("handles homophone variants for other commands", () => {
  assert.deepEqual(parseNaturalCommand("云行中的绘画"), { type: "list", runningOnly: true });
  assert.deepEqual(parseNaturalCommand("庭止codex-app"), {
    type: "stop",
    target: "codex-app"
  });
  assert.deepEqual(parseNaturalCommand("虫启codex-app"), {
    type: "restart",
    target: "codex-app"
  });
});

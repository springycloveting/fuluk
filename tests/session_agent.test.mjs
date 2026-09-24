import assert from "node:assert/strict";
import test from "node:test";
import { createSessionAgentManager } from "../src/session_agent.mjs";

test("session agent exposes only Session Gateway tools and returns session lists", async () => {
  const listed = [];
  const fake = createFakeAgent(async (agent) => {
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "当前有 1 个会话。" }]
    });
  });
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async list_sessions(params) {
        listed.push(params);
        return { sessions: [{ id: "s1", name: "main", taskState: "in_progress" }] };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("看看所有会话状态", {});

  assert.deepEqual(
    fake.state.tools.map((tool) => tool.name).sort(),
    [
      "create_session",
      "get_session_output",
      "list_sessions",
      "restart_session",
      "send_keys_to_session",
      "send_to_session",
      "stop_session",
      "summarize_session_states",
      "switch_session"
    ].sort()
  );
  assert.equal(fake.state.tools.some((tool) => /shell|file|search|delete/i.test(tool.name)), false);
  assert.equal(result.command.type, "assistant");
  assert.equal(result.command.source, "web-pi");
  assert.equal(result.answer, "当前有 1 个会话。");
  assert.deepEqual(result.sessions, [{ id: "s1", name: "main", taskState: "in_progress" }]);
  assert.deepEqual(listed, [{ includeClosed: true }]);
  assert.deepEqual(result.actions.map((action) => action.tool), ["list_sessions"]);
});

test("session agent switch action returns target session and output", async () => {
  const session = { id: "s2", name: "second", taskState: "completed" };
  let promptCount = 0;
  const fake = createFakeAgent(async (agent, emit) => {
    promptCount += 1;
    if (promptCount === 2) {
      agent.state.messages.push({
        role: "assistant",
        content: [{ type: "text", text: "已切到 second，并读取了最近输出。" }]
      });
      return;
    }
    const tool = agent.state.tools.find((entry) => entry.name === "switch_session");
    const result = await tool.execute("tool-1", { targetIndex: 2 });
    emit({ type: "tool_execution_end", toolName: tool.name, result, isError: false });
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "已切到 second。" }]
    });
  });
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async switch_session() {
        return { session, output: "recent output" };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("切到第二个会话", {});

  assert.equal(result.answer, "已切到 second，并读取了最近输出。");
  assert.deepEqual(result.session, session);
  assert.equal(result.output, "recent output");
  assert.deepEqual(result.presentation, { updateTerminal: true });
  assert.equal(promptCount, 2);
});

test("session agent summary requests do not expose raw output to the UI", async () => {
  const session = { id: "s1", name: "main", taskState: "completed" };
  const prompts = [];
  const outputCalls = [];
  const fake = createFakeAgent(async (agent, emit) => {
    prompts.push(agent.state.messages.at(-1).content);
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "当前会话完成了测试并等待下一步。" }]
    });
  });
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async get_session_output(params) {
        outputCalls.push(params);
        return { session, output: "very long raw terminal output" };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("查看当前会话，并进行总结", { currentSessionId: "main" });

  assert.equal(result.answer, "当前会话完成了测试并等待下一步。");
  assert.deepEqual(result.session, session);
  assert.equal("output" in result, false);
  assert.deepEqual(result.presentation, { updateTerminal: false });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Backend tool output for web-pi synthesis/);
  assert.match(prompts[0], /very long raw terminal output/);
  assert.deepEqual(outputCalls, [{ lines: 50, currentSessionId: "main" }]);
  assert.deepEqual(result.actions.map((action) => action.tool), ["get_session_output"]);
});

test("session agent deterministically lists sessions for list-style questions", async () => {
  const listed = [];
  const fake = createFakeAgent(async (agent) => {
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "进行中 1：main；已停止 1：old" }]
    });
  });
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async list_sessions(params) {
        listed.push(params);
        return {
          sessions: [
            { id: "s1", name: "main", taskState: "in_progress" },
            { id: "s2", name: "old", taskState: "completed" }
          ],
          summary: "进行中 1：main；已停止 1：old"
        };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("查看当前会话有哪些", {});

  assert.deepEqual(listed, [{}]);
  assert.equal(result.summary, "进行中 1：main；已停止 1：old");
  assert.deepEqual(result.actions.map((action) => action.tool), ["list_sessions"]);
  assert.equal(result.answer, "进行中 1：main；已停止 1：old");
});

test("session agent views current session content via deterministic output action", async () => {
  const outputCalls = [];
  const fake = createFakeAgent(async (agent) => {
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "WEB-PI 最近在跑测试。" }]
    });
  });
  const session = { id: "s1", name: "WEB-PI", taskState: "in_progress" };
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async get_session_output(params) {
        outputCalls.push(params);
        return { session, output: "recent terminal output" };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("查看当前会话", { currentSessionId: "s1" });

  assert.deepEqual(outputCalls, [{ lines: 50, currentSessionId: "s1" }]);
  assert.deepEqual(result.actions.map((action) => action.tool), ["get_session_output"]);
  assert.equal(result.session.name, "WEB-PI");
  assert.equal(result.output, "recent terminal output");
  assert.equal(result.answer, "WEB-PI 最近在跑测试。");
});

test("session agent views named session content without the word 会话", async () => {
  const outputCalls = [];
  const fake = createFakeAgent(async (agent) => {
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "WEB-PI 会话内容如下。" }]
    });
  });
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async get_session_output(params) {
        outputCalls.push(params);
        return { session: { id: "s9", name: "WEB-PI" }, output: "output" };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("查看WEB-PI的内容", {});

  assert.equal(outputCalls[0].target, "WEB-PI");
  assert.equal(outputCalls[0].lines, 50);
  assert.deepEqual(result.actions.map((action) => action.tool), ["get_session_output"]);
});

test("session agent confirmation can send Enter through the key tool", async () => {
  const sent = [];
  const fake = createFakeAgent(async (agent, emit) => {
    const tool = agent.state.tools.find((entry) => entry.name === "send_keys_to_session");
    const result = await tool.execute("tool-1", { target: "test2", keys: ["Enter"] });
    emit({ type: "tool_execution_end", toolName: tool.name, result, isError: false });
    agent.state.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "已确认 test2。" }]
    });
  });
  const manager = createSessionAgentManager(
    { config: { runtimeSettings: { sessionAgent: {} } } },
    createOperations({
      async send_keys_to_session(params) {
        sent.push(params);
        return { ok: true, session: { id: "s2", name: "test2" }, keys: params.keys };
      }
    }),
    { agent: fake }
  );

  const result = await manager.run("允许 test2", {});

  assert.deepEqual(sent, [{ target: "test2", keys: ["Enter"] }]);
  assert.equal(result.session.name, "test2");
});

function createOperations(overrides = {}) {
  return {
    setCurrentRequest() {},
    async list_sessions() {
      return { sessions: [] };
    },
    async get_session_output() {
      return { output: "" };
    },
    async send_to_session() {
      return { ok: true };
    },
    async send_keys_to_session() {
      return { ok: true };
    },
    async switch_session() {
      return { session: null, output: "" };
    },
    async stop_session() {
      return { ok: true };
    },
    async restart_session() {
      return { session: null };
    },
    async create_session() {
      return { session: null };
    },
    async summarize_session_states() {
      return "{}";
    },
    ...overrides
  };
}

function createFakeAgent(onPrompt) {
  const listeners = new Set();
  const agent = {
    state: {
      systemPrompt: "",
      tools: [],
      messages: [],
      errorMessage: undefined
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(input) {
      this.state.messages.push({ role: "user", content: input });
      const emit = (event) => {
        for (const listener of listeners) listener(event);
      };
      await onPrompt(this, emit);
    },
    reset() {
      this.state.messages = [];
    }
  };
  return agent;
}

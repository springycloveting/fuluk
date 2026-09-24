import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateRuntimeSettings } from "../src/config.mjs";

function makeTempConfig(existingCommandParser) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sg-cfg-"));
  return {
    settingsPath: path.join(dir, "settings.json"),
    runtimeSettingsEnabled: true,
    runtimeSettings: {
      commandParser: existingCommandParser,
      notifications: { webhookUrl: "" },
      sessionAgent: { model: "", apiKey: "", models: {}, resetOnConfigChange: false }
    }
  };
}

test("updateRuntimeSettings preserves existing commandParser LLM fields when incoming values are empty", () => {
  const config = makeTempConfig({
    enabled: true,
    mode: "rules-first-ai-fallback",
    baseUrl: "https://modelservice.example.com/v1",
    model: "DeepSeek-V4-Flash",
    apiKey: "pk-secret",
    webAiAgentPiUrl: "",
    webAiAgentPiToken: ""
  });

  // Simulate the UI saving with empty LLM fields (the wipe scenario):
  // the server merges {...existing, ...body}, so body.commandParser overrides with blanks.
  const input = {
    ...config.runtimeSettings,
    commandParser: {
      enabled: true,
      mode: "rules-first-ai-fallback",
      baseUrl: "",
      model: "",
      apiKey: ""
    }
  };

  const next = updateRuntimeSettings(config, input);

  assert.equal(next.commandParser.baseUrl, "https://modelservice.example.com/v1");
  assert.equal(next.commandParser.model, "DeepSeek-V4-Flash");
  assert.equal(next.commandParser.apiKey, "pk-secret");

  // The persisted file on disk must also keep the LLM config.
  const onDisk = JSON.parse(fs.readFileSync(config.settingsPath, "utf8"));
  assert.equal(onDisk.commandParser.baseUrl, "https://modelservice.example.com/v1");
  assert.equal(onDisk.commandParser.model, "DeepSeek-V4-Flash");
  assert.equal(onDisk.commandParser.apiKey, "pk-secret");
});

test("updateRuntimeSettings overwrites commandParser LLM fields when incoming values are non-empty", () => {
  const config = makeTempConfig({
    enabled: true,
    mode: "rules-first-ai-fallback",
    baseUrl: "https://old.example.com/v1",
    model: "old-model",
    apiKey: "pk-old",
    webAiAgentPiUrl: "",
    webAiAgentPiToken: ""
  });

  const input = {
    ...config.runtimeSettings,
    commandParser: {
      enabled: true,
      mode: "rules-first-ai-fallback",
      baseUrl: "https://new.example.com/v1/",
      model: "new-model",
      apiKey: "pk-new"
    }
  };

  const next = updateRuntimeSettings(config, input);

  assert.equal(next.commandParser.baseUrl, "https://new.example.com/v1");
  assert.equal(next.commandParser.model, "new-model");
  assert.equal(next.commandParser.apiKey, "pk-new");
});

test("updateRuntimeSettings preserves webAiAgentPi fields when they are absent from incoming input", () => {
  // The web UI's saveConfig never sends webAiAgentPiUrl/webAiAgentPiToken, so a
  // configured remote parser must survive a normal token-only save.
  const config = makeTempConfig({
    enabled: true,
    mode: "rules-first-ai-fallback",
    baseUrl: "https://modelservice.example.com/v1",
    model: "DeepSeek-V4-Flash",
    apiKey: "pk-secret",
    webAiAgentPiUrl: "https://remote-pi.example.com/api",
    webAiAgentPiToken: "tok-remote"
  });

  const input = {
    ...config.runtimeSettings,
    commandParser: {
      enabled: true,
      mode: "rules-first-ai-fallback",
      baseUrl: "",
      model: "",
      apiKey: ""
      // webAiAgentPiUrl / webAiAgentPiToken intentionally omitted
    }
  };

  const next = updateRuntimeSettings(config, input);

  assert.equal(next.commandParser.webAiAgentPiUrl, "https://remote-pi.example.com/api");
  assert.equal(next.commandParser.webAiAgentPiToken, "tok-remote");
});

test("normalizeSessionAgent preserves the enabled toggle", () => {
  const config = makeTempConfig({
    enabled: true,
    mode: "rules-first-ai-fallback",
    baseUrl: "https://modelservice.example.com/v1",
    model: "DeepSeek-V4-Flash",
    apiKey: "pk-secret"
  });
  // server merges {...existing, ...body}; the UI sends sessionAgent with the toggle
  const input = {
    ...config.runtimeSettings,
    sessionAgent: { ...config.runtimeSettings.sessionAgent, enabled: true }
  };
  const next = updateRuntimeSettings(config, input);
  assert.equal(next.sessionAgent.enabled, true);
  assert.equal(next.sessionAgent.model, "");

  const disabled = updateRuntimeSettings(config, {
    ...config.runtimeSettings,
    sessionAgent: { ...config.runtimeSettings.sessionAgent, enabled: false }
  });
  assert.equal(disabled.sessionAgent.enabled, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { canAutoYesSession, shouldSendAutoYes } from "../public/auto_yes.js";

const sessions = [
  { id: "selected", status: "running" },
  { id: "background", status: "running" },
  { id: "stopped", status: "stopped" }
];

test("global All Yes permits a running background session", () => {
  assert.equal(canAutoYesSession(sessions, "selected", "background", { allowBackground: true }), true);
});

test("session All Yes only permits the selected session", () => {
  assert.equal(canAutoYesSession(sessions, "selected", "background"), false);
  assert.equal(canAutoYesSession(sessions, "selected", "selected"), true);
});

test("All Yes never targets a stopped or missing session", () => {
  assert.equal(canAutoYesSession(sessions, "selected", "stopped", { allowBackground: true }), false);
  assert.equal(canAutoYesSession(sessions, "selected", "missing", { allowBackground: true }), false);
});

test("All Yes suppresses immediate repeats even when the prompt signature changes", () => {
  const previous = { signature: "1. Yes", sentAt: 1_000 };
  assert.equal(shouldSendAutoYes(previous, "1. Yes", 5_000), false);
  assert.equal(shouldSendAutoYes(previous, "different prompt", 5_000), false);
  assert.equal(shouldSendAutoYes(previous, "1. Yes", 11_000), true);
  assert.equal(shouldSendAutoYes(previous, "different prompt", 11_000), true);
});

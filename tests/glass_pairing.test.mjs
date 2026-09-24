import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GlassPairingStore } from "../src/glass_pairing.mjs";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glass-pairing-"));
  return { store: new GlassPairingStore(path.join(dir, "state.json")), dir };
}

test("pair request goes pending then approved key resolves and persists", () => {
  const { store, dir } = tempStore();
  const key = "a".repeat(48);
  assert.equal(store.requestPair({ key, name: "glasses" }), "pending");
  assert.equal(store.status(key), "pending");
  assert.equal(store.listPending()[0].name, "glasses");
  assert.equal(store.approve(key), true);
  assert.equal(store.status(key), "approved");
  assert.equal(store.resolveKey(key).name, "glasses");
  assert.ok(fs.existsSync(path.join(dir, "state.json")));
  const reloaded = new GlassPairingStore(path.join(dir, "state.json"));
  assert.equal(reloaded.resolveKey(key) !== null, true);
});

test("reject removes pending and revoke removes approved key", () => {
  const { store } = tempStore();
  const key = "b".repeat(48);
  store.requestPair({ key });
  assert.equal(store.reject(key), true);
  assert.equal(store.status(key), "unknown");
  store.requestPair({ key });
  store.approve(key);
  assert.equal(store.revoke(key), true);
  assert.equal(store.resolveKey(key), null);
});

test("unknown and expired statuses", async () => {
  const { store } = tempStore();
  assert.equal(store.status("nope"), "unknown");
  const key = "c".repeat(48);
  store.requestPair({ key });
  const item = store.pending.get(key);
  item.expiresAt = Date.now() - 1;
  assert.equal(store.status(key), "expired");
});

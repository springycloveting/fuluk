import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCwdAllowed, createDirectory, listDirectories } from "../src/cwd_policy.mjs";

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cwd-policy-"));
}

test("assertCwdAllowed accepts paths inside a root", () => {
  const root = makeRoot();
  const config = { strictCwd: true, allowedCwds: [root] };
  assertCwdAllowed(root, config);
  assertCwdAllowed(path.join(root, "a", "b"), config);
  assertCwdAllowed(`${root}/./a/../a`, config);
});

test("assertCwdAllowed rejects traversal outside the whitelist", () => {
  const root = makeRoot();
  const config = { strictCwd: true, allowedCwds: [root] };
  assert.throws(() => assertCwdAllowed(path.join(root, ".."), config), /白名单/);
  assert.throws(() => assertCwdAllowed(path.join(root, "a", "..", ".."), config), /白名单/);
  assert.throws(() => assertCwdAllowed("/etc", config), /白名单/);
  assert.throws(() => assertCwdAllowed("relative/path", config), /absolute/);
});

test("assertCwdAllowed follows symlinks so links cannot escape the root", () => {
  const root = makeRoot();
  const outside = makeRoot();
  fs.symlinkSync(outside, path.join(root, "link"));
  const config = { strictCwd: true, allowedCwds: [root] };
  assert.throws(() => assertCwdAllowed(path.join(root, "link"), config), /白名单/);
});

test("assertCwdAllowed is a no-op when strict mode is off", () => {
  const config = { strictCwd: false, allowedCwds: [] };
  assertCwdAllowed("/anywhere/at/all", config);
});

test("listDirectories lists only subdirectories", () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, "zeta"));
  fs.mkdirSync(path.join(root, "alpha"));
  fs.writeFileSync(path.join(root, "file.txt"), "x");
  const result = listDirectories(root, { strictCwd: true, allowedCwds: [root] });
  assert.deepEqual(result.directories, ["alpha", "zeta"]);
  assert.equal(result.path, root);
  assert.equal(result.parent, null);
});

test("createDirectory creates a folder under the whitelist", () => {
  const root = makeRoot();
  const result = createDirectory({ parent: root, name: "new-proj" }, {
    strictCwd: true,
    allowedCwds: [root]
  });
  assert.equal(result.path, path.join(root, "new-proj"));
  assert.ok(fs.statSync(result.path).isDirectory());
});

test("createDirectory rejects traversal and invalid names", () => {
  const root = makeRoot();
  const config = { strictCwd: true, allowedCwds: [root] };
  assert.throws(() => createDirectory({ parent: root, name: "../escape" }, config));
  assert.throws(() => createDirectory({ parent: root, name: ".." }, config));
  assert.throws(() => createDirectory({ parent: root, name: "a/b" }, config));
});

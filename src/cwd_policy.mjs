import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Expand ~ and resolve a user-supplied path.
export function expandCwd(input) {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) throw new Error("cwd is required");
  if (value === "~") return path.resolve(os.homedir());
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  if (value.startsWith("/")) return path.resolve(value);
  throw new Error("cwd must be an absolute path");
}

// Enforce the whitelist. Walks up to the first existing ancestor and
// realpaths it, so a symlink inside a root cannot be used to escape it.
export function assertCwdAllowed(target, config) {
  if (!config?.strictCwd) return;
  const resolved = realExistingPath(expandCwd(target));
  const roots = (config.allowedCwds ?? []).map(realRoot).filter(Boolean);
  if (!roots.some((root) => isInsideRoot(resolved, root))) {
    throw new Error(`目录不在允许的白名单内: ${resolved}`);
  }
}

export function listDirectories(dir, config) {
  const resolved = expandCwd(dir);
  assertWithinWhitelist(resolved, config);
  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    throw new Error(`无法读取目录: ${resolved}`);
  }
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  return { path: resolved, parent: parentWithinWhitelist(resolved, config), directories };
}

export function createDirectory(input, config) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    throw new Error("文件夹名不合法");
  }
  const resolvedParent = expandCwd(input.parent);
  assertWithinWhitelist(resolvedParent, config);
  const target = path.join(resolvedParent, name);
  assertWithinWhitelist(target, config);
  try {
    fs.mkdirSync(target);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`文件夹已存在: ${target}`);
    throw new Error(`无法创建文件夹: ${error?.message ?? target}`);
  }
  return { path: target };
}

function assertWithinWhitelist(target, config) {
  if (!config?.strictCwd) return;
  const roots = (config.allowedCwds ?? []).map(realRoot).filter(Boolean);
  if (!roots.some((root) => isInsideRoot(target, root))) {
    throw new Error(`目录不在允许的白名单内: ${target}`);
  }
}

function parentWithinWhitelist(target, config) {
  const parent = path.dirname(target);
  if (parent === target) return null;
  const roots = (config?.allowedCwds ?? []).map(realRoot).filter(Boolean);
  return roots.some((root) => isInsideRoot(parent, root)) ? parent : null;
}

function isInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function realRoot(root) {
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

function realExistingPath(target) {
  let current = target;
  const suffix = [];
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return suffix.length ? path.join(real, ...suffix.slice().reverse()) : real;
    } catch {
      suffix.push(path.basename(current));
      const parent = path.dirname(current);
      if (parent === current) return target;
      current = parent;
    }
  }
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const PENDING_TTL_MS = 10 * 60 * 1000;

export class GlassPairingStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.pending = new Map();
    this.keys = new Map();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      for (const item of data.keys || []) {
        if (item.key && item.accountId) this.keys.set(item.key, item);
      }
    } catch {
      // Corrupt state must not block startup; pending requests can be retried.
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = { keys: [...this.keys.values()] };
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
    fs.renameSync(tempPath, this.filePath);
  }

  requestPair({ key, name }) {
    this.prunePending();
    if (this.keys.has(key)) return "approved";
    this.pending.set(key, {
      key,
      name: name || "AI 眼镜",
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return "pending";
  }

  status(key) {
    if (this.keys.has(key)) return "approved";
    if (this.pending.has(key)) {
      const item = this.pending.get(key);
      if (item.expiresAt <= Date.now()) {
        this.pending.delete(key);
        return "expired";
      }
      return "pending";
    }
    return "unknown";
  }

  listPending() {
    this.prunePending();
    return [...this.pending.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  listKeys() {
    return [...this.keys.values()].sort((a, b) => b.approvedAt - a.approvedAt);
  }

  approve(key) {
    const item = this.pending.get(key);
    if (!item) return false;
    this.keys.set(key, {
      key,
      name: item.name,
      accountId: crypto.randomUUID(),
      approvedAt: Date.now(),
    });
    this.pending.delete(key);
    this.persist();
    return true;
  }

  reject(key) {
    return this.pending.delete(key);
  }

  revoke(key) {
    const removed = this.keys.delete(key);
    if (removed) this.persist();
    return removed;
  }

  resolveKey(key) {
    return this.keys.get(key) || null;
  }

  prunePending() {
    const now = Date.now();
    for (const [key, item] of this.pending) {
      if (item.expiresAt <= now) this.pending.delete(key);
    }
  }
}

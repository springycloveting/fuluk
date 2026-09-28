# 会话状态 Hook 对接

会话状态（运行中 / 等待审批 / 已完成）不再依赖终端快照对比，而是由各 CLI 的
生命周期 hook 在事件发生时主动上报到网关。

## 接口

`POST /api/hooks/:kind`，`kind` 为 `claude` | `codex` | `opencode`。

- 鉴权：`Authorization: Bearer <SESSION_GATEWAY_TOKEN>`
- Body：各 CLI 的原始 hook JSON（见 `src/hooks.mjs` 的归一化规则）
- 响应：
  - `200 { ok: true, sessionId, taskState }` 已应用
  - `200 { ok: true, ignored: true }` 事件无需处理（如 `SubagentStop`）
  - `202 { ok: true, pending: true }` 尚未解析到网关会话，稍后自动重试
- `taskState`：`in_progress` / `needs_confirmation` / `completed`

## 事件映射

| CLI | 完成 | 等待审批 | 开始活动 |
|---|---|---|---|
| claude | `Stop` | `Notification`（message 含 permission） | `UserPromptSubmit` |
| codex | `notify` `agent-turn-complete` | `notify` `*-approval-available` | — |
| opencode | `session.idle` | `permission.asked` | — |

会话解析顺序：CLI 会话 ID（`cli_session_id`）→ `cwd` + 类型匹配最近的运行中会话。

## 文件

- `hook-bridge.mjs`：从 stdin 读 hook JSON 并转发到接口，失败不阻塞 CLI
- `opencode-plugin/`：OpenCode 插件（事件名 `session.idle` / `permission.asked`）
- `install.mjs`：幂等写入三家 CLI 的全局配置，改动前自动备份

## 安装

```bash
node hooks/install.mjs \
  --targets claude,codex,opencode \
  --base-url http://127.0.0.1:8787 \
  --token "$SESSION_GATEWAY_TOKEN"
```

未传 `--token` 时会从运行中的网关进程环境自动读取。修改后需重启网关服务，
并重新创建会话以触发 hook；存量未装 hook 的会话仍走旧快照逻辑作为兜底。

bridge 支持的环境变量：`SESSION_GATEWAY_URL`、`SESSION_GATEWAY_HOOK_TOKEN`。

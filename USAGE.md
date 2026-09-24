# Fuluk Gateway 使用说明

Fuluk Gateway 是一个通过 Web 界面和 REST API 管理 AI CLI 会话的工具。它使用 `tmux` 作为后端，支持管理 `codex`、`claude`、`opencode`、`pi-os` 和本地 shell 会话。

Fuluk Gateway is a tool for managing AI CLI sessions through a Web interface and REST API. It uses `tmux` as the backend, supporting `codex`, `claude`, `opencode`, `pi-os`, and local shell sessions.

<details>
<summary>English</summary>

## Introduction

## Starting the Service

```bash
npm ci

# Development/temporary run
SESSION_GATEWAY_TOKEN=your-secret-token npm run dev
```

The service will start at `http://127.0.0.1:8787`.

For production, it's not recommended to rely on interactive `npm start` for long-term operation. Use the systemd template in the repository:

```bash
sudo SERVICE_USER="$(id -un)" SERVICE_GROUP="$(id -gn)" ./deploy/install-systemd.sh
sudo editor /etc/fuluk-gateway/fuluk-gateway.env
sudo systemctl start fuluk-gateway
sudo systemctl status fuluk-gateway
```

Default production paths:

- Application directory: `/opt/fuluk-gateway`
- Environment file: `/etc/fuluk-gateway/fuluk-gateway.env`
- Data directory: `/var/lib/fuluk-gateway`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HOST` | Server address | `127.0.0.1` |
| `PORT` | Server port | `8787` |
| `SESSION_GATEWAY_TOKEN` | API authentication token | Required |
| `SESSION_GATEWAY_DB` | SQLite database path | `data/session-gateway.sqlite` |
| `SESSION_GATEWAY_SETTINGS` | Web config save path | `data/session-gateway-settings.json` |
| `SESSION_GATEWAY_RUNTIME` | Runtime default command | `/bin/bash` |
| `SESSION_GATEWAY_CODEX_SUBMIT_KEY` | Codex session submit key | `Enter` |
| `SESSION_GATEWAY_CLAUDE_SUBMIT_KEY` | Claude session submit key | `Enter` |
| `SESSION_GATEWAY_OPENCODE_SUBMIT_KEY` | OpenCode session submit key | `Enter` |
| `SESSION_GATEWAY_PI_OS_SUBMIT_KEY` | pi-os session submit key | `Enter` |
| `SESSION_GATEWAY_RUNTIME_SUBMIT_KEY` | Runtime session submit key | `Enter` |
| `SESSION_GATEWAY_SUBMIT_KEY_DELAY_MS` | Delay between text and submit key (ms) | `80` |

## Advanced Command Parsing Modes

Session Gateway supports three command parsing modes:

### 1. rules-only (default)

Pure rule-based parsing using regex to match user input. Fast but doesn't support complex sentences.

### 2. rules-first-ai-fallback

Try rule parsing first, fall back to local AI model when it fails.

Configuration example (`data/session-gateway-settings.json`):

```json
{
  "commandParser": {
    "mode": "rules-first-ai-fallback",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen",
    "apiKey": "dummy"
  }
}
```

### 3. web-ai-agent-pi (advanced mode)

Use web-ai-agent-pi service for command parsing, supports more natural language understanding.

First start the web-ai-agent-pi service:

```bash
web-ai-agent-pi-server
```

Then configure Session Gateway (`data/session-gateway-settings.json`):

```json
{
  "commandParser": {
    "mode": "web-ai-agent-pi",
    "webAiAgentPiUrl": "http://127.0.0.1:8786",
    "webAiAgentPiToken": "your-token"
  }
}
```

Environment variables:
- `WEB_AI_AGENT_PI_PORT` - web-ai-agent-pi service port (default 8786)
- `WEB_AI_AGENT_PI_TOKEN` - Authentication token

## Session Task State Notifications

Session Gateway sends notifications when session task state changes:

- `in_progress` -> `completed` (UI shows "Stopped")
- `in_progress` -> `needs_confirmation` (UI shows "Needs Confirmation")

Event JSON:

```json
{
  "type": "session_task_state_changed",
  "previousTaskState": "in_progress",
  "taskState": "needs_confirmation",
  "changedAt": "2026-05-28T00:00:00.000Z",
  "session": { "id": "...", "name": "test2" }
}
```

### WebSocket

Connection URL:

```text
ws://127.0.0.1:8787/api/session-events?token=SESSION_GATEWAY_TOKEN
```

The server polls session status at `SESSION_GATEWAY_NOTIFICATION_POLL_MS` interval (default 5000ms) when WebSocket clients are connected.

### Webhook

Environment variable:

```bash
SESSION_GATEWAY_WEBHOOK_URL=https://example.com/session-webhook
```

Or in `data/session-gateway-settings.json`:

```json
{
  "notifications": {
    "webhookUrl": "https://example.com/session-webhook"
  }
}
```

When webhook is configured, the server automatically polls and POSTs event JSON to that URL.

## Web Interface Usage

### 1. Access the Interface

Open browser and visit `http://127.0.0.1:8787`

### 2. Configure Authentication Token

Click `Config` at the top, enter the `SESSION_GATEWAY_TOKEN` set at startup (development default is `dev-token`, production must use a strong random value).

### 3. Create Session

Click `Create` at the top, in the popup select:
- **Type**: codex / claude / opencode / pi-os / runtime
- **Name**: Session name (optional, auto-generated if empty)
- **Directory**: Working directory path (required)
- **Project**: Project identifier (optional)

Click `Create` button to create the session.

### 4. View Session List

Click `Sessions` at the top to open the session drawer. Session list includes:
- Session name
- Type (codex/claude/opencode/pi-os/runtime)
- Status (running/stopped/missing)
- Working directory

Click `Refresh` to refresh the list.

### 5. Interact with Session

Click a session item on the left to select it:
- **Output area**: Shows terminal output
- **Input box**: Enter text and click `Send` or press Enter to send
- **Restart**: Restart session
- **Stop**: Stop session

### 6. Natural Language Commands

Click `Command` at the top, enter shortcut commands in the command window. Results display in the command window; only output/switch operations update the main terminal.

**Command Examples**

| Example | Description |
|---------|-------------|
| `新建一个 codex 会话，目录 /workspace/app。` | Create new session |
| `把这句话发给 claude-main：查看。` | Send text to specified session |
| `codex-1 最近输出。` | Get session output |
| `列出所有运行中的会话。` | List running sessions |
| `停止 opencode-test。` | Stop session |
| `重启 session-name。` | Restart session |
| `进入 session-name。` | Switch to specified session |

### 7. Configuration Interface

Click `Config` at the top to configure:

- UI language: 中文 / English
- Light/Dark theme
- Bearer token: Saved in browser locally, used for API requests
- Command parsing: Optional local OpenAI-compatible model

Settings are saved to the JSON file specified by `SESSION_GATEWAY_SETTINGS`, default is `data/session-gateway-settings.json`. Changes only affect newly created sessions; existing sessions keep their original command.

## Project Labels

Sessions can carry a free-text project label. Enter it in the `项目` / Project field when creating a session, and use the session search box or natural language (e.g., `列出项目 demo 的会话`) to filter by it. The label is a plain tag — it does not create a group or shared message channel.

## REST API Usage

All APIs (except `/health`) require authentication token in request header:

```
Authorization: Bearer your-secret-token
```

### Health Check

```bash
curl http://127.0.0.1:8787/health
```

Response:
```json
{"ok": true, "tmux": true}
```

### List All Sessions

```bash
curl -H "Authorization: Bearer dev-token" \
  http://127.0.0.1:8787/api/sessions
```

### Create Session

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"kind": "runtime", "cwd": "/tmp", "name": "my-shell"}' \
  http://127.0.0.1:8787/api/sessions
```

### Get Session Output

```bash
curl -H "Authorization: Bearer dev-token" \
  "http://127.0.0.1:8787/api/sessions/my-shell/output?lines=100"
```

### Send Input

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"text": "ls -la"}' \
  http://127.0.0.1:8787/api/sessions/my-shell/input
```

### Restart Session

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  http://127.0.0.1:8787/api/sessions/my-shell/restart
```

### Stop Session

```bash
curl -X DELETE \
  -H "Authorization: Bearer dev-token" \
  http://127.0.0.1:8787/api/sessions/my-shell
```

### Natural Language Command

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"text": "列出所有运行中的会话。"}' \
  http://127.0.0.1:8787/api/nl
```

## Session Types

| Type | Command | Description |
|------|---------|-------------|
| `codex` | `codex` | OpenAI Codex CLI |
| `claude` | `claude` | Anthropic Claude CLI |
| `opencode` | `opencode` | OpenCode CLI |
| `pi-os` | `pi-os` | pi-os CLI |
| `runtime` | `/bin/bash` | Local shell session |

## Notes

1. **tmux dependency**: System must have tmux installed
2. **CLI validation**: When creating codex/claude/opencode/pi-os sessions, corresponding command is checked for existence
3. **Node.js version**: Requires Node.js 22+ (`node:sqlite` is experimental)
4. **Real-time output**: Output is captured live from tmux, not stored as persistent data
5. **Session status**: Status is automatically refreshed when listing sessions (running/stopped/missing)

## Troubleshooting

### tmux Not Installed

```bash
sudo apt install tmux
```

### Node.js Version Wrong

```bash
source ~/.nvm/nvm.sh
nvm use 22
```

### Port Already in Use

Change port:
```bash
PORT=9000 SESSION_GATEWAY_TOKEN=dev-token npm run dev
```

### Authentication Failed

Ensure the token in request header matches `SESSION_GATEWAY_TOKEN` set at startup.

### Web Send Only Newlines Without Executing

Gateway sends literal text first, then sends submit key separately. Default submit key is `Enter`.

If certain Codex CLI / tmux / terminal combination still treats `Enter` as newline, try specifying Codex submit key:

```bash
SESSION_GATEWAY_CODEX_SUBMIT_KEY=C-m SESSION_GATEWAY_TOKEN=dev-token npm run dev
```

`SESSION_GATEWAY_CODEX_SUBMIT_KEY` value is passed directly to `tmux send-keys`, e.g., `Enter`, `C-m`, `C-j`.

</details>

<details>
<summary>中文</summary>

## 简介

## 启动服务

```bash
npm ci

# 开发/临时运行
SESSION_GATEWAY_TOKEN=your-secret-token npm run dev
```

服务将在 `http://127.0.0.1:8787` 启动。

生产环境不建议只靠交互式 `npm start` 长期运行。推荐使用仓库里的 systemd 模板：

```bash
sudo SERVICE_USER="$(id -un)" SERVICE_GROUP="$(id -gn)" ./deploy/install-systemd.sh
sudo editor /etc/fuluk-gateway/fuluk-gateway.env
sudo systemctl start fuluk-gateway
sudo systemctl status fuluk-gateway
```

默认生产路径：

- 应用目录：`/opt/fuluk-gateway`
- 环境文件：`/etc/fuluk-gateway/fuluk-gateway.env`
- 数据目录：`/var/lib/fuluk-gateway`

## 环境变量配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `HOST` | 服务器地址 | `127.0.0.1` |
| `PORT` | 服务器端口 | `8787` |
| `SESSION_GATEWAY_TOKEN` | API 认证令牌 | 必填 |
| `SESSION_GATEWAY_DB` | SQLite 数据库路径 | `data/session-gateway.sqlite` |
| `SESSION_GATEWAY_SETTINGS` | Web 配置保存路径 | `data/session-gateway-settings.json` |
| `SESSION_GATEWAY_RUNTIME` | runtime 类型默认命令 | `/bin/bash` |
| `SESSION_GATEWAY_CODEX_SUBMIT_KEY` | codex 会话发送后的提交键 | `Enter` |
| `SESSION_GATEWAY_CLAUDE_SUBMIT_KEY` | claude 会话发送后的提交键 | `Enter` |
| `SESSION_GATEWAY_OPENCODE_SUBMIT_KEY` | opencode 会话发送后的提交键 | `Enter` |
| `SESSION_GATEWAY_PI_OS_SUBMIT_KEY` | pi-os 会话发送后的提交键 | `Enter` |
| `SESSION_GATEWAY_RUNTIME_SUBMIT_KEY` | runtime 会话发送后的提交键 | `Enter` |
| `SESSION_GATEWAY_SUBMIT_KEY_DELAY_MS` | 发送文本和提交键之间的延迟毫秒数 | `80` |

## 高级命令解析模式

Session Gateway 支持三种命令解析模式：

### 1. rules-only（默认）

纯规则解析，使用正则表达式匹配用户输入。速度快但不支持复杂语句。

### 2. rules-first-ai-fallback

先尝试规则解析，失败时调用本地 AI 模型解析。

配置示例（`data/session-gateway-settings.json`）：

```json
{
  "commandParser": {
    "mode": "rules-first-ai-fallback",
    "baseUrl": "http://127.0.0.1:11434/v1",
    "model": "qwen",
    "apiKey": "dummy"
  }
}
```

### 3. web-ai-agent-pi（高级模式）

使用 web-ai-agent-pi 服务进行命令解析，支持更自然的语言理解。

首先启动 web-ai-agent-pi 服务：

```bash
web-ai-agent-pi-server
```

然后配置 Session Gateway（`data/session-gateway-settings.json`）：

```json
{
  "commandParser": {
    "mode": "web-ai-agent-pi",
    "webAiAgentPiUrl": "http://127.0.0.1:8786",
    "webAiAgentPiToken": "your-token"
  }
}
```

环境变量：
- `WEB_AI_AGENT_PI_PORT` - web-ai-agent-pi 服务端口（默认 8786）
- `WEB_AI_AGENT_PI_TOKEN` - 认证 token

## 会话状态通知

Session Gateway 会在会话任务状态发生指定变化时发送通知：

- `in_progress` -> `completed`（界面显示"已停止"）
- `in_progress` -> `needs_confirmation`（界面显示"需要确认"）

事件 JSON：

```json
{
  "type": "session_task_state_changed",
  "previousTaskState": "in_progress",
  "taskState": "needs_confirmation",
  "changedAt": "2026-05-28T00:00:00.000Z",
  "session": { "id": "...", "name": "test2" }
}
```

### WebSocket

连接地址：

```text
ws://127.0.0.1:8787/api/session-events?token=SESSION_GATEWAY_TOKEN
```

服务端会在有 WebSocket 客户端连接时按 `SESSION_GATEWAY_NOTIFICATION_POLL_MS` 轮询会话状态，默认 `5000` 毫秒。

### Webhook

环境变量：

```bash
SESSION_GATEWAY_WEBHOOK_URL=https://example.com/session-webhook
```

也可以写入 `data/session-gateway-settings.json`：

```json
{
  "notifications": {
    "webhookUrl": "https://example.com/session-webhook"
  }
}
```

有 Webhook 配置时，服务端会自动轮询并向该 URL `POST` 事件 JSON。

## Web 界面使用

### 1. 访问界面

打开浏览器访问 `http://127.0.0.1:8787`

### 2. 配置认证令牌

点击顶部 `配置` / `Config`，在配置窗口里输入启动时设置的 `SESSION_GATEWAY_TOKEN`（开发默认是 `dev-token`，生产环境必须改成强随机值）。

### 3. 创建会话

点击顶部 `新建` / `Create`，在弹窗中选择：
- **类型**: codex / claude / opencode / pi-os / runtime
- **名称**: 会话名称（可选，不填则自动生成）
- **目录**: 工作目录路径（必填）
- **项目**: 项目标识（可选）

点击 `新建` / `Create` 按钮创建会话。

### 4. 查看会话列表

点击顶部 `会话` / `Sessions` 打开会话抽屉。会话列表包含：
- 会话名称
- 类型（codex/claude/opencode/pi-os/runtime）
- 状态（running/stopped/missing）
- 工作目录

点击 `刷新` / `Refresh` 刷新列表。

### 5. 与会话交互

点击左侧会话项选中后：
- **输出区域**: 显示终端输出内容
- **输入框**: 输入文本后点击 `发送` / `Send` 或按回车发送
- **重启 / Restart**: 重启会话
- **停止 / Stop**: 停止会话

### 6. 自然语言命令

点击顶部 `命令` / `Command`，在命令窗口中输入快捷命令。命令结果会显示在命令窗口内；只有查看输出/切换会话这类操作会同步更新主终端。

**同音字智能识别**

系统支持中文同音字自动映射，即使用户输入错误的同音字也能正确理解意图：

| 输入示例 | 识别为 | 说明 |
|----------|--------|------|
| `绘画列表` | `会话列表` | 自动纠正 |
| `绘话列表` | `会话列表` | 自动纠正 |
| `新建一个绘画` | `新建一个会话` | 自动纠正 |
| `列出所有绘话` | `列出所有会话` | 自动纠正 |

当前支持的同音字映射：
- `绘画` / `绘话` / `回话` / `汇话` / `会画` → `会话`
- `烈表` → `列表`
- `烈出` → `列出`
- `插询` / `差询` → `查询`
- `茶看` / `插看` → `查看`
- `云行` / `允行` → `运行`
- `床建` / `创贱` → `创建`
- `心建` / `新见` → `新建`
- `庭止` / `亭止` → `停止`
- `虫启` / `冲启` → `重启`
- `法送` / `发诵` → `发送`
- `经入` / `近入` → `进入`
- `且换` / `窃换` → `切换`

**命令示例**

| 命令示例 | 说明 |
|----------|------|
| `新建一个 codex 会话，目录 /workspace/app。` | 创建新会话 |
| `把这句话发给 claude-main：查看。` | 向指定会话发送文本 |
| `codex-1 最近输出。` | 获取会话输出 |
| `列出所有运行中的会话。` | 列出运行中的会话 |
| `停止 opencode-test。` | 停止会话 |
| `重启 session-name。` | 重启会话 |
| `进入 session-name。` | 切换到指定会话 |
| `建一个opencode会话，用/workspace/OPCAid文件夹，会话名称用opencode+文件夹名称` | 创建 opencode 会话，名称规范化为 `opencode-OPCAid` |

### 7. 配置界面

点击顶部 `配置` / `Config` 可以配置：

- 界面语言：中文 / English
- 明亮/黑暗主题
- Bearer token：保存在浏览器本地，用于请求 API
- 命令解析：可选接入本地 OpenAI-compatible 模型。模型只返回固定 JSON 动作，后端只执行白名单功能。

设置会保存到 `SESSION_GATEWAY_SETTINGS` 指向的 JSON 文件，默认是 `data/session-gateway-settings.json`。保存后仅影响新建会话；已有会话继续使用创建时的命令。

## 项目标签

会话可以携带一个自由文本项目标签：创建会话时在 `项目` 输入框填写，之后可用会话搜索框或自然语言（如 `列出项目 demo 的会话`）按标签过滤。标签只是纯文本标记，不会创建群组或共享消息通道。

## REST API 使用

所有 API（除 `/health` 外）需要在请求头中携带认证令牌：

```
Authorization: Bearer your-secret-token
```

### 健康检查

```bash
curl http://127.0.0.1:8787/health
```

响应：
```json
{"ok": true, "tmux": true}
```

### 列出所有会话

```bash
curl -H "Authorization: Bearer dev-token" \
  http://127.0.0.1:8787/api/sessions
```

### 创建会话

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"kind": "runtime", "cwd": "/tmp", "name": "my-shell"}' \
  http://127.0.0.1:8787/api/sessions
```

### 获取会话输出

```bash
curl -H "Authorization: Bearer dev-token" \
  "http://127.0.0.1:8787/api/sessions/my-shell/output?lines=100"
```

### 发送输入

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"text": "ls -la"}' \
  http://127.0.0.1:8787/api/sessions/my-shell/input
```

### 重启会话

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  http://127.0.0.1:8787/api/sessions/my-shell/restart
```

### 停止会话

```bash
curl -X DELETE \
  -H "Authorization: Bearer dev-token" \
  http://127.0.0.1:8787/api/sessions/my-shell
```

### 自然语言命令

```bash
curl -X POST \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"text": "列出所有运行中的会话。"}' \
  http://127.0.0.1:8787/api/nl
```

## 会话类型说明

| 类型 | 命令 | 说明 |
|------|------|------|
| `codex` | `codex` | OpenAI Codex CLI |
| `claude` | `claude` | Anthropic Claude CLI |
| `opencode` | `opencode` | OpenCode CLI |
| `pi-os` | `pi-os` | pi-os CLI |
| `runtime` | `/bin/bash` | 本地 shell 会话 |

## 注意事项

1. **tmux 依赖**: 系统必须安装 tmux
2. **CLI 验证**: 创建 codex/claude/opencode/pi-os 会话时，会检查对应命令是否存在
3. **Node.js 版本**: 需要 Node.js 22+（`node:sqlite` 是实验性功能）
4. **实时输出**: 输出内容直接从 tmux 捕获，不存储为持久数据
5. **会话状态**: 列出会话时会自动刷新状态（running/stopped/missing）

## 故障排查

### tmux 未安装

```bash
sudo apt install tmux
```

### Node.js 版本不对

```bash
source ~/.nvm/nvm.sh
nvm use 22
```

### 端口被占用

修改端口：
```bash
PORT=9000 SESSION_GATEWAY_TOKEN=dev-token npm run dev
```

### 认证失败

确保请求头中的令牌与启动时设置的 `SESSION_GATEWAY_TOKEN` 一致。

### Web Send 后只换行不执行

Gateway 会先发送字面文本，再单独发送提交键。默认提交键是 `Enter`。

如果某个 Codex CLI / tmux / 终端组合仍把 `Enter` 当作换行，可以尝试指定 Codex 提交键：

```bash
SESSION_GATEWAY_CODEX_SUBMIT_KEY=C-m SESSION_GATEWAY_TOKEN=dev-token npm run dev
```

`SESSION_GATEWAY_CODEX_SUBMIT_KEY` 的值会原样传给 `tmux send-keys`，例如 `Enter`、`C-m`、`C-j`。

</details>

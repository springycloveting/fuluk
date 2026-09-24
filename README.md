# Fuluk Gateway

面向长时间运行 AI CLI 会话的 Web / REST 网关，并配套手机端与 AR 眼镜端。网关运行在宿主机上，通过 `tmux` 直接管理 `codex`、`claude`、`opencode`、`pi-os` 和本地 shell 会话，提供 Web 界面、REST API、WebSocket 实时推送，以及自然语言命令解析。

A web/REST gateway for long-running AI CLI sessions, plus companion phone and AR-glasses clients. It runs on the host and drives `tmux` directly to manage `codex`, `claude`, `opencode`, `pi-os`, and shell sessions.

## 项目组成

| 目录 | 组件 | 技术栈 | 说明 |
|---|---|---|---|
| `src/` + `public/` | Fuluk Gateway 网关 | Node.js 22+ / 原生 HTTP | Web 界面、REST API、WebSocket、tmux 编排、AI 命令解析 |
| `app/` | 手机 APP | Flutter / Android | 会话查看、终端与助手功能的移动端 |
| `fuluk-glasses/` | Rokid AIUI 智能体 | Rokid AIUI (`.ink`) | AR 眼镜上的语音助手 / TUI / 会话切换 |

眼镜端通过 `/api/glass/*` 与网关配对：首次语音输入网关地址，在 Web 端「配置 → AI 眼镜认证」批准后，双方交换并保存密钥，之后无需再输入 token。

## 功能特性

- 会话管理 Web 界面，基于 `tmux` 的多后端（codex / claude / opencode / pi-os / runtime shell）
- 完整 REST API 与 WebSocket 实时任务状态推送
- 自然语言命令接口 `/api/nl`，支持规则优先、AI 回退（web-pi 助手，可开关）
- 自由文本项目标签，用于组织和过滤会话
- SQLite 会话持久化与断线会话恢复
- AR 眼镜配对认证、确认通知跳转、ntfy 消息推送（可选）

## 环境要求

- 安装了 `tmux` 的 Linux 宿主机
- Node.js 22+ 与 npm
- 可选：宿主机上安装 `codex`、`claude`、`opencode` 或 `pi-os`

## 快速开始（本地开发）

```bash
npm ci
SESSION_GATEWAY_TOKEN=change-me npm run dev
```

打开 `http://127.0.0.1:8787`，在 Config 对话框中填入相同的 token。`SESSION_GATEWAY_TOKEN` 为必填项，生产环境请使用强随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 生产部署（systemd）

```bash
sudo git clone https://github.com/springycloveting/fuluk-gateway /opt/fuluk-gateway
cd /opt/fuluk-gateway
sudo SERVICE_USER="$(id -un)" SERVICE_GROUP="$(id -gn)" ./deploy/install-systemd.sh
sudo editor /etc/fuluk-gateway/fuluk-gateway.env   # 设置真实 SESSION_GATEWAY_TOKEN
sudo systemctl start fuluk-gateway
curl http://127.0.0.1:8787/health
journalctl -u fuluk-gateway -f
```

默认路径：应用 `/opt/fuluk-gateway`，环境文件 `/etc/fuluk-gateway/fuluk-gateway.env`，数据与数据库 `/var/lib/fuluk-gateway/`。

## 配置

所有环境变量见 [.env.example](.env.example)。运行时可在 Web Config 对话框中设置 UI 语言 / 主题、浏览器侧 token，以及可选的 OpenAI 兼容模型（用于命令解析回退）：

```json
{
  "sessionAgent": {
    "enabled": true,
    "model": "Provider:ModelName",
    "models": {
      "Provider": {
        "ModelName": {
          "api": "openai",
          "baseUrl": "https://api.example.com/v1",
          "apiKey": "<YOUR_API_KEY>"
        }
      }
    }
  }
}
```

运行时设置只影响新建会话；已有会话保留创建时的命令。

## 客户端

- **手机 APP**：见 `app/README.md`，使用 Flutter 构建（`cd app && flutter build apk`）。
- **Rokid 眼镜端**：见 `fuluk-glasses/README.md`。将该目录打包为 zip 后在 Rokid 开发者平台导入，封装白名单需加入网关地址并允许局域网明文 HTTP。

## 常用命令

```bash
npm run check   # 语法检查
npm test        # 运行 node:test 测试套件
```

## 文档

- [USAGE.md](USAGE.md) — Web 界面与 REST 用法详解（中英）
- [API_REFERENCE.md](API_REFERENCE.md) — API 参考（中英）
- [SECURITY.md](SECURITY.md) — 安全模型与部署建议
- [STARTUP.md](STARTUP.md) — 本地启动速查
- [PENTEST_REPORT_8888.md](PENTEST_REPORT_8888.md) — 渗透测试报告

## 安全

除 `/health` 外所有接口均需 Bearer token，服务端使用恒定时间比较，且不内置默认 token。请勿将 `.env`、`data/`（SQLite、运行时设置）或任何 API 密钥提交到仓库。详见 [SECURITY.md](SECURITY.md)。

---

<details>
<summary>English</summary>

## Components

- **Gateway** (`src/`, `public/`): Node.js HTTP server, web UI, REST API, WebSocket, and `tmux` orchestration.
- **Phone app** (`app/`): Flutter/Android client.
- **AR glasses** (`fuluk-glasses/`): Rokid AIUI agent with voice assistant and TUI.

## Quick start

```bash
npm ci
SESSION_GATEWAY_TOKEN=change-me npm run dev
```

Open `http://127.0.0.1:8787` and enter the same token in the Config dialog. The token is mandatory; generate a strong random one for production.

## Production

Install the systemd unit via `deploy/install-systemd.sh`, set a real token in `/etc/fuluk-gateway/fuluk-gateway.env`, then start the `fuluk-gateway` service. See the Chinese sections above and [SECURITY.md](SECURITY.md) for details.

</details>

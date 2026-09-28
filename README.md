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

源码可跨发行版运行，仅依赖 Node.js 22+、`tmux` 与 `bash`（SQLite 用 Node 内置 `node:sqlite`，无第三方原生模块）；deb 包与 systemd 仅为 Debian/Ubuntu 的便捷封装，Fedora/RHEL、Arch、openSUSE、Alpine 等系统可直接用源码方式运行（`npm ci` 后 `npm start`）。

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
sudo git clone https://github.com/springycloveting/fuluk /opt/fuluk-gateway
cd /opt/fuluk-gateway
sudo SERVICE_USER="$(id -un)" SERVICE_GROUP="$(id -gn)" ./deploy/install-systemd.sh
sudo editor /etc/fuluk-gateway/fuluk-gateway.env   # 设置真实 SESSION_GATEWAY_TOKEN
sudo systemctl start fuluk-gateway
curl http://127.0.0.1:8787/health
journalctl -u fuluk-gateway -f
```

默认路径：应用 `/opt/fuluk-gateway`，环境文件 `/etc/fuluk-gateway/fuluk-gateway.env`，数据与数据库 `/var/lib/fuluk-gateway/`。

## 让 AI Agent 帮你安装（复制即用）

把下面整段文字直接发给任意可在本机执行命令的 AI Agent（如 OpenClaw、Codex、Claude Code），它就会通过离线 deb 安装好 Fuluk Gateway 与全部系统依赖，配置 token 并启动。注意：该指令**不包含**安装 codex / claude / opencode / pi-os 这些 AI CLI 本身。

```text
请帮我在这台 Linux 机器上安装并启动 Fuluk Gateway（项目 https://github.com/springycloveting/fuluk ）。严格按下面要求执行，不要自行扩大范围：

【环境确认】
- 先判断系统并选择路径：使用 systemd 的 Debian/Ubuntu（apt/dpkg）走下面【安装步骤（deb）】；其他 Linux 发行版（Fedora/RHEL、Arch、openSUSE、Alpine 等）走文末【非 Debian 系统：源码安装】。若不是 Linux（如 macOS/Windows），直接告诉我并停止。
- deb 路径需要 Node.js(>=18)、tmux、passwd；源码路径需要 Node.js 22+、tmux、bash 以及可联网执行 npm ci。
- 安装范围只包含 Fuluk Gateway 自身及其运行所需系统依赖：Node.js(>=18)、tmux、passwd。
- 不要安装、升级或配置任何 AI 编程 CLI，包括 codex、claude code、opencode、pi-os；它们若不存在，仅在最后提醒我自行安装。

【安装步骤】
1. 更新 apt 索引（必要时先安装 curl 与 ca-certificates）。
2. 定位 deb 安装包，按以下顺序：
   a) 若我在当前目录或其常见子目录（如 dist/、~/Downloads）已放有名称形如 fuluk-gateway_*_all.deb 的本地文件，优先使用本地最新的一个；
   b) 本地没有时，直接去 GitHub 下载最新版。下载页面：https://github.com/springycloveting/fuluk/releases/latest ；自动获取方式：访问 https://api.github.com/repos/springycloveting/fuluk/releases/latest ，解析 assets 中 name 形如 fuluk-gateway_*_all.deb 的 browser_download_url，用 curl -fsSL 下载到临时目录；
   c) 若 GitHub 也无法访问或找不到 deb：当前为非 Debian 系则转文末【非 Debian 系统：源码安装】；Debian/Ubuntu 则报告我并停止。
3. 执行 sudo apt-get install -y ./<deb路径>，由 apt 自动安装 nodejs、tmux、passwd 依赖（deb 已内置 node_modules，无需联网装 npm 包）。
4. 用 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 生成强随机 token，写入 /etc/fuluk-gateway/fuluk-gateway.env 的 SESSION_GATEWAY_TOKEN=，保留文件其他内容；保持文件权限 600、属主 root:root。
5. 执行 sudo systemctl enable --now fuluk-gateway 启动并设置开机自启。

【非 Debian 系统：源码安装】
1. 用系统包管理器装好 Node.js 22+（含 npm）、tmux、bash（Alpine 注意 bash 需另装）；确认 node -v 为 v22 且 tmux -V 可执行。
2. 获取源码：优先 git clone https://github.com/springycloveting/fuluk.git /opt/fuluk-gateway ；没有 git 则从 https://github.com/springycloveting/fuluk/releases/latest 或 https://github.com/springycloveting/fuluk/archive/refs/heads/main.tar.gz 下载并解压到 /opt/fuluk-gateway。
3. 在源码目录执行 npm ci 安装依赖（需要联网；无第三方原生编译模块）。
4. 用 node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" 生成强随机 token。
5. 配置并启动，二选一：
   a) 若系统使用 systemd，可参照仓库 deploy/fuluk-gateway.service.example 写一个 service，用 EnvironmentFile 或 Environment 传入 SESSION_GATEWAY_TOKEN=<token>，再 systemctl enable --now；
   b) 否则以前台/常驻进程方式启动：SESSION_GATEWAY_TOKEN=<token> HOST=127.0.0.1 PORT=8787 nohup node src/server.mjs >> fuluk-gateway.log 2>&1 & ，并自行确保开机拉起。

【验收】
- systemctl is-active fuluk-gateway 输出 active；
- curl -sS http://127.0.0.1:8787/health 返回成功；
- 若 8787 端口已被旧进程占用，先报告我，不要擅自 kill。

【完成后报告】
- 服务监听地址（默认仅 127.0.0.1:8787；如需手机/局域网访问要把 HOST 改为 0.0.0.0，请先询问我再改）；
- 登录所用的 SESSION_GATEWAY_TOKEN；
- codex / claude / opencode / pi-os 中哪些尚未安装（不要替我安装）。
```

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

- [INSTALL.md](INSTALL.md) — 安装指南（依赖 / tmux / ntfy / LazyTyper 语音输入）
- [USAGE.md](USAGE.md) — Web 界面与 REST 用法详解（中英）
- [WEB_UI_GUIDE.md](WEB_UI_GUIDE.md) — Web 界面一步一步使用手册
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

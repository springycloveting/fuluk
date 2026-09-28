# Known Issues

本项目（Fuluk Gateway）的已知问题清单。Windows 版与 Linux 版在合并进统一 GitHub 仓库前各自演进；**涉及双平台行为的问题，Windows 版有意与 Linux 版保持一致**，待合并后统一修复，不在单边先行修改，以避免平台行为分叉。

## KI-002 Windows 专属修复（P5/P6）：合并时评估是否同步 Linux

- **状态**：Windows 版已修复（2026-09-25，实机验证通过）；**Linux 版暂不改**，合并进统一 GitHub 仓库时评估同步。
- **内容**：
  - **P6 路径分隔符**（`src/session_resume.mjs`）：
    - claude：`claudeProjectDir` 转义规则由 `cwd.replace(/[/.]/g, "-")` 改为 `cwd.replace(/[\\/:.]/g, "-")`（补 `\`、`:` 转义，Windows 目录 `C:\workspace\test` → `C--workspace-test`）。**该改动对 Linux 无副作用**（Linux 路径无 `\`/`:`），建议合并时直接采用同一实现。
    - opencode：`readOpencodeLocalSessionId` 查询参数在 `win32` 下将 `path.resolve(cwd)` 反斜杠转正斜杠（匹配 opencode.db 存储格式 `C:/workspace/test`）。**该改动是 win32 条件分支**，Linux 行为不变，可直接合并。
  - **P5 中文输入乱码**（`src/win-pty.mjs`）：claude/opencode 启动包装为 `cmd /d /c <临时.cmd>` 先 `chcp 65001` 切 UTF-8 控制台代码页。**Windows 专属（ConPTY 行为）**；Linux 走 tmux，无此问题，无需同步。WinPtyBackend 本身是 Windows 后端，不影响 Linux。
- **验证**：Windows 实机——claude/opencode 中文输入正常、cliSessionId 捕获成功、restart 后上下文恢复（详见 `docs/WINDOWS_TEST_REPORT.md` 二.6）。
- **Linux 修改方案（合并时实施）**：
  - **P6 claude 路径转义**：`src/session_resume.mjs` 的 `claudeProjectDir` 将 `cwd.replace(/[/.]/g, "-")` 改为 `cwd.replace(/[\\/:.]/g, "-")`。Linux 路径不含 `\`/`:`，正则行为与原来完全一致，属零风险改动，直接采用。
  - **P6 opencode 查询参数**：`src/session_resume.mjs` 的 `readOpencodeLocalSessionId` 中，构造查询参数时按平台归一化：
    `const resolvedCwd = process.platform === "win32" ? path.resolve(session.cwd).replace(/\\/g, "/") : path.resolve(session.cwd);`，
    然后以 `resolvedCwd` 作为 SQL 参数。Linux 走 else 分支，传入值与现状相同，行为不变。
  - **P5 中文输入**：**Linux 不做任何改动**。Linux 经 tmux 启动，PTY 默认 UTF-8，无 ConPTY 代码页问题；`chcp`/临时 `.cmd` 包装仅存在于 Windows 的 `src/win-pty.mjs`，合并时保持该后端文件 Windows 专属即可。
  - **验证**：合并后在 Linux 跑 `tests/session_resume.test.mjs` 全绿；新建 claude/opencode 会话各发一条中文输入，确认 `cliSessionId` 能捕获且 restart 后上下文恢复。
- **记录日期**：2026-09-25

## KI-003 codex 0.157+ daemon 启动（Windows 专属修复）：合并时评估是否同步 Linux

- **状态**：Windows 版已修复（2026-09-25，见 `docs/WINDOWS_TEST_REPORT.md` P8）；**Linux 版暂不改**，合并进统一 GitHub 仓库时评估。
- **内容**：codex 0.157 自动启动 background server（daemon），Windows 的 Job Object 不允许 daemon 脱离 → codex 启动即退出。修复：`src/win-pty.mjs` 对 `win32 && codex` 追加 `--no-daemon`。
- **Linux 说明**：Linux（tmux）下 daemon 可正常脱离，无此问题；但 `--no-daemon` 参数在 Linux 无副作用（仅禁用后台服务），合并时可直接采用同一实现，行为一致。
- **Linux 修改方案（合并时实施）**：
  - 在 tmux 后端的启动命令构造处（`src/tmux.mjs`：`resolveCreateCommand` 返回 `{ command, args }`，`create()` 将 args 拼进 shell 命令）对 `kind === "codex"` 在 args **最前面**插入 `"--no-daemon"`，使新建命令为 `codex --no-daemon`。
  - 恢复（resume）路径同样适用：`resumeTokenFor("codex")` 返回 `["resume", id]`，需保证最终命令为 `codex --no-daemon resume <id>`（全局 flag 必须位于 `resume` 子命令之前，不能追加到末尾），即 `--no-daemon` 在 args 拼接时位于 resume token 之前。
  - 建议与 Windows 版抽成同一判定（如共享的 `daemonArgsFor(kind)` 辅助函数），避免双平台再次分叉；claude/opencode 不受影响。
  - **验证**：Linux 上新建 codex 会话确认正常进入 TUI（无该参数本就正常，改动后仍正常即通过）；`codex resume` 恢复历史会话成功；`tests/tmux.test.mjs`、`tests/server.test.mjs` 全绿。
- **记录日期**：2026-09-25

## KI-001 交互式 TUI 会话空闲时被误判为 completed

- **状态**：待修复（计划合并仓库后统一修）
- **平台**：Linux + Windows（同款缺陷）
- **严重度**：中（Web UI 任务状态展示错误；可能触发错误的"任务完成" ntfy/webhook 通知）
- **现象**：codex / claude / opencode 等交互式 TUI 会话**空闲等待输入超过 60 秒**（TUI 停在输入提示符，无新输出）时，`taskState` 被标记为 `completed`、`phase` 变为 `stopped`。Web UI 上表现为：刚创建的会话显示"已完成"，实际仍可继续输入；发送输入后恢复 `in_progress`。
- **根因**：`detectTaskState()` 通过 `isOutputIdle(snapshot)` 判定：输出快照超过 `IDLE_OUTPUT_STOPPED_MS = 60_000` 未更新即返回 `completed`。该逻辑**不区分"CLI 等待输入"与"任务结束"**——对始终在等待输入的非结束性 TUI 会话必然误判。
- **代码位置**：
  - `src/server.mjs`：`detectTaskState`（L1017-1022）、`isOutputIdle`（L1024-1029）、`IDLE_OUTPUT_STOPPED_MS`（L30）
  - Linux 版 `Y:\fuluk-gateway\src\server.mjs` 同款（合并前若路径有变以仓库为准）
- **影响范围**：会话列表 `taskState`/`phase` 展示、ntfy/Webhook 任务完成通知的触发（`shouldNotifyTaskTransition`：in_progress → completed 会发通知）。
- **修复方案（待合并后实施）**：对可恢复的交互式 TUI 会话（`isResumableKind`：codex/claude/opencode），空闲时不判 `completed`（保持 `in_progress`，或新增 `waiting_input` 状态）；仅对非交互/确定性结束的会话保留 idle 判定。
- **验证方式**：创建 codex 会话后不输入，等待 >60s，确认列表 `taskState` 仍为 `in_progress`；输入后正常流转为 `in_progress`，任务完成后再判 `completed`。
- **记录日期**：2026-09-25（Windows 版功能测试期间确认，Linux 版同款逻辑在代码审查中确认）

# CLI Session Fixtures - Feasibility Notes

Date: 2026-09-03 (implementation run)

## Resume flags (verified via `--help` on this machine / server)

- codex  -> `codex resume <SESSION_ID>` (subcommand; id is a UUID)
- claude -> `claude -r/--resume <uuid>`; also exposes `--session-id <uuid>` (Fallback A)
- opencode -> `opencode -s/--session <id>` (id format `ses_<26 alphanumerics>`)

These fixtures are **representative** outputs built from the confirmed id formats.
The parser regexes are format-anchored (search the whole text for the id pattern),
so they work on real banners too.

## Feasibility check (Task 1 Step 5) - EXECUTED on the server (v6@v6-server)

### claude (v2.1.193) - RESULT: banner has NO plaintext session id  -> Task 9 ENABLED
Captured via throwaway tmux on a trusted cwd (/home/v6/work). Startup shows:

    ╭─── Claude Code v2.1.193 ─────...─╮
    │          Welcome back!          │
    │             ~/work              │
    ╰─────────────────────────────────╯

No `session id:` line, no UUID anywhere in the pane. => The primary banner-parse path
CANNOT work for claude. `CLAUDE_BANNER_HANDLE_LESS` in `src/server.mjs` MUST be `true`
and Fallback A (gateway-assigned `--session-id`) is required (Task 9).

Also observed: on a cwd claude has never seen, it first shows a *trust confirmation*
screen ("1. Yes, I trust this folder"). Gateway must ensure the cwd is already trusted,
else claude blocks on that screen and no handle / no prompt appears.

### codex (0.133.0) - RESULT: banner panel has NO plaintext session_id; /status is the fallback
Startup shows an info panel (version / model: loading / directory) but no `session_id:`
line. The `/status` probe is required for capture. (A first probe accidentally confirmed
a version-update prompt with Enter and triggered a `npm install -g @openai/codex`
attempt - process exited; the update prompt then kept reappearing, so a clean
`/status` capture was not obtained reliably. The parser keeps the /status fallback and
the fixture remains representative.)

### opencode - RESULT: NOT INSTALLED on this server; not probe-able
`which opencode` -> not found. Primary banner-parse path kept for opencode based on the
representative fixture (`session: ses_...` line). **Deploy-time check still advised** on
a host that has opencode: confirm the startup banner prints a plaintext `ses_...` id.

## Decisions / risk recorded

- `CLAUDE_BANNER_HANDLE_LESS = true` (server.mjs) - confirmed by real banner capture.
- Fallback A (claude `--session-id`) is implemented (Task 9) and tested.
- Fallback B (read local session storage) intentionally NOT planned for v1.
- opencode fixture uses `ses_` prefix (matching real opencode 1.18.x id format).

## UPDATE (2026-09-03): Fallback B replaces Fallback A

E2E on claude 2.1.193 disproved Fallback A: `claude --session-id <uuid>` does NOT
persist the injected uuid as a resumable session (no file under
`~/.claude/projects/<proj>/` contains it; `claude --resume <uuid>` reports
"No conversation found with session ID"). The injected uuid only shows up under
`~/.claude/session-env/<uuid>` as an empty directory.

Fallback B is therefore implemented and E2E-verified:
- claude starts WITHOUT `--session-id` (the gateway-assigned injection is removed).
- After the first user message claude writes `<real-uuid>.jsonl` under
  `~/.claude/projects/<escaped-cwd>/` (verified live).
- `captureCliSessionId` reads the newest such jsonl and stores the real uuid as
  `cliSessionId` (triggered from `POST /api/sessions/:id/input`).
- restart runs `claude --resume <real-uuid>` and resumes the prior conversation
  (verified: restored banner shows the prior "hi" message).

cwd -> project dir escape rule: `/home/v6/work` -> `-home-v6-work` (each `/` and `.` -> `-`).

## UPDATE (2026-09-03): codex e2e -- version-update prompt blocks auto-capture

codex 0.133.0 shows an interactive "Update available! 0.133.0 -> 0.153.0" prompt on
startup. The gateway /status capture probe can land in that prompt and accidentally
select "Update now", triggering `npm install -g @openai/codex`. In e2e this failed
(ENOTEMPTY) and codex exited, so cliSessionId was NOT captured.
After the run: `codex --version` = 0.133.0 but `npm ls -g @openai/codex` = 0.153.0
(half-updated / inconsistent global install).

Deployment note: dismiss or disable the codex update prompt (env/config) or pin the
installed version before relying on auto-capture. The codex /status fallback is
implemented and unit-tested, but cannot fire while the update prompt is up.

## UPDATE (2026-09-03): opencode Fallback B via local SQLite

opencode is installed on this host (`/home/v6/.npm-global/bin/opencode`). `--help`
confirms resume via `-s, --session <id>`. The current build does not expose a
plaintext handle that the gateway can rely on from the TUI pane, but it does persist
sessions in SQLite at:

    ~/.local/share/opencode/opencode.db

Relevant schema verified live:
- `session.id` is the `ses_...` resume handle.
- `session.directory` is the opencode cwd (for this repo, `/home/v6/work/fuluk-gateway`).
- `session.time_archived` is null for active sessions.
- `message.session_id` links messages; `message.data` is JSON and `$.role = "user"`
  marks a session that has really accepted a first user message.

Fallback B for opencode therefore opens the DB read-only and selects the newest
non-archived session for the gateway cwd that has at least one user message. A
creation-time guard excludes sessions older than the gateway session, so an old
same-cwd conversation cannot be captured for a fresh gateway session. Live read on
this host returned `ses_f98dfabb4ffeL107W2NGuKCelf` for
`/home/v6/work/fuluk-gateway`.

The post-input capture hook now runs for opencode as well as claude. Host mode is
covered; docker mode still needs a container-side DB read path if a deployment runs
opencode only inside a container.

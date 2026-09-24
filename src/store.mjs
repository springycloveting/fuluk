import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { newId, nowIso, sanitizeTmuxName } from "./utils.mjs";

export class SessionStore {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.migrate();
  }

  create(input, command, baseCommandArgs = []) {
    const id = newId();
    const record = buildSessionRecord(id, input, command, baseCommandArgs);

    this.db
      .prepare(
        `insert into sessions (
          id, name, kind, cwd, project, tmux_session_name, command, command_args,
          status, created_at, updated_at, stopped_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.name,
        record.kind,
        record.cwd,
        record.project,
        record.tmuxSessionName,
        record.command,
        JSON.stringify(record.commandArgs),
        record.status,
        record.createdAt,
        record.updatedAt,
        record.stoppedAt
      );

    return record;
  }

  replace(id, input, command, baseCommandArgs = []) {
    const existing = this.findByIdOrName(id);
    if (!existing) throw new Error(`Session not found: ${id}`);

    const record = buildSessionRecord(id, { ...input, name: existing.name }, command, baseCommandArgs, {
      createdAt: existing.createdAt
    });

    this.db
      .prepare("delete from output_snapshots where session_id = ?")
      .run(id);
    this.db
      .prepare(
        `update sessions
         set kind = ?,
             cwd = ?,
             project = ?,
             tmux_session_name = ?,
             command = ?,
             command_args = ?,
             status = ?,
             cli_session_id = ?,
             updated_at = ?,
             stopped_at = ?
         where id = ?`
      )
      .run(
        record.kind,
        record.cwd,
        record.project,
        record.tmuxSessionName,
        record.command,
        JSON.stringify(record.commandArgs),
        record.status,
        null,
        record.updatedAt,
        record.stoppedAt,
        record.id
      );

    return record;
  }

  list() {
    return this.db
      .prepare("select * from sessions order by updated_at desc, created_at desc")
      .all()
      .map(mapSessionRow);
  }

  findByIdOrName(idOrName) {
    const row = this.db
      .prepare("select * from sessions where id = ? or name = ? limit 1")
      .get(idOrName, idOrName);
    return row ? mapSessionRow(row) : null;
  }

  updateStatus(id, status) {
    const timestamp = nowIso();
    this.db
      .prepare("update sessions set status = ?, updated_at = ?, stopped_at = ? where id = ?")
      .run(status, timestamp, status === "running" ? null : timestamp, id);
  }

  markRunning(id) {
    this.db
      .prepare("update sessions set status = 'running', updated_at = ?, stopped_at = null where id = ?")
      .run(nowIso(), id);
  }

  setCliSessionId(id, cliSessionId) {
    this.db
      .prepare("update sessions set cli_session_id = ?, updated_at = ? where id = ?")
      .run(cliSessionId, nowIso(), id);
  }

  touch(id) {
    this.db.prepare("update sessions set updated_at = ? where id = ?").run(nowIso(), id);
  }

  saveOutput(sessionId, lines, text, options = {}) {
    const capturedAt = nowIso();
    const result = this.db
      .prepare("insert into output_snapshots (session_id, captured_at, lines, text) values (?, ?, ?, ?)")
      .run(sessionId, capturedAt, lines, text);

    this.db
      .prepare(
        `delete from output_snapshots
         where session_id = ?
         and id not in (
           select id from output_snapshots where session_id = ? order by id desc limit 50
         )`
      )
      .run(sessionId, sessionId);

    if (options.touch !== false) this.touch(sessionId);

    return {
      id: Number(result.lastInsertRowid),
      sessionId,
      capturedAt,
      lines,
      text
    };
  }

  latestOutputSnapshot(sessionId) {
    const row = this.db
      .prepare("select * from output_snapshots where session_id = ? order by id desc limit 1")
      .get(sessionId);
    return row ? mapOutputSnapshotRow(row) : null;
  }

  delete(id) {
    this.db.prepare("delete from input_history where session_id = ?").run(id);
    this.db.prepare("delete from output_snapshots where session_id = ?").run(id);
    const result = this.db.prepare("delete from sessions where id = ?").run(id);
    return result.changes > 0;
  }

  close() {
    this.db.close();
  }

  saveInput(sessionId, text) {
    const timestamp = nowIso();
    this.db
      .prepare("insert into input_history (session_id, text, created_at) values (?, ?, ?)")
      .run(sessionId, text, timestamp);
    return { sessionId, text, createdAt: timestamp };
  }

  listInputHistory(sessionId, limit = 100) {
    return this.db
      .prepare("select * from input_history where session_id = ? order by created_at desc limit ?")
      .all(sessionId, limit)
      .map(mapInputHistoryRow);
  }

  listAllInputHistory(limit = 200) {
    return this.db
      .prepare(`
        select h.*, s.name as session_name, s.kind as session_kind
        from input_history h
        left join sessions s on h.session_id = s.id
        order by h.created_at desc
        limit ?
      `)
      .all(limit)
      .map(mapInputHistoryRow);
  }

  migrate() {
    this.db.exec(`
      /* One-time cleanup: group chat (rooms) feature removed */
      drop table if exists room_message_deliveries;
      drop table if exists room_messages;
      drop table if exists room_sessions;
      drop table if exists rooms;

      create table if not exists sessions (
        id text primary key,
        name text not null unique,
        kind text not null,
        cwd text not null,
        project text,
        tmux_session_name text not null unique,
        command text not null,
        command_args text not null,
        status text not null,
        created_at text not null,
        updated_at text not null,
        stopped_at text
      );

      create table if not exists output_snapshots (
        id integer primary key autoincrement,
        session_id text not null references sessions(id) on delete cascade,
        captured_at text not null,
        lines integer not null,
        text text not null
      );

      create table if not exists input_history (
        id integer primary key autoincrement,
        session_id text not null references sessions(id) on delete cascade,
        text text not null,
        created_at text not null
      );

      create index if not exists idx_output_snapshots_session_id_id
        on output_snapshots(session_id, id desc);

      create index if not exists idx_input_history_session_id_created_at
        on input_history(session_id, created_at desc);

      create index if not exists idx_input_history_created_at
        on input_history(created_at desc);
    `);
    this.ensureColumn("sessions", "cli_session_id", "text");
  }

  ensureColumn(table, column, definition) {
    const exists = this.db.prepare(`pragma table_info(${table})`).all().some((row) => row.name === column);
    if (!exists) this.db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

function buildSessionRecord(id, input, command, baseCommandArgs, options = {}) {
  const name = input.name?.trim() || `${input.kind}-${id.slice(0, 8)}`;
  const timestamp = nowIso();
  return {
    id,
    name,
    kind: input.kind,
    cwd: input.cwd,
    project: input.project ?? null,
    tmuxSessionName: sanitizeTmuxName(name),
    command,
    commandArgs: [...baseCommandArgs, ...(input.commandArgs ?? [])],
    status: "running",
    createdAt: options.createdAt ?? timestamp,
    updatedAt: timestamp,
    stoppedAt: null,
    cliSessionId: null
  };
}

function mapSessionRow(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    cwd: row.cwd,
    project: row.project,
    tmuxSessionName: row.tmux_session_name,
    command: row.command,
    commandArgs: JSON.parse(row.command_args),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stoppedAt: row.stopped_at,
    cliSessionId: row.cli_session_id ?? null
  };
}

function mapInputHistoryRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionName: row.session_name ?? null,
    sessionKind: row.session_kind ?? null,
    text: row.text,
    createdAt: row.created_at
  };
}

function mapOutputSnapshotRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    capturedAt: row.captured_at,
    lines: row.lines,
    text: row.text
  };
}

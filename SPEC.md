# prompt-lock — Specification

**Version-controlled prompt management for AI coding workflows.** Snapshot, diff, rollback, and share prompts used across sessions. Git for your AI context.

## Problem

Developers using Claude Code, Cursor, and similar tools build up valuable prompt patterns but have no way to version, share, or reproduce them. Prompts are scattered across chat histories and custom instruction files.

## Goals

- Zero-config local prompt store per project (`.prompt-lock/`), plus a global store (`--global`).
- Snapshot prompts as immutable versions with messages and timestamps.
- Diff any two versions with readable unified output.
- Roll back to any previous version non-destructively.
- Tag important versions; export/import prompts for sharing.
- No runtime dependencies; Node >= 20; TypeScript source.

## Non-Goals

- Real git integration (custom lightweight versioning is enough; store lives inside a git repo if you want).
- Multi-user sync servers, remote registries.
- LLM-powered prompt analysis.

## Features

- **F1 `init`** — create `.prompt-lock/` store (or `~/.prompt-lock` with `--global`). Idempotent; fails if store exists unless `--force`.
- **F2 `save <name>`** — snapshot prompt content from `--file <path>`, `--text <s>`, or stdin (piped). `-m/--message` for the snapshot note. First save creates the prompt; subsequent saves append versions. Stores a content SHA-256 and skips a no-op save unless `--force` (content identical to head).
- **F3 `list`** — table of prompts: name, version count, head message, last updated, tags. `--json` for machine output.
- **F4 `show <name>[@version]`** — print content of head or a specific version (`@3`, `@latest`, `@tag:<tag>`).
- **F5 `history <name>`** — version log: id, timestamp, message, size, tags. `--json`.
- **F6 `diff <name>[@a [@b]]`** — unified line diff between two versions (default head~1 vs head). Exit code 0 if identical, 1 if differences (script-friendly). ANSI color when TTY, plain otherwise; `--no-color`.
- **F7 `rollback <name>[@version]`** — restore an old version as a new head version (message `rollback to @N`); nothing is deleted.
- **F8 `tag <name> <tag>[@version]`** / `tag --delete` — tag versions; tags resolve in `@tag:` selectors.
- **F9 `export <name>`** — write a portable single-file bundle (JSON with all versions+tags) to stdout or `--out file`; `import <file|url-path>` loads it, merging versions (import refuses to clobber existing prompt unless `--force`).
- **F10 `rm <name>`** — remove a prompt from the index (files kept in `.prompt-lock/trash/` for recovery).

## CLI Shape

```
prompt-lock <command> [args] [flags]
  init [--global] [--force]
  save <name> (--file <p> | --text <s> | stdin) [-m msg] [--force]
  list [--json]
  show <name[@ver]>
  history <name> [--json]
  diff <name[@a] [name[@b]|@b]> [--no-color] [-u context lines]
  rollback <name[@ver]> [-m msg]
  tag <name[@ver]> <tag> | tag --delete <name[@ver]> <tag>
  export <name> [--out <file>]
  import <bundle-file> [--force]
  rm <name>
```

Global flags: `--global` (use `~/.prompt-lock`), `--store <dir>` (explicit store path), `--json` where noted, `--help`, `--version`.

## Storage Layout

```
.prompt-lock/
  store.json            # { schema: 1, prompts: { <name>: { head: <id>, versions: [...] } } }
  prompts/<name>/<id>.md
  trash/                # removed prompts
```

Version record: `{ id, message, createdAt, sha256, size, tags: [] }`. Writes are atomic (temp file + rename). Store name validation: `[A-Za-z0-9._-]+`, 1–64 chars.

## Acceptance Criteria

- **AC1** All F1–F10 commands implemented and exercised by automated tests (node:test); `npm test` green.
- **AC2** `tsc --strict` compiles with zero errors; `npm run build` produces working `dist/` CLI; `prompt-lock --version` works after `npm link`-style invocation (`node dist/cli.js`).
- **AC3** Round-trip: init → save v1 → save v2 → diff @1 @2 shows the change → rollback @1 → head content equals v1 content.
- **AC4** Export → import into a fresh store reproduces identical content and tags (sha match).
- **AC5** Concurrent-safety basics: atomic store.json writes; corrupt store.json produces a clear error, not a stack trace.
- **AC6** No runtime dependencies (`dependencies` empty in package.json); Node >= 20 only.
- **AC7** README documents every command with examples.

## Iteration Budget

Max 10 spec→build→verify cycles; commit after each cycle.

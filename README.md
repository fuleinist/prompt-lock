# prompt-lock

**Git for your AI prompts.** Version-controlled prompt management for AI coding workflows — snapshot, diff, rollback, and share the prompts you use with Claude Code, Cursor, and friends.

Prompts are valuable and they get lost: scattered across chat histories, scratch files, and custom-instruction blobs. `prompt-lock` gives every prompt an immutable version history in a tiny local store, with zero dependencies.

```
prompt-lock save refactor-prompt --file PROMPT.md -m "v2: added examples"
prompt-lock diff refactor-prompt          # what changed since last snapshot?
prompt-lock rollback refactor-prompt@3    # oops, restore version 3
prompt-lock export refactor-prompt --out share.json   # send to a teammate
```

## Install

Requires Node >= 20. No runtime dependencies.

```bash
git clone https://github.com/fuleinist/prompt-lock
cd prompt-lock
npm install
npm run build
npm link        # gives you `prompt-lock` (and `plk`) on your PATH
```

## Quick start

```bash
cd my-project
prompt-lock init                          # creates .prompt-lock/
prompt-lock save review --text "Review this diff for security issues..." -m "first draft"
# ... iterate on the prompt in your editor ...
prompt-lock save review --file review-prompt.md -m "added OWASP checklist"
prompt-lock list
prompt-lock diff review                   # previous version vs head
prompt-lock history review
```

Prefer one store for everything? Use `--global` (`~/.prompt-lock`) or point at any directory with `--store <dir>`.

## Commands

### `init`

Create a store in the current directory (`.prompt-lock/`).

```bash
prompt-lock init [--global] [--store <dir>] [--force]
```

Idempotent-safe: fails if a store exists unless `--force` (which validates the existing store instead of clobbering it).

### `save <name>`

Snapshot a prompt as a new version. Content comes from `--file`, `--text`, or stdin:

```bash
prompt-lock save deploy --text "You are a release engineer..." -m "initial"
prompt-lock save deploy --file prompts/deploy.md -m "tightened rollback rules"
cat PROMPT.md | prompt-lock save deploy -m "from pipe"
```

A save whose content is byte-identical to head is a no-op (use `--force` to record it anyway).

### `list` / `ls`

```bash
prompt-lock list          # table: name, versions, head, message, tags, updated
prompt-lock list --json   # machine-readable
```

### `show <name[@version]>`

Print a version's content. Selectors: `@3`, `@latest`, `@tag:release`.

```bash
prompt-lock show deploy          # head
prompt-lock show deploy@2        # version 2
prompt-lock show deploy@tag:release
```

### `history <name>` / `log`

Version log with timestamps, sizes, tags, messages. `--json` supported.

### `diff <name[@a]> [@b]`

Unified line diff between two versions (default: previous vs head). ANSI colors on TTYs; `--no-color` and `-u <N>` (context lines) available.

```bash
prompt-lock diff deploy                # @head~1 vs @head
prompt-lock diff deploy@1 @3
prompt-lock diff deploy@tag:release    # release vs head
```

Exit codes: `0` identical, `1` differences — script-friendly for CI checks like "did the prompt drift?".

### `rollback <name[@version]>`

Restore an old version **non-destructively**: the restored content becomes a new head version, and every previous version remains reachable.

```bash
prompt-lock rollback deploy@2 -m "reverting to the version that worked"
```

### `tag`

Pin meaningful names to versions. Tags are unique per prompt and usable as `@tag:` selectors.

```bash
prompt-lock tag deploy@3 release
prompt-lock tag deploy hotfix          # tags head
prompt-lock tag --delete deploy release
```

### `export` / `import`

Share prompts as portable single-file JSON bundles (all versions + tags + metadata).

```bash
prompt-lock export deploy --out deploy-bundle.json
prompt-lock export deploy@3            # single version, to stdout

prompt-lock import deploy-bundle.json          # into current store
prompt-lock import deploy-bundle.json --force  # overwrite existing prompt
```

Content hashes are recomputed on import; identical content always yields identical shas.

### `rm <name>`

Remove a prompt from the index. Content files are moved to `.prompt-lock/trash/` — nothing is ever truly deleted.

## Storage layout

Everything lives in one directory you can commit to git, back up, or sync:

```
.prompt-lock/
  store.json            # index: prompts, versions, tags, head pointers
  prompts/<name>/<id>.md  # immutable content per version
  trash/                # removed prompts (recoverable)
```

Writes are atomic (temp file + rename). A corrupt `store.json` produces a clear error message, never a stack trace.

## Typical workflow with AI coding tools

1. Keep your battle-tested prompts in `prompts/` as files, snapshotted with `prompt-lock save <name> --file ...`.
2. Before editing a prompt, you don't need to remember anything — every save is versioned.
3. `prompt-lock diff <name>` in CI or a git hook to detect prompt drift.
4. Tag known-good versions (`@tag:stable`) and roll back instantly when a new prompt regresses.
5. `export` bundles to share prompts with teammates without a server.

## Development

```bash
npm install
npm run build      # tsc --strict, zero deps
npm test           # builds, then runs node:test end-to-end CLI tests (27 tests)
```

See [SPEC.md](SPEC.md) for the full specification and acceptance criteria.

## License

MIT

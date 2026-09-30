import { test, describe, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', 'cli.js');

const tmpDirs: string[] = [];

function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plk-test-'));
  tmpDirs.push(d);
  return d;
}

after(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

function run(cwd: string, args: string[], input?: string): RunResult {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

let cwd = '';

beforeEach(() => {
  cwd = mkTmp();
});

describe('init (F1)', () => {
  test('creates store', () => {
    const r = run(cwd, ['init']);
    assert.equal(r.code, 0);
    assert.match(r.out, /initialized/);
    assert.ok(fs.existsSync(path.join(cwd, '.prompt-lock', 'store.json')));
    assert.ok(fs.existsSync(path.join(cwd, '.prompt-lock', 'prompts')));
    assert.ok(fs.existsSync(path.join(cwd, '.prompt-lock', 'trash')));
  });

  test('double init fails without --force', () => {
    run(cwd, ['init']);
    const r = run(cwd, ['init']);
    assert.equal(r.code, 1);
    assert.match(r.err, /already exists/);
  });

  test('--force keeps existing store valid', () => {
    run(cwd, ['init']);
    const r = run(cwd, ['init', '--force']);
    assert.equal(r.code, 0);
    assert.match(r.out, /store OK/);
  });
});

describe('save/list/show (F2-F4)', () => {
  test('save from --text, list, show round-trip', () => {
    run(cwd, ['init']);
    const r = run(cwd, ['save', 'greeting', '--text', 'hello v1', '-m', 'first']);
    assert.equal(r.code, 0);
    assert.match(r.out, /saved "greeting" @1 — first/);

    const list = run(cwd, ['list']);
    assert.equal(list.code, 0);
    assert.match(list.out, /greeting/);
    assert.match(list.out, /first/);

    const show = run(cwd, ['show', 'greeting']);
    assert.equal(show.code, 0);
    assert.equal(show.out, 'hello v1\n');
  });

  test('save from --file', () => {
    run(cwd, ['init']);
    const f = path.join(cwd, 'p.md');
    fs.writeFileSync(f, 'file content');
    const r = run(cwd, ['save', 'fromfile', '--file', f]);
    assert.equal(r.code, 0);
    assert.equal(run(cwd, ['show', 'fromfile']).out, 'file content\n');
  });

  test('save from stdin', () => {
    run(cwd, ['init']);
    const r = run(cwd, ['save', 'piped'], 'stdin content');
    assert.equal(r.code, 0, r.err);
    assert.equal(run(cwd, ['show', 'piped']).out, 'stdin content\n');
  });

  test('identical save is a no-op unless --force', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'same']);
    const r = run(cwd, ['save', 'p', '--text', 'same']);
    assert.equal(r.code, 0);
    assert.match(r.out, /no changes/);
    const forced = run(cwd, ['save', 'p', '--text', 'same', '--force']);
    assert.match(forced.out, /saved "p" @2/);
  });

  test('show specific version and @latest', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'v1']);
    run(cwd, ['save', 'p', '--text', 'v2']);
    assert.equal(run(cwd, ['show', 'p@1']).out, 'v1\n');
    assert.equal(run(cwd, ['show', 'p@latest']).out, 'v2\n');
    assert.equal(run(cwd, ['show', 'p']).out, 'v2\n');
  });

  test('invalid prompt name rejected', () => {
    run(cwd, ['init']);
    const r = run(cwd, ['save', 'bad name!', '--text', 'x']);
    assert.equal(r.code, 1);
    assert.match(r.err, /invalid prompt name/);
  });

  test('unknown prompt error is friendly', () => {
    run(cwd, ['init']);
    const r = run(cwd, ['show', 'nope']);
    assert.equal(r.code, 1);
    assert.match(r.err, /unknown prompt "nope"/);
  });

  test('list --json parses', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'x']);
    const r = run(cwd, ['list', '--json']);
    const data = JSON.parse(r.out);
    assert.equal(data[0].name, 'p');
    assert.equal(data[0].versions, '1');
  });
});

describe('history (F5)', () => {
  test('lists versions with messages', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'a', '-m', 'first']);
    run(cwd, ['save', 'p', '--text', 'b', '-m', 'second']);
    const r = run(cwd, ['history', 'p']);
    assert.equal(r.code, 0);
    assert.match(r.out, /first/);
    assert.match(r.out, /second/);
    assert.match(r.out, /\(head\)/);
    const j = run(cwd, ['history', 'p', '--json']);
    const data = JSON.parse(j.out);
    assert.equal(data.versions.length, 2);
    assert.equal(data.head, 2);
  });
});

describe('diff (F6)', () => {
  test('default diff: previous vs head, exit 1 on change', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'line1\nline2\nline3']);
    run(cwd, ['save', 'p', '--text', 'line1\nCHANGED\nline3']);
    const r = run(cwd, ['diff', 'p', '--no-color']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^--- p@1$/m);
    assert.match(r.out, /^\+\+\+ p@2$/m);
    assert.match(r.out, /^-line2$/m);
    assert.match(r.out, /^\+CHANGED$/m);
    assert.match(r.out, /^@@ /m);
  });

  test('explicit versions diff', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'one']);
    run(cwd, ['save', 'p', '--text', 'two']);
    run(cwd, ['save', 'p', '--text', 'three']);
    const r = run(cwd, ['diff', 'p@1', '@3', '--no-color']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^-one$/m);
    assert.match(r.out, /^\+three$/m);
  });

  test('identical versions: exit 0', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'same']);
    const r = run(cwd, ['diff', 'p@1', '@1']);
    assert.equal(r.code, 0);
    assert.match(r.out, /no differences/);
  });

  test('single version: nothing to diff', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'only']);
    const r = run(cwd, ['diff', 'p']);
    assert.equal(r.code, 0);
    assert.match(r.out, /nothing to diff/);
  });
});

describe('rollback (F7) — AC3', () => {
  test('full round-trip: save, save, diff, rollback, content restored', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'original content', '-m', 'v1']);
    run(cwd, ['save', 'p', '--text', 'broken change', '-m', 'v2']);
    const d = run(cwd, ['diff', 'p', '--no-color']);
    assert.equal(d.code, 1);
    const rb = run(cwd, ['rollback', 'p@1']);
    assert.equal(rb.code, 0);
    assert.match(rb.out, /rolled back "p" to @1 \(new head @3\)/);
    assert.equal(run(cwd, ['show', 'p']).out, 'original content\n');
    // non-destructive: old versions still there
    assert.equal(run(cwd, ['show', 'p@2']).out, 'broken change\n');
    const h = JSON.parse(run(cwd, ['history', 'p', '--json']).out);
    assert.equal(h.versions.length, 3);
    assert.equal(h.head, 3);
  });

  test('rollback of head fails', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'x']);
    run(cwd, ['save', 'p', '--text', 'y']);
    const r = run(cwd, ['rollback', 'p@2']);
    assert.equal(r.code, 1);
    assert.match(r.err, /already head/);
  });
});

describe('tag (F8)', () => {
  test('tag, resolve via @tag:, delete', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'v1']);
    run(cwd, ['save', 'p', '--text', 'v2']);
    const t = run(cwd, ['tag', 'p@1', 'release']);
    assert.equal(t.code, 0);
    assert.match(t.out, /tagged p@1 as "release"/);
    assert.equal(run(cwd, ['show', 'p@tag:release']).out, 'v1\n');
    // clash rejected
    const clash = run(cwd, ['tag', 'p@2', 'release']);
    assert.equal(clash.code, 1);
    assert.match(clash.err, /already exists/);
    // delete then re-tag
    const del = run(cwd, ['tag', '--delete', 'p@1', 'release']);
    assert.equal(del.code, 0);
    const missing = run(cwd, ['show', 'p@tag:release']);
    assert.equal(missing.code, 1);
    const retag = run(cwd, ['tag', 'p@2', 'release']);
    assert.equal(retag.code, 0);
    assert.equal(run(cwd, ['show', 'p@tag:release']).out, 'v2\n');
  });
});

describe('export/import (F9) — AC4', () => {
  test('bundle round-trip preserves content and tags', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'alpha', '-m', 'one']);
    run(cwd, ['save', 'p', '--text', 'beta', '-m', 'two']);
    run(cwd, ['tag', 'p@1', 'stable']);
    const bundlePath = path.join(cwd, 'bundle.json');
    const ex = run(cwd, ['export', 'p', '--out', bundlePath]);
    assert.equal(ex.code, 0);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
    assert.equal(bundle.tool, 'prompt-lock');
    assert.equal(bundle.versions.length, 2);

    const cwd2 = mkTmp();
    run(cwd2, ['init']);
    const im = run(cwd2, ['import', bundlePath]);
    assert.equal(im.code, 0, im.err);
    assert.match(im.out, /imported "p" \(2 version\(s\)\)/);
    assert.equal(run(cwd2, ['show', 'p@1']).out, 'alpha\n');
    assert.equal(run(cwd2, ['show', 'p']).out, 'beta\n');
    assert.equal(run(cwd2, ['show', 'p@tag:stable']).out, 'alpha\n');
    // sha match: exported sha equals recomputed sha in new store
    const h1 = JSON.parse(run(cwd, ['history', 'p', '--json']).out);
    const h2 = JSON.parse(run(cwd2, ['history', 'p', '--json']).out);
    assert.deepEqual(
      h1.versions.map((v: { sha256: string }) => v.sha256),
      h2.versions.map((v: { sha256: string }) => v.sha256),
    );
  });

  test('import refuses to clobber without --force', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'local']);
    const bundlePath = path.join(cwd, 'b.json');
    run(cwd, ['export', 'p', '--out', bundlePath]);
    const cwd2 = mkTmp();
    run(cwd2, ['init']);
    run(cwd2, ['save', 'p', '--text', 'existing']);
    const r = run(cwd2, ['import', bundlePath]);
    assert.equal(r.code, 1);
    assert.match(r.err, /already exists/);
    const f = run(cwd2, ['import', bundlePath, '--force']);
    assert.equal(f.code, 0);
    assert.equal(run(cwd2, ['show', 'p']).out, 'local\n');
  });

  test('export to stdout is valid JSON', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'x']);
    const r = run(cwd, ['export', 'p']);
    const bundle = JSON.parse(r.out);
    assert.equal(bundle.name, 'p');
  });
});

describe('rm (F10)', () => {
  test('removes prompt, files go to trash', () => {
    run(cwd, ['init']);
    run(cwd, ['save', 'p', '--text', 'doomed']);
    const r = run(cwd, ['rm', 'p']);
    assert.equal(r.code, 0);
    assert.equal(run(cwd, ['show', 'p']).code, 1);
    const trash = fs.readdirSync(path.join(cwd, '.prompt-lock', 'trash'));
    assert.equal(trash.length, 1);
    assert.match(trash[0], /^p-\d+$/);
    const files = fs.readdirSync(path.join(cwd, '.prompt-lock', 'trash', trash[0]));
    assert.ok(files.includes('1.md'));
  });
});

describe('store robustness — AC5', () => {
  test('corrupt store.json gives clean error, no stack trace', () => {
    run(cwd, ['init']);
    fs.writeFileSync(path.join(cwd, '.prompt-lock', 'store.json'), '{not json');
    const r = run(cwd, ['list']);
    assert.equal(r.code, 1);
    assert.match(r.err, /corrupt/);
    assert.ok(!r.err.includes('    at '), 'should not print a stack trace');
  });

  test('missing store gives friendly init hint', () => {
    const r = run(cwd, ['list']);
    assert.equal(r.code, 1);
    assert.match(r.err, /run `prompt-lock init`/);
  });
});

describe('global flags', () => {
  test('--store uses explicit dir', () => {
    const storeDir = path.join(cwd, 'custom-store');
    const r = run(cwd, ['init', '--store', storeDir]);
    assert.equal(r.code, 0);
    assert.ok(fs.existsSync(path.join(storeDir, 'store.json')));
    run(cwd, ['save', 'p', '--text', 'x', '--store', storeDir]);
    assert.equal(run(cwd, ['show', 'p', '--store', storeDir]).out, 'x\n');
  });

  test('--version and --help', () => {
    const v = run(cwd, ['--version']);
    assert.equal(v.code, 0);
    assert.match(v.out, /^\d+\.\d+\.\d+/);
    const h = run(cwd, ['--help']);
    assert.match(h.out, /Usage:/);
    const u = run(cwd, ['bogus']);
    assert.equal(u.code, 1);
    assert.match(u.err, /unknown command/);
  });
});

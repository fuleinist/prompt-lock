#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  PLError,
  NAME_RE,
  resolveStoreRoot,
  loadStore,
  saveStore,
  sha256,
  atomicWrite,
  contentPath,
  readContent,
} from './store.js';
import { parseSelector, getPrompt, resolveVersion } from './selector.js';
import { diffLines } from './diff.js';
import type { Bundle, StoreFile, VersionRecord } from './types.js';

const VERSION = '0.1.0';

const HELP = `prompt-lock — git for your AI prompts

Usage:
  prompt-lock <command> [args] [flags]

Commands:
  init                              Create a .prompt-lock store in the current directory
  save <name> [--file <p> | --text <s> | stdin] [-m msg]
                                    Snapshot a prompt (new version)
  list [--json]                     List all prompts
  show <name[@version]>             Print a prompt version (default: head)
  history <name> [--json]           Version log for a prompt
  diff <name[@a]> [@b] [-u N]       Unified diff between versions (default: previous vs head)
  rollback <name[@version]> [-m msg]
                                    Restore an old version as the new head (non-destructive)
  tag <name[@version]> <tag>        Tag a version
  tag --delete <name[@version]> <tag>
                                    Remove a tag
  export <name> [--out <file>]      Export a portable bundle (JSON)
  import <bundle-file> [--force]    Import a bundle
  rm <name>                         Remove a prompt (recoverable from trash/)

Version selectors: @3, @latest, @tag:release

Flags:
  --global        Use ~/.prompt-lock instead of ./.prompt-lock
  --store <dir>   Use an explicit store directory
  --no-color      Disable colored diff output
  --json          Machine-readable output (list, history)
  -h, --help      Show help
  -V, --version   Show version
`;

const VALUE_FLAGS = new Set([
  'm',
  'message',
  'file',
  'text',
  'store',
  'out',
  'u',
  'context',
]);

interface Parsed {
  pos: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Parsed {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (VALUE_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[k] = argv[++i];
      } else {
        flags[k] = true;
      }
    } else if (a.startsWith('-') && a.length > 1) {
      const k = a.slice(1);
      if (VALUE_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        flags[k] = argv[++i];
      } else {
        flags[k] = true;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exitCode = 1;
  throw new ExitError();
}

class ExitError extends Error {}

function str(flags: Record<string, string | boolean>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = flags[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function nextId(versions: VersionRecord[]): number {
  return versions.reduce((mx, v) => Math.max(mx, v.id), 0) + 1;
}

function printTable(rows: Record<string, string>[]): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => (r[c] ?? '').length)),
  );
  const line = (vals: string[]): string =>
    vals.map((v, i) => (v ?? '').padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(cols.map((c) => c.toUpperCase())));
  for (const r of rows) console.log(line(cols.map((c) => r[c] ?? '')));
}

function ctxRoot(flags: Record<string, string | boolean>): string {
  return resolveStoreRoot({
    global: flags.global === true,
    store: str(flags, 'store'),
  });
}

function ensureMsg(content: string): string {
  return content.endsWith('\n') ? content : content + '\n';
}

// ---------- commands ----------

function cmdInit(flags: Parsed['flags']): void {
  const root = ctxRoot(flags);
  const storeFile = path.join(root, 'store.json');
  if (fs.existsSync(storeFile)) {
    if (flags.force !== true) {
      fail(`store already exists at ${root} (use --force to keep it and re-check)`);
    }
    loadStore(root); // validates; throws friendly error if corrupt
    console.log(`store OK at ${root}`);
    return;
  }
  fs.mkdirSync(path.join(root, 'prompts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'trash'), { recursive: true });
  const store: StoreFile = { schema: 1, prompts: {} };
  saveStore(root, store);
  console.log(`initialized prompt-lock store at ${root}`);
}

function cmdSave(pos: string[], flags: Parsed['flags'], root: string): void {
  const name = pos[0];
  if (!name) fail('usage: save <name> (--file <p> | --text <s> | stdin) [-m msg]');
  if (!NAME_RE.test(name)) {
    fail(`invalid prompt name "${name}" (allowed: letters, digits, dot, dash, underscore; 1-64 chars)`);
  }
  const file = str(flags, 'file');
  const text = str(flags, 'text');
  let content: string;
  if (file !== undefined) {
    try {
      content = fs.readFileSync(path.resolve(file), 'utf8');
    } catch {
      fail(`cannot read file: ${file}`);
    }
  } else if (text !== undefined) {
    content = text;
  } else if (!process.stdin.isTTY) {
    content = fs.readFileSync(0, 'utf8');
  } else {
    fail('no content: pass --file <p>, --text <s>, or pipe via stdin');
  }
  const message = str(flags, 'm', 'message') ?? '';
  const store = loadStore(root);
  const hash = sha256(content);
  let entry = store.prompts[name];
  if (entry) {
    const head = entry.versions.find((v) => v.id === entry.head);
    if (head && head.sha256 === hash && flags.force !== true) {
      console.log(`no changes to "${name}" (identical to @${head.id}) — use --force to save anyway`);
      return;
    }
  } else {
    entry = { head: 0, versions: [] };
    store.prompts[name] = entry;
  }
  const id = nextId(entry.versions);
  const v: VersionRecord = {
    id,
    message,
    createdAt: new Date().toISOString(),
    sha256: hash,
    size: Buffer.byteLength(content, 'utf8'),
    tags: [],
  };
  fs.mkdirSync(path.join(root, 'prompts', name), { recursive: true });
  atomicWrite(contentPath(root, name, id), content);
  entry.versions.push(v);
  entry.head = id;
  saveStore(root, store);
  console.log(`saved "${name}" @${id}${message ? ` — ${message}` : ''}`);
}

function promptSummary(name: string, e: { head: number; versions: VersionRecord[] }): Record<string, string> {
  const head = e.versions.find((v) => v.id === e.head) ?? e.versions[e.versions.length - 1];
  return {
    name,
    versions: String(e.versions.length),
    head: `@${e.head}`,
    message: head?.message || '-',
    tags: head && head.tags.length > 0 ? head.tags.join(',') : '-',
    updated: head?.createdAt ?? '-',
  };
}

function cmdList(flags: Parsed['flags'], root: string): void {
  const store = loadStore(root);
  const names = Object.keys(store.prompts).sort();
  if (flags.json === true) {
    console.log(JSON.stringify(names.map((n) => promptSummary(n, store.prompts[n])), null, 2));
    return;
  }
  if (names.length === 0) {
    console.log('no prompts yet — save one with: prompt-lock save <name> --text "..."');
    return;
  }
  printTable(names.map((n) => promptSummary(n, store.prompts[n])));
}

function cmdShow(pos: string[], root: string): void {
  if (!pos[0]) fail('usage: show <name[@version]>');
  const { name, spec } = parseSelector(pos[0]);
  const store = loadStore(root);
  const entry = getPrompt(store, name);
  const v = resolveVersion(entry, spec);
  process.stdout.write(ensureMsg(readContent(root, name, v)));
}

function cmdHistory(pos: string[], flags: Parsed['flags'], root: string): void {
  const name = pos[0];
  if (!name) fail('usage: history <name> [--json]');
  const store = loadStore(root);
  const entry = getPrompt(store, name);
  if (flags.json === true) {
    console.log(JSON.stringify({ name, head: entry.head, versions: entry.versions }, null, 2));
    return;
  }
  printTable(
    entry.versions.map((v) => ({
      version: `@${v.id}${v.id === entry.head ? ' (head)' : ''}`,
      created: v.createdAt,
      size: String(v.size),
      tags: v.tags.length > 0 ? v.tags.join(',') : '-',
      message: v.message || '-',
    })),
  );
}

function parseCtxLines(flags: Parsed['flags']): number {
  const raw = str(flags, 'u', 'context');
  if (raw === undefined) return 3;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) fail(`invalid context line count: ${raw}`);
  return n;
}

function cmdDiff(pos: string[], flags: Parsed['flags'], root: string): void {
  if (!pos[0]) fail('usage: diff <name[@a]> [@b] [-u N] [--no-color]');
  const { name, spec } = parseSelector(pos[0]);
  const store = loadStore(root);
  const entry = getPrompt(store, name);
  let bSpec: string | undefined;
  if (pos[1]) {
    bSpec = pos[1].startsWith('@') ? pos[1].slice(1) || undefined : parseSelector(pos[1]).spec;
  }
  const b = resolveVersion(entry, bSpec);
  let a: VersionRecord;
  if (spec !== undefined) {
    a = resolveVersion(entry, spec);
  } else {
    const idx = entry.versions.findIndex((v) => v.id === b.id);
    if (idx <= 0) {
      console.log(`nothing to diff: "${name}" has only @${b.id}`);
      return;
    }
    a = entry.versions[idx - 1];
  }
  const ca = readContent(root, name, a);
  const cb = readContent(root, name, b);
  const color = flags['no-color'] !== true && process.stdout.isTTY === true;
  const { text, changed } = diffLines(ca, cb, { context: parseCtxLines(flags), color });
  if (!changed) {
    console.log(`no differences between ${name}@${a.id} and ${name}@${b.id}`);
    return;
  }
  console.log(`--- ${name}@${a.id}`);
  console.log(`+++ ${name}@${b.id}`);
  process.stdout.write(text);
  process.exitCode = 1;
}

function cmdRollback(pos: string[], flags: Parsed['flags'], root: string): void {
  if (!pos[0]) fail('usage: rollback <name[@version]> [-m msg]');
  const { name, spec } = parseSelector(pos[0]);
  const store = loadStore(root);
  const entry = getPrompt(store, name);
  const target = resolveVersion(entry, spec);
  if (target.id === entry.head) {
    fail(`@${target.id} is already head — nothing to roll back`);
  }
  const content = readContent(root, name, target);
  const id = nextId(entry.versions);
  const message = str(flags, 'm', 'message') ?? `rollback to @${target.id}`;
  const v: VersionRecord = {
    id,
    message,
    createdAt: new Date().toISOString(),
    sha256: sha256(content),
    size: Buffer.byteLength(content, 'utf8'),
    tags: [],
  };
  atomicWrite(contentPath(root, name, id), content);
  entry.versions.push(v);
  entry.head = id;
  saveStore(root, store);
  console.log(`rolled back "${name}" to @${target.id} (new head @${id})`);
}

function cmdTag(pos: string[], flags: Parsed['flags'], root: string): void {
  const deleting = flags.delete === true || flags.d === true;
  const sel = pos[0];
  const tag = pos[1];
  if (!sel || typeof tag !== 'string' || tag.length === 0) {
    fail(deleting ? 'usage: tag --delete <name[@version]> <tag>' : 'usage: tag <name[@version]> <tag>');
  }
  if (!NAME_RE.test(tag)) {
    fail(`invalid tag name "${tag}" (allowed: letters, digits, dot, dash, underscore; 1-64 chars)`);
  }
  const { name, spec } = parseSelector(sel);
  const store = loadStore(root);
  const entry = getPrompt(store, name);
  const v = resolveVersion(entry, spec);
  if (deleting) {
    if (!v.tags.includes(tag)) fail(`"${name}" @${v.id} is not tagged "${tag}"`);
    v.tags = v.tags.filter((t) => t !== tag);
    saveStore(root, store);
    console.log(`removed tag "${tag}" from ${name}@${v.id}`);
  } else {
    if (v.tags.includes(tag)) {
      console.log(`${name}@${v.id} is already tagged "${tag}"`);
      return;
    }
    const clash = entry.versions.find((x) => x.tags.includes(tag));
    if (clash) fail(`tag "${tag}" already exists on ${name}@${clash.id} — delete it first`);
    v.tags.push(tag);
    saveStore(root, store);
    console.log(`tagged ${name}@${v.id} as "${tag}"`);
  }
}

function cmdExport(pos: string[], flags: Parsed['flags'], root: string): void {
  if (!pos[0]) fail('usage: export <name[@version]> [--out <file>]');
  const { name, spec } = parseSelector(pos[0]);
  const store = loadStore(root);
  const entry = getPrompt(store, name);
  const versions = spec !== undefined ? [resolveVersion(entry, spec)] : entry.versions;
  const bundle: Bundle = {
    tool: 'prompt-lock',
    schema: 1,
    name,
    exportedAt: new Date().toISOString(),
    versions: versions.map((v) => ({ ...v, content: readContent(root, name, v) })),
  };
  const json = JSON.stringify(bundle, null, 2) + '\n';
  const out = str(flags, 'out');
  if (out !== undefined) {
    atomicWrite(path.resolve(out), json);
    console.log(`exported "${name}" (${versions.length} version(s)) to ${out}`);
  } else {
    process.stdout.write(json);
  }
}

function cmdImport(pos: string[], flags: Parsed['flags'], root: string): void {
  const file = pos[0];
  if (!file) fail('usage: import <bundle-file> [--force]');
  let raw: string;
  try {
    raw = fs.readFileSync(path.resolve(file), 'utf8');
  } catch {
    fail(`cannot read bundle: ${file}`);
  }
  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch {
    fail('bundle is not valid JSON');
  }
  if (
    !bundle ||
    bundle.tool !== 'prompt-lock' ||
    bundle.schema !== 1 ||
    typeof bundle.name !== 'string' ||
    !Array.isArray(bundle.versions) ||
    bundle.versions.length === 0
  ) {
    fail('not a valid prompt-lock bundle');
  }
  const name = bundle.name;
  if (!NAME_RE.test(name)) fail(`bundle prompt name invalid: "${name}"`);
  const store = loadStore(root);
  if (store.prompts[name] && flags.force !== true) {
    fail(`prompt "${name}" already exists in this store — use --force to overwrite`);
  }
  fs.mkdirSync(path.join(root, 'prompts', name), { recursive: true });
  const versions: VersionRecord[] = [];
  let id = 0;
  for (const bv of bundle.versions) {
    if (typeof bv.content !== 'string') fail(`bundle version #${id + 1} has no content`);
    id++;
    const content = bv.content;
    const v: VersionRecord = {
      id,
      message: typeof bv.message === 'string' ? bv.message : '',
      createdAt: typeof bv.createdAt === 'string' ? bv.createdAt : new Date().toISOString(),
      sha256: sha256(content),
      size: Buffer.byteLength(content, 'utf8'),
      tags: Array.isArray(bv.tags) ? bv.tags.filter((t) => typeof t === 'string') : [],
    };
    atomicWrite(contentPath(root, name, id), content);
    versions.push(v);
  }
  store.prompts[name] = { head: id, versions };
  saveStore(root, store);
  console.log(`imported "${name}" (${versions.length} version(s))`);
}

function cmdRm(pos: string[], root: string): void {
  const name = pos[0];
  if (!name) fail('usage: rm <name>');
  const store = loadStore(root);
  if (!store.prompts[name]) fail(`unknown prompt "${name}"`);
  delete store.prompts[name];
  saveStore(root, store);
  const src = path.join(root, 'prompts', name);
  if (fs.existsSync(src)) {
    const dest = path.join(root, 'trash', `${name}-${Date.now()}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
  }
  console.log(`removed "${name}" (files kept in trash/ for recovery)`);
}

// ---------- main ----------

function main(argv: string[]): void {
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0];
  const rest = pos.slice(1);

  if (flags.version === true || flags.V === true || cmd === 'version' || cmd === '--version') {
    console.log(VERSION);
    return;
  }
  if (flags.help === true || flags.h === true || cmd === undefined || cmd === 'help') {
    console.log(HELP);
    return;
  }

  try {
    if (cmd === 'init') {
      cmdInit(flags);
      return;
    }
    const root = ctxRoot(flags);
    switch (cmd) {
      case 'save':
        cmdSave(rest, flags, root);
        break;
      case 'list':
      case 'ls':
        cmdList(flags, root);
        break;
      case 'show':
      case 'cat':
        cmdShow(rest, root);
        break;
      case 'history':
      case 'log':
        cmdHistory(rest, flags, root);
        break;
      case 'diff':
        cmdDiff(rest, flags, root);
        break;
      case 'rollback':
      case 'revert':
        cmdRollback(rest, flags, root);
        break;
      case 'tag':
        cmdTag(rest, flags, root);
        break;
      case 'export':
        cmdExport(rest, flags, root);
        break;
      case 'import':
        cmdImport(rest, flags, root);
        break;
      case 'rm':
      case 'remove':
        cmdRm(rest, root);
        break;
      default:
        fail(`unknown command "${cmd}" — run \`prompt-lock --help\``);
    }
  } catch (e) {
    if (e instanceof ExitError) return;
    if (e instanceof PLError) {
      console.error(`error: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

main(process.argv.slice(2));

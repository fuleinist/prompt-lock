import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StoreFile, VersionRecord } from './types.js';

export const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export class PLError extends Error {}

export interface StoreOpts {
  global?: boolean;
  store?: string;
}

export function resolveStoreRoot(opts: StoreOpts): string {
  if (typeof opts.store === 'string' && opts.store.length > 0) {
    return path.resolve(opts.store);
  }
  if (opts.global) {
    return path.join(os.homedir(), '.prompt-lock');
  }
  return path.join(process.cwd(), '.prompt-lock');
}

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function atomicWrite(file: string, data: string): void {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadStore(root: string): StoreFile {
  const file = path.join(root, 'store.json');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new PLError(
        `no prompt-lock store at ${root} — run \`prompt-lock init\` first`,
      );
    }
    throw e;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new PLError(`store is corrupt: ${file} is not valid JSON`);
  }
  if (
    !data ||
    typeof data !== 'object' ||
    (data as StoreFile).schema !== 1 ||
    typeof (data as StoreFile).prompts !== 'object' ||
    (data as StoreFile).prompts === null
  ) {
    throw new PLError(`store is corrupt or has an unsupported schema: ${file}`);
  }
  return data as StoreFile;
}

export function saveStore(root: string, store: StoreFile): void {
  atomicWrite(path.join(root, 'store.json'), JSON.stringify(store, null, 2) + '\n');
}

export function contentPath(root: string, name: string, id: number): string {
  return path.join(root, 'prompts', name, `${id}.md`);
}

export function readContent(root: string, name: string, v: VersionRecord): string {
  try {
    return fs.readFileSync(contentPath(root, name, v.id), 'utf8');
  } catch {
    throw new PLError(
      `content file missing for "${name}" @${v.id} — store may be damaged`,
    );
  }
}

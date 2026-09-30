import { PLError, NAME_RE } from './store.js';
import type { PromptEntry, StoreFile, VersionRecord } from './types.js';

export interface Selector {
  name: string;
  spec: string | undefined;
}

export function parseSelector(arg: string): Selector {
  const i = arg.indexOf('@');
  if (i < 0) return { name: arg, spec: undefined };
  const name = arg.slice(0, i);
  const spec = arg.slice(i + 1);
  return { name, spec: spec.length > 0 ? spec : undefined };
}

export function getPrompt(store: StoreFile, name: string): PromptEntry {
  if (!NAME_RE.test(name)) {
    throw new PLError(
      `invalid prompt name "${name}" (allowed: letters, digits, dot, dash, underscore; 1-64 chars)`,
    );
  }
  const entry = store.prompts[name];
  if (!entry) throw new PLError(`unknown prompt "${name}"`);
  return entry;
}

export function resolveVersion(
  entry: PromptEntry,
  spec: string | undefined,
): VersionRecord {
  if (spec === undefined || spec === 'latest' || spec === 'head') {
    const head = entry.versions.find((v) => v.id === entry.head);
    if (!head) throw new PLError('prompt has no versions');
    return head;
  }
  if (spec.startsWith('tag:')) {
    const tag = spec.slice(4);
    const v = entry.versions.find((x) => x.tags.includes(tag));
    if (!v) throw new PLError(`no version tagged "${tag}"`);
    return v;
  }
  const id = Number(spec);
  if (!Number.isInteger(id) || id < 1) {
    throw new PLError(`bad version selector "@${spec}" (use @N, @latest, or @tag:name)`);
  }
  const v = entry.versions.find((x) => x.id === id);
  if (!v) throw new PLError(`no version @${id}`);
  return v;
}

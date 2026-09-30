export interface VersionRecord {
  id: number;
  message: string;
  createdAt: string;
  sha256: string;
  size: number;
  tags: string[];
}

export interface PromptEntry {
  head: number;
  versions: VersionRecord[];
}

export interface StoreFile {
  schema: number;
  prompts: Record<string, PromptEntry>;
}

export interface BundleVersion extends VersionRecord {
  content: string;
}

export interface Bundle {
  tool: string;
  schema: number;
  name: string;
  exportedAt: string;
  versions: BundleVersion[];
}

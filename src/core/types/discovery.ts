import type { FileHashEntry, ManagedFileHash, ManagedFileHashEntry, ResolvedSourceMeta, SkillEntry } from './manifest';

export interface SkillDefinition {
    name: string;
    description: string;
    path: string;
    sharedFiles: string[];
}

export interface ResolvedSource {
    ok: true;
    handler: string;
    provider: 'github';
    url: string;
    ref: string | null;
    subpath: string | null;
    webUrl: string;
}

export interface ResolveSourceFailure {
    ok: false;
    error: string;
}

export interface ListSkillsSuccess {
    ok: true;
    skills: string[];
    skillEntries: SkillEntry[];
    sharedFileHashes: FileHashEntry[];
    managedSharedFileHashes?: ManagedFileHashEntry[];
    aliasMap: Map<string, string>;
    resolved: ResolvedSourceMeta;
}

export interface FailureResult {
    ok: false;
    error: string;
    details?: string;
}

export interface SharedFileContentEntry {
    path: string;
    content: Buffer;
    executable: boolean;
}

export interface CollectSharedFilesSuccess {
    ok: true;
    files: SharedFileContentEntry[];
}

export interface SkillDirectoryFile {
    path: string;
    content: Buffer;
    executable: boolean;
}

export interface CollectedSkillDirectory {
    sourcePath: string;
    files: SkillDirectoryFile[];
}

export interface CollectSkillDirectoriesSuccess {
    ok: true;
    directories: CollectedSkillDirectory[];
}

export interface DiscoveredSourceMeta {
    mode: 'all' | 'explicit';
    listedAt: string;
    skills: string[];
    skillEntries: SkillEntry[];
    sharedFileHashes: FileHashEntry[];
    managedSharedFileHashes?: ManagedFileHashEntry[];
    subagents?: SubagentDefinition[];
    subagentSharedFiles?: SharedFileContentEntry[];
    missingRequested: string[];
    resolved: ResolvedSourceMeta;
}

export interface DiscoveredSources { [key: string]: DiscoveredSourceMeta }

export interface LocalSkill {
    name: string;
    path: string;
    dirName: string;
    sourcePath: string;
    sharedFiles: string[];
}

export interface SubagentDefinition {
    name: string;
    description: string | null;
    sourcePath: string;
    targetPath: string;
    sharedFiles: string[];
    content: Buffer;
    hash: ManagedFileHash;
}

export interface SubagentDiscoverySuccess {
    ok: true;
    subagents: SubagentDefinition[];
    sharedFiles: SharedFileContentEntry[];
}

export interface SourceDiscoverySuccess extends ListSkillsSuccess {
    listedAt: string;
    subagents: SubagentDefinition[];
    subagentSharedFiles: SharedFileContentEntry[];
}

import type { FileHashEntry, ResolvedSourceMeta, SkillEntry } from './manifest';

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
}

export interface CollectSharedFilesSuccess {
    ok: true;
    files: SharedFileContentEntry[];
}

export interface SkillDirectoryFile {
    path: string;
    content: Buffer;
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

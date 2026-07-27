export interface ManifestPublishConfig {
    branchPrefix: string | null;
    createPr: boolean | null;
}

export interface ManifestSourceEntry {
    source: string;
    skills: string[] | null;
    subagents?: string[] | null;
    publish: ManifestPublishConfig;
}

export interface ManifestData {
    agents: string[];
    subagents?: string[];
    sources: ManifestSourceEntry[];
}

export interface FileHashEntry {
    path: string;
    sha256: string;
}

export interface SkillTreeHash {
    treeSha256: string;
    files: FileHashEntry[];
}

export interface SkillEntry {
    name: string;
    sourcePath: string;
    sharedFiles: string[];
    hash: SkillTreeHash | null;
}

export interface ManagedFileHash {
    sha256: string;
    executable: boolean;
}

export interface ManagedFileHashEntry {
    path: string;
    hash: ManagedFileHash;
}

export interface SubagentEntry {
    name: string;
    sourcePath: string;
    targetPath: string;
    sharedFiles: string[];
    hash: ManagedFileHash;
}

export interface SharedEntry {
    sourcePath: string;
    targetPath: string;
    hash: ManagedFileHash;
    owners: string[];
}

export interface ResolvedSourceMeta {
    requestedRef: string | null;
    defaultBranch: string | null;
    resolvedRef: string | null;
    resolvedCommit: string | null;
    subpath: string | null;
    resolvedAt: string | null;
}

export interface LockSourceMeta {
    mode: string;
    listedAt: string | null;
    skillEntries: SkillEntry[];
    sharedFileHashes?: FileHashEntry[];
    subagentEntries?: SubagentEntry[];
    sharedEntries?: SharedEntry[];
    resolved: ResolvedSourceMeta;
}

export interface LockData {
    schemaVersion: number;
    agents: string[];
    subagents?: string[];
    sources: { [key: string]: LockSourceMeta };
}

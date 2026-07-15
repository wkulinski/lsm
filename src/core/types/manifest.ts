export interface ManifestPublishConfig {
    branchPrefix: string | null;
    createPr: boolean | null;
}

export interface ManifestSourceEntry {
    source: string;
    skills: string[] | null;
    publish: ManifestPublishConfig;
}

export interface ManifestData {
    agents: string[];
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
    sharedFileHashes: FileHashEntry[];
    resolved: ResolvedSourceMeta;
}

export interface LockData {
    schemaVersion: number;
    agents: string[];
    sources: { [key: string]: LockSourceMeta };
}

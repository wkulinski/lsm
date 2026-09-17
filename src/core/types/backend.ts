import type { ManagedSkillEntry } from './sync';
import type { CollectSharedFilesSuccess, CollectSkillDirectoriesSuccess, FailureResult, ListSkillsSuccess, ResolvedSource, SourceDiscoverySuccess } from './discovery';
import type { SkillEntry } from './manifest';

export type AgentProjectSkillDirsResult
    = | { ok: true; dirs: string[] }
        | { ok: false; error: string };

export interface BackendCommandSuccess {
    ok: true;
    status: 0;
    cmd: string[];
}

export interface BackendCommandFailure {
    ok: false;
    status: 1;
    cmd: string[];
    error: string;
    details?: unknown;
}

export type BackendCommandResult = BackendCommandSuccess | BackendCommandFailure;

export interface BackendVersionSuccess {
    ok: true;
    status: 0;
    stdout: string;
    stderr: '';
}

export interface BackendVersionFailure {
    ok: false;
    status: 1;
    stdout: '';
    stderr: string;
}

export type BackendVersionResult = BackendVersionSuccess | BackendVersionFailure;

export interface BackendLike {
    root: string;
    listSkills(source: string, options?: { includeInternal?: boolean; fullDepth?: boolean; resolvedCommit?: string | null }): ListSkillsSuccess | FailureResult;
    discoverSource?(source: string, options?: {
        skills?: string[] | null;
        subagents?: string[] | null;
        includePlugins?: boolean;
        mode?: 'update' | 'locked';
        resolvedCommit?: string | null;
        lockedSubagentEntries?: import('./manifest').SubagentEntry[];
    }): SourceDiscoverySuccess | FailureResult;
    resolveSource(source: string): ResolvedSource | FailureResult;
    collectSharedFiles(source: string, sharedFiles: string[], options?: { resolvedCommit?: string | null }): CollectSharedFilesSuccess | FailureResult;
    collectSkillDirectories?(source: string, skillSourcePaths: string[], options?: { resolvedCommit?: string | null }): CollectSkillDirectoriesSuccess | FailureResult;
    resolveAgentProjectSkillDirs(agents: string[]): AgentProjectSkillDirsResult;
    installSkillEntries(input: { source: string; skillEntries: SkillEntry[]; agents: string[]; resolvedCommit?: string | null }): BackendCommandResult;
    removeSkillEntries(input: { skillEntries: ManagedSkillEntry[]; agents: string[] }): BackendCommandResult;
    getVersion?(): BackendVersionResult;
}

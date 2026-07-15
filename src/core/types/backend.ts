import type { ManagedSkillEntry } from './sync';
import type { CollectSharedFilesSuccess, CollectSkillDirectoriesSuccess, FailureResult, ListSkillsSuccess, ResolvedSource } from './discovery';
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
    listSkills(source: string, options?: { includeInternal?: boolean; fullDepth?: boolean }): ListSkillsSuccess | FailureResult;
    resolveSource(source: string): ResolvedSource | FailureResult;
    collectSharedFiles(source: string, sharedFiles: string[]): CollectSharedFilesSuccess | FailureResult;
    collectSkillDirectories?(source: string, skillSourcePaths: string[]): CollectSkillDirectoriesSuccess | FailureResult;
    resolveAgentProjectSkillDirs(agents: string[]): AgentProjectSkillDirsResult;
    installSkillEntries(input: { source: string; skillEntries: SkillEntry[]; agents: string[] }): BackendCommandResult;
    removeSkillEntries(input: { skillEntries: ManagedSkillEntry[]; agents: string[] }): BackendCommandResult;
    getVersion?(): BackendVersionResult;
}

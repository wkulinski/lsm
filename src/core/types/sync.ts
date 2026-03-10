import type { ManagerEvent } from './events';
import type { ManagerErrorResult, ManagerHeader, ManagerTemplatesCreatedResult } from './manager';

type Reporter = (event: ManagerEvent) => void;

export interface SyncPlan {
    oldAgents: string[];
    newAgents: string[];
    agentsUnion: string[];
    agentsRemoved: string[];
    oldManaged: string[];
    newManaged: string[];
    skillsRemoved: string[];
}

export interface SyncPreflightConflict {
    path: string;
    reason: string;
    operation: string;
    scope: string;
    source: string | null;
    skill: string | null;
}

export interface SyncPreflight {
    ok: boolean;
    error?: string;
    conflicts: SyncPreflightConflict[];
}

export interface SyncInstallResult {
    source: string;
    ok: boolean;
    skipped?: boolean;
    status?: number;
    cmd?: string[];
}

export interface SharedSyncError {
    source?: string;
    message: string;
    details?: unknown;
}

export interface SharedSyncResult {
    sharedFailed: boolean;
    managedNewLocalPaths: Record<string, string[]>;
    sharedStats: Record<string, { declaredFiles: number; copiedFiles: number }>;
    sharedFileHashesBySource: Record<string, Array<{ path: string; sha256: string }>>;
    removedFiles?: number;
    errors: SharedSyncError[];
}

export interface SyncRemovalSummary {
    removedFromRemovedAgents: number;
    prunedSkills: number;
    removedAgents: string[];
    agentsUnion: string[];
    hadNothingToPrune: boolean;
}

export interface SyncConfirmationRequest {
    header: ManagerHeader;
    preflight: SyncPreflight;
    plan: SyncPlan;
}

export interface SyncCommandOptions {
    force?: boolean;
    report?: Reporter;
    confirmLocalChanges?: (input: SyncConfirmationRequest) => boolean | Promise<boolean>;
}

export interface SyncCancelledResult {
    status: 'cancelled';
    exitCode: 1;
    header: ManagerHeader;
    plan: SyncPlan;
    preflight: SyncPreflight;
}

export interface SyncAddFailedResult {
    status: 'add-failed';
    exitCode: 1;
    header: ManagerHeader;
    plan: SyncPlan;
    preflight: SyncPreflight;
    installs: SyncInstallResult[];
}

export interface SyncSharedFailedResult {
    status: 'shared-failed';
    exitCode: 1;
    header: ManagerHeader;
    plan: SyncPlan;
    preflight: SyncPreflight;
    installs: SyncInstallResult[];
    shared: SharedSyncResult;
}

export interface SyncCompletedResult {
    status: 'completed';
    exitCode: number;
    header: ManagerHeader;
    plan: SyncPlan;
    preflight: SyncPreflight;
    missingRequested: Array<{ source: string; skill: string }>;
    installs: SyncInstallResult[];
    shared: SharedSyncResult;
    removal: SyncRemovalSummary;
    lockWritten: boolean;
}

export type SyncCommandResult =
    | ManagerTemplatesCreatedResult
    | ManagerErrorResult
    | SyncCancelledResult
    | SyncAddFailedResult
    | SyncSharedFailedResult
    | SyncCompletedResult;

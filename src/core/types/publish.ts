import type { ManagerEvent } from './events';
import type { ManagerErrorResult, ManagerHeader, ManagerTemplatesCreatedResult } from './manager';

type Reporter = (event: ManagerEvent) => void;
type UnknownRecord = Record<string, unknown>;

export interface PublishCommandOptions {
    source?: string | null;
    newSkills?: string[];
    removeSkills?: string[];
    dryRun?: boolean;
    confirmDeletes?: boolean;
    message?: string | null;
    branch?: string | null;
    createPr?: boolean | null;
    title?: string | null;
    body?: string | null;
    report?: Reporter;
}

export interface PublishCompletedResult {
    status: 'completed';
    exitCode: 0;
    header: ManagerHeader;
    result: UnknownRecord;
}

export type PublishCommandResult =
    | ManagerTemplatesCreatedResult
    | ManagerErrorResult
    | PublishCompletedResult;

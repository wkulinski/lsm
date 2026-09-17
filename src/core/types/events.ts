import type { PublishCommandOptions } from './publish';
import type { ManagerHeader } from './manager';
import type { SyncPlan, SyncPluginSummary, SyncPreflight, SyncSourceReport } from './sync';

export type ManagerEvent
    = | { type: 'header'; header: ManagerHeader }
        | { type: 'sync-discover-start' }
        | { type: 'sync-plan'; plan: SyncPlan }
        | { type: 'sync-preflight'; preflight: SyncPreflight; force: boolean }
        | { type: 'sync-add-start' }
        | { type: 'sync-add-source'; source: string; mode: string; skillCount: number }
        | { type: 'sync-shared-start' }
        | { type: 'sync-subagents-start' }
        | { type: 'sync-subagent-source'; source: string; mode: SyncSourceReport['mode']; selected: number }
        | { type: 'sync-subagents'; sources?: number; sourceReports?: SyncSourceReport[]; detected: number; installed: number; removed: number; sharedFiles: number; plugins?: SyncPluginSummary }
        | { type: 'sync-remove-start'; plan: SyncPlan }
        | { type: 'publish-start'; options: Required<Pick<PublishCommandOptions, 'dryRun' | 'confirmDeletes'>> & {
            source: string | null;
            newSkills: string[];
            removeSkills: string[];
            createPr: boolean | null;
        }; };

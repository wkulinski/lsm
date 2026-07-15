import SyncService from '../sync/SyncService';
import type { SyncCommandOptions, SyncCommandResult } from '../types';
import type {
    ManagerRuntime,
    Reporter,
} from './types';

export default class SyncWorkflow {
    private readonly service = new SyncService();

    public run({ runtime, options = {}, report }: {
        runtime: ManagerRuntime;
        options?: SyncCommandOptions;
        report?: Reporter;
    }): Promise<SyncCommandResult> {
        return this.service.run({ runtime, options, report });
    }
}

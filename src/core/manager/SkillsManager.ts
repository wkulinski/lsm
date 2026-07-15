import PublishWorkflow from './PublishWorkflow';
import RuntimeFactory from './RuntimeFactory';
import SyncService from '../sync/SyncService';
import type {
    PublishCommandOptions,
    PublishCommandResult,
    SyncCommandOptions,
    SyncCommandResult,
} from '../types';
import type { ManagerOptions } from './types';

export type { ManagerOptions } from './types';

export class SkillsManager {
    private readonly options: ManagerOptions;
    private readonly runtimeFactory: RuntimeFactory;

    public constructor(options: ManagerOptions = {}) {
        this.options = options;
        this.runtimeFactory = new RuntimeFactory({ options });
    }

    public async runSync(options: SyncCommandOptions = {}): Promise<SyncCommandResult> {
        const report = options.report ?? this.options.report;
        const runtimeResult = this.runtimeFactory.createRuntime();
        if ('status' in runtimeResult) {
            return runtimeResult;
        }

        return new SyncService().run({ runtime: runtimeResult, options, report });
    }

    public runPublish(options: PublishCommandOptions = {}): Promise<PublishCommandResult> {
        return Promise.resolve().then(() => this.runPublishSync(options));
    }

    private runPublishSync(options: PublishCommandOptions = {}): PublishCommandResult {
        const report = options.report ?? this.options.report;
        const manifestRuntimeResult = this.runtimeFactory.createManifestRuntime();
        if ('status' in manifestRuntimeResult) {
            return manifestRuntimeResult;
        }

        return new PublishWorkflow().run({
            manifestRuntime: manifestRuntimeResult,
            options,
            report,
            createExecutionRuntime: manifestRuntime => this.runtimeFactory.createExecutionRuntime(manifestRuntime),
        });
    }
}

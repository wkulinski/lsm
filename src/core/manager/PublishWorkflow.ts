import { normalizeError } from '../shared/errors';
import PublishParameterResolver from '../publish/PublishParameterResolver';
import type {
    ManagerErrorResult,
    PublishCommandOptions,
    PublishCommandResult,
} from '../types';
import type {
    ManagerRuntime,
    ManifestRuntime,
    Reporter,
} from './types';

interface UnknownRecord { [key: string]: unknown }

export default class PublishWorkflow {
    public run(
        {
            manifestRuntime,
            options = {},
            report,
            createExecutionRuntime,
        }: {
            manifestRuntime: ManifestRuntime;
            options?: PublishCommandOptions;
            report?: Reporter;
            createExecutionRuntime: (manifestRuntime: ManifestRuntime) => ManagerRuntime | ManagerErrorResult;
        },
    ): PublishCommandResult {
        const resolvedParameters = new PublishParameterResolver().resolve({
            manifest: manifestRuntime.manifest,
            source: options.source,
            newSkills: options.newSkills ?? [],
            removeSkills: options.removeSkills ?? [],
            createPr: options.createPr ?? null,
        });
        if (!resolvedParameters.ok) {
            return {
                status: 'error',
                exitCode: 1,
                error: resolvedParameters.error,
                details: resolvedParameters.details,
            };
        }

        const runtimeResult = createExecutionRuntime(manifestRuntime);
        if ('status' in runtimeResult) {
            return runtimeResult;
        }

        const runtime = runtimeResult;
        report?.({ type: 'header', header: runtime.header });

        const publishOptions = {
            source: resolvedParameters.targetSource.source,
            newSkills: resolvedParameters.selectedNewSkills,
            removeSkills: resolvedParameters.selectedRemoveSkills,
            dryRun: options.dryRun === true,
            confirmDeletes: options.confirmDeletes === true,
            createPr: typeof options.createPr === 'boolean' ? options.createPr : null,
            message: options.message ?? null,
            branch: options.branch ?? null,
            title: options.title ?? null,
            body: options.body ?? null,
        };

        report?.({
            type: 'publish-start',
            options: {
                source: publishOptions.source,
                newSkills: publishOptions.newSkills,
                removeSkills: publishOptions.removeSkills,
                dryRun: publishOptions.dryRun,
                confirmDeletes: publishOptions.confirmDeletes,
                createPr: publishOptions.createPr,
            },
        });

        try {
            const result = runtime.publisher.publish({
                manifest: runtime.manifest,
                lock: runtime.lock,
                ...publishOptions,
            }) as (UnknownRecord & { ok: true }) | { ok: false; error?: string; details?: unknown };

            if (!result.ok) {
                return {
                    status: 'error',
                    exitCode: 1,
                    error: result.error ?? 'Publish failed.',
                    details: result.details,
                    header: runtime.header,
                };
            }

            return {
                status: 'completed',
                exitCode: 0,
                header: runtime.header,
                result,
            };
        }
        catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
                header: runtime.header,
            };
        }
    }
}

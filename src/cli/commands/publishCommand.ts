import { createManager } from '../../core/manager';
import { renderPublishEvent, renderPublishResult } from '../renderers/publishRenderer';

export interface PublishCommandOptions {
    manifest?: string;
    source?: string;
    newSkill?: string[];
    removeSkill?: string[];
    dryRun?: boolean;
    confirmDeletes?: boolean;
    message?: string;
    branch?: string;
    pr?: boolean;
    title?: string;
    body?: string;
}

export async function runPublishCommand(options: PublishCommandOptions): Promise<number> {
    const manager = createManager({
        cwd: process.cwd(),
        manifestPath: options.manifest,
    });

    const result = await manager.runPublish({
        source: options.source,
        newSkills: options.newSkill,
        removeSkills: options.removeSkill,
        dryRun: options.dryRun === true,
        confirmDeletes: options.confirmDeletes === true,
        message: options.message,
        branch: options.branch,
        createPr: options.pr === false ? false : null,
        title: options.title,
        body: options.body,
        report: renderPublishEvent,
    });

    return renderPublishResult(result);
}

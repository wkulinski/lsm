import { spawnSync } from 'node:child_process';

import type { ResolvedSource } from '../types';
import PublishGitService from './PublishGitService';
import type { PublishErrorResult } from './PublishParameterResolver';

export interface PublishPrSuccess {
    ok: true;
    url: string | null;
    output: string;
}

export type PublishPrResult = PublishPrSuccess | PublishErrorResult;

export interface GhCommandResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

export type GhRunner = (args: string[], options?: { cwd?: string }) => GhCommandResult;

export default class PullRequestService {
    private readonly ghRunner: GhRunner;
    private readonly publishGitService: PublishGitService;

    public constructor({
        ghRunner = defaultGhRunner,
        publishGitService = new PublishGitService(),
    }: {
        ghRunner?: GhRunner;
        publishGitService?: PublishGitService;
    } = {}) {
        this.ghRunner = ghRunner;
        this.publishGitService = publishGitService;
    }

    public createPublishPr({
        cloneDir,
        sourceInfo,
        baseBranch,
        branchName,
        resolvedCommit,
        selectedNewSkills,
        selectedRemoveSkills,
        effectiveCreatePr,
        title,
        body,
    }: {
        cloneDir: string;
        sourceInfo: ResolvedSource;
        baseBranch: string;
        branchName: string;
        resolvedCommit: string;
        selectedNewSkills: string[];
        selectedRemoveSkills: string[];
        effectiveCreatePr: boolean;
        title: string | null;
        body: string | null;
    }): { pr: PublishPrSuccess | null; warnings: string[] } {
        if (!effectiveCreatePr) {
            return { pr: null, warnings: [] };
        }

        const prResult = this.createPullRequest({
            cwd: cloneDir,
            sourceInfo,
            baseBranch,
            branchName,
            title: title && title.trim().length > 0
                ? title
                : 'chore(skills): publish managed skills',
            body: body && body.trim().length > 0
                ? body
                : this.defaultPrBody({
                    resolvedCommit,
                    newSkills: selectedNewSkills,
                    removeSkills: selectedRemoveSkills,
                }),
        });
        if (prResult.ok) {
            return { pr: prResult, warnings: [] };
        }

        return { pr: null, warnings: [prResult.error] };
    }

    public createPullRequest({
        cwd, sourceInfo, baseBranch, branchName, title, body,
    }: {
        cwd: string;
        sourceInfo: ResolvedSource;
        baseBranch: string;
        branchName: string;
        title: string;
        body: string;
    }): PublishPrResult {
        if (!this.isGhAvailable()) {
            return {
                ok: false,
                error: 'gh CLI is not available or not authenticated; PR was not created automatically.',
                compareUrl: this.publishGitService.buildCompareUrl(sourceInfo.webUrl, baseBranch, branchName),
            };
        }

        const result = this.ghRunner([
            'pr',
            'create',
            '--base',
            baseBranch,
            '--head',
            branchName,
            '--title',
            title,
            '--body',
            body,
        ], { cwd });

        if (result.status !== 0) {
            return {
                ok: false,
                error: `Failed to create PR automatically: ${(result.stderr || result.stdout || '').trim()}`,
                compareUrl: this.publishGitService.buildCompareUrl(sourceInfo.webUrl, baseBranch, branchName),
            };
        }

        const output = `${result.stdout}\n${result.stderr}`.trim();
        const urlMatch = /https:\/\/github\.com\/[^\s]+/.exec(output);
        return {
            ok: true,
            url: urlMatch ? urlMatch[0] : null,
            output,
        };
    }

    public isGhAvailable(): boolean {
        const result = this.ghRunner(['auth', 'status']);
        return result.status === 0;
    }

    public defaultPrBody({ resolvedCommit, newSkills, removeSkills }: { resolvedCommit: string; newSkills: string[]; removeSkills: string[] }): string {
        return [
            'Published automatically using Llm Skills Manager (wkulinski/lsm).',
            '',
            `Base commit from lock: ${resolvedCommit}`,
            `Selected new skills: ${newSkills.length ? newSkills.join(', ') : 'none'}`,
            `Selected removed skills: ${removeSkills.length ? removeSkills.join(', ') : 'none'}`,
        ].join('\n');
    }
}

function defaultGhRunner(args: string[], options: { cwd?: string } = {}): GhCommandResult {
    const result = spawnSync('gh', args, {
        encoding: 'utf8',
        cwd: options.cwd,
    });

    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
    };
}

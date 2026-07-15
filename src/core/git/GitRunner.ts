import { spawnSync } from 'node:child_process';

export interface GitCommandResult {
    ok: boolean;
    status: number;
    stdout: string;
    stderr: string;
    errorCode?: string;
}

export interface GitRunnerLike {
    run(cwd: string | null, args: string[]): GitCommandResult;
}

export default class GitRunner implements GitRunnerLike {
    public run(cwd: string | null, args: string[]): GitCommandResult {
        const result = spawnSync('git', args, {
            encoding: 'utf8',
            ...(cwd ? { cwd } : {}),
        });
        const error = result.error as NodeJS.ErrnoException | undefined;

        return {
            ok: result.status === 0,
            status: result.status ?? 1,
            stdout: typeof result.stdout === 'string' ? result.stdout : '',
            stderr: typeof result.stderr === 'string' ? result.stderr : '',
            ...(error?.code ? { errorCode: error.code } : {}),
        };
    }
}

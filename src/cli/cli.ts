import { Command, CommanderError } from 'commander';

import { runPublishCommand, type PublishCommandOptions } from './commands/publishCommand';
import { runSyncCommand, type SyncCommandOptions } from './commands/syncCommand';

export async function runCli(argv: string[]): Promise<number> {
    let exitCode = 0;

    const program = new Command()
        .name('lsm')
        .description('LLM Skills Manager')
        .showHelpAfterError()
        .exitOverride()
    ;

    program
        .command('sync')
        .description('Synchronize managed skills from manifest sources')
        .option('--manifest <path>', 'Path to skills manifest')
        .option('--update', 'Resolve current upstream sources and update the lock')
        .option('--force', 'Continue despite local change conflicts')
        .action(async (options: SyncCommandOptions) => {
            exitCode = await runSyncCommand(options);
        })
    ;

    program
        .command('publish')
        .description('Publish local managed skills back to the source repository')
        .option('--manifest <path>', 'Path to skills manifest')
        .option('--source <source>', 'Explicit source from manifest')
        .option('--new-skill <name>', 'Mark skill for publishing as new', collectValues, [])
        .option('--remove-skill <name>', 'Mark skill for removal upstream', collectValues, [])
        .option('--dry-run', 'Plan publish changes without committing')
        .option('--confirm-deletes', 'Allow planned deletes')
        .option('--message <message>', 'Commit message override')
        .option('--branch <name>', 'Publish branch name')
        .option('--no-pr', 'Do not create a pull request')
        .option('--title <title>', 'Pull request title override')
        .option('--body <body>', 'Pull request body override')
        .action(async (options: PublishCommandOptions) => {
            exitCode = await runPublishCommand(options);
        })
    ;

    try {
        await program.parseAsync(normalizeCliArgv(argv), { from: 'user' });
        return exitCode;
    }
    catch (error) {
        if (error instanceof CommanderError) {
            return error.code === 'commander.helpDisplayed' ? 0 : error.exitCode;
        }
        throw error;
    }
}

function normalizeCliArgv(argv: string[]): string[] {
    if (argv.length === 0 || argv[0]?.startsWith('-')) {
        return ['sync', ...argv];
    }

    return argv;
}

function collectValues(value: string, previous: string[]): string[] {
    return [...previous, value];
}

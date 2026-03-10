import { runCli } from './cli/cli';

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    try {
        return await runCli(argv);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        return 1;
    }
}

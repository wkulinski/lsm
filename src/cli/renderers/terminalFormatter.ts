export type TerminalTone = 'heading' | 'info' | 'success' | 'warning' | 'error' | 'muted' | 'accent';

export interface TerminalStream {
    isTTY?: boolean;
    write(chunk: string): unknown;
}

const ANSI_RESET = '\u001b[0m';

const ANSI_TONES: { [key in TerminalTone]: string } = {
    heading: '\u001b[1;36m',
    info: '\u001b[36m',
    success: '\u001b[32m',
    warning: '\u001b[33m',
    error: '\u001b[31m',
    muted: '\u001b[2m',
    accent: '\u001b[35m',
};

export function shouldUseColor(stream: TerminalStream, env: NodeJS.ProcessEnv = process.env): boolean {
    if (Object.hasOwn(env, 'NO_COLOR') || env.FORCE_COLOR === '0') {
        return false;
    }

    if (Object.hasOwn(env, 'FORCE_COLOR')) {
        return true;
    }

    if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') {
        return false;
    }

    return stream.isTTY === true;
}

export function colorize(text: string, tone: TerminalTone, stream: TerminalStream = process.stdout, env: NodeJS.ProcessEnv = process.env): string {
    if (!shouldUseColor(stream, env)) {
        return text;
    }

    return `${ANSI_TONES[tone]}${text}${ANSI_RESET}`;
}

export function writeSection(
    stream: TerminalStream,
    title: string,
    tone: TerminalTone = 'heading',
    leadingBlank = true,
): void {
    stream.write(`${leadingBlank ? '\n' : ''}${colorize(title, tone, stream)}\n`);
}

export function writeBullet(
    stream: TerminalStream,
    text: string,
    tone: TerminalTone = 'muted',
    indent = '  ',
): void {
    stream.write(`${indent}${colorize('-', tone, stream)} ${text}\n`);
}

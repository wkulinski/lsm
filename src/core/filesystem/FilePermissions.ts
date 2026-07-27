import fs from 'node:fs';

export function hasExecutableBit(mode: number): boolean {
    return (mode & 0o111) !== 0;
}

export function syncExecutableBit(filePath: string, executable: boolean): void {
    const currentMode = fs.statSync(filePath).mode & 0o7777;
    const nextMode = executable
        ? currentMode | 0o111
        : currentMode & ~0o111;

    if (nextMode !== currentMode) {
        fs.chmodSync(filePath, nextMode);
    }
}

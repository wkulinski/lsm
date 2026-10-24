import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import SkillInstaller from '../src/core/skills/SkillInstaller';
import SkillScanner from '../src/core/source/SkillScanner';
import { createTempDir } from './helpers';

function createLayout(): { root: string; skillsDir: string; targetDir: string } {
    const root = createTempDir();
    const skillsDir = path.join(root, '.agents', 'skills');
    const targetDir = path.join(skillsDir, 'example');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), '# Old\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'old-only.txt'), 'old\n', 'utf8');
    fs.writeFileSync(path.join(targetDir, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    return { root, skillsDir, targetDir };
}

function newFiles(): { path: string; content: Buffer; executable: boolean }[] {
    return [
        { path: 'SKILL.md', content: Buffer.from('# New\n'), executable: false },
        { path: 'nested/tool.sh', content: Buffer.from('#!/bin/sh\n'), executable: true },
    ];
}

function listWorkDirs(root: string): string[] {
    return fs.readdirSync(path.join(root, '.agents')).filter(name => name.startsWith('.lsm-swap-'));
}

describe('SkillInstaller.writeDirectory', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('replaces the previous version with exactly the new files', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# New\n');
            expect(fs.existsSync(path.join(targetDir, 'old-only.txt'))).toBe(false);
            expect(fs.existsSync(path.join(targetDir, 'run.sh'))).toBe(false);
            expect(fs.statSync(path.join(targetDir, 'nested', 'tool.sh')).mode & 0o111).toBe(0o111);
            expect(fs.statSync(path.join(targetDir, 'SKILL.md')).mode & 0o111).toBe(0);
            expect(listWorkDirs(root)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('installs a new skill into a missing skills directory', () => {
        const root = createTempDir();

        try {
            const skillsDir = path.join(root, '.claude', 'skills');
            const targetDir = path.join(skillsDir, 'group', 'example');

            SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# New\n');
            expect(fs.readdirSync(path.join(root, '.claude'))).toEqual(['skills']);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('keeps the previous version when preparing the new content fails', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            const originalWrite = fs.writeFileSync;
            vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
                if (String(file).endsWith(path.join('nested', 'tool.sh'))) {
                    throw new Error('disk full');
                }
                (originalWrite as (...args: unknown[]) => void)(file, ...rest);
            }) as typeof fs.writeFileSync);

            expect(() => {
                SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);
            }).toThrow('disk full');

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# Old\n');
            expect(fs.readFileSync(path.join(targetDir, 'old-only.txt'), 'utf8')).toBe('old\n');
            expect(fs.statSync(path.join(targetDir, 'run.sh')).mode & 0o111).toBe(0o111);
            expect(listWorkDirs(root)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('keeps the previous version when the executable bit cannot be applied', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
                throw new Error('EPERM');
            });

            expect(() => {
                SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);
            }).toThrow('EPERM');

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# Old\n');
            expect(listWorkDirs(root)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('leaves no partial skill when a new installation fails', () => {
        const root = createTempDir();

        try {
            const skillsDir = path.join(root, '.agents', 'skills');
            const targetDir = path.join(skillsDir, 'example');
            vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
                throw new Error('EPERM');
            });

            expect(() => {
                SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);
            }).toThrow('EPERM');

            expect(fs.existsSync(targetDir)).toBe(false);
            expect(listWorkDirs(root)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('restores the previous version when moving the new content fails', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            const originalRename = fs.renameSync;
            vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
                if (String(from).endsWith(`${path.sep}new`)) {
                    throw new Error('rename failed');
                }
                originalRename(from, to);
            }) as typeof fs.renameSync);

            expect(() => {
                SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);
            }).toThrow('rename failed');

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# Old\n');
            expect(fs.readFileSync(path.join(targetDir, 'old-only.txt'), 'utf8')).toBe('old\n');
            expect(fs.statSync(path.join(targetDir, 'run.sh')).mode & 0o111).toBe(0o111);
            expect(listWorkDirs(root)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('preserves the previous version and reports its location when restoring fails', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            const originalRename = fs.renameSync;
            vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
                if (String(from).endsWith(`${path.sep}new`) || String(from).endsWith(`${path.sep}previous`)) {
                    throw new Error('rename failed');
                }
                originalRename(from, to);
            }) as typeof fs.renameSync);

            let message = '';
            try {
                SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);
            }
            catch (error) {
                message = (error as Error).message;
            }

            const [workDirName] = listWorkDirs(root);
            const backupDir = path.join(root, '.agents', workDirName, 'previous');
            expect(message).toContain(backupDir);
            expect(fs.readFileSync(path.join(backupDir, 'SKILL.md'), 'utf8')).toBe('# Old\n');
            expect(fs.readFileSync(path.join(backupDir, 'old-only.txt'), 'utf8')).toBe('old\n');
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('does not report a successful installation as failed when cleanup fails', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            const originalRm = fs.rmSync;
            vi.spyOn(fs, 'rmSync').mockImplementation(((target: fs.PathLike, options?: fs.RmOptions) => {
                if (path.basename(String(target)).startsWith('.lsm-swap-')) {
                    throw new Error('EBUSY');
                }
                originalRm(target, options);
            }) as typeof fs.rmSync);

            const skillMd = '---\nname: example\ndescription: Example skill\n---\n\n# New\n';
            const files = [{ path: 'SKILL.md', content: Buffer.from(skillMd), executable: false }];
            fs.writeFileSync(path.join(targetDir, 'SKILL.md'), skillMd.replace('New', 'Old'), 'utf8');

            expect(() => {
                SkillInstaller.writeDirectory(targetDir, files, skillsDir);
            }).not.toThrow();

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe(skillMd);
            expect(fs.existsSync(path.join(targetDir, 'old-only.txt'))).toBe(false);

            // The leftover backup lives outside the skills directory, so it is not a second local skill.
            const leftovers = listWorkDirs(root);
            expect(leftovers).toHaveLength(1);
            expect(fs.existsSync(path.join(root, '.agents', leftovers[0], 'previous', 'SKILL.md'))).toBe(true);
            vi.restoreAllMocks();
            const discovered = new SkillScanner({ fullDepth: true }).discover(root, '.agents/skills');
            expect(discovered.skills.map(skill => skill.name)).toEqual(['example']);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects traversal in file paths before touching the previous version', () => {
        const { root, skillsDir, targetDir } = createLayout();

        try {
            expect(() => {
                SkillInstaller.writeDirectory(targetDir, [
                    { path: '../escape.txt', content: Buffer.from('x'), executable: false },
                ], skillsDir);
            }).toThrow('..');

            expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# Old\n');
            expect(fs.existsSync(path.join(skillsDir, 'escape.txt'))).toBe(false);
            expect(listWorkDirs(root)).toEqual([]);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects target directories outside the skills directory', () => {
        const { root, skillsDir } = createLayout();

        try {
            const outsideDir = path.join(root, 'outside');

            expect(() => {
                SkillInstaller.writeDirectory(outsideDir, newFiles(), skillsDir);
            }).toThrow('escapes skills directory');
            expect(() => {
                SkillInstaller.writeDirectory(skillsDir, newFiles(), skillsDir);
            }).toThrow('escapes skills directory');

            expect(fs.existsSync(outsideDir)).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
        'falls back to a work directory inside the skills directory when its parent is read-only',
        () => {
            const { root, skillsDir, targetDir } = createLayout();
            const parentDir = path.dirname(skillsDir);

            try {
                fs.chmodSync(parentDir, 0o555);

                SkillInstaller.writeDirectory(targetDir, newFiles(), skillsDir);

                expect(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')).toBe('# New\n');
                expect(fs.existsSync(path.join(targetDir, 'old-only.txt'))).toBe(false);
                expect(fs.readdirSync(skillsDir)).toEqual(['example']);
                expect(fs.readdirSync(parentDir)).toEqual(['skills']);
            }
            finally {
                fs.chmodSync(parentDir, 0o755);
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
    );
});

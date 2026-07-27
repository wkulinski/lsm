import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import ManagedFileSynchronizer, { type ManagedFileDeclaration } from '../src/core/sync/ManagedFileSynchronizer';
import Hashing from '../src/core/shared/Hashing';
import { createTempDir } from './helpers';

describe('ManagedFileSynchronizer', () => {
    test('resolves ownership before writing any target', () => {
        const root = createTempDir();

        try {
            const synchronizer = new ManagedFileSynchronizer({ root });
            const result = synchronizer.plan({
                files: [
                    declaration('source-a', 'shared/common.md', '# A\n'),
                    declaration('source-b', 'shared/common.md', '# B\n'),
                ],
            });

            expect(result).toEqual({
                ok: false,
                error: 'Managed file ownership conflicts detected.',
                details: [{ filePath: 'shared/common.md', a: 'source-a', b: 'source-b' }],
            });
            expect(fs.existsSync(path.join(root, 'shared', 'common.md'))).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rejects ownership conflicts even when competing files have identical content', () => {
        const root = createTempDir();

        try {
            const result = new ManagedFileSynchronizer({ root }).plan({
                files: [
                    declaration('source-a', '.agents/skills/_shared/common.md', '# Common\n'),
                    declaration('source-b', '.agents/skills/_shared/common.md', '# Common\n'),
                ],
            });

            expect(result).toMatchObject({
                ok: false,
                error: 'Managed file ownership conflicts detected.',
            });
            expect(fs.existsSync(path.join(root, '.agents', 'skills', '_shared', 'common.md'))).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('applies files, executable bits, and managed pruning atomically', () => {
        const root = createTempDir();
        const stalePath = path.join(root, 'shared', 'stale.md');
        fs.mkdirSync(path.dirname(stalePath), { recursive: true });
        fs.writeFileSync(stalePath, 'stale\n');

        try {
            const synchronizer = new ManagedFileSynchronizer({ root });
            const plan = synchronizer.plan({
                files: [declaration('source-a', 'shared/run.sh', '#!/bin/sh\n', true)],
                removals: ['shared/stale.md'],
            });

            expect(plan.ok).toBe(true);
            if (!plan.ok) {
                return;
            }
            synchronizer.apply(plan.plan);

            const targetPath = path.join(root, 'shared', 'run.sh');
            expect(fs.readFileSync(targetPath, 'utf8')).toBe('#!/bin/sh\n');
            expect(fs.statSync(targetPath).mode & 0o111).toBe(0o111);
            expect(fs.existsSync(stalePath)).toBe(false);
            expect(fs.existsSync(path.join(root, '.lsm-managed-journal-'))).toBe(false);
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('treats an executable-only local change as a managed conflict', () => {
        const root = createTempDir();
        const targetPath = path.join(root, 'shared', 'script.sh');
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, '#!/bin/sh\n');
        fs.chmodSync(targetPath, 0o755);

        try {
            const content = Buffer.from('#!/bin/sh\n');
            const result = new ManagedFileSynchronizer({ root }).plan({
                files: [declaration('source-a', 'shared/script.sh', content, false)],
                baselines: [{
                    targetPath: 'shared/script.sh',
                    hash: { sha256: Hashing.sha256Buffer(content), executable: false },
                }],
            });

            expect(result).toMatchObject({
                ok: false,
                error: 'Managed file local conflicts detected.',
                details: ['shared/script.sh'],
            });
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('does not prune a locally changed file when its baseline is known', () => {
        const root = createTempDir();
        const targetPath = path.join(root, 'shared', 'stale.md');
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, 'local change\n');

        try {
            const result = new ManagedFileSynchronizer({ root }).plan({
                files: [],
                removals: ['shared/stale.md'],
                baselines: [{
                    targetPath: 'shared/stale.md',
                    hash: { sha256: Hashing.sha256Buffer(Buffer.from('baseline\n')), executable: false },
                }],
            });

            expect(result).toMatchObject({
                ok: false,
                error: 'Managed file local conflicts detected.',
                details: ['shared/stale.md'],
            });
            expect(fs.readFileSync(targetPath, 'utf8')).toBe('local change\n');
        }
        finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rolls back earlier writes when a later rename fails', () => {
        const root = createTempDir();
        const firstPath = path.join(root, 'shared', 'first.md');
        const secondPath = path.join(root, 'shared', 'second.md');
        fs.mkdirSync(path.dirname(firstPath), { recursive: true });
        fs.writeFileSync(firstPath, 'old-first\n');
        fs.writeFileSync(secondPath, 'old-second\n');
        const originalRename = fs.renameSync;
        let finalRenames = 0;
        const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            const destination = String(to);
            if (!destination.includes('.lsm-managed-journal-')) {
                finalRenames += 1;
                if (finalRenames === 2) {
                    throw new Error('simulated rename failure');
                }
            }
            originalRename(from, to);
        });

        try {
            const synchronizer = new ManagedFileSynchronizer({ root });
            const plan = synchronizer.plan({
                files: [
                    declaration('source-a', 'shared/first.md', 'new-first\n'),
                    declaration('source-a', 'shared/second.md', 'new-second\n'),
                ],
            });
            expect(plan.ok).toBe(true);
            if (!plan.ok) {
                return;
            }

            expect(() => {
                synchronizer.apply(plan.plan);
            }).toThrow('simulated rename failure');
            expect(fs.readFileSync(firstPath, 'utf8')).toBe('old-first\n');
            expect(fs.readFileSync(secondPath, 'utf8')).toBe('old-second\n');
        }
        finally {
            renameSpy.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rolls back when writing or chmod fails', () => {
        const failures = [
            { operation: 'write', install: (): { mockRestore(): void } => vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('simulated write failure'); }) },
            { operation: 'chmod', install: (): { mockRestore(): void } => vi.spyOn(fs, 'chmodSync').mockImplementation(() => { throw new Error('simulated chmod failure'); }) },
        ];

        failures.forEach(({ operation, install }) => {
            const root = createTempDir();
            const spy = install();
            try {
                const synchronizer = new ManagedFileSynchronizer({ root });
                const plan = synchronizer.plan({ files: [declaration('source-a', 'nested/file.md', 'content\n', true)] });
                expect(plan.ok).toBe(true);
                if (!plan.ok) {
                    return;
                }

                expect(() => {
                    synchronizer.apply(plan.plan);
                }).toThrow(`simulated ${operation} failure`);
                expect(fs.existsSync(path.join(root, 'nested', 'file.md'))).toBe(false);
                expect(fs.existsSync(path.join(root, 'nested'))).toBe(false);
            }
            finally {
                spy.mockRestore();
                fs.rmSync(root, { recursive: true, force: true });
            }
        });
    });

    test('rolls back a prune failure and cleans the journal', () => {
        const root = createTempDir();
        const stalePath = path.join(root, 'nested', 'stale.md');
        fs.mkdirSync(path.dirname(stalePath), { recursive: true });
        fs.writeFileSync(stalePath, 'stale\n');
        const originalRename = fs.renameSync;
        const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            if (String(to).includes('.lsm-managed-journal-')) {
                throw new Error('simulated prune failure');
            }
            originalRename(from, to);
        });

        try {
            const synchronizer = new ManagedFileSynchronizer({ root });
            const plan = synchronizer.plan({ files: [], removals: ['nested/stale.md'] });
            expect(plan.ok).toBe(true);
            if (!plan.ok) {
                return;
            }

            expect(() => {
                synchronizer.apply(plan.plan);
            }).toThrow('simulated prune failure');
            expect(fs.readFileSync(stalePath, 'utf8')).toBe('stale\n');
            expect(fs.existsSync(path.join(root, 'nested'))).toBe(true);
            expect(fs.readdirSync(root).some(entry => entry.startsWith('.lsm-managed-journal-'))).toBe(false);
        }
        finally {
            renameSpy.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('rolls back when journal cleanup fails once', () => {
        const root = createTempDir();
        const originalRemove = fs.rmSync;
        let journalCleanupFailed = false;
        const removeSpy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
            if (!journalCleanupFailed && String(target).includes('.lsm-managed-journal-')) {
                journalCleanupFailed = true;
                throw new Error('simulated cleanup failure');
            }
            originalRemove(target, options);
        });

        try {
            const synchronizer = new ManagedFileSynchronizer({ root });
            const plan = synchronizer.plan({ files: [declaration('source-a', 'file.md', 'content\n')] });
            expect(plan.ok).toBe(true);
            if (!plan.ok) {
                return;
            }

            expect(() => {
                synchronizer.apply(plan.plan);
            }).toThrow('simulated cleanup failure');
            expect(fs.existsSync(path.join(root, 'file.md'))).toBe(false);
            expect(fs.readdirSync(root).some(entry => entry.startsWith('.lsm-managed-journal-'))).toBe(false);
        }
        finally {
            removeSpy.mockRestore();
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

function declaration(owner: string, targetPath: string, content: string | Buffer, executable = false): ManagedFileDeclaration {
    return {
        owner,
        sourcePath: targetPath,
        targetPath,
        content: Buffer.isBuffer(content) ? content : Buffer.from(content),
        executable,
    };
}

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import RuntimeFactory from '../src/core/manager/RuntimeFactory';
import { createTempDir, readJson, writeJson } from './helpers';

describe('RuntimeFactory', () => {
    test('creates default manifest and lock templates when config files are missing', () => {
        const tempDir = createTempDir();

        try {
            const runtimeFactory = new RuntimeFactory({ options: { cwd: tempDir } });

            const result = runtimeFactory.createManifestRuntime();

            expect(result).toMatchObject({
                status: 'templates-created',
                exitCode: 1,
                root: tempDir,
                createdTemplates: ['skills.json', 'skills.lock.json'],
            });
            expect(readJson(path.join(tempDir, 'skills.json'))).toEqual({
                agents: [],
                sources: [],
            });
            expect(readJson(path.join(tempDir, 'skills.lock.json'))).toMatchObject({
                schemaVersion: 5,
                agents: [],
                sources: {},
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('respects custom relative manifest and lock paths when creating templates', () => {
        const tempDir = createTempDir();

        try {
            const runtimeFactory = new RuntimeFactory({
                options: {
                    cwd: tempDir,
                    manifestPath: 'config/custom-skills.json',
                    lockPath: 'state/custom-lock.json',
                },
            });

            const result = runtimeFactory.createManifestRuntime();

            expect(result).toMatchObject({
                status: 'templates-created',
                exitCode: 1,
                root: tempDir,
                createdTemplates: ['config/custom-skills.json', 'state/custom-lock.json'],
            });
            expect(fs.existsSync(path.join(tempDir, 'config', 'custom-skills.json'))).toBe(true);
            expect(fs.existsSync(path.join(tempDir, 'state', 'custom-lock.json'))).toBe(true);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('builds execution runtime with header paths resolved from manifest runtime', () => {
        const tempDir = createTempDir();

        try {
            writeJson(path.join(tempDir, 'skills.json'), {
                agents: ['codex', 'cursor'],
                sources: [],
            });
            writeJson(path.join(tempDir, 'skills.lock.json'), {
                schemaVersion: 5,
                generatedAt: new Date().toISOString(),
                agents: ['codex', 'cursor'],
                sources: {},
            });
            const runtimeFactory = new RuntimeFactory({ options: { cwd: tempDir } });
            const manifestRuntime = runtimeFactory.createManifestRuntime();
            expect(manifestRuntime).not.toHaveProperty('status');
            if ('status' in manifestRuntime) {
                return;
            }

            const runtime = runtimeFactory.createExecutionRuntime(manifestRuntime);

            expect(runtime).not.toHaveProperty('status');
            if ('status' in runtime) {
                return;
            }
            expect(runtime.header).toMatchObject({
                root: tempDir,
                manifestPath: path.join(tempDir, 'skills.json'),
                manifestRelativePath: 'skills.json',
                lockPath: path.join(tempDir, 'skills.lock.json'),
                lockRelativePath: 'skills.lock.json',
                agents: ['codex', 'cursor'],
            });
            expect(runtime.header.cliVersion).toEqual(expect.any(String));
            expect(runtime.backend.root).toBe(tempDir);
            expect(runtime.sync).toBeDefined();
            expect(runtime.publisher).toBeDefined();
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

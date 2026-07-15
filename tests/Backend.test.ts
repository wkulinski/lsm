import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import Backend from '../src/core/manager/BackendAdapter';
import SkillDiscovery from '../src/core/source/SkillDiscovery';
import { createTempDir } from './helpers';
import type { CollectSkillDirectoriesSuccess, FailureResult } from '../src/core/types';

describe('Backend', () => {
    test('resolves configured agent skill directories and rejects unsupported agents', () => {
        const tempDir = createTempDir();

        try {
            const backend = new Backend({ root: tempDir });

            expect(backend.resolveAgentProjectSkillDirs(['codex'])).toEqual({
                ok: true,
                dirs: [path.join(tempDir, '.agents', 'skills')],
            });
            expect(backend.resolveAgentProjectSkillDirs(['*'])).toEqual({
                ok: false,
                error: "Copy sync requires explicit agent names (wildcard '*' is not supported).",
            });
            expect(backend.resolveAgentProjectSkillDirs(['unknown-agent'])).toEqual({
                ok: false,
                error: 'Unsupported agent for copy sync: "unknown-agent". Add mapping in AgentRegistry.',
            });
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('installs collected skill directories into configured agent directories', () => {
        const tempDir = createTempDir();
        const originalCollectDescriptor = Object.getOwnPropertyDescriptor(SkillDiscovery.prototype, 'collectSkillDirectories');

        try {
            SkillDiscovery.prototype.collectSkillDirectories = (
                source: string,
                skillSourcePaths: string[],
            ): CollectSkillDirectoriesSuccess | FailureResult => {
                expect(source).toBe('owner/repo');
                expect(skillSourcePaths).toEqual(['.agents/skills/example']);

                return {
                    ok: true,
                    directories: [{
                        sourcePath: '.agents/skills/example',
                        files: [
                            { path: 'SKILL.md', content: Buffer.from('# Example\n') },
                            { path: 'nested/config.json', content: Buffer.from('{"enabled":true}\n') },
                        ],
                    }],
                };
            };

            const backend = new Backend({ root: tempDir });
            const result = backend.installSkillEntries({
                source: 'owner/repo',
                skillEntries: [{
                    name: 'Example',
                    sourcePath: '.agents/skills/example',
                    sharedFiles: [],
                    hash: null,
                }],
                agents: ['codex'],
            });

            expect(result).toEqual({
                ok: true,
                status: 0,
                cmd: ['internal-install', 'owner/repo'],
            });
            expect(fs.readFileSync(path.join(tempDir, '.agents', 'skills', 'example', 'SKILL.md'), 'utf8')).toBe('# Example\n');
            expect(fs.readFileSync(path.join(tempDir, '.agents', 'skills', 'example', 'nested', 'config.json'), 'utf8')).toBe('{"enabled":true}\n');
        }
        finally {
            if (originalCollectDescriptor) {
                Object.defineProperty(SkillDiscovery.prototype, 'collectSkillDirectories', originalCollectDescriptor);
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('removes managed skill entries from configured agent directories', () => {
        const tempDir = createTempDir();

        try {
            const skillDir = path.join(tempDir, '.agents', 'skills', 'example');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Example\n', 'utf8');

            const backend = new Backend({ root: tempDir });
            const result = backend.removeSkillEntries({
                skillEntries: [{
                    name: 'Example',
                    sourcePath: '.agents/skills/example',
                }],
                agents: ['codex'],
            });

            expect(result).toEqual({
                ok: true,
                status: 0,
                cmd: ['internal-remove'],
            });
            expect(fs.existsSync(skillDir)).toBe(false);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

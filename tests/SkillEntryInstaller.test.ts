import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import SkillEntryInstaller from '../src/core/skills/SkillEntryInstaller';
import SkillDiscovery from '../src/core/source/SkillDiscovery';
import { createTempDir } from './helpers';
import type { CollectSkillDirectoriesSuccess, FailureResult } from '../src/core/types';

describe('SkillEntryInstaller', () => {
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

            const installer = new SkillEntryInstaller({ root: tempDir });
            const result = installer.install({
                source: 'owner/repo',
                skillEntries: [{
                    name: 'Example',
                    sourcePath: '.agents/skills/example',
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

            const installer = new SkillEntryInstaller({ root: tempDir });
            const result = installer.remove({
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

    test('does not install skills through a symlinked agent directory', () => {
        const tempDir = createTempDir();
        const originalCollectDescriptor = Object.getOwnPropertyDescriptor(SkillDiscovery.prototype, 'collectSkillDirectories');

        try {
            const outsideDir = path.join(tempDir, 'outside');
            const agentSkillDir = path.join(tempDir, '.agents', 'skills');
            fs.mkdirSync(outsideDir, { recursive: true });
            fs.mkdirSync(path.dirname(agentSkillDir), { recursive: true });
            fs.symlinkSync(outsideDir, agentSkillDir);
            SkillDiscovery.prototype.collectSkillDirectories = (): CollectSkillDirectoriesSuccess => ({
                ok: true,
                directories: [{
                    sourcePath: '.agents/skills/example',
                    files: [{ path: 'SKILL.md', content: Buffer.from('# Example\n') }],
                }],
            });

            const result = new SkillEntryInstaller({ root: tempDir }).install({
                source: 'owner/repo',
                skillEntries: [{ name: 'Example', sourcePath: '.agents/skills/example' }],
                agents: ['codex'],
            });

            if (result.ok) {
                throw new Error('Expected symlinked agent directory to be rejected.');
            }
            expect(result.error).toContain('symbolic link');
            expect(fs.readdirSync(outsideDir)).toEqual([]);
        }
        finally {
            if (originalCollectDescriptor) {
                Object.defineProperty(SkillDiscovery.prototype, 'collectSkillDirectories', originalCollectDescriptor);
            }
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('returns command failures when agent directories cannot be resolved', () => {
        const installer = new SkillEntryInstaller({ root: '/tmp/project' });

        expect(installer.install({
            source: 'owner/repo',
            skillEntries: [{ name: 'Example', sourcePath: '.agents/skills/example' }],
            agents: ['*'],
        })).toEqual({
            ok: false,
            status: 1,
            cmd: ['internal-install', 'owner/repo'],
            error: "Copy sync requires explicit agent names (wildcard '*' is not supported).",
        });

        expect(installer.remove({
            skillEntries: [{ name: 'Example', sourcePath: '.agents/skills/example' }],
            agents: ['unknown-agent'],
        })).toEqual({
            ok: false,
            status: 1,
            cmd: ['internal-remove'],
            error: 'Unsupported agent for copy sync: "unknown-agent". Add mapping in AgentRegistry.',
        });
    });
});

import { describe, expect, test } from 'vitest';

import ManifestNormalizer from '../src/core/manifest/ManifestNormalizer';

describe('ManifestNormalizer', () => {
    test('normalizes agents, sources, selected skills, and publish config', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'skills.json' });

        expect(normalizer.normalize({
            agents: [' cursor ', 'codex', 'codex'],
            sources: [{
                source: ' owner/repo ',
                skills: [' beta ', 'alpha', 'alpha', ''],
                publish: {
                    branchPrefix: ' publish/custom ',
                    createPr: false,
                },
            }],
        })).toEqual({
            agents: ['codex', 'cursor'],
            subagents: [],
            sources: [{
                source: 'owner/repo',
                skills: ['alpha', 'beta'],
                subagents: null,
                publish: {
                    branchPrefix: 'publish/custom',
                    createPr: false,
                },
            }],
        });
    });

    test('rejects invalid manifest declarations with file-scoped messages', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'custom.json' });

        expect(() => normalizer.normalize({ agents: [], sources: [] })).toThrow('at least one of "agents" or "subagents" must be non-empty');
        expect(() => normalizer.normalize({ agents: ['codex'], sources: 'owner/repo' })).toThrow('"custom.json": "sources" must be an array');
        expect(() => normalizer.normalize({ agents: ['codex'], sources: ['owner/repo'] })).toThrow('"custom.json": each source entry must be an object');
        expect(() => normalizer.normalize({
            agents: ['codex'],
            sources: [{ source: 'owner/repo', publish: { branchPrefix: '' } }],
        })).toThrow('"custom.json": "publish.branchPrefix" must be a non-empty string');
        expect(() => normalizer.normalize({
            agents: ['codex'],
            sources: [{ source: 'owner/repo', publish: { includeNewByDefault: true } }],
        })).toThrow('"custom.json": "publish.includeNewByDefault" is no longer supported');
    });

    test('normalizes subagent targets and source selections', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'skills.json' });

        expect(normalizer.normalize({
            agents: [],
            subagents: [' opencode ', 'opencode'],
            sources: [{
                source: 'owner/repo',
                subagents: [' researcher ', 'reviewer', 'researcher'],
            }],
        })).toEqual({
            agents: [],
            subagents: ['opencode'],
            sources: [{
                source: 'owner/repo',
                skills: null,
                subagents: ['researcher', 'reviewer'],
                publish: { branchPrefix: null, createPr: null },
            }],
        });

        expect(normalizer.normalize({
            agents: ['codex'],
            sources: [{ source: 'owner/repo', subagents: null }],
        }).sources[0].subagents).toBeNull();
        expect(normalizer.normalize({
            agents: ['codex'],
            sources: [{ source: 'owner/repo', subagents: [] }],
        }).sources[0].subagents).toEqual([]);
    });

    test('rejects duplicate sources and unknown subagent targets', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'custom.json' });

        expect(() => normalizer.normalize({
            agents: ['codex'],
            sources: [{ source: 'owner/repo' }, { source: ' owner/repo ' }],
        })).toThrow('"custom.json": duplicate source "owner/repo"');
        expect(() => normalizer.normalize({
            agents: [],
            subagents: ['codex'],
            sources: [],
        })).toThrow('unsupported subagent target "codex"');
    });
});

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
            sources: [{
                source: 'owner/repo',
                skills: ['alpha', 'beta'],
                publish: {
                    branchPrefix: 'publish/custom',
                    createPr: false,
                },
            }],
        });
    });

    test('rejects invalid manifest declarations with file-scoped messages', () => {
        const normalizer = new ManifestNormalizer({ manifestFileName: 'custom.json' });

        expect(() => normalizer.normalize({ agents: [], sources: [] })).toThrow('"agents" must be a non-empty array');
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
});

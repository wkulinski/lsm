import { describe, expect, test } from 'vitest';

import PublishParameterResolver from '../src/core/publish/PublishParameterResolver';
import type { ManifestData } from '../src/core/types';

describe('PublishParameterResolver', () => {
    test('resolves explicit source and normalizes selected skills', () => {
        const resolver = new PublishParameterResolver();

        expect(resolver.resolve({
            manifest: createManifest(),
            source: 'owner/repo-b',
            newSkills: [' Beta ', 'alpha', 'beta', ''],
            removeSkills: ['Legacy', 'legacy', ' Old '],
            createPr: null,
        })).toMatchObject({
            ok: true,
            targetSource: {
                source: 'owner/repo-b',
                sourceEntry: {
                    source: 'owner/repo-b',
                    publish: { branchPrefix: 'publish/custom', createPr: false },
                },
            },
            publishConfig: { branchPrefix: 'publish/custom', createPr: false },
            selectedNewSkills: ['Beta', 'alpha'],
            selectedRemoveSkills: ['Legacy', 'Old'],
            effectiveCreatePr: false,
        });
    });

    test('uses createPr option before manifest publish config', () => {
        const resolver = new PublishParameterResolver();

        expect(resolver.resolve({
            manifest: createManifest(),
            source: 'owner/repo-b',
            newSkills: [],
            removeSkills: [],
            createPr: true,
        })).toMatchObject({
            ok: true,
            effectiveCreatePr: true,
        });
    });

    test('returns an error when selected new and removed skills overlap case-insensitively', () => {
        const resolver = new PublishParameterResolver();

        expect(resolver.resolve({
            manifest: createManifest(),
            source: 'owner/repo-a',
            newSkills: ['Alpha'],
            removeSkills: ['alpha'],
            createPr: null,
        })).toEqual({
            ok: false,
            error: 'Conflicting publish selection.',
            details: 'A skill cannot be both new and removed: Alpha',
        });
    });

    test('returns a source selection error when source is ambiguous or missing', () => {
        const resolver = new PublishParameterResolver();

        expect(resolver.resolveTargetSource(createManifest(), null)).toEqual({
            ok: false,
            error: 'Multiple sources configured. Use --source <source>.',
        });
        expect(resolver.resolveTargetSource(createManifest(), '   ')).toEqual({
            ok: false,
            error: 'Multiple sources configured. Use --source <source>.',
        });
        expect(resolver.resolveTargetSource(createManifest(), 'owner/missing')).toEqual({
            ok: false,
            error: 'Source "owner/missing" not found in manifest.',
        });
    });
});

function createManifest(): ManifestData {
    return {
        agents: ['codex'],
        sources: [
            {
                source: 'owner/repo-a',
                skills: null,
                publish: { branchPrefix: null, createPr: null },
            },
            {
                source: 'owner/repo-b',
                skills: null,
                publish: { branchPrefix: 'publish/custom', createPr: false },
            },
        ],
    };
}

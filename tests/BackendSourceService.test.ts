import { describe, expect, test } from 'vitest';

import BackendSourceService, { type BackendSourceDiscovery, type BackendSourceListSkillsOptions } from '../src/core/source/BackendSourceService';
import type {
    CollectSharedFilesSuccess,
    FailureResult,
    ListSkillsSuccess,
    ResolvedSource,
} from '../src/core/types';

describe('BackendSourceService', () => {
    test('delegates listSkills with normalized discovery options', () => {
        const calls: BackendSourceListSkillsOptions[] = [];
        const service = new BackendSourceService({
            createDiscovery: (options = {}): BackendSourceDiscovery => {
                calls.push(options);
                return {
                    listSkills(source: string): ListSkillsSuccess | FailureResult {
                        expect(source).toBe('owner/repo');
                        return {
                            ok: true,
                            skills: ['Example'],
                            skillEntries: [],
                            sharedFileHashes: [],
                            aliasMap: new Map(),
                            resolved: {
                                requestedRef: null,
                                defaultBranch: 'main',
                                resolvedRef: 'main',
                                resolvedCommit: 'abc123',
                                subpath: null,
                                resolvedAt: '2026-01-01T00:00:00.000Z',
                            },
                        };
                    },
                    resolveSource: createUnexpectedResolveSource,
                    collectSharedFiles: createUnexpectedCollectSharedFiles,
                };
            },
        });

        expect(service.listSkills('owner/repo', { includeInternal: true })).toMatchObject({
            ok: true,
            skills: ['Example'],
        });
        expect(calls).toEqual([{ includeInternal: true, fullDepth: false }]);
    });

    test('delegates source resolution', () => {
        const service = new BackendSourceService({
            createDiscovery: (): BackendSourceDiscovery => ({
                listSkills: createUnexpectedListSkills,
                resolveSource(source: string): ResolvedSource | FailureResult {
                    expect(source).toBe('owner/repo');
                    return {
                        ok: true,
                        handler: 'github',
                        provider: 'github',
                        url: 'https://github.com/owner/repo.git',
                        ref: null,
                        subpath: null,
                        webUrl: 'https://github.com/owner/repo',
                    };
                },
                collectSharedFiles: createUnexpectedCollectSharedFiles,
            }),
        });

        expect(service.resolveSource('owner/repo')).toMatchObject({
            ok: true,
            url: 'https://github.com/owner/repo.git',
        });
    });

    test('delegates shared file collection', () => {
        const service = new BackendSourceService({
            createDiscovery: (): BackendSourceDiscovery => ({
                listSkills: createUnexpectedListSkills,
                resolveSource: createUnexpectedResolveSource,
                collectSharedFiles(source: string, sharedFiles: string[]): CollectSharedFilesSuccess | FailureResult {
                    expect(source).toBe('owner/repo');
                    expect(sharedFiles).toEqual(['.agents/skills/shared/common.md']);
                    return {
                        ok: true,
                        files: [{
                            path: '.agents/skills/shared/common.md',
                            content: Buffer.from('# Common\n'),
                        }],
                    };
                },
            }),
        });

        expect(service.collectSharedFiles('owner/repo', ['.agents/skills/shared/common.md'])).toMatchObject({
            ok: true,
            files: [{ path: '.agents/skills/shared/common.md' }],
        });
    });
});

function createUnexpectedListSkills(): ListSkillsSuccess | FailureResult {
    throw new Error('Unexpected listSkills call');
}

function createUnexpectedResolveSource(): ResolvedSource | FailureResult {
    throw new Error('Unexpected resolveSource call');
}

function createUnexpectedCollectSharedFiles(): CollectSharedFilesSuccess | FailureResult {
    throw new Error('Unexpected collectSharedFiles call');
}

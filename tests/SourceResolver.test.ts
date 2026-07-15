import { describe, expect, test } from 'vitest';

import SourceResolver from '../src/core/source/SourceResolver';

describe('SourceResolver', () => {
    test('parses supported GitHub source formats', () => {
        const resolver = new SourceResolver();

        expect(resolver.parseGitHubSource('owner/repo')).toEqual({
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: null,
            subpath: null,
        });
        expect(resolver.parseGitHubSource('owner/repo.git')).toEqual({
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: null,
            subpath: null,
        });
        expect(resolver.parseGitHubSource('owner/repo@main/skills')).toEqual({
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: 'main',
            subpath: 'skills',
        });
        expect(resolver.parseGitHubSource('github.com/owner/repo')).toEqual({
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: null,
            subpath: null,
        });
        expect(resolver.parseGitHubSource('https://github.com/owner/repo/tree/dev')).toEqual({
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: 'dev',
            subpath: null,
        });
        expect(resolver.parseGitHubSource('https://github.com/owner/repo/tree/dev/path/to/skills')).toEqual({
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: 'dev',
            subpath: 'path/to/skills',
        });
    });

    test('resolves sources with web URLs and rejects unsupported values', () => {
        const resolver = new SourceResolver();

        expect(resolver.resolve('owner/repo@main/skills')).toEqual({
            ok: true,
            handler: 'github',
            provider: 'github',
            url: 'https://github.com/owner/repo.git',
            ref: 'main',
            subpath: 'skills',
            webUrl: 'https://github.com/owner/repo',
        });
        expect(resolver.resolve('not-a-source')).toEqual({
            ok: false,
            error: 'Unsupported source: not-a-source (allowed: github)',
        });
    });

    test('rejects source subpaths that escape the repository root', () => {
        const resolver = new SourceResolver();

        expect(resolver.parseGitHubSource('owner/repo/../../outside')).toBeNull();
        expect(resolver.parseGitHubSource('https://github.com/owner/repo/tree/main/../../outside')).toBeNull();
    });
});

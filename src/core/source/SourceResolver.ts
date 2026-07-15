import type { ResolvedSource, ResolveSourceFailure } from '../types/discovery';

export interface ParsedSource {
    provider: 'github';
    url: string;
    ref: string | null;
    subpath: string | null;
}

export type ResolvedSourceBase = Omit<ResolvedSource, 'webUrl'>;

interface SourceHandler {
    name: string;
    parse: (source: string) => ParsedSource | null;
}

export default class SourceResolver {
    private readonly sourceHandlers: SourceHandler[];

    public constructor() {
        this.sourceHandlers = [
            {
                name: 'github',
                parse: (source: string): ParsedSource | null => this.parseGitHubSource(source),
            },
        ];
    }

    public resolve(source: string): ResolvedSource | ResolveSourceFailure {
        const resolved = this.resolveBase(source);
        if (!resolved.ok) {
            return resolved;
        }

        return {
            ...resolved,
            webUrl: resolved.url.replace(/\.git$/, ''),
        };
    }

    public resolveBase(source: string): ResolvedSourceBase | ResolveSourceFailure {
        for (const handler of this.sourceHandlers) {
            const parsed = handler.parse(source);
            if (parsed) {
                return { ok: true, handler: handler.name, ...parsed };
            }
        }

        return { ok: false, error: `Unsupported source: ${source} (allowed: github)` };
    }

    public normalizeGitHubRepo(value: string): string {
        return value.replace(/\.git$/, '');
    }

    public parseGitHubSource(input: string): ParsedSource | null {
        let source = input.trim();
        if (source.startsWith('github.com/')) {
            source = `https://${source}`;
        }

        const treeWithPath = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/.exec(source);
        if (treeWithPath) {
            const [, owner, repo, ref, subpath] = treeWithPath;
            const normalizedSubpath = this.normalizeSubpath(subpath);
            if (!normalizedSubpath) {
                return null;
            }
            return {
                provider: 'github',
                url: `https://github.com/${owner}/${this.normalizeGitHubRepo(repo)}.git`,
                ref,
                subpath: normalizedSubpath,
            };
        }

        const treeRef = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?$/.exec(source);
        if (treeRef) {
            const [, owner, repo, ref] = treeRef;
            return {
                provider: 'github',
                url: `https://github.com/${owner}/${this.normalizeGitHubRepo(repo)}.git`,
                ref,
                subpath: null,
            };
        }

        const repoUrl = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(source);
        if (repoUrl) {
            const [, owner, repo] = repoUrl;
            return {
                provider: 'github',
                url: `https://github.com/${owner}/${this.normalizeGitHubRepo(repo)}.git`,
                ref: null,
                subpath: null,
            };
        }

        const shorthand = /^([^/]+)\/([^/]+?)(?:@([^/]+))?(?:\/(.+))?$/.exec(source);
        if (shorthand) {
            const [, owner, repo, ref, subpath] = shorthand;
            const normalizedSubpath = subpath ? this.normalizeSubpath(subpath) : null;
            if (subpath && !normalizedSubpath) {
                return null;
            }
            return {
                provider: 'github',
                url: `https://github.com/${owner}/${this.normalizeGitHubRepo(repo)}.git`,
                ref: ref || null,
                subpath: normalizedSubpath,
            };
        }

        return null;
    }

    private normalizeSubpath(value: string): string | null {
        const normalized = value.trim().replace(/\\/g, '/');
        if (!normalized || normalized.startsWith('/')) {
            return null;
        }

        const segments = normalized.split('/').filter(segment => segment && segment !== '.');
        if (segments.some(segment => segment === '..')) {
            return null;
        }

        return segments.length > 0 ? segments.join('/') : null;
    }
}

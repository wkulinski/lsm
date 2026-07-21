import SkillDiscovery from './SkillDiscovery';
import type {
    CollectSharedFilesSuccess,
    FailureResult,
    ListSkillsSuccess,
    ResolvedSource,
} from '../types/discovery';

export interface BackendSourceListSkillsOptions {
    includeInternal?: boolean;
    fullDepth?: boolean;
    resolvedCommit?: string | null;
}

export type BackendSourceDiscovery = Pick<SkillDiscovery, 'listSkills' | 'resolveSource' | 'collectSharedFiles'>;
type SkillDiscoveryFactory = (options?: BackendSourceListSkillsOptions) => BackendSourceDiscovery;

export default class BackendSourceService {
    private readonly createDiscovery: SkillDiscoveryFactory;

    public constructor({
        createDiscovery = (options?: BackendSourceListSkillsOptions): BackendSourceDiscovery => new SkillDiscovery(options),
    }: { createDiscovery?: SkillDiscoveryFactory } = {}) {
        this.createDiscovery = createDiscovery;
    }

    public listSkills(source: string, options: BackendSourceListSkillsOptions = {}): ListSkillsSuccess | FailureResult {
        const discovery = this.createDiscovery({
            includeInternal: options.includeInternal ?? false,
            fullDepth: options.fullDepth ?? false,
        });
        return discovery.listSkills(source, { resolvedCommit: options.resolvedCommit ?? null });
    }

    public resolveSource(source: string): ResolvedSource | FailureResult {
        return this.createDiscovery().resolveSource(source);
    }

    public collectSharedFiles(source: string, sharedFiles: string[], options: { resolvedCommit?: string | null } = {}): CollectSharedFilesSuccess | FailureResult {
        return this.createDiscovery().collectSharedFiles(source, sharedFiles, options);
    }
}

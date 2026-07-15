import type {
    ManifestData,
    ManifestPublishConfig,
    ManifestSourceEntry,
} from '../types';

export interface PublishErrorResult {
    ok: false;
    error: string;
    details?: string;
    compareUrl?: string | null;
}

export interface ResolvedTargetSourceSuccess {
    ok: true;
    source: string;
    sourceEntry: ManifestSourceEntry;
}

export interface ResolvePublishParametersSuccess {
    ok: true;
    targetSource: ResolvedTargetSourceSuccess;
    publishConfig: ManifestPublishConfig;
    selectedNewSkills: string[];
    selectedRemoveSkills: string[];
    effectiveCreatePr: boolean;
}

export default class PublishParameterResolver {
    public resolve({
        manifest,
        source,
        newSkills,
        removeSkills,
        createPr,
    }: {
        manifest: ManifestData;
        source?: string | null;
        newSkills: string[];
        removeSkills: string[];
        createPr: boolean | null;
    }): ResolvePublishParametersSuccess | PublishErrorResult {
        const targetSource = this.resolveTargetSource(manifest, source);
        if (!targetSource.ok) {
            return targetSource;
        }

        const publishConfig = targetSource.sourceEntry.publish;
        const selectedNewSkills = this.normalizeNewSkills(newSkills);
        const selectedRemoveSkills = this.normalizeRemoveSkills(removeSkills);
        const conflictingSkills = selectedNewSkills.filter(skillName => (
            selectedRemoveSkills.some(removeName => removeName.toLowerCase() === skillName.toLowerCase())
        ));
        if (conflictingSkills.length > 0) {
            return {
                ok: false,
                error: 'Conflicting publish selection.',
                details: `A skill cannot be both new and removed: ${conflictingSkills.join(', ')}`,
            };
        }
        const effectiveCreatePr = typeof createPr === 'boolean'
            ? createPr
            : (typeof publishConfig.createPr === 'boolean' ? publishConfig.createPr : true);

        return {
            ok: true,
            targetSource,
            publishConfig,
            selectedNewSkills,
            selectedRemoveSkills,
            effectiveCreatePr,
        };
    }

    public resolveTargetSource(manifest: ManifestData, source: string | null | undefined): ResolvedTargetSourceSuccess | PublishErrorResult {
        const normalizedSource = typeof source === 'string' ? source.trim() : '';
        if (normalizedSource) {
            const selected = manifest.sources.find((entry: ManifestSourceEntry) => entry.source === normalizedSource);
            if (!selected) {
                return {
                    ok: false,
                    error: `Source "${normalizedSource}" not found in manifest.`,
                };
            }
            return { ok: true, source: selected.source, sourceEntry: selected };
        }

        if (manifest.sources.length === 1) {
            const selected = manifest.sources[0];
            return { ok: true, source: selected.source, sourceEntry: selected };
        }

        return {
            ok: false,
            error: 'Multiple sources configured. Use --source <source>.',
        };
    }

    public normalizeNewSkills(newSkills: unknown): string[] {
        return this.normalizeSkillNameList(newSkills);
    }

    public normalizeRemoveSkills(removeSkills: unknown): string[] {
        return this.normalizeSkillNameList(removeSkills);
    }

    public normalizeSkillNameList(values: unknown): string[] {
        if (!Array.isArray(values)) {
            return [];
        }

        const unique = new Map<string, string>();
        values.forEach((value) => {
            const normalized = String(value ?? '').trim();
            if (!normalized) {
                return;
            }
            const key = normalized.toLowerCase();
            if (!unique.has(key)) {
                unique.set(key, normalized);
            }
        });

        return [...unique.values()];
    }
}

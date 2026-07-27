import Helpers from '../shared/Helpers';
import type { ManifestData } from '../types';

interface UnknownRecord { [key: string]: unknown }

export default class ManifestNormalizer {
    private readonly manifestFileName: string;

    public constructor({ manifestFileName }: { manifestFileName: string }) {
        this.manifestFileName = manifestFileName;
    }

    public normalize(json: unknown): ManifestData {
        const record = json as UnknownRecord;
        const agents = this.normalizeStringArray('agents', record.agents, { allowEmpty: true, allowUndefined: true });
        const subagents = this.normalizeSubagentTargets(record.subagents);
        if (agents.length === 0 && subagents.length === 0) {
            Helpers.die(`"${this.manifestFileName}": at least one of "agents" or "subagents" must be non-empty`);
        }

        const sources = record.sources ?? [];
        if (!Array.isArray(sources)) {
            Helpers.die(`"${this.manifestFileName}": "sources" must be an array`);
        }
        if (sources.length === 0) {
            return { agents, subagents, sources: [] };
        }

        const normalizedSources = new Set<string>();
        const normalized = sources.map((sourceEntry: unknown) => {
            if (!sourceEntry || typeof sourceEntry !== 'object' || Array.isArray(sourceEntry)) {
                Helpers.die(`"${this.manifestFileName}": each source entry must be an object`);
            }
            const e = sourceEntry as UnknownRecord;

            if (typeof e.source !== 'string' || !e.source.trim()) {
                Helpers.die(`"${this.manifestFileName}": each source entry needs {"source": "..."}`);
            }
            const source = e.source.trim();
            if (normalizedSources.has(source)) {
                Helpers.die(`"${this.manifestFileName}": duplicate source "${source}"`);
            }
            normalizedSources.add(source);

            const hasSkills = Object.hasOwn(e, 'skills');
            if (hasSkills && !Array.isArray(e.skills)) {
                Helpers.die(`"${this.manifestFileName}": "skills" must be an array when present`);
            }

            if (Object.hasOwn(e, 'copies')) {
                Helpers.die(`"${this.manifestFileName}": "copies" is no longer supported; use skill frontmatter "shared_files"`);
            }

            const hasPublish = Object.hasOwn(e, 'publish');
            if (hasPublish && (!e.publish || typeof e.publish !== 'object' || Array.isArray(e.publish))) {
                Helpers.die(`"${this.manifestFileName}": "publish" must be an object when present`);
            }

            const skills = Array.isArray(e.skills)
                ? Helpers.sortUniq((e.skills as unknown[]).map(x => String(x).trim()).filter(Boolean))
                : null;
            const subagentSelection = this.normalizeSourceSubagents(e.subagents);

            const publish = hasPublish
                ? this.normalizeManifestPublish(e.publish as UnknownRecord)
                : {
                    branchPrefix: null,
                    createPr: null,
                };

            return { source, skills, subagents: subagentSelection, publish };
        });

        return { agents, subagents, sources: normalized };
    }

    public ensureNonEmptyStringArray(name: string, value: unknown): void {
        this.normalizeStringArray(name, value, { allowEmpty: false });
    }

    private normalizeStringArray(
        name: string,
        value: unknown,
        { allowEmpty = false, allowUndefined = false }: { allowEmpty?: boolean; allowUndefined?: boolean } = {},
    ): string[] {
        if (typeof value === 'undefined' && allowUndefined) {
            return [];
        }
        if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
            Helpers.die(`"${name}" must be ${allowEmpty ? 'an array' : 'a non-empty array'}`);
        }
        const normalized = value.map((x: unknown) => {
            if (typeof x !== 'string' || !x.trim()) {
                Helpers.die(`"${name}" contains empty/non-string value`);
            }
            return x.trim();
        });
        return Helpers.sortUniq(normalized);
    }

    private normalizeSubagentTargets(value: unknown): string[] {
        if (value === null || typeof value === 'undefined') {
            return [];
        }
        const targets = this.normalizeStringArray('subagents', value, { allowEmpty: true });
        targets.forEach((target) => {
            if (target !== 'opencode') {
                Helpers.die(`"${this.manifestFileName}": unsupported subagent target "${target}"; expected "opencode"`);
            }
        });
        return targets;
    }

    private normalizeSourceSubagents(value: unknown): string[] | null {
        if (value === null || typeof value === 'undefined') {
            return null;
        }
        return this.normalizeStringArray('subagents', value, { allowEmpty: true });
    }

    public normalizeManifestPublish(publish: UnknownRecord): { branchPrefix: string | null; createPr: boolean | null } {
        const result: { branchPrefix: string | null; createPr: boolean | null } = {
            branchPrefix: null,
            createPr: null,
        };

        if (Object.hasOwn(publish, 'branchPrefix')) {
            if (typeof publish.branchPrefix !== 'string' || !publish.branchPrefix.trim()) {
                Helpers.die(`"${this.manifestFileName}": "publish.branchPrefix" must be a non-empty string`);
            }
            result.branchPrefix = publish.branchPrefix.trim();
        }

        if (Object.hasOwn(publish, 'createPr')) {
            if (typeof publish.createPr !== 'boolean') {
                Helpers.die(`"${this.manifestFileName}": "publish.createPr" must be boolean`);
            }
            result.createPr = publish.createPr;
        }

        if (Object.hasOwn(publish, 'includeNewByDefault')) {
            Helpers.die(`"${this.manifestFileName}": "publish.includeNewByDefault" is no longer supported`);
        }

        return result;
    }
}

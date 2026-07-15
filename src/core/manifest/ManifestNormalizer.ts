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
        this.ensureNonEmptyStringArray('agents', record.agents);

        const sources = record.sources ?? [];
        if (!Array.isArray(sources)) {
            Helpers.die(`"${this.manifestFileName}": "sources" must be an array`);
        }
        if (sources.length === 0) {
            return { agents: Helpers.sortUniq((record.agents as string[]).map((x: string) => x.trim())), sources: [] };
        }

        const normalized = sources.map((sourceEntry: unknown) => {
            if (!sourceEntry || typeof sourceEntry !== 'object' || Array.isArray(sourceEntry)) {
                Helpers.die(`"${this.manifestFileName}": each source entry must be an object`);
            }
            const e = sourceEntry as UnknownRecord;

            if (typeof e.source !== 'string' || !e.source.trim()) {
                Helpers.die(`"${this.manifestFileName}": each source entry needs {"source": "..."}`);
            }

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
            if (skills) {
                skills.forEach((skill) => {
                    if (!skill) {
                        Helpers.die(`"${this.manifestFileName}": "skills" contains empty value`);
                    }
                });
            }

            const publish = hasPublish
                ? this.normalizeManifestPublish(e.publish as UnknownRecord)
                : {
                    branchPrefix: null,
                    createPr: null,
                };

            return { source: e.source.trim(), skills, publish };
        });

        return { agents: Helpers.sortUniq((record.agents as string[]).map((x: string) => x.trim())), sources: normalized };
    }

    public ensureNonEmptyStringArray(name: string, value: unknown): void {
        if (!Array.isArray(value) || value.length === 0) {
            Helpers.die(`"${name}" must be a non-empty array`);
        }
        value.forEach((x: unknown) => {
            if (typeof x !== 'string' || !x.trim()) {
                Helpers.die(`"${name}" contains empty/non-string value`);
            }
        });
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

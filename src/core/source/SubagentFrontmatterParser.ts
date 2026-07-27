import fs from 'node:fs';
import { parseDocument } from 'yaml';

interface UnknownRecord { [key: string]: unknown }

export interface SubagentFrontmatter {
    name?: string | null;
    description?: string | null;
}

export default class SubagentFrontmatterParser {
    public parse(filePath: string): SubagentFrontmatter {
        const content = fs.readFileSync(filePath, 'utf8');
        const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content);
        if (!match) {
            return {};
        }

        const document = parseDocument(match[1]);
        if (document.errors.length > 0) {
            throw new Error(`Invalid subagent frontmatter in ${filePath}: ${document.errors[0].message}`);
        }

        const data = document.toJS({ maxAliasCount: 0 }) as unknown;
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error(`Invalid subagent frontmatter in ${filePath}: frontmatter must be an object`);
        }

        const record = data as UnknownRecord;
        const name = this.readOptionalString(record.name, 'name', filePath);
        const description = this.readOptionalString(record.description, 'description', filePath);
        return { name, description };
    }

    private readOptionalString(value: unknown, fieldName: string, filePath: string): string | null {
        if (typeof value === 'undefined' || value === null) {
            return null;
        }
        if (typeof value !== 'string' || !value.trim()) {
            throw new Error(`Invalid subagent frontmatter in ${filePath}: "${fieldName}" must be a non-empty string`);
        }
        return value.trim();
    }
}

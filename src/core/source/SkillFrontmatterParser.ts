import fs from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';

import { hasSymlinkInPath, isPathInside, toPosixPath } from '../filesystem/PathUtils';
import type { SkillDefinition } from '../types/discovery';

interface SkillFrontmatter {
    name?: unknown;
    description?: unknown;
    metadata?: {
        internal?: unknown;
    };
    shared_files?: unknown;
}

export interface SkillContext {
    basePath: string;
    searchPath: string;
}

export interface SharedFilesDeclarationInput extends SkillContext {
    value: unknown;
    skillName: string;
    skillDir: string;
}

export default class SkillFrontmatterParser {
    private readonly includeInternal: boolean;

    public constructor({ includeInternal = false }: { includeInternal?: boolean } = {}) {
        this.includeInternal = includeInternal;
    }

    public parseSkillMd(skillDir: string, { basePath, searchPath }: SkillContext): SkillDefinition | null {
        if (hasSymlinkInPath(skillDir, basePath)) {
            return null;
        }
        const filePath = path.join(skillDir, 'SKILL.md');
        if (hasSymlinkInPath(filePath, basePath)) {
            return null;
        }
        if (!fs.existsSync(filePath)) {
            return null;
        }
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const data = parseSkillFrontmatter(content) as SkillFrontmatter;
            if (typeof data.name !== 'string' || typeof data.description !== 'string') {
                return null;
            }
            const isInternal = data.metadata?.internal === true;
            if (isInternal && !this.includeInternal) {
                return null;
            }

            const sharedFiles = this.normalizeSharedFilesDeclaration({
                value: data.shared_files,
                skillName: data.name.trim(),
                skillDir,
                basePath,
                searchPath,
            });

            return {
                name: data.name.trim(),
                description: data.description.trim(),
                path: skillDir,
                sharedFiles,
            };
        }
        catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            throw new Error(`Invalid skill definition in ${filePath}: ${message}`, { cause: e });
        }
    }

    public normalizeSharedFilesDeclaration(
        { value, skillName, skillDir, basePath, searchPath }: SharedFilesDeclarationInput,
    ): string[] {
        if (value === null || typeof value === 'undefined') {
            return [];
        }

        if (!Array.isArray(value)) {
            throw new Error(`Skill "${skillName}": "shared_files" must be an array`);
        }

        const skillsRootPath = this.resolveSkillsRootPath(skillDir, searchPath);
        const normalized = value.map((entry: unknown, index: number) => {
            const indexLabel = String(index);
            const relativeToSkills = this.normalizeRelativePath(entry, `shared_files[${indexLabel}]`);
            const absoluteSharedPath = path.resolve(skillsRootPath, relativeToSkills);
            if (!isPathInside(absoluteSharedPath, skillsRootPath)) {
                throw new Error(`Skill "${skillName}": "shared_files[${indexLabel}]" escapes skills root`);
            }
            if (hasSymlinkInPath(absoluteSharedPath, skillsRootPath)) {
                throw new Error(`Skill "${skillName}": shared file contains a symbolic link: ${relativeToSkills}`);
            }
            if (!fs.existsSync(absoluteSharedPath)) {
                throw new Error(`Skill "${skillName}": shared file does not exist: ${relativeToSkills}`);
            }

            const stat = fs.statSync(absoluteSharedPath);
            if (!stat.isFile()) {
                throw new Error(`Skill "${skillName}": shared file path is not a file: ${relativeToSkills}`);
            }

            return toPosixPath(path.relative(basePath, absoluteSharedPath));
        });

        return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
    }

    public resolveSkillsRootPath(skillDir: string, searchPath: string): string {
        const parts = path.resolve(skillDir).split(path.sep);
        const skillsIndexes: number[] = [];
        parts.forEach((part: string, idx: number) => {
            if (part === 'skills') {
                skillsIndexes.push(idx);
            }
        });

        if (skillsIndexes.length === 0) {
            return path.resolve(searchPath);
        }

        const index = skillsIndexes[skillsIndexes.length - 1];
        const root = parts.slice(0, index + 1).join(path.sep) || path.sep;
        return root;
    }

    public normalizeRelativePath(value: unknown, fieldName: string): string {
        if (typeof value !== 'string') {
            throw new Error(`"${fieldName}" must be a string`);
        }

        const normalizedSlashes = value.trim().replace(/\\/g, '/');
        if (!normalizedSlashes) {
            throw new Error(`"${fieldName}" cannot be empty`);
        }

        if (normalizedSlashes.startsWith('/') || /^[A-Za-z]:\//.test(normalizedSlashes)) {
            throw new Error(`"${fieldName}" must be a relative path`);
        }

        const tokens = normalizedSlashes
            .split('/')
            .filter(token => token.length > 0 && token !== '.');

        if (tokens.some(token => token === '..')) {
            throw new Error(`"${fieldName}" cannot contain ".."`);
        }

        return tokens.length > 0 ? tokens.join('/') : '.';
    }
}

function parseSkillFrontmatter(content: string): unknown {
    const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content);
    if (!match) {
        return {};
    }

    const document = parseDocument(match[1]);
    if (document.errors.length > 0) {
        throw document.errors[0];
    }

    return document.toJS({ maxAliasCount: 0 });
}

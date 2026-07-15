import fs from 'node:fs';
import path from 'node:path';

import SkillFrontmatterParser, { type SkillContext } from './SkillFrontmatterParser';
import { hasSymlinkInPath, isPathInside } from '../filesystem/PathUtils';
import type { SkillDefinition } from '../types/discovery';

export interface DiscoveredSkills {
    skills: SkillDefinition[];
    aliasMap: Map<string, string>;
}

export default class SkillScanner {
    public fullDepth: boolean;
    public skipDirs: Set<string>;
    public skillFrontmatterParser: SkillFrontmatterParser;

    public constructor(
        {
            fullDepth = false,
            skipDirs = new Set([
                'node_modules',
                '.git',
                'dist',
                'build',
            ]),
            skillFrontmatterParser = new SkillFrontmatterParser(),
        }: {
            fullDepth?: boolean;
            skipDirs?: Set<string>;
            skillFrontmatterParser?: SkillFrontmatterParser;
        } = {},
    ) {
        this.fullDepth = fullDepth;
        this.skipDirs = skipDirs;
        this.skillFrontmatterParser = skillFrontmatterParser;
    }

    public discover(basePath: string, subpath: string | null): DiscoveredSkills {
        const skills: SkillDefinition[] = [];
        const seen = new Set<string>();
        const aliasMap = new Map<string, string>();
        const searchPath = subpath ? path.resolve(basePath, subpath) : path.resolve(basePath);

        if (!isPathInside(searchPath, basePath) || hasSymlinkInPath(searchPath, basePath)) {
            return { skills, aliasMap };
        }

        if (!fs.existsSync(searchPath)) {
            return { skills, aliasMap };
        }

        const addedRoot = this.collectIfSkillDir(searchPath, skills, seen, aliasMap, { basePath, searchPath });
        if (addedRoot && !this.fullDepth) {
            return { skills, aliasMap };
        }

        this.discoverInPriorityDirs(searchPath, skills, seen, aliasMap, { basePath, searchPath });

        if (skills.length === 0 || this.fullDepth) {
            const allSkillDirs = this.findSkillDirs(searchPath);
            allSkillDirs.forEach((skillDir) => {
                this.collectIfSkillDir(skillDir, skills, seen, aliasMap, { basePath, searchPath });
            });
        }

        return { skills, aliasMap };
    }

    public discoverInPriorityDirs(
        searchPath: string,
        skills: SkillDefinition[],
        seen: Set<string>,
        aliasMap: Map<string, string>,
        context: SkillContext,
    ): void {
        const prioritySearchDirs = this.prioritySearchDirs(searchPath);
        prioritySearchDirs.forEach((dir) => {
            this.scanDirectSkillDirs(dir, skills, seen, aliasMap, context);
        });
    }

    public scanDirectSkillDirs(
        dir: string,
        skills: SkillDefinition[],
        seen: Set<string>,
        aliasMap: Map<string, string>,
        context: SkillContext,
    ): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }

        entries.forEach((entry) => {
            if (!entry.isDirectory()) {
                return;
            }
            const skillDir = path.join(dir, entry.name);
            this.collectIfSkillDir(skillDir, skills, seen, aliasMap, context);
        });
    }

    public collectIfSkillDir(
        skillDir: string,
        skills: SkillDefinition[],
        seen: Set<string>,
        aliasMap: Map<string, string>,
        context: SkillContext,
    ): boolean {
        if (hasSymlinkInPath(skillDir, context.basePath)) {
            return false;
        }
        if (!this.hasSkillMd(skillDir)) {
            return false;
        }
        const skill = this.parseSkillMd(skillDir, context);
        if (!skill) {
            return false;
        }
        this.addSkill(skill, skills, seen, aliasMap);
        return true;
    }

    public addSkill(
        skill: SkillDefinition,
        skills: SkillDefinition[],
        seen: Set<string>,
        aliasMap: Map<string, string>,
    ): void {
        const name = skill.name.trim();
        if (!name) {
            return;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        skills.push(skill);
        seen.add(key);
        aliasMap.set(key, name);
        const dirName = path.basename(skill.path).toLowerCase();
        if (dirName && !aliasMap.has(dirName)) {
            aliasMap.set(dirName, name);
        }
    }

    public hasSkillMd(dir: string): boolean {
        return fs.existsSync(path.join(dir, 'SKILL.md'));
    }

    public parseSkillMd(skillDir: string, context: SkillContext): SkillDefinition | null {
        return this.skillFrontmatterParser.parseSkillMd(skillDir, context);
    }

    public findSkillDirs(dir: string, depth = 0, maxDepth = 5): string[] {
        if (depth > maxDepth) {
            return [];
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return [];
        }

        const found: string[] = [];
        if (this.hasSkillMd(dir)) {
            found.push(dir);
        }

        entries.forEach((entry) => {
            if (!entry.isDirectory()) {
                return;
            }
            if (this.skipDirs.has(entry.name)) {
                return;
            }
            const nested = this.findSkillDirs(path.join(dir, entry.name), depth + 1, maxDepth);
            nested.forEach(item => found.push(item));
        });

        return found;
    }

    public prioritySearchDirs(searchPath: string): string[] {
        return [
            searchPath,
            path.join(searchPath, 'skills'),
            path.join(searchPath, 'skills/.curated'),
            path.join(searchPath, 'skills/.experimental'),
            path.join(searchPath, 'skills/.system'),
            path.join(searchPath, '.agent/skills'),
            path.join(searchPath, '.agents/skills'),
            path.join(searchPath, '.claude/skills'),
            path.join(searchPath, '.cline/skills'),
            path.join(searchPath, '.codebuddy/skills'),
            path.join(searchPath, '.codex/skills'),
            path.join(searchPath, '.commandcode/skills'),
            path.join(searchPath, '.continue/skills'),
            path.join(searchPath, '.cursor/skills'),
            path.join(searchPath, '.github/skills'),
            path.join(searchPath, '.goose/skills'),
            path.join(searchPath, '.iflow/skills'),
            path.join(searchPath, '.junie/skills'),
            path.join(searchPath, '.kilocode/skills'),
            path.join(searchPath, '.kiro/skills'),
            path.join(searchPath, '.mux/skills'),
            path.join(searchPath, '.neovate/skills'),
            path.join(searchPath, '.opencode/skills'),
            path.join(searchPath, '.openhands/skills'),
            path.join(searchPath, '.pi/skills'),
            path.join(searchPath, '.qoder/skills'),
            path.join(searchPath, '.roo/skills'),
            path.join(searchPath, '.trae/skills'),
            path.join(searchPath, '.windsurf/skills'),
            path.join(searchPath, '.zencoder/skills'),
        ];
    }
}

import fs from 'node:fs';
import path from 'node:path';

import SubagentRegistry from '../agents/SubagentRegistry';
import { hasExecutableBit } from '../filesystem/FilePermissions';
import { hasSymlinkInPath, toPosixPath } from '../filesystem/PathUtils';
import Hashing from '../shared/Hashing';
import type { SubagentEntry } from '../types/manifest';
import type {
    FailureResult,
    SubagentDefinition,
    SubagentDiscoverySuccess,
} from '../types/discovery';
import SharedFileCollector from './SharedFileCollector';
import SubagentFrontmatterParser from './SubagentFrontmatterParser';
import SubagentMetadataReader from './SubagentMetadataReader';
import type { SourceWorkspaceHandle } from './SourceWorkspace';

interface Candidate {
    filePath: string;
    sourcePath: string;
    variantDirectory: string;
    name: string;
    description: string | null;
    sharedFiles: string[];
}

export default class SubagentDiscovery {
    private readonly registry: SubagentRegistry;
    private readonly frontmatterParser: SubagentFrontmatterParser;
    private readonly metadataReader: SubagentMetadataReader;
    private readonly sharedFileCollector: SharedFileCollector;

    public constructor(
        {
            registry = new SubagentRegistry(),
            frontmatterParser = new SubagentFrontmatterParser(),
            metadataReader = new SubagentMetadataReader(),
            sharedFileCollector = new SharedFileCollector(),
        }: {
            registry?: SubagentRegistry;
            frontmatterParser?: SubagentFrontmatterParser;
            metadataReader?: SubagentMetadataReader;
            sharedFileCollector?: SharedFileCollector;
        } = {},
    ) {
        this.registry = registry;
        this.frontmatterParser = frontmatterParser;
        this.metadataReader = metadataReader;
        this.sharedFileCollector = sharedFileCollector;
    }

    public discoverWorkspace(
        workspace: SourceWorkspaceHandle,
        {
            selected = null,
            projectRoot,
            mode = 'update',
            lockedEntries = [],
        }: {
            selected?: string[] | null;
            projectRoot?: string;
            mode?: 'update' | 'locked';
            lockedEntries?: SubagentEntry[];
        } = {},
    ): SubagentDiscoverySuccess | FailureResult {
        const sourceRoot = path.resolve(workspace.root, workspace.resolved.subpath ?? '.');
        if (Array.isArray(selected) && selected.length === 0) {
            return { ok: true, subagents: [], sharedFiles: [] };
        }
        const candidates = this.collectCandidates(sourceRoot);
        const candidateByName = new Map<string, Candidate>();
        candidates.forEach((candidate) => {
            const key = candidate.name.toLowerCase();
            if (candidateByName.has(key)) {
                throw new Error(`Duplicate subagent name: ${candidate.name}`);
            }
            candidateByName.set(key, candidate);
        });

        const selectedCandidates = this.selectCandidates(candidates, selected);
        const lockedByName = new Map(lockedEntries.map(entry => [entry.name.toLowerCase(), entry]));
        const subagents = selectedCandidates.map(candidate => this.createDefinition(candidate, {
            projectRoot,
            mode,
            lockedEntry: lockedByName.get(candidate.name.toLowerCase()),
        }));

        const targetPaths = new Map<string, string>();
        subagents.forEach((subagent) => {
            const existing = targetPaths.get(subagent.targetPath);
            if (existing) {
                throw new Error(`Duplicate subagent target path: ${subagent.targetPath} (${existing}, ${subagent.name})`);
            }
            targetPaths.set(subagent.targetPath, subagent.name);
        });

        const sharedPaths = [...new Set(subagents.flatMap(subagent => subagent.sharedFiles))]
            .sort((left, right) => left.localeCompare(right));
        const sharedResult = this.sharedFileCollector.collectSharedFiles(sourceRoot, sharedPaths);
        if (!sharedResult.ok) {
            return sharedResult;
        }

        return {
            ok: true,
            subagents: subagents.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
            sharedFiles: sharedResult.files,
        };
    }

    private collectCandidates(sourceRoot: string): Candidate[] {
        const candidates: Candidate[] = [];
        this.registry.sourceDirectories(sourceRoot).forEach((directory) => {
            if (hasSymlinkInPath(directory.absolutePath, sourceRoot)) {
                throw new Error(`Subagent directory contains a symbolic link: ${directory.relativePath}`);
            }
            this.collectDirectory(directory.absolutePath, directory.absolutePath, directory.relativePath, sourceRoot, candidates);
        });
        return candidates.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    }

    private collectDirectory(directoryPath: string, variantRoot: string, relativeDirectory: string, sourceRoot: string, candidates: Candidate[]): void {
        fs.readdirSync(directoryPath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))
            .forEach((entry) => {
                const filePath = path.join(directoryPath, entry.name);
                if (entry.isSymbolicLink()) {
                    throw new Error(`Subagent path contains a symbolic link: ${toPosixPath(path.relative(sourceRoot, filePath))}`);
                }
                if (entry.isDirectory()) {
                    this.collectDirectory(filePath, variantRoot, `${relativeDirectory}/${entry.name}`, sourceRoot, candidates);
                    return;
                }
                if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
                    return;
                }

                const frontmatter = this.frontmatterParser.parse(filePath);
                const relativeFilePath = toPosixPath(path.relative(sourceRoot, filePath));
                const relativeName = toPosixPath(path.relative(variantRoot, filePath)).replace(/\.md$/i, '');
                const name = frontmatter.name ?? relativeName;
                const sharedFiles = this.metadataReader.read(filePath, sourceRoot);
                candidates.push({
                    filePath,
                    sourcePath: relativeFilePath,
                    variantDirectory: relativeDirectory,
                    name,
                    description: frontmatter.description ?? null,
                    sharedFiles,
                });
            });
    }

    private selectCandidates(candidates: Candidate[], selected: string[] | null): Candidate[] {
        if (selected === null || typeof selected === 'undefined') {
            return candidates;
        }
        if (selected.length === 0) {
            return [];
        }

        const desired = new Set(selected.map(name => name.trim().toLowerCase()));
        const found = candidates.filter(candidate => desired.has(candidate.name.toLowerCase()));
        const foundNames = new Set(found.map(candidate => candidate.name.toLowerCase()));
        const missing = selected.filter(name => !foundNames.has(name.trim().toLowerCase()));
        if (missing.length > 0) {
            throw new Error(`Requested subagent not found: ${missing[0]}`);
        }
        return found;
    }

    private createDefinition(
        candidate: Candidate,
        {
            projectRoot,
            mode,
            lockedEntry,
        }: {
            projectRoot?: string;
            mode: 'update' | 'locked';
            lockedEntry?: SubagentEntry;
        },
    ): SubagentDefinition {
        if (mode === 'locked' && lockedEntry?.sourcePath !== candidate.sourcePath) {
            throw new Error(`Locked subagent entry does not match source path: ${candidate.name}`);
        }

        const content = fs.readFileSync(candidate.filePath);
        const stat = fs.lstatSync(candidate.filePath);
        if (stat.isSymbolicLink()) {
            throw new Error(`Subagent file contains a symbolic link: ${candidate.sourcePath}`);
        }

        const targetPath = this.registry.resolveTargetPath({
            sourcePath: candidate.sourcePath,
            projectRoot,
            mode,
            lockedTargetPath: lockedEntry?.targetPath,
        });
        return {
            name: candidate.name,
            description: candidate.description,
            sourcePath: candidate.sourcePath,
            targetPath,
            sharedFiles: candidate.sharedFiles,
            content,
            hash: {
                sha256: Hashing.sha256Buffer(content),
                executable: hasExecutableBit(stat.mode),
            },
        };
    }
}

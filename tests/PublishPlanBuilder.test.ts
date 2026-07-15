import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import PublishPlanBuilder, { type PublishPlanBuilderManifestStore } from '../src/core/publish/PublishPlanBuilder';
import { createTempDir } from './helpers';
import type {
    LocalSkill,
    LockData,
    LockSourceMeta,
    SkillEntry,
} from '../src/core/types';

describe('PublishPlanBuilder', () => {
    test('builds a plan for managed skills, new skills, shared files, and stale shared file deletion', () => {
        const tempDir = createTempDir();

        try {
            const sharedFilePath = '.agents/skills/shared/keep.md';
            writeFile(path.join(tempDir, sharedFilePath), '# Shared\n');

            const lockSource = createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                        sharedFiles: [
                            sharedFilePath,
                            '.agents/skills/shared/stale.md',
                        ],
                    }),
                ],
            });
            const lock = createLock({ sources: { upstream: lockSource } });
            const builder = createBuilder(tempDir, lock);

            const plan = builder.build({
                localSkills: createLocalSkills(tempDir, [
                    createLocalSkill({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                        sharedFiles: [sharedFilePath],
                    }),
                    createLocalSkill({
                        name: 'Beta',
                        sourcePath: '.agents/skills/beta',
                    }),
                ]),
                lock,
                lockSource,
                targetSource: 'upstream',
                newSkills: ['Beta'],
                removeSkills: [],
            });

            expect(plan.errors).toEqual([]);
            expect(plan.warnings).toEqual([]);
            expect(plan.items).toEqual([
                {
                    type: 'directory',
                    localPath: path.join(tempDir, '.agents', 'skills', 'alpha'),
                    targetPath: '.agents/skills/alpha',
                },
                {
                    type: 'directory',
                    localPath: path.join(tempDir, '.agents', 'skills', 'beta'),
                    targetPath: '.agents/skills/beta',
                    isNewSkill: true,
                },
                {
                    type: 'file',
                    localPath: path.join(tempDir, '.agents', 'skills', 'shared', 'keep.md'),
                    targetPath: '.agents/skills/shared/keep.md',
                    isSharedFile: true,
                },
                {
                    type: 'delete',
                    deleteKind: 'file',
                    targetPath: '.agents/skills/shared/stale.md',
                    isSharedFile: true,
                },
            ]);
            expect(plan.deleteItems).toEqual([{
                type: 'delete',
                deleteKind: 'file',
                targetPath: '.agents/skills/shared/stale.md',
                isSharedFile: true,
            }]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('plans explicit removal only when the managed skill is already absent locally', () => {
        const tempDir = createTempDir();

        try {
            const lockSource = createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                    }),
                ],
            });
            const lock = createLock({ sources: { upstream: lockSource } });
            const builder = createBuilder(tempDir, lock);

            const plan = builder.build({
                localSkills: createLocalSkills(tempDir, [
                    createLocalSkill({
                        name: 'Beta',
                        sourcePath: '.agents/skills/beta',
                    }),
                ]),
                lock,
                lockSource,
                targetSource: 'upstream',
                newSkills: [],
                removeSkills: ['Alpha'],
            });

            expect(plan.errors).toEqual([]);
            expect(plan.items).toEqual([{
                type: 'delete',
                deleteKind: 'directory',
                targetPath: '.agents/skills/alpha',
                skillName: 'Alpha',
            }]);
            expect(builder.formatDeleteItems(plan.deleteItems)).toBe([
                'Planned delete paths:',
                '  - [directory] .agents/skills/alpha',
                '',
                'Re-run with --confirm-deletes to allow these deletions.',
            ].join('\n'));
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('rejects a managed entry that points at the source skills root', () => {
        const tempDir = createTempDir();

        try {
            const lockSource = createLockSource({
                skillEntries: [createSkillEntry({
                    name: 'Root Skill',
                    sourcePath: '.agents/skills',
                })],
            });
            const lock = createLock({ sources: { upstream: lockSource } });
            const builder = createBuilder(tempDir, lock);

            const plan = builder.build({
                localSkills: createLocalSkills(tempDir, [createLocalSkill({
                    name: 'Other',
                    sourcePath: '.agents/skills/other',
                })]),
                lock,
                lockSource,
                targetSource: 'upstream',
                newSkills: [],
                removeSkills: ['Root Skill'],
            });

            expect(plan.items).toEqual([]);
            expect(plan.deleteItems).toEqual([]);
            expect(plan.errors).toEqual([
                'Managed skill "Root Skill" resolves to the source skills root and cannot be published or removed.',
            ]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('reports selection and shared file ownership errors', () => {
        const tempDir = createTempDir();

        try {
            const sharedFilePath = '.agents/skills/shared/common.md';
            writeFile(path.join(tempDir, sharedFilePath), '# Shared\n');

            const lockSource = createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                    }),
                ],
            });
            const lock = createLock({
                sources: {
                    upstream: lockSource,
                    fork: createLockSource({
                        skillEntries: [
                            createSkillEntry({
                                name: 'Gamma',
                                sourcePath: '.agents/skills/gamma',
                                sharedFiles: [sharedFilePath],
                            }),
                        ],
                    }),
                },
            });
            const builder = createBuilder(tempDir, lock);

            const plan = builder.build({
                localSkills: createLocalSkills(tempDir, [
                    createLocalSkill({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                        sharedFiles: [sharedFilePath],
                    }),
                    createLocalSkill({
                        name: 'Gamma',
                        sourcePath: '.agents/skills/gamma',
                    }),
                ]),
                lock,
                lockSource,
                targetSource: 'upstream',
                newSkills: ['Gamma', 'Missing'],
                removeSkills: ['Unknown'],
            });

            expect(plan.errors).toEqual([
                'Skill "Unknown" was requested via --remove-skill but is not managed by source "upstream".',
                'Skill "Gamma" is not new (already managed by source: fork).',
                'Skill "Missing" was requested via --new-skill but not found locally.',
                'Shared file ".agents/skills/shared/common.md" is already owned by source "fork".',
            ]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('keeps shared files protected when a missing managed skill was not explicitly removed', () => {
        const tempDir = createTempDir();

        try {
            const lockSource = createLockSource({
                skillEntries: [
                    createSkillEntry({
                        name: 'Alpha',
                        sourcePath: '.agents/skills/alpha',
                        sharedFiles: ['.agents/skills/shared/protected.md'],
                    }),
                ],
            });
            const lock = createLock({ sources: { upstream: lockSource } });
            const builder = createBuilder(tempDir, lock);

            const plan = builder.build({
                localSkills: createLocalSkills(tempDir, [
                    createLocalSkill({
                        name: 'Beta',
                        sourcePath: '.agents/skills/beta',
                    }),
                ]),
                lock,
                lockSource,
                targetSource: 'upstream',
                newSkills: [],
                removeSkills: [],
            });

            expect(plan.errors).toEqual([]);
            expect(plan.items).toEqual([]);
            expect(plan.warnings).toEqual([
                'Skill "Alpha" is managed but missing locally; skipping upstream deletion. '
                + 'Use --remove-skill "Alpha" and --confirm-deletes to remove it upstream.',
                'Shared file ".agents/skills/shared/protected.md" remains unmanaged for now because at least one missing managed skill '
                + 'was not explicitly removed.',
            ]);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

function createBuilder(projectRoot: string, lock: LockData): PublishPlanBuilder {
    return new PublishPlanBuilder({
        projectRoot,
        manifestStore: createManifestStore(lock),
    });
}

function createManifestStore(lock: LockData): PublishPlanBuilderManifestStore {
    return {
        lockManagedSkills(): string[] {
            return Object.values(lock.sources)
                .flatMap(source => source.skillEntries)
                .map(entry => entry.name);
        },
    };
}

function createLocalSkills(projectRoot: string, skills: LocalSkill[]): Map<string, LocalSkill> {
    return new Map(skills.map(skill => [
        skill.name.toLowerCase(),
        {
            ...skill,
            path: path.join(projectRoot, skill.sourcePath),
        },
    ]));
}

function createLocalSkill(
    {
        name,
        sourcePath,
        sharedFiles = [],
    }: {
        name: string;
        sourcePath: string;
        sharedFiles?: string[];
    },
): LocalSkill {
    return {
        name,
        path: sourcePath,
        dirName: path.basename(sourcePath),
        sourcePath,
        sharedFiles,
    };
}

function createLock({ sources }: { sources: LockData['sources'] }): LockData {
    return {
        schemaVersion: 5,
        agents: ['codex'],
        sources,
    };
}

function createLockSource({ skillEntries }: { skillEntries: SkillEntry[] }): LockSourceMeta {
    return {
        mode: 'all',
        listedAt: '2026-06-05T00:00:00.000Z',
        skillEntries,
        sharedFileHashes: [],
        resolved: {
            requestedRef: null,
            defaultBranch: 'main',
            resolvedRef: 'main',
            resolvedCommit: 'abc123',
            subpath: null,
            resolvedAt: '2026-06-05T00:00:00.000Z',
        },
    };
}

function createSkillEntry(
    {
        name,
        sourcePath,
        sharedFiles = [],
    }: {
        name: string;
        sourcePath: string;
        sharedFiles?: string[];
    },
): SkillEntry {
    return {
        name,
        sourcePath,
        sharedFiles,
        hash: null,
    };
}

function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

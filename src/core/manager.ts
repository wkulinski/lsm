import path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };

import Backend from './modules/Backend.mjs';
import Manifest from './modules/Manifest.mjs';
import Publisher from './modules/Publisher.mjs';
import Sync from './modules/Sync.mjs';
import type {
    ManagerErrorResult,
    ManagerEvent,
    ManagerHeader,
    ManagerTemplatesCreatedResult,
    PublishCommandOptions,
    PublishCommandResult,
    SharedSyncResult,
    SyncCommandOptions,
    SyncCommandResult,
    SyncInstallResult,
    SyncPlan,
    SyncPreflight,
    SyncRemovalSummary,
} from './types';

type UnknownRecord = Record<string, unknown>;
type Reporter = (event: ManagerEvent) => void;

export interface ManagerOptions {
    cwd?: string;
    manifestPath?: string;
    lockPath?: string;
    maxBuffer?: number;
    disableTelemetry?: string;
    report?: Reporter;
}

interface ManagerRuntime {
    root: string;
    manifestPath: string;
    lockPath: string;
    header: ManagerHeader;
    manifestStore: any;
    backend: any;
    sync: any;
    publisher: any;
    manifest: any;
    lock: any;
}

interface ManifestRuntime {
    root: string;
    manifestPath: string;
    lockPath: string;
    manifestStore: any;
    manifest: any;
    lock: any;
}

interface NormalizedError {
    error: string;
    details?: unknown;
}

export class SkillsManager {
    private readonly options: ManagerOptions;

    constructor(options: ManagerOptions = {}) {
        this.options = options;
    }

    async runSync(options: SyncCommandOptions = {}): Promise<SyncCommandResult> {
        const report = options.report ?? this.options.report;
        const runtimeResult = this.createRuntime();
        if ('status' in runtimeResult) {
            return runtimeResult;
        }

        const runtime = runtimeResult;
        report?.({ type: 'header', header: runtime.header });

        try {
            report?.({ type: 'sync-discover-start' });
            const discovery = runtime.sync.discover(runtime.manifest);
            runtime.sync.assertNoConflicts(discovery.discovered);

            const plan = runtime.sync.planRemovals({
                lock: runtime.lock,
                manifest: runtime.manifest,
                discovered: discovery.discovered,
            }) as SyncPlan;
            report?.({ type: 'sync-plan', plan });

            const preflight = runtime.sync.collectLocalChangeConflicts({
                manifest: runtime.manifest,
                lock: runtime.lock,
                discovered: discovery.discovered,
                plan,
            }) as SyncPreflight;
            if (!preflight.ok) {
                return {
                    status: 'error',
                    exitCode: 1,
                    error: `Preflight failed: ${preflight.error}`,
                    header: runtime.header,
                };
            }

            if (preflight.conflicts.length > 0) {
                report?.({ type: 'sync-preflight', preflight, force: options.force === true });
            }

            if (preflight.conflicts.length > 0 && options.force !== true) {
                if (!options.confirmLocalChanges) {
                    return {
                        status: 'error',
                        exitCode: 1,
                        error: 'Local change conflicts detected, but no confirmation handler was provided.',
                        header: runtime.header,
                    };
                }

                const confirmed = await options.confirmLocalChanges({
                    header: runtime.header,
                    preflight,
                    plan,
                });

                if (!confirmed) {
                    return {
                        status: 'cancelled',
                        exitCode: 1,
                        header: runtime.header,
                        plan,
                        preflight,
                    };
                }
            }

            report?.({ type: 'sync-add-start' });
            Object.entries(discovery.discovered as Record<string, any>).forEach(([source, meta]) => {
                report?.({
                    type: 'sync-add-source',
                    source,
                    mode: String(meta.mode ?? 'all'),
                    skillCount: Array.isArray(meta.skills) ? meta.skills.length : 0,
                });
            });
            const addResult = runtime.sync.addPhase(discovery.discovered, runtime.manifest.agents) as {
                installs: SyncInstallResult[];
                addFailed: boolean;
            };

            if (addResult.addFailed) {
                return {
                    status: 'add-failed',
                    exitCode: 1,
                    header: runtime.header,
                    plan,
                    preflight,
                    installs: addResult.installs,
                };
            }

            report?.({ type: 'sync-shared-start' });
            const shared = runtime.sync.syncSharedFilesPhase({
                manifest: runtime.manifest,
                lock: runtime.lock,
                discovered: discovery.discovered,
            }) as SharedSyncResult;

            if (shared.sharedFailed) {
                return {
                    status: 'shared-failed',
                    exitCode: 1,
                    header: runtime.header,
                    plan,
                    preflight,
                    installs: addResult.installs,
                    shared,
                };
            }

            report?.({ type: 'sync-remove-start', plan });
            const removal = runtime.sync.removePhase(plan) as SyncRemovalSummary;

            const shouldFail = discovery.missingRequested.length > 0;
            if (!shouldFail) {
                runtime.manifestStore.writeLock({
                    agents: runtime.manifest.agents,
                    sources: lockSourcesFromDiscovered(discovery.discovered, shared.sharedFileHashesBySource),
                });
            }

            return {
                status: 'completed',
                exitCode: shouldFail ? 1 : 0,
                header: runtime.header,
                plan,
                preflight,
                missingRequested: discovery.missingRequested,
                installs: addResult.installs,
                shared,
                removal,
                lockWritten: !shouldFail,
            };
        } catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
                header: runtime.header,
            };
        }
    }

    async runPublish(options: PublishCommandOptions = {}): Promise<PublishCommandResult> {
        const report = options.report ?? this.options.report;
        const manifestRuntimeResult = this.createManifestRuntime();
        if ('status' in manifestRuntimeResult) {
            return manifestRuntimeResult;
        }

        const publishSourceResult = resolveRequestedPublishSource(manifestRuntimeResult.manifest, options.source ?? null);
        if (!publishSourceResult.ok) {
            return {
                status: 'error',
                exitCode: 1,
                error: publishSourceResult.error,
            };
        }

        const runtimeResult = this.createExecutionRuntime(manifestRuntimeResult);
        if ('status' in runtimeResult) {
            return runtimeResult;
        }

        const runtime = runtimeResult;
        report?.({ type: 'header', header: runtime.header });

        const publishOptions = {
            source: publishSourceResult.source,
            newSkills: normalizeStringList(options.newSkills),
            removeSkills: normalizeStringList(options.removeSkills),
            dryRun: options.dryRun === true,
            confirmDeletes: options.confirmDeletes === true,
            createPr: typeof options.createPr === 'boolean' ? options.createPr : null,
            message: options.message ?? null,
            branch: options.branch ?? null,
            title: options.title ?? null,
            body: options.body ?? null,
        };

        report?.({
            type: 'publish-start',
            options: {
                source: publishOptions.source,
                newSkills: publishOptions.newSkills,
                removeSkills: publishOptions.removeSkills,
                dryRun: publishOptions.dryRun,
                confirmDeletes: publishOptions.confirmDeletes,
                createPr: publishOptions.createPr,
            },
        });

        try {
            const result = runtime.publisher.publish({
                manifest: runtime.manifest,
                lock: runtime.lock,
                ...publishOptions,
            }) as UnknownRecord & { ok?: boolean; error?: string; details?: unknown };

            if (!result.ok) {
                return {
                    status: 'error',
                    exitCode: 1,
                    error: result.error ?? 'Publish failed.',
                    details: result.details,
                    header: runtime.header,
                };
            }

            return {
                status: 'completed',
                exitCode: 0,
                header: runtime.header,
                result,
            };
        } catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
                header: runtime.header,
            };
        }
    }

    private createRuntime(): ManagerRuntime | ManagerTemplatesCreatedResult | ManagerErrorResult {
        const manifestRuntimeResult = this.createManifestRuntime();
        if ('status' in manifestRuntimeResult) {
            return manifestRuntimeResult;
        }

        return this.createExecutionRuntime(manifestRuntimeResult);
    }

    private createManifestRuntime(): ManifestRuntime | ManagerTemplatesCreatedResult | ManagerErrorResult {
        const root = path.resolve(this.options.cwd ?? process.cwd());
        const manifestPath = resolveConfigPath(this.options.manifestPath, path.join(root, 'skills.json'), root);
        const lockPath = resolveConfigPath(this.options.lockPath, path.join(root, 'skills.lock.json'), root);

        try {
            const manifestStore = new Manifest({ manifestPath, lockPath });
            const createdTemplates = manifestStore.ensureFiles() as string[];
            if (createdTemplates.length > 0) {
                return {
                    status: 'templates-created',
                    exitCode: 1,
                    root,
                    createdTemplates: createdTemplates.map((filePath) => path.relative(root, filePath)),
                };
            }

            const manifest = manifestStore.loadManifest();
            const lock = manifestStore.loadLock();

            return {
                root,
                manifestPath,
                lockPath,
                manifestStore,
                manifest,
                lock,
            };
        } catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
            };
        }
    }

    private createExecutionRuntime(
        manifestRuntime: ManifestRuntime,
    ): ManagerRuntime | ManagerErrorResult {
        try {
            const backend = new Backend({
                root: manifestRuntime.root,
            });

            const header: ManagerHeader = {
                root: manifestRuntime.root,
                cliVersion: typeof packageJson.version === 'string' ? packageJson.version : '0.0.0',
                manifestPath: manifestRuntime.manifestPath,
                manifestRelativePath: path.relative(manifestRuntime.root, manifestRuntime.manifestPath),
                lockPath: manifestRuntime.lockPath,
                lockRelativePath: path.relative(manifestRuntime.root, manifestRuntime.lockPath),
                agents: manifestRuntime.manifest.agents,
            };

            return {
                ...manifestRuntime,
                header,
                backend,
                sync: new Sync({ backend, manifestStore: manifestRuntime.manifestStore }),
                publisher: new Publisher({ backend, manifestStore: manifestRuntime.manifestStore }),
            };
        } catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
            };
        }
    }
}

export function createManager(options: ManagerOptions = {}): SkillsManager {
    return new SkillsManager(options);
}

export const manager = createManager;

function resolveConfigPath(candidate: string | undefined, fallback: string, root: string): string {
    if (!candidate) {
        return fallback;
    }

    return path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
}

function normalizeStringList(values: string[] | undefined): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeError(error: unknown): NormalizedError {
    if (error instanceof Error) {
        const details = (error as Error & { details?: unknown }).details;
        return {
            error: error.message,
            details,
        };
    }

    return {
        error: String(error),
    };
}

function resolveRequestedPublishSource(
    manifest: { sources?: Array<{ source: string }> },
    source: string | null,
): { ok: true; source: string } | { ok: false; error: string } {
    const sources = Array.isArray(manifest.sources) ? manifest.sources : [];

    if (source) {
        const selected = sources.find((entry) => entry.source === source);
        if (!selected) {
            return {
                ok: false,
                error: `Source "${source}" not found in manifest.`,
            };
        }

        return { ok: true, source: selected.source };
    }

    if (sources.length === 0) {
        return {
            ok: false,
            error: 'No sources configured in manifest.',
        };
    }

    if (sources.length === 1) {
        return {
            ok: true,
            source: sources[0].source,
        };
    }

    return {
        ok: false,
        error: 'Multiple sources configured. Use --source <source>.',
    };
}

function lockSourcesFromDiscovered(
    discovered: Record<string, any>,
    sharedFileHashesBySource: Record<string, Array<{ path: string; sha256: string }>>,
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(discovered).map(([source, meta]) => [
            source,
            {
                mode: meta.mode,
                listedAt: meta.listedAt,
                skillEntries: (meta.skillEntries ?? []).map((entry: any) => ({
                    name: entry.name,
                    sourcePath: entry.sourcePath,
                    sharedFiles: entry.sharedFiles ?? [],
                    hash: entry.hash ?? null,
                })),
                sharedFileHashes: sharedFileHashesBySource[source] ?? [],
                resolved: meta.resolved ?? {
                    requestedRef: null,
                    defaultBranch: null,
                    resolvedRef: null,
                    resolvedCommit: null,
                    subpath: null,
                    resolvedAt: null,
                },
            },
        ]),
    );
}

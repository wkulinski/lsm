import fs from 'node:fs';
import path from 'node:path';
import packageJson from '../../../package.json' with { type: 'json' };

import { normalizeError } from '../shared/errors';
import BackendAdapter from './BackendAdapter';
import { resolveLockPath, resolveManifestPath } from './configPaths';
import ManifestStore from '../manifest/ManifestStore';
import PublishAdapter from '../publish/PublishAdapter';
import SyncAdapter from '../sync/SyncAdapter';
import type {
    ManagerOptions,
    ManagerRuntime,
    ManifestRuntime,
} from './types';
import type {
    ManagerErrorResult,
    ManagerHeader,
    ManagerTemplatesCreatedResult,
} from '../types';

export default class RuntimeFactory {
    private readonly options: ManagerOptions;

    public constructor({ options }: { options: ManagerOptions }) {
        this.options = options;
    }

    public createRuntime(): ManagerRuntime | ManagerTemplatesCreatedResult | ManagerErrorResult {
        const manifestRuntimeResult = this.createManifestRuntime();
        if ('status' in manifestRuntimeResult) {
            return manifestRuntimeResult;
        }

        return this.createExecutionRuntime(manifestRuntimeResult);
    }

    public createManifestRuntime(): ManifestRuntime | ManagerTemplatesCreatedResult | ManagerErrorResult {
        const root = path.resolve(this.options.cwd ?? process.cwd());
        const manifestPath = resolveManifestPath(root, this.options.manifestPath);
        const lockPath = resolveLockPath(root, this.options.lockPath);

        try {
            const manifestStore = new ManifestStore({ manifestPath, lockPath });
            const manifestExisted = fs.existsSync(manifestPath);
            const createdTemplates = manifestStore.ensureFiles();
            const onlyLockWasCreated = manifestExisted
                && createdTemplates.length === 1
                && createdTemplates[0] === lockPath;
            if (createdTemplates.length > 0 && !onlyLockWasCreated) {
                return {
                    status: 'templates-created',
                    exitCode: 1,
                    root,
                    createdTemplates: createdTemplates.map(filePath => path.relative(root, filePath)),
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
        }
        catch (error) {
            const normalized = normalizeError(error);
            return {
                status: 'error',
                exitCode: 1,
                error: normalized.error,
                details: normalized.details,
            };
        }
    }

    public createExecutionRuntime(
        manifestRuntime: ManifestRuntime,
    ): ManagerRuntime | ManagerErrorResult {
        try {
            const backend = new BackendAdapter({
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
                sync: new SyncAdapter({ backend, manifestStore: manifestRuntime.manifestStore }),
                publisher: new PublishAdapter({ backend, manifestStore: manifestRuntime.manifestStore }),
            };
        }
        catch (error) {
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

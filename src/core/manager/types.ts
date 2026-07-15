import type BackendAdapter from './BackendAdapter';
import type ManifestStore from '../manifest/ManifestStore';
import type PublishAdapter from '../publish/PublishAdapter';
import type SyncAdapter from '../sync/SyncAdapter';
import type {
    LockData,
    ManagerEvent,
    ManagerHeader,
    ManifestData,
} from '../types';

export type Reporter = (event: ManagerEvent) => void;

export interface ManagerOptions {
    cwd?: string;
    manifestPath?: string;
    lockPath?: string;
    report?: Reporter;
}

export interface ManagerRuntime {
    root: string;
    manifestPath: string;
    lockPath: string;
    header: ManagerHeader;
    manifestStore: ManifestStore;
    backend: BackendAdapter;
    sync: SyncAdapter;
    publisher: PublishAdapter;
    manifest: ManifestData;
    lock: LockData;
}

export interface ManifestRuntime {
    root: string;
    manifestPath: string;
    lockPath: string;
    manifestStore: ManifestStore;
    manifest: ManifestData;
    lock: LockData;
}

import PublishService, {
    type PublishServiceInput,
    type PublishServiceResult,
} from './PublishService';
import type { BackendLike } from '../types';
import type { PublishPlanBuilderManifestStore } from './PublishPlanBuilder';

export default class PublishAdapter {
    public backend: BackendLike;
    public manifestStore: PublishPlanBuilderManifestStore;

    public constructor({ backend, manifestStore }: { backend: BackendLike; manifestStore: PublishPlanBuilderManifestStore }) {
        this.backend = backend;
        this.manifestStore = manifestStore;
    }

    public publish(input: PublishServiceInput): PublishServiceResult {
        return new PublishService({
            backend: this.backend,
            manifestStore: this.manifestStore,
        }).publish(input);
    }
}

export interface SyncSharedFileOwnershipConflict {
    filePath: string;
    a: string;
    b: string;
}

export default class SyncSharedFileOwnership {
    public detectOwnershipConflicts(filesBySource: { [key: string]: string[] }): SyncSharedFileOwnershipConflict[] {
        const owners = new Map<string, string>();
        const conflicts: SyncSharedFileOwnershipConflict[] = [];

        Object.entries(filesBySource).forEach(([source, files]) => {
            files.forEach((filePath) => {
                const previousOwner = owners.get(filePath);
                if (previousOwner && previousOwner !== source) {
                    conflicts.push({ filePath, a: previousOwner, b: source });
                    return;
                }
                owners.set(filePath, source);
            });
        });

        return conflicts;
    }
}

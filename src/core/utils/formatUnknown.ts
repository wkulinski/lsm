export function formatUnknown(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return String(value);
    }
    if (typeof value === 'undefined') {
        return 'undefined';
    }
    if (typeof value === 'function') {
        return '[function]';
    }
    if (typeof value === 'symbol') {
        return value.toString();
    }

    try {
        return JSON.stringify(value);
    }
    catch {
        return '[unserializable]';
    }
}

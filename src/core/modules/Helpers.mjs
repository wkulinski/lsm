export default class Helpers {
    static error(message, details = null) {
        const error = new Error(String(message));
        if (details !== null && details !== undefined) {
            error.details = details;
        }
        return error;
    }

    static die(message, details = null) {
        throw Helpers.error(message, details);
    }

    static uniq(arr) {
        return [...new Set(arr)];
    }

    static sortUniq(arr) {
        return Helpers.uniq(arr).sort((a, b) => a.localeCompare(b));
    }
}

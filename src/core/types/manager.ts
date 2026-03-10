export interface ManagerHeader {
    root: string;
    cliVersion: string;
    manifestPath: string;
    manifestRelativePath: string;
    lockPath: string;
    lockRelativePath: string;
    agents: string[];
}

export interface ManagerTemplatesCreatedResult {
    status: 'templates-created';
    exitCode: 1;
    root: string;
    createdTemplates: string[];
}

export interface ManagerErrorResult {
    status: 'error';
    exitCode: 1;
    error: string;
    details?: unknown;
    header?: ManagerHeader;
}

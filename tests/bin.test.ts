import { afterEach, describe, expect, test, vi } from 'vitest';

import { runCli } from '../src/cli/cli';

vi.mock('../src/cli/cli', () => ({
    runCli: vi.fn(),
}));

import { main } from '../src/bin';

const mockedRunCli = vi.mocked(runCli);

describe('CLI entrypoint', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        mockedRunCli.mockReset();
    });

    test('returns the CLI exit code', async () => {
        mockedRunCli.mockResolvedValue(7);

        await expect(main(['sync'])).resolves.toBe(7);
        expect(mockedRunCli).toHaveBeenCalledWith(['sync']);
    });

    test('renders Error instances and unknown thrown values', async () => {
        const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        mockedRunCli.mockRejectedValueOnce(new Error('failed'));
        await expect(main(['sync'])).resolves.toBe(1);
        mockedRunCli.mockRejectedValueOnce('failed as string');
        await expect(main(['sync'])).resolves.toBe(1);

        expect(write).toHaveBeenNthCalledWith(1, 'Error: failed\n');
        expect(write).toHaveBeenNthCalledWith(2, 'Error: failed as string\n');
    });
});

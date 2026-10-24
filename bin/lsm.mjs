#!/usr/bin/env node

import('../dist/bin.mjs')
    .then(({ main }) => main(process.argv.slice(2)))
    .then((code) => {
        process.exitCode = typeof code === 'number' ? code : 0;
    })
    .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Fatal: ${message}\n`);
        process.exitCode = 1;
    });

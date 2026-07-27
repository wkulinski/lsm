# Commands
- Install: `npm ci`.
- Tests: `npm test`; focused tests can be passed to Vitest, e.g. `npx vitest run tests/Sync.test.ts`.
- Type checks: `npm run typecheck`, `npm run test:typecheck`.
- Lint/build: `npm run lint:js`, `npm run build`.
- CLI smoke/help: `node bin/lsm --help`.
- Git integration tests use temporary local repos; do not use network repositories or a real user workspace.
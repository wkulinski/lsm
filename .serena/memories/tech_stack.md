# Stack
- Node.js >=20, ESM package (`"type": "module"`).
- TypeScript 5.x, strict/noUnusedLocals/isolatedModules, bundler module resolution; declarations emitted via `tsc`, production bundle via `tsdown`.
- Vitest 4 with Node environment; YAML dependency for manifest/config parsing; Commander for CLI.
- ESLint 10 with TypeScript and stylistic plugins.
- Package scripts are authoritative in `package.json`; no runtime framework.
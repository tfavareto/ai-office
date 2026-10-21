import { configDefaults, defineConfig } from 'vitest/config';

// `tsc -b` emits compiled copies of the tests into dist/; run only the sources.
export default defineConfig({ test: { name: 'shared', environment: 'node', exclude: [...configDefaults.exclude, 'dist/**'] } });

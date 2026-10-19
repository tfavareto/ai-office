// The hooks and the installer are plain Node ES modules, so they need the Node globals the root config does not declare.
import root from '../../eslint.config.js';

const nodeGlobals = Object.fromEntries(
  ['process', 'Buffer', 'fetch', 'AbortSignal', 'URLSearchParams', 'setTimeout', 'clearTimeout'].map((name) => [
    name,
    'readonly',
  ]),
);

export default [
  ...root,
  { files: ['**/*.mjs'], languageOptions: { globals: nodeGlobals } },
  // Hook outputs are untyped JSON, asserted on directly in tests.
  { files: ['test/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
];

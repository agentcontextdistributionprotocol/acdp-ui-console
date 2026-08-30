import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  { ignores: ['coverage/**', 'temp/**', 'plans/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  // REQUIRED for ESLint 10 — do not delete. eslint-plugin-react@7.37.5 (pinned
  // ^7.37.0 by eslint-config-next 16) reaches ESLint's removed
  // context.getFilename() only from its React-version *detection* path
  // (lib/util/version.js:31). An explicit version string short-circuits
  // detectReactVersion (version.js:109-116) — the single ESLint-10
  // incompatibility in this config. Never use 'detect'.
  { settings: { react: { version: '19.2.0' } } },
];

export default eslintConfig;

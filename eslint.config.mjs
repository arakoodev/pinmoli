/**
 * ESLint flat config for Pinmoli.
 *
 * Includes eslint-plugin-pinmoli (local) — 17 rules extracted from
 * real bugs made by Claude Code in this codebase.
 */

import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pinmoliPlugin = require('./eslint-plugin-pinmoli.cjs');

export default [
  // Global ignores
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },

  // Base config: all TypeScript files
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      'pinmoli': pinmoliPlugin,
    },
    rules: {
      // TypeScript
      ...typescriptPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Baseline
      'no-console': 'off',
      'no-constant-condition': 'off',
      'no-control-regex': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-proto': 'error',
    },
  },

  // Library code: all pinmoli rules as errors
  {
    files: [
      'src/sip/**/*.ts',
      'src/webrtc/**/*.ts',
      'src/tools/**/*.ts',
      'src/agent/**/*.ts',
      'src/network/**/*.ts',
      'src/storage/**/*.ts',
      'src/validation/**/*.ts',
    ],
    rules: {
      'pinmoli/no-console-in-lib': 'error',
      'pinmoli/no-process-exit': 'error',
      'pinmoli/no-shared-tmp-path': 'error',
      'pinmoli/no-unabortable-spawn': 'error',
      'pinmoli/no-unroutable-ip-fallback': 'error',
      'pinmoli/no-random-sip-port': 'error',
      'pinmoli/no-unrefed-timer-in-sip': 'warn',
      'pinmoli/require-to-tag-in-dialog': 'error',
      'pinmoli/no-hardcoded-payload-type': 'error',
      'pinmoli/no-optional-codec-in-media': 'error',
      'pinmoli/no-silent-transcode-fallback': 'error',
      'pinmoli/no-incomplete-enum-description': 'error',
      'pinmoli/require-cancel-with-invite': 'error',
      'pinmoli/no-stun-on-sip-socket': 'error',
      'pinmoli/require-rport-in-via': 'error',
    },
  },

  // UI code: no process.exit, no raw intervals, require cursor hide with Loader
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'pinmoli/no-process-exit': 'error',
      'pinmoli/no-setinterval-in-ui': 'error',
      'pinmoli/require-cursor-hide-with-loader': 'error',
    },
  },
];

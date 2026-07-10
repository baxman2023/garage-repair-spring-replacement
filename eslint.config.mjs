import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/*.d.ts',
      // The legacy static garage-door site coexists in this repo and is not part of CopyForge.
      '*.html',
      'img/**',
      'news/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // CommonJS config files (PM2 ecosystem, etc.) run in a Node CJS context.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);

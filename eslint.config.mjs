import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Configuracion de ESLint del monorepo.
 *
 * El objetivo NO es imponer estilo (eso lo resuelve el formateo), sino atrapar
 * las clases de error que un `tsc` no ve: promesas sin esperar, comparaciones
 * inseguras, variables sin usar que delatan codigo muerto.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      'apps/nfc-android/**',
      'apps/api/prisma/migrations/**',
      '**/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Las variables sin usar suelen ser restos de una refactorizacion. Se
      // permite el prefijo `_` para los parametros que la firma exige pero el
      // cuerpo no necesita.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` explicito se avisa pero no bloquea: hay fronteras (Prisma, Fastify)
      // donde el tipo exacto no aporta y forzarlo produce peor codigo.
      '@typescript-eslint/no-explicit-any': 'warn',
      // La asercion no nula es habitual y legitima tras una comprobacion previa.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    // Las pruebas pueden ser mas laxas: describen escenarios, no APIs publicas.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  {
    // La semilla y los guiones de utilidad imprimen por consola a proposito.
    files: ['apps/api/prisma/seed.ts', '**/scripts/**'],
    rules: { '@typescript-eslint/no-unused-vars': 'warn' },
  },
);

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas de integracion comparten una unica base de datos y cada suite
    // la limpia al empezar. Ejecutarlas en paralelo produciria carreras entre
    // suites, no fallos reales del codigo, asi que se serializan.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});

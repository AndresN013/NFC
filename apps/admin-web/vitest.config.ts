import { defineConfig } from 'vitest/config';

/**
 * Pruebas de logica pura: cliente de API, guardia de permisos de interfaz y
 * formateo de tablas. No se monta navegador ni DOM: los componentes de React
 * se prueban indirectamente manteniendo su logica en `src/lib`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

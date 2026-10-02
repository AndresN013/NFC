import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guardia de la frontera navegador/servidor.
 *
 * `@mev/domain/browser` se importa desde componentes de cliente. Si alguien
 * reexporta ahi un modulo que dependa de `node:crypto`, el empaquetado de la web
 * del aficionado se rompe, y en el peor caso se enviarian al navegador funciones
 * de generacion de tokens.
 *
 * Esta prueba lo detecta en el paquete de dominio, no tres capas mas arriba en
 * un fallo de webpack difícil de leer.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/** Modulos que el barril de navegador reexporta, en el orden en que aparecen. */
function modulosReexportadosPorBrowser(): string[] {
  const contenido = readFileSync(join(SRC, 'browser.ts'), 'utf8');
  return [...contenido.matchAll(/export \* from '\.\/(.+?)\.js'/g)].map((m) => m[1]!);
}

/** Resuelve la ruta de un modulo reexportado a su archivo fuente. */
function rutaFuente(modulo: string): string {
  return join(SRC, `${modulo}.ts`);
}

/** Modulos nativos de Node que podrian importarse sin el prefijo `node:`. */
const NATIVOS_SIN_PREFIJO = ['crypto', 'fs', 'path', 'os', 'url', 'buffer', 'stream'];

function importaNode(rutaArchivo: string): boolean {
  const contenido = readFileSync(rutaArchivo, 'utf8');
  // Forma canonica del proyecto: `from 'node:crypto'`.
  if (/from ['"]node:/.test(contenido)) return true;
  // Forma antigua sin prefijo, por si alguien la introduce.
  return NATIVOS_SIN_PREFIJO.some((nativo) =>
    new RegExp(`from ['"]${nativo}['"]`).test(contenido),
  );
}

describe('frontera del barril de navegador', () => {
  it('reexporta al menos los modulos de presentacion que usa la web', () => {
    const modulos = modulosReexportadosPorBrowser();
    expect(modulos).toContain('trust');
    expect(modulos).toContain('privacy');
    expect(modulos).toContain('states');
  });

  it('NINGUN modulo reexportado depende de un modulo nativo de Node', () => {
    for (const modulo of modulosReexportadosPorBrowser()) {
      expect(importaNode(rutaFuente(modulo)), `${modulo}.ts importa un modulo de Node`).toBe(
        false,
      );
    }
  });

  it('NO reexporta identifiers, que genera y hashea tokens en el servidor', () => {
    expect(modulosReexportadosPorBrowser()).not.toContain('identifiers');
  });

  it('identifiers si depende de node:crypto: confirma que la exclusion importa', () => {
    // Si esta asercion falla, `identifiers` dejo de ser de servidor y habria que
    // revisar por que, no simplemente moverlo al barril de navegador.
    expect(importaNode(rutaFuente('identifiers'))).toBe(true);
  });

  it('el barril principal si incluye identifiers, para el uso de servidor', () => {
    const indice = readFileSync(join(SRC, 'index.ts'), 'utf8');
    expect(indice).toContain("from './identifiers.js'");
  });

  it('todo modulo fuente sin dependencias de Node esta disponible en el navegador', () => {
    // Evita el olvido inverso: anadir un modulo puro y no exponerlo al cliente.
    const excluidos = new Set(['index', 'browser', 'identifiers']);
    const modulosBrowser = new Set(modulosReexportadosPorBrowser());

    const archivos = readdirSync(SRC)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => f.replace(/\.ts$/, ''))
      .filter((m) => !excluidos.has(m));

    for (const modulo of archivos) {
      if (importaNode(rutaFuente(modulo))) continue;
      expect(modulosBrowser.has(modulo), `${modulo}.ts es puro pero no se expone al navegador`).toBe(
        true,
      );
    }
  });
});

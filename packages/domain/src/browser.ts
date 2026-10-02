/**
 * Superficie de @mev/domain segura para el NAVEGADOR.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 * ---------------------------
 * El barril principal (`index.ts`) reexporta `identifiers.ts`, que depende de
 * `node:crypto` para generar tokens y calcular hashes. Ese modulo es
 * deliberadamente de servidor: generar el token de un chip o hashearlo con la
 * pimienta del servidor no es algo que deba ocurrir nunca en un navegador.
 *
 * Importar el barril completo desde un componente de cliente haria dos cosas
 * malas a la vez: romperia el empaquetado, y —si el empaquetador lo resolviera
 * con un sustituto— enviaria al navegador funciones que dan la falsa impresion
 * de poder generar identificadores validos.
 *
 * Asi que la separacion es una frontera de seguridad, no una comodidad de
 * compilacion: lo que se importa desde `@mev/domain/browser` es exactamente lo
 * que puede vivir en el cliente sin riesgo.
 *
 * Reglas para mantenerlo:
 *  - Nada que importe `node:*` puede reexportarse aqui.
 *  - Nada que genere o verifique material criptografico puede reexportarse aqui.
 */
export * from './trust.js';
export * from './states.js';
// `rbac` es logica pura y el panel lo necesita en el cliente para ocultar
// secciones. Ojo: ocultar en la interfaz es comodidad, no seguridad; la
// autorizacion real la aplica la API en cada peticion.
export * from './rbac.js';
export * from './geo.js';
export * from './analytics.js';
export * from './privacy.js';
export * from './content.js';
export * from './risk/types.js';
export * from './risk/engine.js';

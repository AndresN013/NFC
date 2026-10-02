/**
 * @mev/domain - reglas de negocio puras de Marathon Escudo Vivo.
 *
 * Este paquete NO conoce la base de datos, HTTP, ni el hardware NFC.
 * Todo lo que contiene es determinista y testeable sin infraestructura.
 */
export * from './trust.js';
export * from './states.js';
export * from './identifiers.js';
export * from './rbac.js';
export * from './geo.js';
export * from './analytics.js';
export * from './privacy.js';
export * from './content.js';
export * from './risk/types.js';
export * from './risk/engine.js';

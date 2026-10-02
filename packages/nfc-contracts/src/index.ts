/**
 * @mev/nfc-contracts - abstraccion de proveedores NFC.
 *
 * Regla del paquete: ninguna implementacion recibe, guarda ni devuelve claves
 * maestras. El material criptografico se referencia por `KeyReference` opaca y
 * las operaciones que lo usan se ejecutan en el servicio que lo custodia.
 */
export * from './ndef.js';
export * from './provider.js';
export * from './providers/mock.js';
export * from './providers/ntag21x.js';
export * from './providers/ntag424.js';

import type { NfcPersonalizationProvider, ProviderCapabilities } from './provider.js';
import { MockNfcProvider } from './providers/mock.js';

/** Identificadores de proveedor admitidos por configuracion. */
export const PROVIDER_IDS = ['mock', 'ntag21x-ndef', 'ntag424dna'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * Resumen de capacidades por proveedor, para que la interfaz pueda advertir al
 * usuario ANTES de ejecutar una operacion.
 */
export const PROVIDER_SUMMARY: Record<
  ProviderId,
  Pick<ProviderCapabilities, 'displayName' | 'canProduceCryptographicProof' | 'isSimulation'> & {
    warning: string | null;
  }
> = {
  mock: {
    displayName: 'Simulador NFC',
    canProduceCryptographicProof: false,
    isSimulation: true,
    warning:
      'SIMULACION: no hay hardware involucrado. Ningun resultado de este proveedor constituye autenticacion.',
  },
  'ntag21x-ndef': {
    displayName: 'NTAG 213/215/216',
    canProduceCryptographicProof: false,
    isSimulation: false,
    warning:
      'Este chip identifica el producto pero NO lo autentica. Su contenido es copiable.',
  },
  ntag424dna: {
    displayName: 'NTAG 424 DNA',
    canProduceCryptographicProof: false,
    isSimulation: false,
    warning: 'INTEGRACION PENDIENTE: el adaptador existe pero no esta implementado.',
  },
};

/**
 * Fabrica del proveedor por defecto para entornos sin hardware.
 * La API la usa cuando `NFC_PROVIDER=mock`.
 */
export function createDefaultProvider(): NfcPersonalizationProvider {
  return new MockNfcProvider();
}

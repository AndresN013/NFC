import {
  nfcError,
  type LockPlan,
  type NfcErrorInfo,
  type NfcPersonalizationProvider,
  type OriginalityResult,
  type PersonalizationPlan,
  type PostPressResult,
  type ProviderCapabilities,
  type TagDetection,
  type TagInspection,
  type TagTransport,
  type VerificationPayload,
  type VerifyPersonalizationResult,
  type WriteResult,
} from '../provider.js';

/**
 * ############################################################################
 * # NTAG 424 DNA - ADAPTADOR INCOMPLETO. NO USAR EN PRODUCCION.              #
 * ############################################################################
 *
 * ESTADO: solo contrato. Ningun metodo ejecuta una operacion real sobre un chip.
 * Todos lanzan `NOT_IMPLEMENTED`. Esto es deliberado.
 *
 * POR QUE NO ESTA IMPLEMENTADO
 * ----------------------------
 * Personalizar un NTAG 424 DNA requiere tres cosas que este entorno no tiene:
 *
 *   1. Hardware real para validar cada comando. Un error en la configuracion de
 *      `ChangeFileSettings` o en el orden de `ChangeKey` deja el chip
 *      inutilizable de forma PERMANENTE. No se puede escribir a ciegas.
 *   2. La documentacion oficial de NXP del conjunto de comandos (AN12196 y la
 *      hoja de datos del producto), que se distribuye bajo registro.
 *   3. Un custodio de claves (KMS, HSM o SAM) operativo.
 *
 * Escribir aqui comandos inventados seria peor que no escribir nada: produciria
 * un adaptador que parece funcional, pasa una revision superficial y destruye
 * inventario en la primera prueba real. Por eso este archivo declara la forma
 * de la integracion y nada mas.
 *
 * QUE SI ESTA DEFINIDO
 * --------------------
 *  - La forma exacta de cada operacion (la interfaz comun a todos los proveedores).
 *  - Donde entra el material criptografico: SIEMPRE por `KeyReference` opaca.
 *  - La frontera de confianza: la verificacion del mensaje autenticado ocurre en
 *    el SERVIDOR, no en el telefono.
 *
 * COMO COMPLETAR LA INTEGRACION
 * -----------------------------
 * Ver docs/guia-ntag424-dna.md. Resumen de los puntos de enganche:
 *
 *  - `personalizeSecureTag`: debe delegar en un servicio de personalizacion del
 *    lado servidor que derive las claves diversificadas a partir de la clave
 *    maestra custodiada, y devuelva al telefono unicamente los APDU ya cifrados
 *    que este debe retransmitir. El telefono actua como un simple tunel: nunca
 *    ve una clave.
 *  - `readVerificationPayload`: debe devolver el mensaje SUN completo tal como lo
 *    emite el chip, sin interpretarlo. La validacion del CMAC y el descifrado del
 *    contador ocurren en el servidor.
 *  - `capabilities.canProduceCryptographicProof` debe seguir siendo `false` hasta
 *    que exista una implementacion validada contra hardware. El motor de riesgo
 *    consulta esta bandera.
 */

export interface Ntag424ProviderOptions {
  transport: TagTransport;
  detection: TagDetection;
  /**
   * Cliente del servicio de personalizacion del lado servidor.
   * Cuando se implemente, este es el unico camino por el que puede llegar
   * material criptografico, y llega ya cifrado y listo para retransmitir.
   */
  personalizationService?: SecureElementPersonalizationService;
}

/**
 * Contrato del servicio de servidor que custodia las claves maestras.
 * El telefono NUNCA implementa esta interfaz: solo la consume por red.
 */
export interface SecureElementPersonalizationService {
  /**
   * Devuelve la secuencia de APDU ya construida y cifrada por el custodio de
   * claves, que el telefono debe retransmitir tal cual al chip.
   */
  buildPersonalizationApdus(input: {
    jobId: string;
    uid: string;
    keyReferences: PersonalizationPlan['keyReferences'];
  }): Promise<Uint8Array[]>;

  /**
   * Verifica en el servidor un mensaje autenticado producido por el chip.
   * El telefono nunca decide si una firma es valida.
   */
  verifyAuthenticatedMessage(input: {
    uid: string;
    message: string;
  }): Promise<{ valid: boolean; readCounter: number | null }>;
}

const NOT_IMPLEMENTED_DETAIL =
  'El proveedor NTAG 424 DNA es un contrato sin implementacion. ' +
  'Requiere hardware, la documentacion oficial de NXP y un custodio de claves. ' +
  'Ver docs/guia-ntag424-dna.md.';

export class Ntag424DnaProvider implements NfcPersonalizationProvider {
  readonly capabilities: ProviderCapabilities = {
    id: 'ntag424dna',
    displayName: 'NTAG 424 DNA (INTEGRACION PENDIENTE)',
    supportedChipTypes: ['NTAG424DNA'],
    /**
     * `false` a proposito. El chip SI es capaz, pero este adaptador no lo es.
     * Esta bandera describe la implementacion, no el silicio. Cambiarla a `true`
     * sin una implementacion validada haria que el motor de riesgo emitiera
     * `VERIFIED` sin ninguna prueba detras.
     */
    canProduceCryptographicProof: false,
    canVerifyOriginality: false,
    canLockMemory: false,
    isSimulation: false,
  };

  constructor(private readonly options: Ntag424ProviderOptions) {}

  async detectTag(): Promise<TagDetection> {
    // La deteccion es la unica operacion que no toca la logica segura: se apoya
    // en lo que ya reporto la pila NFC de la plataforma.
    return this.options.detection;
  }

  async inspectTag(): Promise<TagInspection> {
    throw notImplemented('inspectTag');
  }

  async validateOriginality(): Promise<OriginalityResult> {
    return {
      verified: false,
      notSupported: true,
      simulated: false,
      detail: NOT_IMPLEMENTED_DETAIL,
    };
  }

  async preparePersonalization(): Promise<{ ok: boolean; error?: NfcErrorInfo }> {
    return { ok: false, error: notImplemented('preparePersonalization').info };
  }

  async writeNdef(): Promise<WriteResult> {
    // Un NTAG 424 DNA admite escritura NDEF simple, pero hacerlo por esta via
    // sin configurar SUN produciria una etiqueta cara con la seguridad de una
    // NTAG 213. Se rechaza para que nadie lo haga por accidente.
    return {
      success: false,
      bytesWritten: 0,
      writtenPayloadHex: '',
      error: nfcError(
        'OPERATION_NOT_PERMITTED',
        'Escribir NDEF simple en un NTAG 424 DNA desaprovecha el chip y no aporta autenticacion. ' +
          'Use personalizeSecureTag cuando la integracion este completa.',
      ).info,
    };
  }

  async personalizeSecureTag(): Promise<WriteResult> {
    // PUNTO DE INTEGRACION 1
    // Implementacion prevista:
    //   const apdus = await this.options.personalizationService.buildPersonalizationApdus({...})
    //   for (const apdu of apdus) await this.options.transport.transceive(apdu)
    // Los APDU llegan ya construidos y cifrados por el custodio de claves.
    throw notImplemented('personalizeSecureTag');
  }

  async verifyPersonalization(): Promise<VerifyPersonalizationResult> {
    throw notImplemented('verifyPersonalization');
  }

  async lockAllowedAreas(_inspection: TagInspection, _lockPlan: LockPlan): Promise<WriteResult> {
    throw notImplemented('lockAllowedAreas');
  }

  async readVerificationPayload(): Promise<VerificationPayload> {
    // PUNTO DE INTEGRACION 2
    // Implementacion prevista: leer el fichero NDEF con el mensaje SUN y
    // devolverlo INTACTO en `authenticatedMessage`. No interpretarlo aqui.
    throw notImplemented('readVerificationPayload');
  }

  async runPostPressCheck(): Promise<PostPressResult> {
    throw notImplemented('runPostPressCheck');
  }
}

function notImplemented(operation: string) {
  return nfcError('NOT_IMPLEMENTED', `${operation}: ${NOT_IMPLEMENTED_DETAIL}`);
}

/**
 * Lista explicita de lo que falta, consumible por la interfaz de usuario y por
 * la documentacion para que el estado nunca quede implicito.
 */
export const NTAG424_PENDING_WORK: readonly { operation: string; blockedBy: string }[] = [
  { operation: 'inspectTag', blockedBy: 'Comandos GetVersion / GetFileSettings sin validar' },
  {
    operation: 'personalizeSecureTag',
    blockedBy: 'ChangeKey y ChangeFileSettings; requiere custodio de claves y hardware',
  },
  { operation: 'verifyPersonalization', blockedBy: 'Depende de personalizeSecureTag' },
  { operation: 'lockAllowedAreas', blockedBy: 'Configuracion irreversible; requiere hardware' },
  {
    operation: 'readVerificationPayload',
    blockedBy: 'Lectura del mensaje SUN; requiere hardware para validar el formato',
  },
  { operation: 'runPostPressCheck', blockedBy: 'Depende de readVerificationPayload' },
  {
    operation: 'validateOriginality',
    blockedBy: 'Clave publica de originalidad de NXP no disponible en el repositorio',
  },
];

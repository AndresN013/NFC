import {
  checkUriFits,
  decodeNdefUriMessage,
  encodeNdefUriMessage,
  NTAG_USER_MEMORY_BYTES,
  toHex,
  unwrapType2Tlv,
  wrapType2Tlv,
} from '../ndef.js';
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
import type { ChipType } from '@mev/domain';

/**
 * Proveedor para la familia NTAG 213/215/216 (NFC Forum Type 2 Tag).
 *
 * QUE HACE ESTE PROVEEDOR
 * -----------------------
 * Escribe un registro NDEF de tipo URI, lo relee y compara. Eso es todo.
 *
 * QUE NO HACE, Y NO PUEDE HACER
 * -----------------------------
 * NO autentica. Una NTAG 21x no ejecuta ninguna operacion criptografica sobre
 * un reto del servidor. Su contenido NDEF es legible y reescribible por
 * cualquier telefono con NFC hasta que se bloquea, y una vez leido puede
 * copiarse a otra etiqueta. El UID es de solo lectura de fabrica, pero existen
 * en el mercado etiquetas con UID escribible y emuladores que lo replican.
 *
 * En consecuencia, `canProduceCryptographicProof` es `false` y toda lectura que
 * pase por este proveedor produce como maximo `IDENTIFIED_ONLY`.
 *
 * SOBRE LA FIRMA DE ORIGINALIDAD
 * ------------------------------
 * NXP documenta el comando READ_SIG (0x3C 0x00), que devuelve una firma ECC de
 * 32 bytes generada en fabrica sobre el UID. Verificarla exige la clave publica
 * de originalidad de NXP, que este repositorio NO incluye y que debe obtenerse
 * del fabricante. Sin esa clave la comprobacion no puede realizarse, y este
 * proveedor lo reporta como `notSupported` en lugar de fingir un resultado.
 *
 * Aunque se verificara, la firma probaria que el SILICIO es de NXP; no probaria
 * que ese chip concreto sea el que Marathon programo ni que siga en su emblema
 * original. Sirve como senal de riesgo, no como autenticacion.
 */

const NTAG_TYPES: readonly ChipType[] = ['NTAG213', 'NTAG215', 'NTAG216'];

export interface Ntag21xProviderOptions {
  transport: TagTransport;
  detection: TagDetection;
  /**
   * Clave publica de originalidad de NXP en formato SEC1 no comprimido.
   * Debe suministrarse por configuracion. Si falta, `validateOriginality`
   * devuelve `notSupported`. NUNCA se versiona en este repositorio.
   */
  nxpOriginalityPublicKey?: Uint8Array | null;
}

export class Ntag21xNdefProvider implements NfcPersonalizationProvider {
  readonly capabilities: ProviderCapabilities = {
    id: 'ntag21x-ndef',
    displayName: 'NTAG 213/215/216 - escritura NDEF (solo identificacion)',
    supportedChipTypes: NTAG_TYPES,
    canProduceCryptographicProof: false,
    canVerifyOriginality: false,
    canLockMemory: true,
    isSimulation: false,
  };

  private readonly transport: TagTransport;
  private readonly detection: TagDetection;

  constructor(private readonly options: Ntag21xProviderOptions) {
    this.transport = options.transport;
    this.detection = options.detection;
  }

  async detectTag(): Promise<TagDetection> {
    if (!NTAG_TYPES.includes(this.detection.chipType)) {
      throw nfcError(
        'TAG_TYPE_UNSUPPORTED',
        `Este proveedor solo admite NTAG 21x, se detecto ${this.detection.chipType}`,
      );
    }
    return this.detection;
  }

  async inspectTag(detection: TagDetection): Promise<TagInspection> {
    const capacity = NTAG_USER_MEMORY_BYTES[detection.chipType] ?? 0;
    if (capacity === 0) {
      throw nfcError('TAG_TYPE_UNSUPPORTED', `Capacidad desconocida para ${detection.chipType}`);
    }

    let raw: Uint8Array;
    try {
      raw = await this.transport.readUserMemory(0, capacity);
    } catch (error) {
      throw nfcError('TRANSPORT_ERROR', `No se pudo leer la memoria: ${describe(error)}`, true);
    }

    const message = unwrapType2Tlv(raw);
    const currentUri = message ? decodeNdefUriMessage(message) : null;

    // Sondeo de solo lectura: se intenta reescribir el primer byte con su MISMO
    // valor. Si el chip esta bloqueado, la escritura falla sin alterar nada.
    let readOnly = false;
    try {
      await this.transport.writeUserMemory(0, raw.slice(0, 1));
    } catch {
      readOnly = true;
    }

    return {
      ...detection,
      userMemoryBytes: capacity,
      readOnly,
      hasNdefMessage: message != null,
      currentUri,
      versionBytes: null,
    };
  }

  /**
   * No se implementa la verificacion de la firma de originalidad porque exige
   * la clave publica de NXP, que no forma parte de este repositorio.
   * Se reporta con honestidad en lugar de devolver un `verified: true` vacio.
   */
  async validateOriginality(): Promise<OriginalityResult> {
    if (!this.options.nxpOriginalityPublicKey) {
      return {
        verified: false,
        notSupported: true,
        simulated: false,
        detail:
          'Verificacion de originalidad no disponible: falta la clave publica de ' +
          'originalidad de NXP. Configurela para habilitar esta comprobacion. ' +
          'Ver docs/guia-ntag424-dna.md, seccion "Firma de originalidad".',
      };
    }
    // PENDIENTE DE INTEGRACION: emitir READ_SIG (0x3C 0x00) por `transceive` y
    // verificar la firma ECDSA sobre el UID con la clave publica configurada.
    // No se implementa a ciegas: requiere validarse contra chips reales.
    return {
      verified: false,
      notSupported: true,
      simulated: false,
      detail:
        'Clave publica presente pero la verificacion READ_SIG no esta implementada. ' +
        'Requiere validacion contra hardware real antes de habilitarse.',
    };
  }

  async preparePersonalization(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<{ ok: boolean; error?: NfcErrorInfo }> {
    if (inspection.readOnly) {
      return {
        ok: false,
        error: nfcError('TAG_READ_ONLY', 'El chip ya esta bloqueado como solo lectura').info,
      };
    }

    const capacity = checkUriFits(plan.uri, inspection.chipType);
    if (!capacity.fits) {
      return {
        ok: false,
        error: nfcError(
          'INSUFFICIENT_MEMORY',
          `La URI requiere ${capacity.requiredBytes} bytes y el chip ofrece ${capacity.availableBytes}`,
        ).info,
      };
    }

    if (plan.keyReferences.length > 0) {
      // Defensa en profundidad: si alguien encola un plan con claves sobre un
      // chip que no las soporta, se rechaza en lugar de ignorarlas en silencio.
      return {
        ok: false,
        error: nfcError(
          'OPERATION_NOT_PERMITTED',
          'El plan incluye referencias de clave, pero una NTAG 21x no admite personalizacion criptografica',
        ).info,
      };
    }

    return { ok: true };
  }

  async writeNdef(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<WriteResult> {
    const prepared = await this.preparePersonalization(inspection, plan);
    if (!prepared.ok) {
      return { success: false, bytesWritten: 0, writtenPayloadHex: '', error: prepared.error };
    }

    const payload = wrapType2Tlv(encodeNdefUriMessage(plan.uri));
    try {
      await this.transport.writeUserMemory(0, payload);
    } catch (error) {
      return {
        success: false,
        bytesWritten: 0,
        writtenPayloadHex: '',
        error: nfcError('WRITE_FAILED', `Fallo la escritura: ${describe(error)}`, true).info,
      };
    }

    return { success: true, bytesWritten: payload.length, writtenPayloadHex: toHex(payload) };
  }

  /** Una NTAG 21x no tiene nada que personalizar criptograficamente. */
  async personalizeSecureTag(): Promise<WriteResult> {
    return {
      success: false,
      bytesWritten: 0,
      writtenPayloadHex: '',
      error: nfcError(
        'OPERATION_NOT_PERMITTED',
        'NTAG 21x no admite personalizacion criptografica. Use un NTAG 424 DNA.',
      ).info,
    };
  }

  async verifyPersonalization(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<VerifyPersonalizationResult> {
    let raw: Uint8Array;
    try {
      raw = await this.transport.readUserMemory(0, inspection.userMemoryBytes);
    } catch (error) {
      return {
        matches: false,
        readBackUri: null,
        detail: `No se pudo releer el chip: ${describe(error)}`,
      };
    }

    const message = unwrapType2Tlv(raw);
    const readBackUri = message ? decodeNdefUriMessage(message) : null;
    const matches = readBackUri === plan.uri;

    return {
      matches,
      readBackUri,
      detail: matches
        ? 'La relectura coincide con lo grabado'
        : `La relectura no coincide. Esperado un registro URI, leido: ${readBackUri ?? 'ninguno'}`,
    };
  }

  /**
   * Bloqueo del area NDEF.
   *
   * NO IMPLEMENTADO a proposito. Escribir los lock bytes o los bits de un
   * NTAG 21x es IRREVERSIBLE: un error de offset inutiliza el chip de forma
   * permanente. Implementarlo exige validarse contra chips reales de cada
   * familia. Ver docs/protocolo-programacion.md, seccion "Bloqueo".
   */
  async lockAllowedAreas(_inspection: TagInspection, lockPlan: LockPlan): Promise<WriteResult> {
    if (!lockPlan.lockNdefReadOnly && !lockPlan.lockConfiguration) {
      return { success: true, bytesWritten: 0, writtenPayloadHex: '' };
    }
    return {
      success: false,
      bytesWritten: 0,
      writtenPayloadHex: '',
      error: nfcError(
        'NOT_IMPLEMENTED',
        'El bloqueo irreversible de NTAG 21x no esta implementado: requiere validacion con hardware real.',
      ).info,
    };
  }

  async readVerificationPayload(detection: TagDetection): Promise<VerificationPayload> {
    const capacity = NTAG_USER_MEMORY_BYTES[detection.chipType] ?? 144;
    const raw = await this.transport.readUserMemory(0, capacity);
    const message = unwrapType2Tlv(raw);
    const uri = message ? decodeNdefUriMessage(message) : null;

    return {
      token: uri ? (uri.split('/').pop() ?? null) : null,
      // Una NTAG 21x no produce mensajes autenticados. Siempre null.
      authenticatedMessage: null,
      // Tampoco expone un contador de lecturas en el payload NDEF.
      readCounter: null,
      simulated: false,
    };
  }

  async runPostPressCheck(
    detection: TagDetection,
    expectedUri: string,
  ): Promise<PostPressResult> {
    try {
      const capacity = NTAG_USER_MEMORY_BYTES[detection.chipType] ?? 144;
      const raw = await this.transport.readUserMemory(0, capacity);
      const message = unwrapType2Tlv(raw);
      const uri = message ? decodeNdefUriMessage(message) : null;
      return {
        readable: message != null,
        contentIntact: uri === expectedUri,
        // Android no expone RSSI para NFC. Se deja null en lugar de inventarlo.
        signalStrength: null,
        detail:
          message == null
            ? 'El chip respondio pero no contiene un mensaje NDEF valido'
            : uri === expectedUri
              ? 'Contenido intacto tras el termosellado'
              : 'El contenido cambio tras el termosellado',
      };
    } catch (error) {
      return {
        readable: false,
        contentIntact: false,
        signalStrength: null,
        detail: `El chip no respondio tras el termosellado: ${describe(error)}`,
      };
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

import { decodeNdefUriMessage, encodeNdefUriMessage, unwrapType2Tlv, wrapType2Tlv, NTAG_USER_MEMORY_BYTES, toHex } from '../ndef.js';
import {
  nfcError,
  type LockPlan,
  type NfcPersonalizationProvider,
  type OriginalityResult,
  type PersonalizationPlan,
  type PostPressResult,
  type ProviderCapabilities,
  type TagDetection,
  type TagInspection,
  type VerificationPayload,
  type VerifyPersonalizationResult,
  type WriteResult,
  type TagTransport,
} from '../provider.js';
import type { ChipType } from '@mev/domain';

/**
 * ############################################################################
 * # PROVEEDOR SIMULADO - NO PRODUCE AUTENTICACION REAL                       #
 * ############################################################################
 *
 * Este proveedor NO habla con ningun chip. Existe para poder desarrollar y
 * probar toda la cadena (app -> API -> base de datos -> web) sin hardware.
 *
 * Todo payload que emite lleva `simulated: true`. El motor de riesgo trata esa
 * marca como regla dura: una evidencia simulada JAMAS produce el nivel
 * `VERIFIED`. Si alguien retirara esa marca, las pruebas del motor de riesgo
 * fallarian.
 */

/** Estado de un chip virtual en memoria. */
export interface SimulatedTag {
  uid: string;
  chipType: ChipType;
  memory: Uint8Array;
  readOnly: boolean;
  configurationLocked: boolean;
  /** Contador de lecturas simulado, para poder ejercitar la logica anti-replay. */
  readCounter: number;
}

export function createSimulatedTag(
  uid: string,
  chipType: ChipType = 'NTAG213',
): SimulatedTag {
  const size = NTAG_USER_MEMORY_BYTES[chipType] ?? 144;
  return {
    uid,
    chipType,
    memory: new Uint8Array(size),
    readOnly: false,
    configurationLocked: false,
    readCounter: 0,
  };
}

/** Transporte en memoria: permite probar los proveedores reales sin hardware. */
export class SimulatedTagTransport implements TagTransport {
  constructor(private readonly tag: SimulatedTag) {}

  async readUserMemory(offset: number, length: number): Promise<Uint8Array> {
    if (offset + length > this.tag.memory.length) {
      throw nfcError('TRANSPORT_ERROR', `Lectura fuera de rango: ${offset}+${length}`);
    }
    return this.tag.memory.slice(offset, offset + length);
  }

  async writeUserMemory(offset: number, data: Uint8Array): Promise<void> {
    if (this.tag.readOnly) {
      throw nfcError('TAG_READ_ONLY', 'El chip simulado esta bloqueado como solo lectura');
    }
    if (offset + data.length > this.tag.memory.length) {
      throw nfcError(
        'INSUFFICIENT_MEMORY',
        `No caben ${data.length} bytes desde ${offset} en ${this.tag.memory.length}`,
      );
    }
    this.tag.memory.set(data, offset);
  }

  async transceive(): Promise<Uint8Array> {
    throw nfcError('NOT_IMPLEMENTED', 'El transporte simulado no ejecuta APDUs crudos');
  }

  async close(): Promise<void> {
    /* nada que cerrar */
  }

  /** Solo para pruebas: marca el tag simulado como solo lectura. */
  setReadOnly(value: boolean): void {
    this.tag.readOnly = value;
  }
}

export interface MockProviderOptions {
  tag?: SimulatedTag;
  /** Fuerza un fallo en la escritura, para ejercitar los reintentos. */
  failWrite?: boolean;
  /** Fuerza que la relectura no coincida, para ejercitar la cuarentena. */
  corruptOnVerify?: boolean;
  /** Simula que el chip deja de responder tras el termosellado. */
  failPostPress?: boolean;
}

export class MockNfcProvider implements NfcPersonalizationProvider {
  readonly capabilities: ProviderCapabilities = {
    id: 'mock',
    displayName: 'Simulador NFC (NO es autenticacion real)',
    supportedChipTypes: ['NTAG213', 'NTAG215', 'NTAG216', 'NTAG424DNA', 'UNKNOWN'],
    // Deliberadamente `false`: un simulador no puede producir una prueba.
    canProduceCryptographicProof: false,
    canVerifyOriginality: false,
    canLockMemory: true,
    isSimulation: true,
  };

  private readonly tag: SimulatedTag;
  private readonly transport: SimulatedTagTransport;

  constructor(private readonly options: MockProviderOptions = {}) {
    this.tag = options.tag ?? createSimulatedTag('04A1B2C3D4E580');
    this.transport = new SimulatedTagTransport(this.tag);
  }

  async detectTag(): Promise<TagDetection> {
    return {
      uid: this.tag.uid,
      chipType: this.tag.chipType,
      technologies: ['SIMULATED'],
    };
  }

  async inspectTag(detection: TagDetection): Promise<TagInspection> {
    const tlv = await this.transport.readUserMemory(0, this.tag.memory.length);
    const message = unwrapType2Tlv(tlv);
    const uri = message ? decodeNdefUriMessage(message) : null;
    return {
      ...detection,
      userMemoryBytes: this.tag.memory.length,
      readOnly: this.tag.readOnly,
      hasNdefMessage: message != null,
      currentUri: uri,
      versionBytes: null,
    };
  }

  async validateOriginality(): Promise<OriginalityResult> {
    return {
      verified: false,
      notSupported: true,
      simulated: true,
      detail:
        'SIMULACION: no se comprobo ninguna firma de originalidad. Este resultado no ' +
        'constituye evidencia de que el silicio sea autentico.',
    };
  }

  async preparePersonalization(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<{ ok: boolean; error?: import('../provider.js').NfcErrorInfo }> {
    if (inspection.readOnly) {
      return {
        ok: false,
        error: nfcError('TAG_READ_ONLY', 'El chip simulado ya esta bloqueado').info,
      };
    }
    const required = wrapType2Tlv(encodeNdefUriMessage(plan.uri)).length;
    if (required > inspection.userMemoryBytes) {
      return {
        ok: false,
        error: nfcError(
          'INSUFFICIENT_MEMORY',
          `Requiere ${required} bytes, disponibles ${inspection.userMemoryBytes}`,
        ).info,
      };
    }
    return { ok: true };
  }

  async writeNdef(
    _inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<WriteResult> {
    if (this.options.failWrite) {
      return {
        success: false,
        bytesWritten: 0,
        writtenPayloadHex: '',
        error: nfcError('WRITE_FAILED', 'SIMULACION: fallo de escritura forzado', true).info,
      };
    }
    const payload = wrapType2Tlv(encodeNdefUriMessage(plan.uri));
    await this.transport.writeUserMemory(0, payload);
    return {
      success: true,
      bytesWritten: payload.length,
      writtenPayloadHex: toHex(payload),
    };
  }

  /**
   * En el simulador esto es exactamente lo mismo que `writeNdef`: NO hay
   * diversificacion de claves, NO hay configuracion SUN, NO hay criptografia.
   */
  async personalizeSecureTag(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<WriteResult> {
    return this.writeNdef(inspection, plan);
  }

  async verifyPersonalization(
    _inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<VerifyPersonalizationResult> {
    if (this.options.corruptOnVerify) {
      return {
        matches: false,
        readBackUri: null,
        detail: 'SIMULACION: relectura corrupta forzada',
      };
    }
    const tlv = await this.transport.readUserMemory(0, this.tag.memory.length);
    const message = unwrapType2Tlv(tlv);
    const readBackUri = message ? decodeNdefUriMessage(message) : null;
    return {
      matches: readBackUri === plan.uri,
      readBackUri,
      detail: readBackUri === plan.uri ? 'Relectura coincide' : 'Relectura NO coincide',
    };
  }

  async lockAllowedAreas(_inspection: TagInspection, lockPlan: LockPlan): Promise<WriteResult> {
    if (lockPlan.lockNdefReadOnly) this.tag.readOnly = true;
    if (lockPlan.lockConfiguration) this.tag.configurationLocked = true;
    return { success: true, bytesWritten: 0, writtenPayloadHex: '' };
  }

  async readVerificationPayload(): Promise<VerificationPayload> {
    const tlv = await this.transport.readUserMemory(0, this.tag.memory.length);
    const message = unwrapType2Tlv(tlv);
    const uri = message ? decodeNdefUriMessage(message) : null;
    this.tag.readCounter += 1;
    return {
      token: uri ? (uri.split('/').pop() ?? null) : null,
      // Deliberadamente null: un simulador no fabrica mensajes autenticados.
      authenticatedMessage: null,
      readCounter: this.tag.readCounter,
      simulated: true,
    };
  }

  async runPostPressCheck(
    _detection: TagDetection,
    expectedUri: string,
  ): Promise<PostPressResult> {
    if (this.options.failPostPress) {
      return {
        readable: false,
        contentIntact: false,
        signalStrength: null,
        detail: 'SIMULACION: chip ilegible tras el termosellado (fallo forzado)',
      };
    }
    const tlv = await this.transport.readUserMemory(0, this.tag.memory.length);
    const message = unwrapType2Tlv(tlv);
    const uri = message ? decodeNdefUriMessage(message) : null;
    return {
      readable: message != null,
      contentIntact: uri === expectedUri,
      signalStrength: null,
      detail: 'SIMULACION: no se midio ninguna senal fisica real',
    };
  }
}

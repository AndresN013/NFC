import type { ChipType } from '@mev/domain';

/**
 * Contrato del proveedor de personalizacion NFC.
 *
 * El dominio y la API hablan SOLO con esta interfaz. Anadir un lector USB o una
 * estacion industrial en el futuro significa escribir una implementacion nueva,
 * sin tocar el dominio ni la base de datos.
 *
 * REGLA INVIOLABLE: ninguna implementacion recibe, almacena ni devuelve claves
 * maestras. Cuando una operacion necesita material criptografico, recibe un
 * `KeyReference` opaco (un identificador en el KMS/HSM/SAM) y la operacion
 * criptografica se ejecuta en el servicio que custodia la clave.
 */

/** Referencia opaca a una clave. NO contiene la clave. */
export interface KeyReference {
  /** Identificador en el custodio, p.ej. un ARN de KMS o un slot de SAM. */
  reference: string;
  /** Custodio: `kms`, `hsm`, `sam` o `none` (solo para el proveedor simulado). */
  custodian: 'kms' | 'hsm' | 'sam' | 'none';
  /** Version de la clave, para rotacion. */
  version: number;
}

export interface TagDetection {
  /** UID del chip en hexadecimal. Dato sensible: nunca se expone al aficionado. */
  uid: string;
  chipType: ChipType;
  /** Tecnologias reportadas por la pila NFC, p.ej. ['NfcA', 'Ndef']. */
  technologies: string[];
}

export interface TagInspection extends TagDetection {
  userMemoryBytes: number;
  /** El area NDEF ya fue bloqueada como solo lectura. */
  readOnly: boolean;
  /** Ya contiene un mensaje NDEF. */
  hasNdefMessage: boolean;
  /** URI actual, si el mensaje existente es un registro URI. */
  currentUri: string | null;
  /** Numero de version del chip segun GET_VERSION, en hexadecimal, si esta disponible. */
  versionBytes: string | null;
}

/**
 * Resultado de la comprobacion de originalidad del silicio.
 *
 * NXP publica una firma ECC de originalidad en las NTAG 21x
 * (comando READ_SIG). Verificarla comprueba que el SILICIO salio de una
 * fabrica NXP; NO comprueba que el contenido no haya sido copiado a otra
 * etiqueta NXP legitima, ni que el emblema sea el original. Por eso su
 * resultado alimenta el riesgo pero NUNCA produce por si solo `VERIFIED`.
 */
export interface OriginalityResult {
  /** `true` solo si un verificador real valido la firma contra la clave publica de NXP. */
  verified: boolean;
  /** `true` cuando el proveedor no puede realizar la comprobacion. */
  notSupported: boolean;
  /** `true` si el resultado proviene de una simulacion. */
  simulated: boolean;
  detail: string;
}

export interface PersonalizationPlan {
  /** Identificador del trabajo, emitido por el servidor. Idempotencia. */
  jobId: string;
  /** URI a grabar en el registro NDEF. */
  uri: string;
  /** Referencias de clave para chips seguros. Vacio para NTAG 21x. */
  keyReferences: KeyReference[];
  /** Areas que deben bloquearse tras verificar la escritura. */
  lockPlan: LockPlan;
}

export interface LockPlan {
  /** Bloquear el area NDEF como solo lectura de forma IRREVERSIBLE. */
  lockNdefReadOnly: boolean;
  /**
   * Bloquear los bits de configuracion del chip.
   * Irreversible. Requiere confirmacion explicita en la app del operario.
   */
  lockConfiguration: boolean;
}

export interface WriteResult {
  success: boolean;
  bytesWritten: number;
  /** Bytes exactos que se enviaron al chip, para poder comparar en la relectura. */
  writtenPayloadHex: string;
  error?: NfcErrorInfo;
}

export interface VerificationPayload {
  /** Token leido del chip. */
  token: string | null;
  /** Mensaje autenticado (SUN/CMAC) si el chip lo produce. null en NTAG 21x. */
  authenticatedMessage: string | null;
  /** Contador de lecturas si el chip lo expone. */
  readCounter: number | null;
  /**
   * `true` si el payload provino de un proveedor simulado.
   * La API degrada el nivel de confianza cuando esta marca esta activa.
   */
  simulated: boolean;
}

export interface VerifyPersonalizationResult {
  /** La relectura coincide byte a byte con lo que se escribio. */
  matches: boolean;
  readBackUri: string | null;
  detail: string;
}

export interface PostPressResult {
  /** El chip sigue respondiendo tras el termosellado. */
  readable: boolean;
  /** El contenido sigue siendo el esperado. */
  contentIntact: boolean;
  /** Intensidad de senal relativa 0..100 si la plataforma la expone. null si no. */
  signalStrength: number | null;
  detail: string;
}

export const NFC_ERROR_CODES = [
  'TAG_LOST',
  'TAG_READ_ONLY',
  'TAG_NOT_NDEF',
  'TAG_TYPE_UNSUPPORTED',
  'INSUFFICIENT_MEMORY',
  'WRITE_FAILED',
  'VERIFY_MISMATCH',
  'AUTH_FAILED',
  'TRANSPORT_ERROR',
  'NOT_IMPLEMENTED',
  'OPERATION_NOT_PERMITTED',
] as const;

export type NfcErrorCode = (typeof NFC_ERROR_CODES)[number];

export interface NfcErrorInfo {
  code: NfcErrorCode;
  /** Mensaje tecnico para el registro de auditoria. Sin secretos. */
  detail: string;
  /** Mensaje comprensible para el operario en planta, en espanol. */
  operatorMessage: string;
  /** El operario puede reintentar la misma operacion sin riesgo. */
  retryable: boolean;
}

export class NfcOperationError extends Error {
  constructor(readonly info: NfcErrorInfo) {
    super(info.detail);
    this.name = 'NfcOperationError';
  }
}

/** Mensajes en espanol, redactados para alguien en planta, no para un ingeniero. */
export const OPERATOR_MESSAGES: Record<NfcErrorCode, string> = {
  TAG_LOST: 'Se perdio el contacto. Mantenga el emblema apoyado sin moverlo hasta que suene.',
  TAG_READ_ONLY: 'Este chip ya esta bloqueado y no admite escritura. Aparte la unidad.',
  TAG_NOT_NDEF: 'El chip no tiene el formato esperado. Aparte la unidad y avise al supervisor.',
  TAG_TYPE_UNSUPPORTED: 'Este tipo de chip no corresponde a esta orden. Verifique el lote.',
  INSUFFICIENT_MEMORY: 'El chip no tiene memoria suficiente. Verifique el modelo del lote.',
  WRITE_FAILED: 'No se pudo grabar. Retire el telefono, vuelva a acercarlo e intente de nuevo.',
  VERIFY_MISMATCH:
    'La comprobacion posterior no coincide. La unidad pasa a cuarentena automaticamente.',
  AUTH_FAILED: 'El chip rechazo la operacion de seguridad. Aparte la unidad.',
  TRANSPORT_ERROR: 'Error de comunicacion con el chip. Intente nuevamente.',
  NOT_IMPLEMENTED: 'Esta operacion no esta disponible en este equipo.',
  OPERATION_NOT_PERMITTED: 'No tiene autorizacion para esta operacion.',
};

export function nfcError(
  code: NfcErrorCode,
  detail: string,
  retryable = false,
): NfcOperationError {
  return new NfcOperationError({
    code,
    detail,
    operatorMessage: OPERATOR_MESSAGES[code],
    retryable,
  });
}

/**
 * Capacidades declaradas por un proveedor. La aplicacion consulta esto ANTES de
 * ofrecer una operacion, en lugar de intentarla y fallar.
 */
export interface ProviderCapabilities {
  readonly id: string;
  readonly displayName: string;
  readonly supportedChipTypes: readonly ChipType[];
  /** Puede producir una prueba criptografica verificable en servidor. */
  readonly canProduceCryptographicProof: boolean;
  readonly canVerifyOriginality: boolean;
  readonly canLockMemory: boolean;
  /**
   * `true` cuando el proveedor NO habla con hardware real.
   * La API usa esta marca para degradar el nivel de confianza.
   */
  readonly isSimulation: boolean;
}

/**
 * Interfaz que toda implementacion debe cumplir.
 * Las implementaciones son sin estado entre invocaciones salvo el handle de tag.
 */
export interface NfcPersonalizationProvider {
  readonly capabilities: ProviderCapabilities;

  /** Espera a que un chip entre en el campo y devuelve su identidad basica. */
  detectTag(): Promise<TagDetection>;

  /** Lee la informacion tecnica permitida del chip ya detectado. */
  inspectTag(detection: TagDetection): Promise<TagInspection>;

  /** Comprueba la firma de originalidad del silicio, si el chip la expone. */
  validateOriginality(detection: TagDetection): Promise<OriginalityResult>;

  /**
   * Valida localmente que el plan es ejecutable sobre este chip (capacidad,
   * tipo, estado de bloqueo) antes de emitir una sola escritura.
   */
  preparePersonalization(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<{ ok: boolean; error?: NfcErrorInfo }>;

  /** Escribe un mensaje NDEF con la URI del plan. */
  writeNdef(inspection: TagInspection, plan: PersonalizationPlan): Promise<WriteResult>;

  /**
   * Personalizacion de un chip seguro (claves diversificadas, configuracion SUN).
   * Solo la implementa un proveedor con hardware y SDK reales.
   */
  personalizeSecureTag(
    inspection: TagInspection,
    plan: PersonalizationPlan,
  ): Promise<WriteResult>;

  /** Relee el chip y compara con lo escrito. */
  verifyPersonalization(
    inspection: TagInspection,
    plan: PersonalizationPlan,
    write: WriteResult,
  ): Promise<VerifyPersonalizationResult>;

  /** Bloquea las areas permitidas. Operacion IRREVERSIBLE. */
  lockAllowedAreas(inspection: TagInspection, lockPlan: LockPlan): Promise<WriteResult>;

  /** Lee el payload que la web usaria para verificar. */
  readVerificationPayload(detection: TagDetection): Promise<VerificationPayload>;

  /** Comprobacion posterior al termosellado. */
  runPostPressCheck(
    detection: TagDetection,
    expectedUri: string,
  ): Promise<PostPressResult>;
}

/**
 * Transporte de bajo nivel hacia el chip. En Android lo implementa la capa que
 * envuelve `android.nfc`. En el simulador lo implementa un objeto en memoria.
 * Aislarlo permite probar la logica de los proveedores sin hardware.
 */
export interface TagTransport {
  /** Lee `length` bytes de la memoria de usuario desde `offset`. */
  readUserMemory(offset: number, length: number): Promise<Uint8Array>;
  /** Escribe en la memoria de usuario desde `offset`. */
  writeUserMemory(offset: number, data: Uint8Array): Promise<void>;
  /** Intercambia un APDU crudo. Lanza NOT_IMPLEMENTED si el transporte no lo soporta. */
  transceive(apdu: Uint8Array): Promise<Uint8Array>;
  /** Cierra la conexion con el tag. */
  close(): Promise<void>;
}

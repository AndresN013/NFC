import { describe, expect, it } from 'vitest';
import { createSimulatedTag, MockNfcProvider, SimulatedTagTransport } from './mock.js';
import { Ntag21xNdefProvider } from './ntag21x.js';
import { Ntag424DnaProvider, NTAG424_PENDING_WORK } from './ntag424.js';
import type { PersonalizationPlan } from '../provider.js';
import { NfcOperationError } from '../provider.js';

const URI = 'https://ev.mrthn.ec/v/8xKq2LmNpRt4wZ9c';

function plan(overrides: Partial<PersonalizationPlan> = {}): PersonalizationPlan {
  return {
    jobId: 'job-1',
    uri: URI,
    keyReferences: [],
    lockPlan: { lockNdefReadOnly: false, lockConfiguration: false },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Proveedor simulado
// ---------------------------------------------------------------------------

describe('MockNfcProvider - declaracion honesta de capacidades', () => {
  it('se declara como simulacion', () => {
    expect(new MockNfcProvider().capabilities.isSimulation).toBe(true);
  });

  it('NO declara capacidad de prueba criptografica', () => {
    expect(new MockNfcProvider().capabilities.canProduceCryptographicProof).toBe(false);
  });

  it('su nombre visible advierte que no es autenticacion real', () => {
    expect(new MockNfcProvider().capabilities.displayName.toLowerCase()).toContain('no es');
  });

  it('todo payload de verificacion va marcado como simulado', async () => {
    const provider = new MockNfcProvider();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());
    const payload = await provider.readVerificationPayload(detection);
    expect(payload.simulated).toBe(true);
  });

  it('nunca fabrica un mensaje autenticado', async () => {
    const provider = new MockNfcProvider();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());
    const payload = await provider.readVerificationPayload(detection);
    expect(payload.authenticatedMessage).toBeNull();
  });

  it('su comprobacion de originalidad se reporta como no soportada', async () => {
    const result = await new MockNfcProvider().validateOriginality();
    expect(result.verified).toBe(false);
    expect(result.notSupported).toBe(true);
    expect(result.detail).toContain('SIMULACION');
  });
});

describe('MockNfcProvider - ciclo completo de personalizacion', () => {
  it('escribe, relee y confirma que coincide', async () => {
    const provider = new MockNfcProvider();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);

    expect(inspection.hasNdefMessage).toBe(false);

    const prepared = await provider.preparePersonalization(inspection, plan());
    expect(prepared.ok).toBe(true);

    const write = await provider.writeNdef(inspection, plan());
    expect(write.success).toBe(true);
    expect(write.bytesWritten).toBeGreaterThan(0);

    const verify = await provider.verifyPersonalization(inspection, plan(), write);
    expect(verify.matches).toBe(true);
    expect(verify.readBackUri).toBe(URI);
  });

  it('el contador de lecturas simulado avanza en cada lectura', async () => {
    const provider = new MockNfcProvider();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());

    const first = await provider.readVerificationPayload(detection);
    const second = await provider.readVerificationPayload(detection);
    expect(second.readCounter!).toBeGreaterThan(first.readCounter!);
  });

  it('un fallo de escritura forzado es reintentable', async () => {
    const provider = new MockNfcProvider({ failWrite: true });
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    const write = await provider.writeNdef(inspection, plan());
    expect(write.success).toBe(false);
    expect(write.error?.retryable).toBe(true);
    expect(write.error?.operatorMessage).toBeTruthy();
  });

  it('una relectura corrupta no coincide', async () => {
    const provider = new MockNfcProvider({ corruptOnVerify: true });
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    const write = await provider.writeNdef(inspection, plan());
    const verify = await provider.verifyPersonalization(inspection, plan(), write);
    expect(verify.matches).toBe(false);
  });

  it('rechaza escribir sobre un chip bloqueado', async () => {
    const tag = createSimulatedTag('04AABBCCDDEE80');
    tag.readOnly = true;
    const provider = new MockNfcProvider({ tag });
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    const prepared = await provider.preparePersonalization(inspection, plan());
    expect(prepared.ok).toBe(false);
    expect(prepared.error?.code).toBe('TAG_READ_ONLY');
  });

  it('rechaza una URI que no cabe en el chip', async () => {
    const provider = new MockNfcProvider({ tag: createSimulatedTag('0400', 'NTAG213') });
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    const prepared = await provider.preparePersonalization(
      inspection,
      plan({ uri: `https://a.test/${'x'.repeat(300)}` }),
    );
    expect(prepared.ok).toBe(false);
    expect(prepared.error?.code).toBe('INSUFFICIENT_MEMORY');
  });

  it('detecta un chip ilegible tras el termosellado', async () => {
    const provider = new MockNfcProvider({ failPostPress: true });
    const detection = await provider.detectTag();
    const result = await provider.runPostPressCheck(detection, URI);
    expect(result.readable).toBe(false);
    expect(result.contentIntact).toBe(false);
  });

  it('confirma el contenido intacto tras el termosellado simulado', async () => {
    const provider = new MockNfcProvider();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());
    const result = await provider.runPostPressCheck(detection, URI);
    expect(result.readable).toBe(true);
    expect(result.contentIntact).toBe(true);
    expect(result.detail).toContain('SIMULACION');
  });
});

// ---------------------------------------------------------------------------
// Proveedor NTAG 21x (logica real, transporte simulado)
// ---------------------------------------------------------------------------

describe('Ntag21xNdefProvider - escritura NDEF real sobre transporte simulado', () => {
  function build(chipType: 'NTAG213' | 'NTAG215' | 'NTAG216' = 'NTAG213') {
    const tag = createSimulatedTag('04A1B2C3D4E580', chipType);
    const transport = new SimulatedTagTransport(tag);
    const detection = { uid: tag.uid, chipType, technologies: ['NfcA', 'Ndef'] };
    return { tag, transport, provider: new Ntag21xNdefProvider({ transport, detection }) };
  }

  it('NO declara capacidad de prueba criptografica', () => {
    expect(build().provider.capabilities.canProduceCryptographicProof).toBe(false);
  });

  it('no se declara simulacion: la logica de codificacion es real', () => {
    expect(build().provider.capabilities.isSimulation).toBe(false);
  });

  it('escribe y relee correctamente la URI', async () => {
    const { provider } = build();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);

    const write = await provider.writeNdef(inspection, plan());
    expect(write.success).toBe(true);
    expect(write.writtenPayloadHex).toMatch(/^03/); // TLV NDEF

    const verify = await provider.verifyPersonalization(inspection, plan(), write);
    expect(verify.matches).toBe(true);
    expect(verify.readBackUri).toBe(URI);
  });

  it('detecta un chip virgen sin mensaje NDEF', async () => {
    const { provider } = build();
    const inspection = await provider.inspectTag(await provider.detectTag());
    expect(inspection.hasNdefMessage).toBe(false);
    expect(inspection.currentUri).toBeNull();
  });

  it('detecta un chip bloqueado mediante el sondeo de escritura', async () => {
    const { tag, provider } = build();
    tag.readOnly = true;
    const inspection = await provider.inspectTag(await provider.detectTag());
    expect(inspection.readOnly).toBe(true);
  });

  it('rechaza un chip que no pertenece a la familia NTAG 21x', async () => {
    const tag = createSimulatedTag('04FF', 'NTAG424DNA');
    const transport = new SimulatedTagTransport(tag);
    const provider = new Ntag21xNdefProvider({
      transport,
      detection: { uid: tag.uid, chipType: 'NTAG424DNA', technologies: ['IsoDep'] },
    });
    await expect(provider.detectTag()).rejects.toThrow(NfcOperationError);
  });

  it('rechaza un plan con referencias de clave: el chip no las admite', async () => {
    const { provider } = build();
    const inspection = await provider.inspectTag(await provider.detectTag());
    const prepared = await provider.preparePersonalization(
      inspection,
      plan({ keyReferences: [{ reference: 'arn:...:PLACEHOLDER', custodian: 'kms', version: 1 }] }),
    );
    expect(prepared.ok).toBe(false);
    expect(prepared.error?.code).toBe('OPERATION_NOT_PERMITTED');
  });

  it('rechaza la personalizacion criptografica', async () => {
    const { provider } = build();
    const result = await provider.personalizeSecureTag();
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('OPERATION_NOT_PERMITTED');
  });

  it('nunca devuelve un mensaje autenticado', async () => {
    const { provider } = build();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());
    const payload = await provider.readVerificationPayload(detection);
    expect(payload.authenticatedMessage).toBeNull();
    expect(payload.readCounter).toBeNull();
    expect(payload.simulated).toBe(false);
  });

  it('extrae el token de la URI leida', async () => {
    const { provider } = build();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());
    const payload = await provider.readVerificationPayload(detection);
    expect(payload.token).toBe('8xKq2LmNpRt4wZ9c');
  });

  it('reporta la originalidad como no soportada sin la clave publica de NXP', async () => {
    const result = await build().provider.validateOriginality();
    expect(result.notSupported).toBe(true);
    expect(result.verified).toBe(false);
  });

  it('el bloqueo irreversible NO esta implementado y lo declara', async () => {
    const { provider } = build();
    const inspection = await provider.inspectTag(await provider.detectTag());
    const result = await provider.lockAllowedAreas(inspection, {
      lockNdefReadOnly: true,
      lockConfiguration: false,
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_IMPLEMENTED');
  });

  it('un plan de bloqueo vacio es una operacion valida sin efecto', async () => {
    const { provider } = build();
    const inspection = await provider.inspectTag(await provider.detectTag());
    const result = await provider.lockAllowedAreas(inspection, {
      lockNdefReadOnly: false,
      lockConfiguration: false,
    });
    expect(result.success).toBe(true);
  });

  it('detecta contenido alterado tras el termosellado', async () => {
    const { tag, provider } = build();
    const detection = await provider.detectTag();
    const inspection = await provider.inspectTag(detection);
    await provider.writeNdef(inspection, plan());

    tag.memory.fill(0, 5, 20); // dano simulado del calor

    const result = await provider.runPostPressCheck(detection, URI);
    expect(result.contentIntact).toBe(false);
  });

  it('una NTAG215 admite URIs que no caben en una NTAG213', async () => {
    const largeUri = `https://ev.mrthn.ec/v/${'A'.repeat(200)}`;
    const small = build('NTAG213');
    const large = build('NTAG215');

    const smallInspection = await small.provider.inspectTag(await small.provider.detectTag());
    const largeInspection = await large.provider.inspectTag(await large.provider.detectTag());

    expect((await small.provider.preparePersonalization(smallInspection, plan({ uri: largeUri }))).ok).toBe(false);
    expect((await large.provider.preparePersonalization(largeInspection, plan({ uri: largeUri }))).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Proveedor NTAG 424 DNA (contrato sin implementacion)
// ---------------------------------------------------------------------------

describe('Ntag424DnaProvider - contrato declarado, implementacion pendiente', () => {
  function build() {
    const tag = createSimulatedTag('04DEADBEEF0080', 'NTAG424DNA');
    return new Ntag424DnaProvider({
      transport: new SimulatedTagTransport(tag),
      detection: { uid: tag.uid, chipType: 'NTAG424DNA', technologies: ['IsoDep'] },
    });
  }

  it('NO afirma poder producir una prueba criptografica', () => {
    expect(build().capabilities.canProduceCryptographicProof).toBe(false);
  });

  it('su nombre visible declara que la integracion esta pendiente', () => {
    expect(build().capabilities.displayName).toContain('PENDIENTE');
  });

  it('la personalizacion segura lanza NOT_IMPLEMENTED', async () => {
    await expect(build().personalizeSecureTag()).rejects.toThrow(NfcOperationError);
  });

  it('la lectura del payload de verificacion lanza NOT_IMPLEMENTED', async () => {
    await expect(build().readVerificationPayload()).rejects.toThrow(NfcOperationError);
  });

  it('rechaza degradar el chip a NDEF simple', async () => {
    const result = await build().writeNdef();
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('OPERATION_NOT_PERMITTED');
  });

  it('no simula una comprobacion de originalidad', async () => {
    const result = await build().validateOriginality();
    expect(result.verified).toBe(false);
    expect(result.notSupported).toBe(true);
    expect(result.simulated).toBe(false);
  });

  it('publica la lista explicita de trabajo pendiente', () => {
    expect(NTAG424_PENDING_WORK.length).toBeGreaterThan(0);
    for (const item of NTAG424_PENDING_WORK) {
      expect(item.blockedBy.length).toBeGreaterThan(10);
    }
  });
});

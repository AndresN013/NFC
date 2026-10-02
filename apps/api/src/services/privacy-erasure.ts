import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '../lib/audit.js';

/**
 * Ejecucion del derecho de eliminacion.
 *
 * LA TENSION QUE ESTE CODIGO RESUELVE
 * -----------------------------------
 * Hay dos obligaciones que apuntan en direcciones opuestas:
 *
 *  a) La persona tiene derecho a que sus datos se eliminen.
 *  b) El responsable debe poder DEMOSTRAR que en su dia obtuvo un consentimiento
 *     valido, y conservar la trazabilidad de operaciones con efecto economico.
 *
 * Borrar la fila de la persona a secas incumple (b): desaparece la prueba de que
 * el consentimiento existio, y con ella la defensa del responsable. Conservarla
 * intacta incumple (a).
 *
 * LA RESOLUCION QUE SE APLICA AQUI: anonimizacion irreversible en lugar de
 * borrado fisico.
 *
 *  - Se destruye todo dato IDENTIFICATIVO: correo, nombre, hash de contrasena.
 *    El correo se sustituye por un sello de tiempo opaco en un dominio invalido,
 *    de modo que la fila siga siendo unica pero no apunte a nadie.
 *  - Se conservan las FILAS de consentimiento, canje y auditoria. Ya no
 *    identifican a una persona, pero siguen probando que hubo una decision y
 *    que hubo una operacion.
 *  - Se cierra toda titularidad activa, porque una prenda no puede pertenecer a
 *    una cuenta anonimizada. La prenda vuelve a ser reclamable, que es el
 *    resultado correcto: el objeto fisico sigue existiendo y tiene un dueno real.
 *  - Se revocan las sesiones, porque de lo contrario un dispositivo con sesion
 *    viva seguiria operando sobre una cuenta que ya no debe existir.
 *
 * LO QUE ESTA OPERACION NO HACE, Y DEBE CONSTAR:
 *  - No es reversible. No hay deshacer.
 *  - No borra copias de seguridad. La purga del historico de respaldos es un
 *    procedimiento de infraestructura, no de aplicacion. Ver docs/privacidad-lopdp.md
 *  - No borra datos que ya se hubieran exportado a un tercero antes de la
 *    solicitud.
 */

export interface ResultadoEliminacion {
  fanId: string;
  titularidadesCerradas: number;
  transferenciasCanceladas: number;
  casosAnonimizados: number;
  consentimientosConservados: number;
}

/** Marcador de posicion de correo. No es una direccion entregable. */
function correoAnonimo(fanId: string): string {
  // `.invalid` esta reservado por la RFC 2606 precisamente para esto: garantiza
  // que la direccion no puede existir ni resolverse.
  return `eliminado-${fanId}@invalid`;
}

export async function ejecutarEliminacionDeDatos(
  db: PrismaClient,
  params: { fanId: string; actorId: string; privacyRequestId: string; ipPrefix?: string | null },
): Promise<ResultadoEliminacion> {
  return db.$transaction(async (tx) => {
    const ahora = new Date();

    // 1. Cerrar titularidades activas. La prenda vuelve a ser reclamable.
    const titularidades = await tx.ownership.updateMany({
      where: { fanId: params.fanId, endedAt: null },
      data: { endedAt: ahora },
    });

    // 2. Cancelar transferencias pendientes en cualquiera de los dos extremos.
    const transferencias = await tx.ownershipTransfer.updateMany({
      where: {
        state: 'PENDING',
        OR: [{ fromFanId: params.fanId }, { toFanId: params.fanId }],
      },
      data: { state: 'CANCELLED', cancelledAt: ahora },
    });

    // 3. Revocar todas las sesiones. Sin esto, un telefono con sesion viva
    //    seguiria operando sobre una cuenta ya anonimizada.
    await tx.fanSession.updateMany({
      where: { fanId: params.fanId, revokedAt: null },
      data: { revokedAt: ahora },
    });

    // 4. Anonimizar los casos de soporte: se conserva el caso (historial de
    //    calidad y garantia) sin el correo de contacto.
    const casos = await tx.supportCase.updateMany({
      where: { fanId: params.fanId },
      data: { contactEmail: correoAnonimo(params.fanId) },
    });

    // 5. Conteo de consentimientos que se CONSERVAN como prueba. Ya no
    //    identifican a nadie porque la cuenta queda anonimizada.
    const consentimientos = await tx.consent.count({ where: { fanId: params.fanId } });

    // 6. Destruir los datos identificativos de la cuenta.
    await tx.fanAccount.update({
      where: { id: params.fanId },
      data: {
        email: correoAnonimo(params.fanId),
        passwordHash: null,
        displayName: null,
        emailVerifiedAt: null,
        active: false,
        deletedAt: ahora,
        loyaltyTier: 0,
      },
    });

    // 7. Desvincular la solicitud de la cuenta y dejar constancia de que la
    //    eliminacion se EJECUTO, no solo de que el caso se cerro.
    await tx.privacyRequest.update({
      where: { id: params.privacyRequestId },
      data: {
        state: 'COMPLETED',
        resolvedAt: ahora,
        resolvedById: params.actorId,
        deletionExecutedAt: ahora,
        // El correo de la solicitud tambien es dato identificativo.
        email: correoAnonimo(params.fanId),
        fanId: null,
      },
    });

    await recordAudit(tx, {
      actorId: params.actorId,
      action: 'privacy.deletion.executed',
      entityType: 'FanAccount',
      entityId: params.fanId,
      metadata: {
        privacyRequestId: params.privacyRequestId,
        titularidadesCerradas: titularidades.count,
        transferenciasCanceladas: transferencias.count,
        casosAnonimizados: casos.count,
        consentimientosConservados: consentimientos,
        // Se registra explicitamente que fue anonimizacion y no borrado fisico.
        metodo: 'anonimizacion_irreversible',
      },
      ipPrefix: params.ipPrefix ?? null,
    });

    return {
      fanId: params.fanId,
      titularidadesCerradas: titularidades.count,
      transferenciasCanceladas: transferencias.count,
      casosAnonimizados: casos.count,
      consentimientosConservados: consentimientos,
    };
  });
}

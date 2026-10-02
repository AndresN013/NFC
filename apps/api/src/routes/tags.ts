import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildQrUrl,
  buildTagUrl,
  generateQrToken,
  generateTagToken,
  generateUnitPublicRef,
  hashToken,
} from '@mev/domain';
import { checkUriFits } from '@mev/nfc-contracts';
import { badRequest, notFound } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { buildRequestContext } from '../lib/request-context.js';

/**
 * Aprovisionamiento de etiquetas para pilotos y pruebas.
 *
 * PARA QUE SIRVE
 * --------------
 * Permite preparar una camiseta y obtener la URL que hay que grabar en el chip,
 * usando una aplicacion generica de escritura NFC desde un telefono cualquiera.
 * Es el camino para un piloto pequeno mientras la app Android de planta no este
 * compilada y desplegada.
 *
 * EN QUE SE DIFERENCIA DE LA LINEA DE PRODUCCION
 * ----------------------------------------------
 * El flujo de `routes/production.ts` es el de la planta: reserva el chip por su
 * UID, ordena la escritura, exige la relectura de comprobacion y el control
 * posterior al termosellado antes de activar. Cada paso lo confirma la app tras
 * hablar con el chip.
 *
 * Aqui no hay app que hable con el chip, asi que:
 *  - El UID no se conoce (la aplicacion generica no lo reporta). Se registra un
 *    identificador sintetico con el prefijo `PILOT-` para que sea evidente en el
 *    panel que esa unidad no paso por la linea.
 *  - No hay relectura verificada por el servidor ni control post-termosellado.
 *
 * Por eso las unidades creadas aqui quedan marcadas y NO deben confundirse con
 * produccion real. La marca vive en el UID sintetico y en la auditoria.
 */

/** Identificador sintetico. El prefijo lo hace inconfundible en el panel. */
function uidDePiloto(): string {
  return `PILOT-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export default async function tagRoutes(app: FastifyInstance): Promise<void> {
  const { config, db } = app;

  app.post(
    '/tags/provision',
    {
      // Exige poder escribir en produccion Y activar: preparar una etiqueta
      // lista para usar es exactamente las dos cosas a la vez.
      preHandler: [app.requirePermission('production:activate')],
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
      schema: {
        tags: ['admin'],
        summary: 'Prepara una camiseta y devuelve la URL a grabar en el chip',
      },
    },
    async (request, reply) => {
      const body = z
        .object({
          skuCode: z.string().min(1).max(100),
          playerId: z.string().uuid().nullish(),
          shirtNumber: z.number().int().min(0).max(99).nullish(),
          /**
           * Base de la URL que se grabara. Debe ser una direccion que el
           * TELEFONO DEL AFICIONADO pueda abrir: `localhost` no sirve.
           * Si se omite se usa `FAN_WEB_PUBLIC_URL`.
           */
          baseUrl: z.string().url().max(200).nullish(),
          /** Tipo de chip, para comprobar que la URL cabe en su memoria. */
          chipType: z.enum(['NTAG213', 'NTAG215', 'NTAG216']).default('NTAG213'),
        })
        .parse(request.body);

      const actor = request.currentUser!;
      const context = buildRequestContext(request, config.ANALYTICS_IP_SALT);

      const base = (body.baseUrl ?? config.FAN_WEB_PUBLIC_URL).replace(/\/+$/, '');

      // Una URL a localhost se graba sin error y luego no abre nada en el
      // telefono del aficionado. Es el fallo mas facil de cometer aqui, asi que
      // se rechaza antes de crear nada.
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(base)) {
        throw badRequest(
          'Esa direccion solo funciona en el ordenador que ejecuta el servidor. ' +
            'Use la direccion de red del equipo (por ejemplo http://192.168.1.119:3000) ' +
            'o un dominio publico, para que el telefono del aficionado pueda abrirla.',
        );
      }

      const sku = await db.sku.findUnique({
        where: { code: body.skuCode },
        include: { jerseyModel: true },
      });
      if (!sku) throw notFound(`No existe el SKU ${body.skuCode}`);

      const tagToken = generateTagToken();
      const qrToken = generateQrToken();
      const tagUrl = buildTagUrl(base, tagToken);

      // Se comprueba la capacidad ANTES de crear nada: una URL que no cabe
      // produce una escritura truncada y un chip inservible.
      const capacidad = checkUriFits(tagUrl, body.chipType);
      if (!capacidad.fits) {
        throw badRequest(
          `La URL ocupa ${capacidad.requiredBytes} bytes y un ${body.chipType} ofrece ` +
            `${capacidad.availableBytes}. Use un dominio mas corto o un chip de mas memoria.`,
        );
      }

      const ahora = new Date();
      const publicRef = generateUnitPublicRef();

      const creado = await db.$transaction(async (tx) => {
        const chip = await tx.nfcChip.create({
          data: {
            uid: uidDePiloto(),
            chipType: body.chipType,
            // Se crea ya activado: este camino no tiene linea de produccion que
            // recorra los estados intermedios.
            state: 'ACTIVATED',
            tagTokenHash: hashToken(tagToken, config.TOKEN_HASH_PEPPER),
            programmedAt: ahora,
            verifiedAt: ahora,
            activatedAt: ahora,
          },
        });

        const emblem = await tx.emblem.create({
          data: { code: `EMB-${publicRef.replace('MEV-', '')}`, chipId: chip.id },
        });

        const unit = await tx.jerseyUnit.create({
          data: {
            jerseyModelId: sku.jerseyModelId,
            skuId: sku.id,
            playerId: body.playerId ?? null,
            shirtNumber: body.shirtNumber ?? null,
            emblemId: emblem.id,
            publicRef,
            qrTokenHash: hashToken(qrToken, config.TOKEN_HASH_PEPPER),
            state: 'ACTIVATED',
            activatedAt: ahora,
          },
          select: { id: true, publicRef: true },
        });

        await tx.digitalCertificate.create({
          data: { jerseyUnitId: unit.id, serial: `CERT-${publicRef.replace('MEV-', '')}` },
        });

        await recordAudit(tx, {
          actorId: actor.id,
          action: 'tags.provisioned',
          entityType: 'JerseyUnit',
          entityId: unit.id,
          metadata: {
            skuCode: body.skuCode,
            chipType: body.chipType,
            baseUrl: base,
            // Queda constancia de que esta unidad no recorrio la linea.
            via: 'aprovisionamiento_de_piloto',
          },
          ipPrefix: context.ipPrefix,
        });

        return unit;
      });

      return reply.status(201).send({
        unitId: creado.id,
        publicRef: creado.publicRef,
        /** Esto es lo que hay que grabar en el chip, tal cual. */
        tagUrl,
        /** Respaldo visible, por si el telefono no tiene NFC. */
        qrUrl: buildQrUrl(base, qrToken),
        club: sku.jerseyModel.clubId,
        model: sku.jerseyModel.name,
        bytes: { required: capacidad.requiredBytes, available: capacidad.availableBytes },
        // Se devuelve una sola vez. No se puede recuperar despues.
        aviso:
          'Esta URL se muestra una sola vez. Si la pierde, prepare otra camiseta: ' +
          'el sistema guarda el identificador cifrado y no puede recuperarlo.',
      });
    },
  );

  /**
   * Direcciones por las que este servidor es alcanzable desde otro dispositivo
   * de la misma red.
   *
   * Existe porque el error mas comun al preparar una etiqueta es grabar una URL
   * a `localhost`, que se graba sin problema y luego no abre nada en el telefono
   * del aficionado. Esto le da al operario las opciones correctas para elegir.
   */
  app.get(
    '/tags/direcciones',
    {
      preHandler: [app.requirePermission('production:read')],
      schema: { tags: ['admin'], summary: 'Direcciones de red utilizables para grabar' },
    },
    async () => {
      const { networkInterfaces } = await import('node:os');
      const puertoWeb = new URL(config.FAN_WEB_PUBLIC_URL).port || '3000';

      const direcciones: { etiqueta: string; base: string; nota: string }[] = [];

      for (const [nombre, interfaces] of Object.entries(networkInterfaces())) {
        for (const iface of interfaces ?? []) {
          if (iface.family !== 'IPv4' || iface.internal) continue;
          direcciones.push({
            etiqueta: `Red local (${nombre})`,
            base: `http://${iface.address}:${puertoWeb}`,
            nota: 'Funciona solo si el telefono esta en la misma red WiFi.',
          });
        }
      }

      const configurada = config.FAN_WEB_PUBLIC_URL;
      const esLocal = /localhost|127\.0\.0\.1/i.test(configurada);
      if (!esLocal) {
        direcciones.unshift({
          etiqueta: 'Direccion configurada',
          base: configurada,
          nota: 'La de FAN_WEB_PUBLIC_URL. Es la que usara produccion.',
        });
      }

      return {
        direcciones,
        advertencia: esLocal
          ? 'FAN_WEB_PUBLIC_URL apunta a localhost, que un telefono no puede abrir. ' +
            'Elija una direccion de red o configure un dominio publico.'
          : null,
      };
    },
  );
}

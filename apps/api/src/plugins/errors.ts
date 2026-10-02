import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { InvalidStateTransitionError } from '@mev/domain';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { NfcOperationError } from '@mev/nfc-contracts';

/**
 * Manejador central de errores.
 *
 * Contrato de respuesta: siempre `{ error: { code, message } }`.
 *
 * El `internalDetail` de un AppError y la traza de cualquier error inesperado
 * van al registro del servidor, NUNCA al cuerpo de la respuesta. Un mensaje de
 * error detallado en produccion es una fuga de informacion.
 */
/** Forma de los errores que Fastify y Prisma adjuntan mas alla de `Error`. */
interface AugmentedError extends Error {
  statusCode?: number;
  validation?: unknown;
  code?: string;
}

export default fp(async function errorsPlugin(app: FastifyInstance) {
  app.setErrorHandler((rawError, request, reply) => {
    // Las comprobaciones `instanceof` de abajo estrechan el tipo del parametro
    // hasta agotarlo, asi que se conserva una referencia con la forma ampliada
    // para poder leer `statusCode`, `validation` y `code` al final.
    const error = rawError as AugmentedError;

    if (error instanceof AppError) {
      if (error.internalDetail) {
        request.log.warn(
          { code: error.code, detail: error.internalDetail, path: request.url },
          'error de aplicacion',
        );
      }
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: 'Datos de entrada invalidos',
          issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }

    if (error instanceof InvalidStateTransitionError) {
      return reply.status(409).send({
        error: {
          code: 'INVALID_STATE',
          message: `No se puede pasar de ${error.from} a ${error.to}.`,
        },
      });
    }

    if (error instanceof NfcOperationError) {
      return reply.status(422).send({
        error: {
          code: error.info.code,
          message: error.info.operatorMessage,
          retryable: error.info.retryable,
        },
      });
    }

    // Errores de validacion de esquema de Fastify.
    if (error.validation) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Datos de entrada invalidos' },
      });
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Demasiadas solicitudes. Espere un momento e intente de nuevo.',
        },
      });
    }

    // Violacion de unicidad de Prisma: se traduce a 409 sin revelar la columna.
    if (error.code === 'P2002') {
      request.log.warn({ err: error, path: request.url }, 'violacion de unicidad');
      return reply.status(409).send({
        error: { code: 'CONFLICT', message: 'El recurso ya existe o esta en uso.' },
      });
    }

    request.log.error({ err: error, path: request.url }, 'error no controlado');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Ocurrio un error inesperado.' },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } });
  });
});

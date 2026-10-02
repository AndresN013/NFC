-- Restricciones que Prisma no expresa de forma nativa en el esquema.

-- Una unidad de jersey no puede tener dos titularidades activas a la vez.
-- Sin esta restriccion, una condicion de carrera entre dos reclamos
-- simultaneos dejaria dos propietarios validos para el mismo jersey.
CREATE UNIQUE INDEX "Ownership_active_unique"
  ON "Ownership" ("jerseyUnitId")
  WHERE "endedAt" IS NULL;

-- Una unidad no puede tener dos transferencias pendientes simultaneas.
-- Impide que el titular genere varias invitaciones y que dos personas
-- distintas acepten la misma prenda.
CREATE UNIQUE INDEX "OwnershipTransfer_pending_unique"
  ON "OwnershipTransfer" ("jerseyUnitId")
  WHERE "state" = 'PENDING';

-- Busquedas de eventos recientes por unidad: el motor de riesgo las ejecuta
-- en cada verificacion, asi que el orden descendente importa.
CREATE INDEX "VerificationEvent_unit_recent"
  ON "VerificationEvent" ("jerseyUnitId", "createdAt" DESC);

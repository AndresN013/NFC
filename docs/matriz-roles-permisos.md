# Matriz de roles y permisos

Fuente única: `packages/domain/src/rbac.ts`. La evaluación en tiempo de ejecución
está en `apps/api/src/auth/plugin.ts` (`requirePermission`) y llama a `hasAccess`
del dominio. Esta tabla se deriva literalmente de `ROLE_PERMISSIONS`; si el
código cambia, este documento queda desactualizado y debe corregirse contra el
código, no al contrario.

---

## 1. Los siete roles

| Rol | A quién representa | Ámbito habitual |
|---|---|---|
| `SUPERADMIN` | Administración técnica de la plataforma | `GLOBAL` |
| `MARATHON_ADMIN` | Personal de Marathon con responsabilidad operativa | `GLOBAL` u `ORGANIZATION` |
| `CLUB_ADMIN` | Persona designada por un club | `CLUB` |
| `PRODUCTION_OPERATOR` | Operario de la línea de producción | `ORGANIZATION` |
| `SUPPORT` | Atención al aficionado y privacidad | `GLOBAL` u `ORGANIZATION` |
| `CONTENT_AGENCY` | Agencia externa que produce contenido | `CLUB` o `CAMPAIGN` |
| `SPONSOR` | Patrocinador externo | `CAMPAIGN` |

`SPONSOR` y `CONTENT_AGENCY` están declarados como roles externos en
`EXTERNAL_ROLES`.

---

## 2. Matriz completa rol × permiso

Leyenda: `X` = el rol tiene el permiso; celda vacía = no lo tiene.

| Permiso | SUPERADMIN | MARATHON_ADMIN | CLUB_ADMIN | PRODUCTION_OPERATOR | SUPPORT | CONTENT_AGENCY | SPONSOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `users:read` | X | X | | | | | |
| `users:write` | X | X | | | | | |
| `roles:assign` | X | X | | | | | |
| `audit:read` | X | X | | | | | |
| `catalog:read` | X | X | X | X | X | X | |
| `catalog:write` | X | X | | | | | |
| `production:read` | X | X | X | X | X | | |
| `production:write` | X | X | | X | | | |
| `production:activate` | X | X | | | | | |
| `production:quarantine` | X | X | | X | | | |
| `production:revoke` | X | X | | | | | |
| `devices:read` | X | X | | | | | |
| `devices:write` | X | X | | | | | |
| `chips:read` | X | X | | | | | |
| `chips:write` | X | X | | X | | | |
| `fans:read` | X | X | | | X | | |
| `ownership:read` | X | X | | | X | | |
| `ownership:write` | X | X | | | X | | |
| `content:read` | X | X | X | | | X | |
| `content:write` | X | X | X | | | X | |
| `campaigns:read` | X | X | X | | | X | X |
| `campaigns:write` | X | X | | | | | |
| `rewards:read` | X | X | X | | | | |
| `rewards:write` | X | X | | | | | |
| `alerts:read` | X | X | X | | X | | |
| `alerts:write` | X | X | | | | | |
| `support:read` | X | X | | | X | | |
| `support:write` | X | X | | | X | | |
| `privacy:read` | X | X | | | X | | |
| `privacy:write` | X | X | | | X | | |
| `analytics:read` | X | X | X | | | | |
| `analytics:campaign_scoped` | X | | | | | | X |

Totales: 32 permisos. `SUPERADMIN` tiene los 32. `MARATHON_ADMIN` tiene 31: le
falta **solo** `analytics:campaign_scoped`, que es el permiso estrecho del
patrocinador; un administrador de Marathon llega a las mismas métricas por
`analytics:read`, que es más amplio.

### 2.1 Asimetrías deliberadas de la matriz

Estas combinaciones parecen errores y no lo son.

| Observación | Razón |
|---|---|
| `PRODUCTION_OPERATOR` tiene `chips:write` pero **no** `chips:read` | El operario necesita grabar chips, no leer el UID completo de chips ya programados. `chips:read` es el permiso que revela el UID íntegro y es la vía para construir una lista de identificadores fuera de la planta. |
| `PRODUCTION_OPERATOR` no tiene `production:activate` ni `production:revoke` | Activar es una decisión comercial y revocar es una decisión de seguridad. Quien fabrica no decide qué sale a la venta ni qué se da de baja. Separación de funciones. |
| `PRODUCTION_OPERATOR` sí tiene `production:quarantine` | Apartar una unidad dudosa debe ser barato y estar al alcance de quien la tiene en la mano. Es una acción conservadora: detiene el flujo, no lo avanza. |
| `SUPPORT` tiene `ownership:write` pero no `chips:write` ni `production:revoke` | Soporte corrige titularidades (el caso real: alguien regaló la prenda y el registro quedó mal). No puede reprogramar un chip ni dar de baja una unidad. |
| `CLUB_ADMIN` tiene `production:read` pero ningún permiso de escritura de producción | El club quiere saber cuántas unidades de su modelo están fabricadas y activadas. No interviene en la línea. |
| `CLUB_ADMIN` tiene `content:write` pero no `campaigns:write` | El club edita el contenido que ve su afición. Las campañas comerciales con patrocinadores las abre Marathon. |
| `CLUB_ADMIN` no tiene `fans:read` | El club no necesita la identidad de los aficionados para publicar contenido. Ve `analytics:read`, que son agregados. |
| `CONTENT_AGENCY` no tiene `analytics:read` | Una agencia de contenido produce piezas; medir el rendimiento es de Marathon y del club. Se le niega la analítica para no darle un canal de observación sobre la base de usuarios. |
| `SPONSOR` no tiene `catalog:read` | Consecuencia práctica documentada en 4.2: hoy limita qué rutas del panel puede tocar. |

---

## 3. Modelo de alcances

Un permiso no se concede en el vacío: se concede sobre un **ámbito**. La
asignación es la tripleta `(rol, tipo de ámbito, id de ámbito)`, persistida en
`RoleAssignment` con unicidad `(userId, role, scopeType, scopeId)`.

```ts
export type ScopeType = 'GLOBAL' | 'ORGANIZATION' | 'CLUB' | 'CAMPAIGN';
```

| Tipo de ámbito | `scopeId` | Qué cubre |
|---|---|---|
| `GLOBAL` | `null` | Cualquier ámbito. Es el comodín. |
| `ORGANIZATION` | id de `Organization` | Los recursos de esa organización |
| `CLUB` | id de `Club` | Los recursos de ese club |
| `CAMPAIGN` | id de `Campaign` | Esa campaña y nada más |

### 3.1 Regla de evaluación

`hasAccess` recorre las asignaciones y acepta la primera que satisfaga las tres
condiciones:

1. El rol de la asignación incluye el permiso solicitado.
2. Si la asignación es `GLOBAL`, se concede sin más comprobaciones.
3. Si la asignación tiene ámbito, la comprobación **debe** declarar
   `scopeType` y `scopeId`, y ambos deben coincidir exactamente.

Hay una consecuencia que conviene tener presente: **una asignación con ámbito no
satisface una comprobación sin ámbito.** Si la ruta pide
`requirePermission('analytics:read')` sin pasar ámbito, solo la atraviesan las
asignaciones `GLOBAL`. No hay degradación silenciosa a "algo verá": se devuelve
403.

### 3.2 Ejemplos

**Ejemplo 1 — Club con ámbito propio.**
Asignación: `{ role: 'CLUB_ADMIN', scopeType: 'CLUB', scopeId: 'club-bsc' }`.

| Comprobación | Resultado | Por qué |
|---|---|---|
| `content:write` sobre `CLUB / club-bsc` | Concedido | Rol y ámbito coinciden |
| `content:write` sobre `CLUB / club-ldu` | Denegado | Otro club |
| `content:write` sin ámbito | Denegado | La asignación no es `GLOBAL` |
| `fans:read` sobre `CLUB / club-bsc` | Denegado | `CLUB_ADMIN` no tiene ese permiso en ningún ámbito |

**Ejemplo 2 — Patrocinador de una campaña.**
Asignación: `{ role: 'SPONSOR', scopeType: 'CAMPAIGN', scopeId: 'camp-A' }`.

| Comprobación | Resultado |
|---|---|
| `analytics:campaign_scoped` sobre `CAMPAIGN / camp-A` | Concedido |
| `analytics:campaign_scoped` sobre `CAMPAIGN / camp-B` | Denegado |
| `analytics:read` en cualquier ámbito | Denegado: el rol no lo tiene |
| `fans:read` en cualquier ámbito | Denegado por rol **y** por `PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES` |

La ruta `GET /api/v1/admin/analytics/campaign/:campaignId` hace esta comprobación
dos veces a propósito: primero `requirePermission('analytics:campaign_scoped')`
como barrera de entrada, y después `hasAccess(..., { scopeType: 'CAMPAIGN',
scopeId: campaignId })` con la campaña concreta de la URL. Sin la segunda, un
patrocinador con ámbito sobre `camp-A` podría leer `camp-B` cambiando un
identificador en la barra de direcciones.

**Ejemplo 3 — Acumulación de asignaciones.**
Una persona puede tener varias. `permissionsForRoles` une los permisos de todos
sus roles, pero **la unión de permisos no une los ámbitos**: cada permiso sigue
evaluándose contra la asignación que lo aporta. Alguien que sea `CLUB_ADMIN` de
Barcelona SC y `CONTENT_AGENCY` de una campaña no obtiene `content:write` sobre
la campaña por el hecho de tener `CLUB_ADMIN` en otro sitio.

**Ejemplo 4 — Operario de planta.**
Asignación: `{ role: 'PRODUCTION_OPERATOR', scopeType: 'ORGANIZATION', scopeId: 'org-marathon' }`.
Las rutas de `apps/api/src/routes/production.ts` usan
`requirePermission('production:write')` sin ámbito, de modo que en el estado
actual del código el operario necesita asignación `GLOBAL` para operar. Ver 4.2.

---

## 4. Por qué un patrocinador nunca accede a datos personales

Esta es la sección que no debe relajarse por conveniencia comercial.

### 4.1 Cuatro barreras independientes

**Barrera 1 — La matriz de roles.** `SPONSOR` tiene exactamente dos permisos:
`campaigns:read` y `analytics:campaign_scoped`. No tiene `fans:read`, ni
`ownership:read`, ni `analytics:read`, ni `support:read`, ni `chips:read`. No es
que estén restringidos por ámbito: no están en el rol.

**Barrera 2 — La lista de permisos prohibidos.**
`PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES` declara los nueve permisos que jamás
pueden concederse a un rol externo, **cualquiera sea su ámbito**:

| Permiso prohibido para rol externo | Qué expondría |
|---|---|
| `fans:read` | Identidad de aficionados: nombre, correo |
| `ownership:read` | Quién es titular de qué prenda |
| `ownership:write` | Capacidad de alterar titularidades |
| `chips:read` | UID completo de los chips |
| `chips:write` | Capacidad de reprogramar chips |
| `privacy:read` | Solicitudes de derechos, con datos de la persona |
| `privacy:write` | Capacidad de resolver esas solicitudes |
| `users:write` | Crear o modificar personal interno |
| `roles:assign` | Escalada de privilegios: concederse permisos |

Esta lista existe como **red de seguridad frente a un cambio accidental de la
matriz**. Es el escenario realista: alguien añade `fans:read` a `SPONSOR` para
resolver una petición de un patrocinador ("solo queremos saber quiénes
participaron"), y la prueba de autorización falla antes del despliegue. La
comprobación cruza `EXTERNAL_ROLES` con esta lista; no depende de que alguien
recuerde la regla.

**Barrera 3 — La analítica no expone filas.** En `packages/domain/src/analytics.ts`,
`SPONSOR_VISIBLE_EVENTS` es una lista blanca de dos eventos (`CONTENT_VIEWED`,
`QUIZ_COMPLETED`) y ninguno de clase `IDENTIFIED`. Las métricas que un
patrocinador consulta son contadores materializados en `CampaignMetric`,
calculados por un trabajo asíncrono que ya aplicó `suppressSmallCohort`. La ruta
del panel lee esa tabla, **no la tabla de eventos**. Un patrocinador no tiene
ninguna consulta que atraviese filas con sujeto.

**Barrera 4 — La supresión de cohortes pequeñas.** `MIN_AGGREGATE_COHORT_SIZE`
vale 20. Un agregado con menos sujetos se devuelve como `null`. Un "agregado" de
una persona no es un agregado: es un dato personal con otro nombre. Ver
[privacidad-lopdp.md](privacidad-lopdp.md).

### 4.2 Consecuencia honesta del estado actual

En `apps/api/src/routes/admin.ts`, `POST /logout` y `GET /me` están protegidos
con `requirePermission('catalog:read')`. `SPONSOR` **no tiene** `catalog:read`,
así que hoy un patrocinador que inicie sesión no puede leer su propio perfil ni
cerrar sesión por esa ruta. Del mismo modo, cualquier rol con asignación no
`GLOBAL` (el caso normal de `CLUB_ADMIN`, `CONTENT_AGENCY`, `SPONSOR` y del
operario) recibe 403 en las rutas que llaman a `requirePermission` sin declarar
ámbito.

Esto es un defecto de granularidad de las rutas, no del modelo de permisos. La
corrección pendiente es doble:

1. Proteger `/me` y `/logout` con una comprobación de sesión sin permiso de
   catálogo, porque leer el propio perfil no es leer el catálogo.
2. Pasar el ámbito del recurso en cada ruta que opere sobre un club, una
   organización o una campaña, en lugar de comprobar el permiso a secas.

Se registra aquí y en [limitaciones.md](limitaciones.md) para que no se
descubra en el piloto.

### 4.3 Lo que un patrocinador ve, en concreto

| Puede | No puede |
|---|---|
| Consultar las campañas de su ámbito (`campaigns:read`) | Ver ninguna campaña ajena |
| Leer contadores diarios de `CampaignMetric` de **su** campaña | Ejecutar ninguna consulta sobre `VerificationEvent`, `Ownership` o `FanAccount` |
| Ver el valor de `minCohortSize` y saber que hay supresión | Ver un contador por debajo del umbral: llega `null` |
| — | Exportar listas, correos, identificadores o UID |
| — | Cruzar su métrica con ninguna dimensión que individualice |

---

## 5. Cómo se prueba que la matriz no se rompió

La red de seguridad no es este documento. Son las pruebas de autorización del
dominio, que comprueban:

- Que ningún rol de `EXTERNAL_ROLES` tenga ningún permiso de
  `PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES`.
- Que ningún evento de clase `IDENTIFIED` esté en `SPONSOR_VISIBLE_EVENTS`.
- Que una asignación con ámbito no satisfaga una comprobación de otro ámbito.

Regla de trabajo: **antes de añadir un permiso a un rol externo, la conversación
no es técnica, es de privacidad.** Ver [privacidad-lopdp.md](privacidad-lopdp.md).

---

## 6. Documentos relacionados

- [arquitectura.md](arquitectura.md)
- [modelo-datos.md](modelo-datos.md)
- [guia-panel.md](guia-panel.md)
- [privacidad-lopdp.md](privacidad-lopdp.md)
- [politica-logs.md](politica-logs.md)
- [modelo-amenazas.md](modelo-amenazas.md)
- [limitaciones.md](limitaciones.md)

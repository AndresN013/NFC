# Guía del panel administrativo

Manual por rol: qué ve cada persona, qué puede hacer, en qué pantalla y contra qué
ruta de la API.

Fuentes: `apps/admin-web/src` (interfaz Next.js) y
`apps/api/src/routes/admin.ts` (API). La matriz de permisos está en
[matriz-roles-permisos.md](matriz-roles-permisos.md) y aquí se usa sin volver a
justificarla.

> **Estado.** El panel tiene 20 pantallas implementadas, incluida la del
> patrocinador y las tres del circuito de soporte (detalle del caso, ficha del
> aficionado y detalle de la solicitud de privacidad).
>
> Los huecos que quedan son de **catálogo y marketing**: el catálogo, el
> contenido, las campañas y las recompensas se administran por semilla o por SQL.
> Ningún circuito del producto queda bloqueado por ello. Se señalan en cada
> sección y se resumen en 12.

Prefijos de API:

| Superficie | Prefijo | Consumidor |
|---|---|---|
| Panel administrativo | `/api/v1/admin` | `apps/admin-web` |
| App de planta | `/api/v1/production` | `apps/nfc-android` |
| Web del aficionado | `/api/v1` y `/api/v1/fan` | `apps/fan-web` |

---

## 1. Cómo decide la interfaz qué mostrar

### 1.1 La regla que gobierna todo el panel

El encabezado de `apps/admin-web/src/lib/permissions.ts` lo dice en mayúsculas:

> **ESTO NO ES CONTROL DE ACCESO.**
> Todo lo que hay aquí sirve únicamente para no enseñar botones y secciones que el
> usuario no puede usar. La autorización real la aplica el servidor.

Consecuencia práctica, también literal del código: si alguien manipula la lista de
permisos en su navegador, lo único que consigue es ver un enlace que al pulsarlo
devuelve 403. Por eso las páginas **muestran el error de la API** en lugar de
suponer que no puede ocurrir.

### 1.2 De dónde salen los permisos de la interfaz

Dos fuentes, en este orden:

1. **`GET /api/v1/admin/me`**, que devuelve una lista `permissions` ya evaluada por
   el servidor a partir de `ALL_UI_PERMISSIONS`.
2. **`uiPermissionsFromAssignments`**, un cálculo del cliente a partir de los roles
   que devolvió el inicio de sesión. Es el respaldo para cuando `/me` no está
   disponible.

El respaldo existe por un caso real documentado en el propio archivo: `/admin/me`
exige `catalog:read`, que un `SPONSOR` **no tiene**, así que un patrocinador recibe
403 al pedir su propio perfil. Sin el respaldo su menú quedaría vacío y no podría
llegar ni a su campaña.

El comentario del código añade la valoración correcta: al ser un cálculo del
cliente, **vale todavía menos** que la lista del servidor y es exclusivamente para
pintar el menú.

### 1.3 Limitación heredada del modelo de ámbitos

`requirePermission` sin ámbito solo lo satisface una asignación `GLOBAL`. La mayoría
de las rutas de `admin.ts` se declaran así. Consecuencia: **hoy el panel es
plenamente usable por usuarios con asignación `GLOBAL`**, y un `CLUB_ADMIN` con
ámbito `CLUB` recibirá 403 en las pantallas que no pasen su ámbito.

Es un defecto conocido de granularidad de las rutas, no del modelo de permisos.
Detalle en [matriz-roles-permisos.md](matriz-roles-permisos.md) sección 4.2. Las
secciones siguientes describen el diseño previsto; los roles con ámbito no podrán
ejercerlo hasta que se corrija.

### 1.4 `ALL_UI_PERMISSIONS` es más corta que la matriz

La lista que el servidor evalúa para la interfaz tiene 25 entradas de los 32
permisos. Omite `roles:assign`, `chips:write`, `ownership:write`,
`campaigns:write`, `rewards:write`, `support:write` y `privacy:write`. Todas ellas
son escrituras cuyo permiso de lectura acompañante sí está: la sección se muestra
por la lectura y el servidor decide la escritura.

---

## 2. Mapa de pantallas

`NAV_GROUPS` en `apps/admin-web/src/lib/nav.ts` declara la navegación, y cada
entrada lleva el permiso de lectura que la API exige. `AppShell` filtra los grupos
y oculta los que queden vacíos.

| Grupo | Pantalla | Ruta de la interfaz | Permiso | API que consume |
|---|---|---|---|---|
| General | Inicio | `/` | `analytics:read` | `GET /admin/analytics/overview` |
| Administración | Usuarios | `/usuarios` | `users:read` | `GET/POST /admin/users`, `PATCH /admin/users/:id/active` |
| Administración | Auditoría | `/auditoria` | `audit:read` | `GET /admin/audit`, con exportación CSV |
| Catálogo | Clubes | `/catalogo/clubes` | `catalog:read` | `GET /admin/clubs` |
| Catálogo | Modelos | `/catalogo/modelos` | `catalog:read` | `GET /admin/jersey-models`, `GET /admin/clubs` |
| Catálogo | Jugadores | `/catalogo/jugadores` | `catalog:read` | `GET /admin/players`, `GET /admin/clubs` |
| Producción | Órdenes | `/produccion/ordenes` | `production:read` | `GET/POST /admin/orders`, `GET /admin/clubs` |
| Producción | Lotes | `/produccion/lotes` | `production:read` | `GET /admin/batches` |
| Producción | Unidades | `/produccion/unidades` | `production:read` | `GET /admin/units`, `POST /admin/units/:id/revoke`, exportación CSV |
| Producción | Dispositivos | `/produccion/dispositivos` | `devices:read` | `GET/POST /admin/devices`, `PATCH /admin/devices/:id/active` |
| Producción | Chips NFC | `/chips` | `chips:read` | `GET /admin/chips` |
| Riesgo y atención | Alertas | `/riesgo/alertas` | `alerts:read` | `GET /admin/alerts`, `PATCH /admin/alerts/:id` |
| Riesgo y atención | Casos de soporte | `/soporte/casos` | `support:read` | `GET /admin/support-cases` |
| Riesgo y atención | Solicitudes de privacidad | `/privacidad/solicitudes` | `privacy:read` | `GET /admin/privacy-requests` |
| Contenido | Contenido dinámico | `/contenido` | `content:read` | `GET /admin/content` |
| — | Entrar | `/entrar` | — | `POST /admin/login` |
| Patrocinio | Campaña | `/patrocinador/campana/[id]` | `analytics:campaign_scoped` | `GET /admin/analytics/campaign/:campaignId` |

`AppShell` y la pantalla de inicio construyen el enlace
`/patrocinador/campana/<campaignId>` para los usuarios con ámbito de campaña, y la
página existe en `apps/admin-web/src/app/patrocinador/campana/[id]/page.tsx`. El
nombre del segmento dinámico es `[id]`, no `[campaignId]`; en Next.js eso solo
cambia el nombre del parámetro, no la URL.

### 2.1 Catálogo completo de rutas de la API del panel

| Ruta | Método | Permiso | ¿Pantalla que la usa? |
|---|---|---|---|
| `/admin/login` | POST | — | `/entrar` |
| `/admin/logout` | POST | `catalog:read` | `AppShell` |
| `/admin/me` | GET | `catalog:read` | `SessionProvider` |
| `/admin/users` | GET | `users:read` | `/usuarios` |
| `/admin/users` | POST | `users:write` | `/usuarios` |
| `/admin/users/:id/active` | PATCH | `users:write` | `/usuarios` |
| `/admin/clubs` | GET | `catalog:read` | varias |
| `/admin/jersey-models` | GET | `catalog:read` | `/catalogo/modelos` |
| `/admin/players` | GET | `catalog:read` | `/catalogo/jugadores` |
| `/admin/units` | GET | `production:read` | `/produccion/unidades` |
| `/admin/units/:id/revoke` | POST | `production:revoke` | `/produccion/unidades` |
| `/admin/chips` | GET | `chips:read` | `/chips` |
| `/admin/batches` | GET | `production:read` | `/produccion/lotes` |
| `/admin/orders` | GET | `production:read` | `/produccion/ordenes` |
| `/admin/orders` | POST | `production:write` | `/produccion/ordenes` |
| `/admin/devices` | GET | `devices:read` | `/produccion/dispositivos` |
| `/admin/devices` | POST | `devices:write` | `/produccion/dispositivos` |
| `/admin/devices/:id/active` | PATCH | `devices:write` | `/produccion/dispositivos` |
| `/admin/alerts` | GET | `alerts:read` | `/riesgo/alertas` |
| `/admin/alerts/:id` | PATCH | `alerts:write` | `/riesgo/alertas` |
| `/admin/support-cases` | GET | `support:read` | `/soporte/casos` |
| `/admin/privacy-requests` | GET | `privacy:read` | `/privacidad/solicitudes` |
| `/admin/content` | GET | `content:read` | `/contenido` |
| `/admin/audit` | GET | `audit:read` | `/auditoria` |
| `/admin/analytics/overview` | GET | `analytics:read` | `/` |
| `/admin/analytics/campaign/:campaignId` | GET | `analytics:campaign_scoped` | `/patrocinador/campana/[id]` |

---

## 3. Inicio de sesión

`POST /api/v1/admin/login` desde `/entrar`. Devuelve token, caducidad, identidad,
`mfaEnabled` y las asignaciones de rol con su ámbito.

| Aspecto | Valor |
|---|---|
| Duración de la sesión | 12 h |
| Límite de peticiones | `RATE_LIMIT_LOGIN_PER_MINUTE`, por defecto 5 por minuto |
| Transporte del token | Cabecera `Authorization: Bearer <token>` |
| Auditoría | `admin.login` |
| **MFA** | `mfaEnabled` se devuelve pero **no se exige un segundo factor** |

El campo `mfaEnabled` en `true` **no significa que haya MFA**: significa que la
intención está registrada en el modelo. La interfaz no debe presentarlo como una
protección activa. Ver [limitaciones.md](limitaciones.md).

`POST /api/v1/admin/logout` revoca la sesión en el servidor. Cerrar sesión debe
llamar a esta ruta: borrar el token del navegador deja la sesión viva hasta su
caducidad.

---

## 4. `SUPERADMIN`

**Quién.** Administración técnica de la plataforma. Grupo muy pequeño y cuentas
nominales, nunca compartidas.

**Permisos.** Los 32. Es el único rol que tiene simultáneamente `analytics:read` y
`analytics:campaign_scoped`.

**Pantallas.** Todas las de la sección 2, incluida la del patrocinador: es el único
rol que tiene a la vez `analytics:read` y `analytics:campaign_scoped`.

**Para qué existe.** Arranque del sistema, asignación inicial de roles e
intervenciones excepcionales. **No es el rol de trabajo diario**: el trabajo
operativo se hace con `MARATHON_ADMIN`.

| Tarea propia del rol | Dónde |
|---|---|
| Crear las primeras cuentas de personal | `/usuarios` |
| Asignar roles y ámbitos | **Sin pantalla ni ruta.** Hoy por `prisma/seed.ts` o intervención directa en la base de datos |
| Revisar el registro de auditoría | `/auditoria` |

**Controles que deberían existir y no existen.** MFA obligatorio para este rol y
atestación del dispositivo de acceso. Mientras no existan, el rol se protege con
procedimiento: pocas cuentas, contraseñas largas de gestor, y revisión periódica
del registro de auditoría **por otra persona**.

---

## 5. `MARATHON_ADMIN`

**Quién.** Personal de Marathon con responsabilidad operativa sobre el producto.

**Permisos.** 31: todos menos `analytics:campaign_scoped`.

**Pantallas.** Todas las del panel.

### 5.1 Qué ve y qué hace, pantalla por pantalla

| Pantalla | Lectura | Acciones disponibles |
|---|---|---|
| `/` | Resumen agregado | — |
| `/usuarios` | Lista paginada de personal | Crear usuario, activar y desactivar (`canWrite` por `users:write`) |
| `/auditoria` | Registro filtrable | **Exportar CSV** |
| `/catalogo/*` | Clubes, modelos, jugadores | Solo lectura: no hay ruta de `catalog:write` |
| `/produccion/ordenes` | Órdenes con su estado | Crear orden (`canWrite` por `production:write`) |
| `/produccion/lotes` | Lotes con conteo de chips y emblemas | Solo lectura |
| `/produccion/unidades` | Unidades con filtros por estado, club y orden | **Revocar** (`canRevoke`), ver UID completo (`canSeeFullUid`), **exportar CSV** |
| `/produccion/dispositivos` | Teléfonos autorizados | Dar de alta y activar o desactivar (`canWrite` por `devices:write`) |
| `/chips` | Chips con UID completo, estado, contador y lote | Solo lectura |
| `/riesgo/alertas` | Alertas con filtros | Cambiar estado (`canReview` por `alerts:write`) |
| `/soporte/casos` | Casos de soporte | Solo lectura: no hay ruta de `support:write` |
| `/privacidad/solicitudes` | Solicitudes de derechos con su `dueAt` | Solo lectura: no hay ruta de `privacy:write` |
| `/contenido` | Contenido dinámico | Solo lectura: no hay ruta de `content:write` |

### 5.2 Acciones de consecuencia

**Revocar una unidad.** `POST /api/v1/admin/units/:id/revoke` desde
`/produccion/unidades`. Efecto inmediato: toda lectura pública devuelve `REVOKED` y
el aficionado ve *"Este registro fue dado de baja"*. Es **irreversible**: `REVOKED`
no tiene transición de salida en `JERSEY_UNIT_TRANSITIONS`. Se usa para
devoluciones, robos reportados y retiros de producción. **No** para una sospecha sin
confirmar: para eso está la cuarentena.

**Autorizar y desautorizar un dispositivo de planta.** `POST /api/v1/admin/devices`
y `PATCH /api/v1/admin/devices/:id/active`. Un teléfono no registrado no puede
programar. Al desactivar un dispositivo hay que **revocar también las sesiones
abiertas** desde él: si no, la sesión de 4 h sigue siendo válida hasta caducar.

**Desactivar un usuario.** `PATCH /api/v1/admin/users/:id/active`. La misma
advertencia: desactivar debe ir acompañado de revocar sesiones.

**Ver el UID completo.** `/chips` requiere `chips:read` y muestra el UID íntegro. En
`/produccion/unidades`, el UID se enmascara salvo que el usuario tenga `chips:read`,
y la exportación CSV registra en auditoría si el UID se incluyó
(`includedChipUid`). Un detalle deliberado de la API: **el hash del token nunca se
devuelve, ni a un `SUPERADMIN`**, porque no aporta nada operativo y su filtración
permitiría correlacionar.

**Marcar un lote.** Poner `ProductionBatch.flagged` degrada el veredicto de todas
las unidades del lote, **incluidas las ya vendidas**: el motor de riesgo suma 20
puntos en cada verificación. Exige motivo escrito y aviso a soporte, porque el
efecto será un aumento inmediato de reclamaciones de aficionados cuyas prendas son
legítimas. Hoy no hay pantalla para hacerlo. Ver
[protocolo-programacion.md](protocolo-programacion.md).

### 5.3 Exportaciones CSV

Dos pantallas exportan: `/produccion/unidades` y `/auditoria`.

| Propiedad | Comportamiento |
|---|---|
| Alcance | Se exporta **el conjunto filtrado completo**, no la página visible |
| Límite | `CSV_EXPORT_LIMIT` = 5.000 filas por exportación |
| Truncado | La API devuelve la cabecera `x-export-truncated`, y la interfaz **avisa en pantalla** |
| Auditoría | La exportación de unidades registra `admin.units.exported` con número de filas, total coincidente, si está truncada y si incluyó el UID |

El aviso de truncado no es un detalle cosmético: el propio componente lo justifica
—un fichero incompleto que no se anuncia se interpreta como el total y acaba en un
informe equivocado.

Hueco conocido: **`GET /admin/chips` no deja entrada de auditoría**, pese a ser la
consulta que revela UID completos. Ver [politica-logs.md](politica-logs.md).

---

## 6. `CLUB_ADMIN`

**Quién.** Persona designada por un club. Es externa a Marathon en términos de
confianza, aunque no figure en `EXTERNAL_ROLES`.

**Permisos (8).** `catalog:read`, `content:read`, `content:write`,
`campaigns:read`, `rewards:read`, `alerts:read`, `analytics:read`,
`production:read`.

**Ámbito habitual.** `CLUB`.

### 6.1 Pantallas visibles

| Pantalla | Qué obtiene |
|---|---|
| `/` | Resumen agregado |
| `/catalogo/clubes`, `/catalogo/modelos`, `/catalogo/jugadores` | Su club, sus modelos, sus jugadores |
| `/produccion/ordenes`, `/produccion/lotes`, `/produccion/unidades` | Avance de fabricación |
| `/riesgo/alertas` | Alertas |
| `/contenido` | Contenido dinámico |

No ve: `/usuarios`, `/auditoria`, `/produccion/dispositivos`, `/chips`,
`/soporte/casos`, `/privacidad/solicitudes`.

### 6.2 Qué no ve, y por qué

| No ve | Motivo |
|---|---|
| Datos de aficionados | No tiene `fans:read`. Publicar contenido no requiere saber quién lo lee |
| Titularidades | No tiene `ownership:read` |
| UID de chips | No tiene `chips:read` |
| Casos de soporte y solicitudes de privacidad | No tiene `support:read` ni `privacy:read` |
| Registro de auditoría | No tiene `audit:read` |
| Personal del sistema | No tiene `users:read` |
| Nada de otro club | El ámbito `CLUB` lo limita a su `scopeId` |

### 6.3 Qué puede hacer hoy

**Solo consultar.** Tiene `content:write` en la matriz y no existe ninguna ruta que
lo ejerza. Cuando exista, deberá aceptar el ámbito del club para que un club no
pueda editar el contenido de otro.

### 6.4 Nota sobre el ámbito y la analítica

`analytics:read` es el permiso de analítica **global**. Con la ruta actual, que no
recibe ámbito, un `CLUB_ADMIN` con asignación `CLUB` recibe 403 en
`/admin/analytics/overview` y su pantalla de inicio queda sin datos. El resultado
actual es restrictivo —que es el error correcto— pero no es el diseño previsto: el
club debería ver los agregados **de sus modelos**.

---

## 7. `PRODUCTION_OPERATOR`

**Quién.** Operario de la línea, trabajando desde un teléfono autorizado.

**Permisos (5).** `catalog:read`, `production:read`, `production:write`,
`production:quarantine`, `chips:write`.

**Superficie.** **No usa el panel web.** Usa la app Android y el prefijo
`/api/v1/production`. El procedimiento está en
[protocolo-programacion.md](protocolo-programacion.md).

### 7.1 Rutas de la app de planta

| Ruta | Método | Permiso | Para qué |
|---|---|---|---|
| `/production/auth/login` | POST | — | Sesión con correo, contraseña y `deviceId` |
| `/production/orders` | GET | `production:read` | Órdenes disponibles |
| `/production/orders/:id` | GET | `production:read` | Detalle de una orden |
| `/production/chips/inspect` | POST | `production:read` | Consultar si un chip ya está registrado |
| `/production/jobs/reserve` | POST | `production:write` | Reservar chip y recibir el plan de escritura |
| `/production/jobs/:jobId/written` | POST | `production:write` | Reportar el resultado de la escritura |
| `/production/jobs/:jobId/verified` | POST | `production:write` | Reportar la relectura de comprobación |
| `/production/units/link` | POST | `production:write` | Vincular chip, emblema y unidad |
| `/production/units/:unitId/post-press` | POST | `production:write` | Registrar la prueba posterior al termosellado |
| `/production/units/:unitId/activate` | POST | `production:activate` | **No accesible al operario** |
| `/production/units/:unitId/quarantine` | POST | `production:quarantine` | Apartar una unidad, con motivo obligatorio |
| `/production/me/history` | GET | `production:read` | Trabajos recientes del propio operario |

### 7.2 Qué no puede hacer, y por qué

| No puede | Motivo |
|---|---|
| **Activar comercialmente** | No tiene `production:activate`. Activar es una decisión comercial |
| **Revocar** | No tiene `production:revoke`. Revocar es una decisión de seguridad |
| **Ver el UID completo de chips ya programados** | Tiene `chips:write`, no `chips:read`. Puede grabar; no puede listar identificadores |
| Ver aficionados, titularidades, alertas, auditoría | No tiene esos permisos |
| Cerrar el trabajo de otro operario | La API devuelve 403 si `operatorId` no coincide |
| Trabajar desde un teléfono no autorizado | El `deviceId` debe existir y estar activo en `AuthorizedDevice` |

### 7.3 Particularidades de la sesión de planta

| Aspecto | Valor |
|---|---|
| Duración | **4 h**, frente a 12 h del panel |
| Motivo | Dispositivo compartido y expuesto; si se extravía, la ventana de abuso debe ser pequeña |
| Banner de simulación | El inicio de sesión devuelve `provider.simulated`; si es `true`, la app lo muestra de forma permanente |
| Idempotencia | **Toda** operación de escritura exige la cabecera `Idempotency-Key` |

---

## 8. `SUPPORT`

**Quién.** Atención al aficionado y gestión de derechos de privacidad. Es el único
rol, además de los administradores, que toca datos personales.

**Permisos (10).** `catalog:read`, `production:read`, `fans:read`,
`ownership:read`, `ownership:write`, `alerts:read`, `support:read`,
`support:write`, `privacy:read`, `privacy:write`.

### 8.1 Qué ve hoy

| Pantalla | Permiso | Estado |
|---|---|---|
| `/soporte/casos` | `support:read` | Implementada, **solo lectura** |
| `/privacidad/solicitudes` | `privacy:read` | Implementada, **solo lectura** |
| `/produccion/unidades` | `production:read` | Implementada. El UID aparece enmascarado, porque no tiene `chips:read` |
| `/riesgo/alertas` | `alerts:read` | Implementada. **Sin** el botón de revisión: no tiene `alerts:write` |
| `/catalogo/*` | `catalog:read` | Implementada |

### 8.2 Qué debería poder hacer y no puede

| Acción | Permiso que ya tiene | Ruta |
|---|---|---|
| Responder y cerrar un caso de soporte | `support:write` | **No existe** |
| Resolver una solicitud de derechos, cambiar su estado | `privacy:write` | **No existe** |
| Buscar una cuenta de aficionado | `fans:read` | **No existe** |
| Consultar la titularidad de una unidad | `ownership:read` | **No existe** |
| Corregir una titularidad | `ownership:write` | **No existe** |

**En el estado actual, `SUPPORT` no puede resolver nada.** Tiene los permisos y le
faltan las rutas y las pantallas. Es el hueco funcional más grande del panel.

### 8.3 Qué no puede hacer nunca

| No puede | Motivo |
|---|---|
| **Revocar una unidad** | No tiene `production:revoke`. Una revocación es irreversible y se escala a `MARATHON_ADMIN` |
| **Reprogramar un chip** | No tiene `chips:write` |
| **Ver el UID completo** | No tiene `chips:read` |
| Resolver alertas de riesgo | No tiene `alerts:write`. Puede verlas y escalarlas |
| Crear o modificar personal interno | No tiene `users:write` |
| Ver el registro de auditoría | No tiene `audit:read` |
| Ver analítica | No tiene `analytics:read` |

### 8.4 Guía de conducta del rol

Este rol ve datos personales, así que la disciplina es parte de su función:

1. **Acceder solo con un caso abierto que lo justifique.** Consultar una cuenta por
   curiosidad es un uso indebido, aunque el permiso lo permita.
2. **No revelar el estado exacto de un chip no activado.** Si alguien pregunta por
   una unidad en `NOT_ACTIVATED`, la respuesta es que contacte con el punto de
   venta, no el detalle del estado interno. Quien robó un lote de emblemas
   intentará averiguar a qué modelo pertenece cada uno.
3. **No entregar códigos de razón del motor de riesgo.** El aficionado recibe el
   texto de `TRUST_LEVEL_COPY`, nunca el código interno.
4. **Verificar la identidad antes de atender una solicitud de acceso.** Atenderla
   sin verificar convierte el derecho de acceso en un canal de fuga. Ver
   [privacidad-lopdp.md](privacidad-lopdp.md).
5. **Respetar el plazo interno de 15 días** (`PRIVACY_REQUEST_SLA_DAYS`), más
   estricto que el legal a propósito. `PrivacyRequest.dueAt` lo materializa y la
   pantalla lo muestra.
6. **Ante un `SUSPICIOUS`, no acusar.** `TRUST_LEVEL_COPY` ya dice que "esto no
   significa que su jersey sea falso". El guion de atención mantiene ese tono: se
   pide revisar, no se declara una falsificación.

### 8.5 Qué puede afirmar y qué no

| Puede afirmar | No puede afirmar |
|---|---|
| "El chip respondió a una comprobación de seguridad" cuando el resultado es `VERIFIED` | "Su jersey es auténtico" cuando el resultado es `IDENTIFIED_ONLY` |
| "Reconocemos este producto en nuestro registro" en `IDENTIFIED_ONLY` | Que una NTAG 213/215/216 sea inclonable |
| "Este registro fue dado de baja" en `REVOKED` | El motivo interno de la revocación sin autorización |
| "Detectamos un patrón inusual" en `SUSPICIOUS` | Qué señal concreta lo disparó |

Hoy **ninguna verificación alcanza `VERIFIED`**, porque no hay proveedor
criptográfico operativo. El guion de soporte debe partir de ese hecho: el veredicto
normal es `IDENTIFIED_ONLY` y significa identificación, no autenticación. Ver
[limitaciones.md](limitaciones.md).

---

## 9. `CONTENT_AGENCY`

**Quién.** Agencia externa que produce el contenido que ve el aficionado. Está en
`EXTERNAL_ROLES`.

**Permisos (4).** `catalog:read`, `content:read`, `content:write`,
`campaigns:read`.

**Ámbito habitual.** `CLUB` o `CAMPAIGN`.

### 9.1 Pantallas visibles

| Pantalla | Para qué |
|---|---|
| `/catalogo/clubes`, `/catalogo/modelos`, `/catalogo/jugadores` | Saber para qué modelo escribe |
| `/contenido` | Ver el contenido dinámico |

No ve nada más: ni inicio (no tiene `analytics:read`), ni producción, ni riesgo, ni
soporte, ni privacidad, ni usuarios, ni auditoría, ni chips.

### 9.2 Qué no ve, y por qué

| No ve | Motivo |
|---|---|
| Aficionados, titularidad, chips, privacidad | Prohibido por `PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES` |
| **Analítica** | No tiene `analytics:read` ni `analytics:campaign_scoped` |
| Producción | No tiene `production:read` |
| Alertas de riesgo | No tiene `alerts:read` |

La ausencia de analítica es deliberada y se cuestionará: una agencia querrá medir el
rendimiento de su contenido. La vía correcta es que Marathon o el club le entreguen
un informe, no que la agencia tenga un canal de observación directo sobre la base de
usuarios.

### 9.3 Qué puede hacer hoy

Nada de escritura: no existe ruta de `content:write`. Cuando exista, el contenido
debe respetar dos reglas del modelo de datos:

1. `ContentItem.mediaAlt` es **obligatorio** cuando hay imagen. Es accesibilidad, no
   metadato opcional.
2. `estimatedMediaBytes` debe rellenarse: permite omitir medios pesados cuando el
   cliente envía la cabecera `Save-Data`. En Ecuador, con planes de datos limitados,
   eso es funcionalidad, no refinamiento.

---

## 10. `SPONSOR`

**Quién.** Patrocinador externo de una campaña. Está en `EXTERNAL_ROLES`.

**Permisos (2).** `campaigns:read` y `analytics:campaign_scoped`.

**Ámbito.** `CAMPAIGN`, siempre. Un patrocinador global no tiene sentido.

### 10.1 Cómo llega a su única pantalla

El panel está preparado para este rol de una forma poco habitual y bien pensada:

1. `/admin/me` le devuelve 403 porque exige `catalog:read`, así que
   `SessionProvider` recurre a `uiPermissionsFromAssignments` para pintar el menú.
2. `AppShell` detecta `analytics:campaign_scoped`, extrae sus campañas con
   `scopedCampaignIds` y añade un grupo **Patrocinio** con un enlace por campaña.
3. La pantalla de inicio detecta que no tiene `analytics:read` pero sí
   `analytics:campaign_scoped`, y en lugar de un aviso de "sin permiso" le ofrece
   el enlace a su campaña. Si no tiene ninguna asignada, muestra "Sin campaña
   asignada. Contacte con su responsable".
4. El enlace lleva a `/patrocinador/campana/[id]`, que existe y está protegida con
   `GuardedPage permissions={['analytics:campaign_scoped']}`.

### 10.2 Qué muestra la pantalla de campaña

`GET /api/v1/admin/analytics/campaign/:campaignId` devuelve:

| Campo | Contenido |
|---|---|
| `campaignId` | El identificador consultado |
| `minCohortSize` | El valor de `MIN_AGGREGATE_COHORT_SIZE`, que es 20 |
| `note` | Explicación de que los valores por debajo del mínimo se muestran como `null` |
| `metrics[]` | `metricKey`, `date` y `value`, con `value` a `null` si la cohorte es pequeña |

Claves de métrica, con su etiqueta en la interfaz:

| `metricKey` | Etiqueta |
|---|---|
| `campaign_reward_redemptions` | Canjes de recompensas |
| `campaign_content_views` | Vistas de contenido patrocinado |
| `campaign_quiz_completions` | Trivias completadas |

La pantalla agrupa los puntos por métrica —una tabla por unidad de medida— y aplica
cuatro decisiones de presentación que conviene no deshacer:

1. **Un valor suprimido se marca como "Suprimido", no como cero ni como celda
   vacía.** El comentario del código lo justifica: una celda vacía se leería como
   "no pasó nada".
2. **El texto explica que "suprimido" no significa cero**, sino que hubo actividad
   demasiado escasa para publicarla sin arriesgar la reidentificación.
3. **El total por métrica suma solo lo publicable**, y el pie de la tabla dice
   cuántos días quedaron suprimidos y que no están incluidos. Sumar los suprimidos
   daría un número falso y además permitiría deducirlos por resta.
4. **La cohorte mínima se muestra en pantalla**, no solo se aplica por detrás.

El encabezado del archivo declara la regla que gobierna la pantalla:

> Esta pantalla NO muestra jamás datos personales de aficionados: ni correos, ni
> nombres, ni identificadores de persona, ni filas individuales. Solo conteos
> agregados de SU campaña. [...] Si alguien añade aquí una tabla de filas por
> persona, está rompiendo la regla.

La garantía técnica que lo sostiene: la pantalla hace **una sola llamada**, a
`/admin/analytics/campaign/:id`, y no importa ningún otro endpoint ni enlaza a otra
sección del panel.

Si la API devuelve 403, la pantalla lo explica en términos de ámbito: *"Su cuenta
solo puede consultar las métricas de la campaña sobre la que tiene alcance"*. Si la
campaña no tiene contadores, distingue entre "aún no hay actividad" y "toda la que
hay queda por debajo de la cohorte mínima", sin afirmar cuál de las dos es.

> **Dependencia pendiente.** El cálculo que materializa `CampaignMetric` **no está
> implementado**: no hay trabajo asíncrono que lo alimente. Hoy esta pantalla
> mostrará "Todavía no hay métricas publicables". La protección de privacidad
> funciona; el dato no existe. Ver [limitaciones.md](limitaciones.md).

### 10.3 Cómo se protege el ámbito

La ruta comprueba el permiso **dos veces**:

1. `requirePermission('analytics:campaign_scoped')` como barrera de entrada.
2. `hasAccess(..., { scopeType: 'CAMPAIGN', scopeId: campaignId })` con la campaña
   concreta de la URL.

Sin la segunda, un patrocinador con ámbito sobre una campaña podría leer otra
cambiando un identificador en la barra de direcciones. Un usuario con
`analytics:read` global también pasa, para que un administrador pueda ver la misma
vista.

### 10.4 Qué no ve nunca

| No ve | Barrera |
|---|---|
| Nombres, correos, identificadores de personas | El rol no tiene `fans:read`, y está prohibido para roles externos |
| Titularidades | Igual |
| Filas de `VerificationEvent` | La ruta lee `CampaignMetric`, no la tabla de eventos |
| Métricas de otra campaña | Doble comprobación de ámbito |
| Contadores por debajo de 20 sujetos | `suppressSmallCohort` devuelve `null` |
| Cortes dimensionales arbitrarios | La granularidad de `CampaignMetric` es fija: campaña, métrica, día |

### 10.5 Formulación para la conversación comercial

> El patrocinador recibe números, no personas. Si una necesidad de patrocinio no
> puede satisfacerse con un número agregado, la respuesta es no.

Ver [privacidad-lopdp.md](privacidad-lopdp.md) y
[matriz-roles-permisos.md](matriz-roles-permisos.md).

---

## 11. Pantallas y roles, resumen

| Pantalla | SUPERADMIN | MARATHON_ADMIN | CLUB_ADMIN | PRODUCTION_OPERATOR | SUPPORT | CONTENT_AGENCY | SPONSOR |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `/` (inicio agregado) | X | X | X | | | | |
| `/` (variante patrocinio) | | | | | | | X |
| `/usuarios` | X | X | | | | | |
| `/auditoria` | X | X | | | | | |
| `/catalogo/*` | X | X | X | | X | X | |
| `/produccion/ordenes` | X | X | X | | X | | |
| `/produccion/lotes` | X | X | X | | X | | |
| `/produccion/unidades` | X | X | X | | X | | |
| `/produccion/dispositivos` | X | X | | | | | |
| `/chips` | X | X | | | | | |
| `/riesgo/alertas` | X | X | X | | X | | |
| `/soporte/casos` | X | X | | | X | | |
| `/privacidad/solicitudes` | X | X | | | X | | |
| `/contenido` | X | X | X | | | X | |
| `/patrocinador/campana/:id` | X | | | | | | X |

El operario no aparece en ninguna fila: su superficie es la app de planta, no el
panel. Los roles con ámbito no `GLOBAL` verán el enlace y recibirán 403 en las
rutas que no pasen ámbito, por lo explicado en 1.3.

---

## 12. Huecos conocidos del panel

| Hueco | Efecto | Prioridad |
|---|---|---|
| **No existe el cálculo de `CampaignMetric`** | La pantalla del patrocinador está completa y no tiene nada que mostrar: ningún trabajo alimenta la tabla | Alta |
| No hay ruta de `content:write` | `CLUB_ADMIN` y `CONTENT_AGENCY` no pueden hacer aquello para lo que existen | Alta |
| No hay rutas de `support:write` ni `privacy:write` | `SUPPORT` no puede resolver casos ni solicitudes de derechos | Alta |
| No hay rutas de `fans:read`, `ownership:read` ni `ownership:write` | Soporte no puede consultar ni corregir titularidades | Alta |
| No hay ruta de `catalog:write` | El catálogo se carga por `seed.ts`; no se pueden crear SKU desde el panel | Media |
| No hay ruta de `roles:assign` | Las asignaciones de rol se hacen por base de datos | Media |
| No hay rutas de campañas ni recompensas | `campaigns:read`, `campaigns:write`, `rewards:read` y `rewards:write` no se pueden ejercer | Media |
| `requirePermission` sin ámbito en casi todas las rutas | Los roles con ámbito reciben 403; el panel solo es usable con asignación `GLOBAL` | Alta |
| `/me` y `/logout` exigen `catalog:read` | Un patrocinador no puede leer su perfil ni cerrar sesión por esa ruta | Media |
| `GET /admin/chips` no se audita | La consulta que revela UID completos no deja rastro | Media |
| No hay pantalla para marcar un lote | `ProductionBatch.flagged` se pone por base de datos | Baja |
| MFA no implementado | `mfaEnabled` es informativo | Alta para `SUPERADMIN` |

Todos están recogidos en [limitaciones.md](limitaciones.md).

---

## 13. Reglas transversales de la interfaz

1. **Ocultar por permiso, autorizar en el servidor.** La lista de permisos decide
   qué se muestra; el 403 del servidor es la autorización real. Las páginas
   muestran el error de la API en lugar de suponer que no puede ocurrir.
2. **La referencia pública se muestra enmascarada** (`MEV-A1B2••••`) salvo donde el
   rol justifique el valor completo.
3. **El UID nunca se muestra sin `chips:read`.** En `/produccion/unidades` se
   enmascara y la exportación registra si se incluyó.
4. **Los códigos de razón del motor de riesgo se muestran al personal interno y
   jamás salen hacia el aficionado.**
5. **Marcar lo simulado.** Toda vista que muestre un `PersonalizationJob`,
   `VerificationEvent` o `PostPressCheck` con `simulated: true` debe marcarlo de
   forma inequívoca. Un registro simulado no debe poder confundirse con uno real,
   nunca.
6. **Las acciones irreversibles piden confirmación explícita.** Aplica a revocar una
   unidad, destruir un chip y marcar un lote.
7. **Cerrar sesión llama a `/admin/logout`.** Borrar el token en el cliente deja la
   sesión viva en el servidor.
8. **Toda exportación se audita y anuncia su truncado.** Ya se cumple en
   `/produccion/unidades`; debe cumplirse en cualquier exportación futura.
9. **Si `mfaEnabled` es `true`, no presentarlo como protección activa.**
10. **Accesibilidad.** El panel ya incluye enlace de salto al contenido,
    `aria-current` en la navegación activa y regiones vivas para anunciar
    resultados. El color no es el único portador de significado, y así debe
    seguir: `StateTag` y los avisos llevan texto.

---

## 14. Documentos relacionados

- [matriz-roles-permisos.md](matriz-roles-permisos.md)
- [protocolo-programacion.md](protocolo-programacion.md)
- [privacidad-lopdp.md](privacidad-lopdp.md)
- [politica-logs.md](politica-logs.md)
- [modelo-datos.md](modelo-datos.md)
- [arquitectura.md](arquitectura.md)
- [limitaciones.md](limitaciones.md)

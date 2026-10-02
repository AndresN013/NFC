# Política de registros

Cubre tres almacenes distintos, que no deben confundirse:

| Almacén | Dónde vive | Quién escribe | Retención |
|---|---|---|---|
| Registro de aplicación (log) | Salida estándar del proceso, recogida por el orquestador | Pino, configurado en `apps/api/src/app.ts` | La del recolector de logs, no la de la base de datos |
| Registro de auditoría | Tabla `AuditEvent` en PostgreSQL | `recordAudit` de `apps/api/src/lib/audit.ts` | 1825 días (`audit_event`) |
| Eventos de verificación | Tabla `VerificationEvent` | `apps/api/src/services/verification.ts` | 180 días para el detalle técnico |

El primero es efímero y sirve para diagnosticar. El segundo es prueba de quién
hizo qué y es **solo-anexar**. El tercero es la materia prima del motor de riesgo.
Las reglas de contenido son distintas para cada uno y se detallan más abajo.

---

## 1. Principios

1. **Un registro es una superficie de ataque.** Lo que entra en un log sale del
   perímetro de la base de datos: se copia a un agregador, se indexa, se ve en
   una pantalla compartida y sobrevive a los borrados de la aplicación. Por eso
   la regla no es "no registrar secretos si se puede", es **no registrar nada
   cuya fuga importe**.
2. **La redacción se hace en el emisor, no en el recolector.** Un filtro en el
   agregador llega tarde: el dato ya viajó. `sanitizeMetadata` y los
   serializadores de Pino actúan antes de que el texto exista.
3. **Nunca la IP completa.** Se trunca y después se seudonimiza. Las dos
   operaciones, en ese orden.
4. **El registro de auditoría no es un almacén de datos.** Guarda referencias e
   identificadores, no cuerpos de peticiones ni volcados de entidades.
5. **Lo que no se puede redactar con certeza, no se registra.** Ante la duda, se
   omite el campo.

---

## 2. Registro de aplicación

### 2.1 Configuración

En `apps/api/src/app.ts`:

| Aspecto | Valor |
|---|---|
| Nivel en producción | `info` |
| Nivel en desarrollo | `debug` |
| En pruebas | Logger **desactivado** por completo (`logger: false`) |
| Registro automático de peticiones | No se desactiva por separado: con `logger: false` no hay nada que registrar, y `disableRequestLogging` está marcada como obsoleta en Fastify 5 |

### 2.2 Serializadores

Solo se serializan tres campos de una petición y uno de una respuesta. Todo lo
demás que Pino registraría por defecto queda fuera.

```ts
serializers: {
  req: (request) => ({
    method: request.method,
    // Se recorta la ruta: /v/<token> no debe acabar en el registro.
    url: request.url.split('?')[0]?.replace(/\/(v|q)\/[^/]+/, '/$1/[redactado]'),
  }),
  res: (reply) => ({ statusCode: reply.statusCode }),
}
```

Qué hace cada pieza, y por qué:

| Operación | Efecto | Motivo |
|---|---|---|
| `request.url.split('?')[0]` | Descarta la cadena de consulta completa | Una cadena de consulta puede llevar un token de sesión, un token de transferencia o un identificador copiado a mano. No se filtra por parámetro: se elimina toda |
| `.replace(/\/(v|q)\/[^/]+/, '/$1/[redactado]')` | `/v/AbC...xyz` pasa a `/v/[redactado]`, e igual para `/q/...` | El `tagToken` y el `qrToken` viajan **en la ruta**, no en la consulta. Sin este recorte, cada lectura de un jersey dejaría el identificador del chip en texto claro en el log |
| Ausencia de `headers` | Nunca se registran cabeceras | `Authorization` lleva el token de sesión; `Cookie` lleva lo mismo; `Idempotency-Key` es interna pero no aporta nada en el log de acceso |
| Ausencia de `body` | Nunca se registra el cuerpo | Contiene contraseñas en el inicio de sesión, tokens en la verificación y correos en el registro |
| Solo `statusCode` en la respuesta | No se registra el cuerpo de la respuesta | La respuesta pública contiene la referencia enmascarada y la ficha del producto; el veredicto ya queda en `VerificationEvent` |

### 2.3 Lo que sigue siendo visible en el log de aplicación

Con honestidad: el recorte de la URL deja `POST /api/v1/verify 200`. El token no
aparece, pero el **hecho** de que hubo una verificación sí, junto con la marca de
tiempo. Si el recolector de logs registra además la IP de origen a nivel de proxy
(fuera del control de esta aplicación), la correlación temporal entre el log del
proxy y el log de la API puede reconstruir "esta IP verificó algo a esta hora".

Mitigación: el proxy debe configurarse para truncar la IP en su propio registro
de acceso, o el registro de acceso del proxy debe tener retención corta. Es una
tarea de infraestructura y **no está resuelta en el repositorio**.

---

## 3. Registro de auditoría (`AuditEvent`)

### 3.1 Qué se anota

`recordAudit` recibe:

| Campo | Contenido | Nota |
|---|---|---|
| `actorId` | Id del `User` o `null` | En acciones de aficionado es `null` y el `fanId` va en `metadata` |
| `actorType` | `USER`, `SYSTEM`, `FAN`, `ANONYMOUS` | Distingue una acción de personal de una de aficionado |
| `action` | Cadena con punto, p. ej. `admin.login`, `ownership.claimed` | Vocabulario estable |
| `entityType` / `entityId` | Entidad afectada | Identificadores internos, no referencias públicas |
| `metadata` | JSON **saneado** | Ver 3.2 |
| `ipPrefix` | IP **truncada** | Ver 4 |

La tabla es solo-anexar: la aplicación nunca hace `update` ni `delete` sobre
`AuditEvent`. Un registro de auditoría que la aplicación puede modificar no
prueba nada.

### 3.2 El saneador `sanitizeMetadata`

Es defensa en profundidad: aunque alguien pase por error un token a `recordAudit`,
no llega a la base de datos.

**Patrón de claves sensibles**, literal del código:

```ts
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|apikey|api_key|authorization|cookie|pepper|salt|privatekey|private_key|masterkey|master_key|cmac|sdmmac|keyvalue)/i;
```

**Excepciones**, claves que son referencias opacas y por tanto sí pueden
registrarse:

```ts
const ALLOWED_REFERENCE_KEYS = /^(tokenHash|keyReference|idempotencyKey|referenceId)$/;
```

| Aspecto del saneador | Comportamiento |
|---|---|
| Coincidencia | Por **nombre de clave**, no por valor, y sin distinguir mayúsculas |
| Coincidencia parcial | Sí: `sessionToken`, `refresh_token` y `userPassword` quedan cubiertos por la subcadena |
| Sustitución | El valor se reemplaza por la cadena `[redactado]` |
| Excepciones | `tokenHash`, `keyReference`, `idempotencyKey`, `referenceId` pasan tal cual, porque son punteros sin valor reutilizable |
| Recursión | Recorre objetos y arreglos; se detiene en profundidad 6 y devuelve `[profundidad maxima]` |
| Truncado | Toda cadena de más de 512 caracteres se corta y se marca `...[truncado]` |
| Nulos | `null` y `undefined` se normalizan a `null` |

Ejemplo de entrada y salida:

```
entrada  { jobId: 'a1b2', tagToken: 'Xk9...', tokenHash: 'e3b0c442...', apiKey: 'live_...' }
salida   { jobId: 'a1b2', tagToken: '[redactado]', tokenHash: 'e3b0c442...', apiKey: '[redactado]' }
```

### 3.3 Límites conocidos del saneador

Se documentan porque el saneador no es infalible y conviene no confiar en él como
única barrera:

1. **Filtra por nombre de clave.** Un secreto guardado bajo una clave neutra
   (`valor`, `payload`, `dato`) pasa intacto. La primera barrera sigue siendo no
   pasar secretos a `recordAudit`.
2. **La regla de excepción es de coincidencia exacta.** `tokenHash` pasa, pero
   `chipTokenHash` contiene `token` y **se redacta**. Es el error seguro (redactar
   de más), pero produce metadatos menos útiles de lo esperado; hay que nombrar
   los campos con la clave exacta permitida.
3. **`salt` y `pepper` están en el patrón**, lo que también redacta campos
   inocentes como `saltRotatedAt`. Se acepta: es preferible perder una fecha a
   filtrar una sal.
4. **El truncado a 512 caracteres no es un control de privacidad**, es un control
   de tamaño. Un correo electrónico cabe de sobra en 512 caracteres.

### 3.4 Qué acciones se auditan hoy

Las rutas implementadas auditan, entre otras: inicio de sesión de panel
(`admin.login`), inicio de sesión de dispositivo de planta, reserva de chip,
resultado de escritura, relectura de comprobación, vinculación de unidad, prueba
posterior al termosellado, activación, cuarentena, revocación, reclamo de
titularidad (`ownership.claimed`), transferencias, altas y bajas de usuario,
cambios de dispositivo autorizado y resolución de alertas.

Criterio: **se audita todo cambio de estado y toda acción con efecto sobre una
persona o sobre una unidad física.** Las lecturas de panel no se auditan una a una
(sería ruido), con una excepción que debería añadirse y hoy no está: la consulta
de `GET /admin/chips`, que requiere `chips:read` y revela UID completos, merece
una entrada de auditoría propia. Ver [limitaciones.md](limitaciones.md).

---

## 4. Tratamiento de la dirección IP

Dos pasos, siempre en este orden, en `apps/api/src/lib/request-context.ts`.

### 4.1 Paso 1: truncado

`truncateIp` de `packages/domain/src/analytics.ts`:

| Familia | Operación | Ejemplo |
|---|---|---|
| IPv4 | Se descarta el último octeto | `192.168.1.77` → `192.168.1.0` |
| IPv6 | Se conservan los primeros 48 bits (3 hextetos) | `2001:db8:1234:5678::1` → `2001:db8:1234::` |
| Entrada malformada | Se devuelve `0.0.0.0` | — |

El resultado **sigue siendo un dato personal indirecto**. El truncado reduce la
precisión, no elimina la condición.

### 4.2 Paso 2: seudonimización con sal rotativa

```ts
function pseudonymize(value: string, salt: string, domain: string): string {
  return createHash('sha256').update(`${salt}:${domain}:${value}`).digest('hex').slice(0, 32);
}
```

| Aspecto | Valor |
|---|---|
| Algoritmo | SHA-256, truncado a 32 caracteres hexadecimales (128 bits) |
| Sal | `ANALYTICS_IP_SALT` |
| Rotación declarada | Cada 30 días (`.env.example`) |
| Separación de dominio | El literal `ip` o `device` entra en la entrada del hash, de modo que el seudónimo de IP y el de dispositivo no son comparables entre sí |

**Efecto de la rotación:** al cambiar la sal, todos los seudónimos anteriores
dejan de corresponder a los nuevos. El correlacionado de largo plazo de una misma
IP se rompe cada 30 días por diseño: el propósito es detectar abuso en una
ventana corta, no construir un historial. Consecuencia operativa: las consultas
del motor de riesgo que cuentan "IP distintas" solo son coherentes dentro de un
periodo de sal.

### 4.3 Dónde acaba cada forma

| Forma | Dónde se guarda | Por qué |
|---|---|---|
| IP completa | **En ningún sitio de la aplicación** | — |
| `ipPrefix` (truncada, sin hash) | `AuditEvent.ipPrefix`, `UserSession.lastIpPrefix` | Una investigación de seguridad sobre una sesión de personal necesita una pista de red legible. Es una tabla interna con acceso restringido por `audit:read` |
| `ipPseudonym` | `VerificationEvent.ipPseudonym` | Contar redes distintas sin poder volver a la red |
| `deviceFingerprint` | `VerificationEvent.deviceFingerprint` | Contar dispositivos distintos |

### 4.4 La huella de dispositivo no es fingerprinting

Se compone de `ipPrefix | user-agent | primer idioma aceptado`, y después se
seudonimiza. **No** se usa canvas, ni enumeración de fuentes, ni sensores, ni
identificadores publicitarios. Es deliberadamente de baja entropía: sirve para
responder "¿cuántos dispositivos distintos leyeron esta unidad en una hora?" y no
para reconocer a una persona entre sitios.

Consecuencia asumida: dos teléfonos iguales en la misma red y con el mismo idioma
producen la misma huella. El motor de riesgo lo compensa no tratando ninguna
señal blanda como concluyente por sí sola.

### 4.5 `trustProxy`

`trustProxy: config.isProduction`. En producción se confía en la cabecera del
proxy para obtener la IP del cliente. **Solo es correcto detrás de un proxy
propio**: si la API queda expuesta directamente, cualquiera falsifica su IP
mediante `X-Forwarded-For` y con ello evade la limitación de peticiones y
contamina los seudónimos. Es un requisito de despliegue, no una opción.

---

## 5. Retención por tipo de dato

Derivada de `RETENTION_DAYS` en `packages/domain/src/privacy.ts`.

| Clave | Días | Qué cubre | Por qué ese plazo |
|---|---|---|---|
| `verification_event_detail` | 180 | `ipPseudonym`, `deviceFingerprint`, `countryCode`, `messageFingerprint`, códigos de razón | Media temporada deportiva. Suficiente para investigar un patrón de clonación estacional; insuficiente para construir un historial de comportamiento |
| `aggregated_metrics` | `null` (indefinido) | Contadores de `AnalyticsDaily` y `CampaignMetric` | No tienen sujeto. Sin persona identificable no hay plazo que cumplir |
| `risk_alert_closed` | 365 | Alertas cerradas | Un año permite comparar la campaña actual con la anterior y justificar una revocación pasada |
| `audit_event` | 1825 (5 años) | Registro de auditoría administrativa | Exigencia de trazabilidad: hay que poder demostrar quién activó o revocó una unidad durante la vida comercial del producto |
| `support_case_closed` | 730 (2 años) | Casos de soporte cerrados | Cubre el periodo de garantía y la reapertura de un caso |
| `consent_record` | 1825 (5 años) | `Consent` | Hay que poder **demostrar** que el consentimiento existió y qué texto se aceptó (`policyVersion`). Borrarlo al revocarlo destruiría la prueba de licitud del tratamiento pasado |

Notas importantes:

- `VERIFICATION_EVENT_RETENTION_DAYS` en `.env.example` replica el valor de 180
  para que la purga sea configurable por despliegue. Si los dos valores se
  desincronizan, el que manda es el del entorno, porque es el que ejecuta el job.
- **Los jobs de purga no están planificados todavía.** Existen
  `purgeExpiredSessions` y `purgeExpiredIdempotencyRecords`, pero nada las invoca
  periódicamente y no hay purga del detalle de `VerificationEvent`. La retención
  está declarada y **no aplicada**. Ver [limitaciones.md](limitaciones.md).
- La retención del **log de aplicación** no la fija este repositorio: la fija el
  recolector. Recomendación: 30 días como máximo, porque su valor es diagnóstico
  y no probatorio.

### 5.1 Qué significa "purgar el detalle"

Purgar un `VerificationEvent` a los 180 días no borra la fila completa
necesariamente: el diseño previsto es anular los campos de detalle técnico
(`ipPseudonym`, `deviceFingerprint`, `messageFingerprint`) y conservar el hecho
agregado (fecha, nivel de confianza, unidad). Así se mantiene el
`interactionCount` y la historia del certificado sin conservar el rastro técnico.
La implementación de este job está pendiente.

---

## 6. Niveles de registro y qué va en cada uno

| Nivel | Uso | Ejemplos | Prohibido |
|---|---|---|---|
| `error` | Fallo que impide completar una operación y no es culpa del cliente | Pérdida de conexión con PostgreSQL, excepción no controlada, fallo del custodio de claves | El cuerpo de la petición que lo provocó |
| `warn` | Situación anómala que la aplicación resolvió | Límite de peticiones alcanzado, clave de idempotencia reutilizada con otro cuerpo, transición de estado rechazada | El identificador presentado |
| `info` | Hecho operativo relevante | Arranque y apagado, proveedor NFC en uso, conexión establecida | Cualquier dato de persona |
| `debug` | Solo desarrollo | Traza de resolución de rutas, detalle de esquemas | Cualquier cosa que no se quiera ver en producción; `debug` no se activa en producción |

Regla adicional: **un error de cliente (4xx) no es un `error`.** Un 403 es el
sistema funcionando. El detalle interno del 403 (`usuario <id> carece de
<permiso>`) se conserva en el error y no se envía al cliente; su destino es el
log, no la respuesta.

---

## 7. Lista negra: cosas que nunca deben aparecer en un log

Ninguno de estos valores debe existir en el registro de aplicación, en
`AuditEvent.metadata`, en un mensaje de error devuelto al cliente ni en una traza
de excepción.

### 7.1 Secretos y material criptográfico

- `SESSION_SECRET`, `TOKEN_HASH_PEPPER`, `ANALYTICS_IP_SALT` y cualquier otro
  secreto de entorno.
- Claves maestras NFC, claves diversificadas por chip, claves de aplicación
  NTAG 424 DNA, en cualquier forma: hexadecimal, base64, arreglo de bytes.
- Valores de CMAC o SDMMAC. Están en `SENSITIVE_KEY_PATTERN` por este motivo.
- Contenido de una respuesta del custodio de claves.
- Claves privadas de firma de certificados.
- Contraseñas en claro, hashes Argon2id completos, y el resultado intermedio de
  una verificación de contraseña.

### 7.2 Identificadores que permiten suplantar o localizar una unidad

- `tagToken` en claro, en la ruta, en el cuerpo o en un mensaje de error.
- `qrToken` en claro.
- `transferToken` en claro. Registrar una invitación de transferencia equivale a
  regalar la prenda a quien lea el log.
- Tokens de sesión de personal, de dispositivo de planta o de aficionado.
- La cadena de consulta completa de cualquier petición.
- El UID completo de un chip. En el log **nunca**; en `AuditEvent` solo cuando la
  acción sea sobre ese chip y la entrada quede bajo `chips:read`.
- La URI NDEF completa grabada en un chip, porque contiene el `tagToken`.
- El payload escrito en hexadecimal (`writtenPayloadHex`), por el mismo motivo.
  Lo que se conserva es `writtenPayloadHash`.

### 7.3 Datos personales

- Dirección IP completa, en cualquier campo y bajo cualquier nombre.
- Correo electrónico. Ni en el log de acceso, ni en un mensaje de error de
  autenticación, ni como clave de un mapa de métricas.
- Nombre y apellidos de una persona titular.
- Coordenadas geográficas precisas. El sistema registra código de país; ciudad y
  coordenadas solo existen con consentimiento `LOCATION` y no van al log.
- Número de teléfono, documento de identidad, dirección postal.
- El contenido de un caso de soporte, que puede incluir cualquier cosa que la
  persona haya escrito.
- El texto de una solicitud de derechos (`PrivacyRequest`).

### 7.4 Información que ayuda a un falsificador

- Códigos de razón internos del motor de riesgo cuando el destinatario es el
  aficionado. En el log interno sí; en la respuesta pública nunca. Entregarlos
  sería dar un canal de diagnóstico sobre qué control falló.
- Umbrales y pesos exactos del motor de riesgo en un mensaje de error.
- La razón concreta por la que un inicio de sesión falló ("el correo no existe"
  frente a "la contraseña es incorrecta"). `lib/passwords.ts` incluye defensa
  contra enumeración por tiempo; un log o un mensaje distinguible la anularía.
- El estado exacto de un chip no activado en la respuesta pública. Quien roba un
  lote de emblemas no debe poder averiguar a qué modelo pertenece cada uno.

### 7.5 Ruido que degrada el registro

- Entidades de base de datos serializadas completas. Si hace falta contexto, se
  registran campos concretos.
- Cuerpos de peticiones, siempre.
- Cabeceras HTTP completas.
- Volcados de configuración al arrancar. Se puede registrar `NFC_PROVIDER` y si
  la ejecución es simulada; no el resto del entorno.

---

## 8. Marcado de simulación

Regla transversal: **toda evidencia producida por el proveedor simulado se marca
como simulada y la marca se conserva.**

| Lugar | Campo |
|---|---|
| Respuesta de `/health` | `simulated: true` cuando `NFC_PROVIDER=mock` |
| `PersonalizationJob` | `simulated` |
| `VerificationEvent` | `simulated` |
| `PostPressCheck` | `simulated` |

El motor de riesgo nunca eleva una evidencia `simulated` a `VERIFIED`. La marca no
se borra al pasar a producción: un registro simulado histórico debe seguir siendo
distinguible de uno real para siempre.

---

## 9. Documentos relacionados

- [arquitectura.md](arquitectura.md)
- [modelo-datos.md](modelo-datos.md)
- [privacidad-lopdp.md](privacidad-lopdp.md)
- [matriz-roles-permisos.md](matriz-roles-permisos.md)
- [plan-gestion-claves.md](plan-gestion-claves.md)
- [modelo-amenazas.md](modelo-amenazas.md)
- [limitaciones.md](limitaciones.md)

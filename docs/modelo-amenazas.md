# Modelo de amenazas

Este es el documento más importante del proyecto. Describe qué puede salir mal,
qué se ha hecho al respecto, y **qué sigue sin resolverse**.

---

## 0. Advertencia previa, sin rodeos

El piloto usa etiquetas **NTAG 213/215/216**. Estas etiquetas:

- No ejecutan ninguna operación criptográfica sobre un reto del servidor.
- Tienen un contenido NDEF legible y reescribible por cualquier teléfono con NFC
  hasta que se bloquea la memoria, y ese contenido puede copiarse a otra etiqueta.
- Tienen un UID de solo lectura de fábrica, pero **existen en el mercado
  etiquetas con UID escribible y emuladores que lo replican**.

Por lo tanto:

> **Con NTAG 21x, el riesgo residual de clonación es ALTO.**
>
> El sistema identifica el producto. No lo autentica. Ninguna combinación de
> reglas de riesgo, rate limiting o análisis geográfico convierte una etiqueta
> copiable en una etiqueta anticlonación. Esa propiedad depende del silicio, no
> del software.

Esto está codificado, no solo documentado:
`supportsCryptographicAuthentication()` en `packages/domain/src/trust.ts`
devuelve `true` únicamente para `NTAG424DNA`, y
`TRUST_CEILING_BY_METHOD` limita cualquier lectura NDEF estática a
`IDENTIFIED_ONLY`.

### Estado de los controles criptográficos hoy

| Control | Estado |
|---|---|
| Verificación de mensaje autenticado (SUN/CMAC) | **No existe.** El adaptador NTAG 424 DNA lanza `NOT_IMPLEMENTED` en todos sus métodos relevantes |
| Verificación de firma de originalidad de NXP (READ_SIG) | **No existe.** Falta la clave pública de originalidad, que debe obtenerse del fabricante |
| Custodia real de claves | **No existe.** `KMS_PROVIDER=null-kms` solo registra referencias |
| Bloqueo irreversible de memoria NTAG 21x | **No implementado a propósito.** Un error de offset inutiliza el chip de forma permanente |

---

## Amenaza 1 — Copia de la URL

**Descripción.** El registro NDEF contiene una URL estática
`https://<fan-web>/v/<tagToken>`. Cualquiera que lea el chip con un teléfono
obtiene esa URL completa y puede pegarla en un navegador, compartirla, imprimirla
en un QR o escribirla en otra etiqueta.

**Vector.** Lectura NDEF con cualquier teléfono. No requiere herramientas
especiales, conocimientos ni acceso privilegiado. Es el ataque de coste cero.

**Controles implementados.**

| Control | Dónde |
|---|---|
| Techo de confianza: `NFC_STATIC_URL` nunca supera `IDENTIFIED_ONLY` | `domain/trust.ts`, `TRUST_CEILING_BY_METHOD` + `applyMethodCeiling()` |
| Hallazgo explícito `METHOD_NOT_CRYPTOGRAPHIC` en cada evaluación | `domain/risk/engine.ts` |
| Mensaje al aficionado que no afirma autenticidad: *"Reconocemos este producto en nuestro registro, pero la lectura no incluyó una comprobación de seguridad. Sirve para consultar información, no para confirmar autenticidad."* | `domain/trust.ts`, `TRUST_LEVEL_COPY.IDENTIFIED_ONLY` |
| El token tiene 256 bits de entropía: no es adivinable | `domain/identifiers.ts`, `generateTagToken()` |
| Se almacena solo como hash con pimienta: una filtración de la base no entrega tokens usables | `identifiers.ts` `hashToken()`, `schema.prisma` `tagTokenHash` |
| El token se recorta del registro de servidor | `apps/api/src/app.ts`, serializador que reemplaza `/v/<token>` por `/v/[redactado]` |
| Detección de uso anómalo: frecuencia, dispositivos, redes | `risk/engine.ts`, sección 4 |

**Riesgo residual: ALTO (inherente).** La copia de la URL es trivial y no se
puede impedir. Lo único que se controla es que el sistema **no mienta** sobre lo
que significa.

**Qué haría falta.** NTAG 424 DNA con SUN: cada lectura produce un mensaje
distinto, autenticado con CMAC y con contador. Copiar la URL de una lectura no
sirve para la siguiente. Ver [guia-ntag424-dna.md](guia-ntag424-dna.md).

---

## Amenaza 2 — Clonación de la etiqueta

**Descripción.** Un atacante lee una etiqueta legítima y fabrica una copia
funcional: misma URL en el NDEF y, con etiquetas de UID escribible, mismo UID.
Esa copia se monta en un emblema falso.

**Vector.**
1. Lectura NDEF de una unidad legítima (en tienda, en la calle, en una foto de
   redes sociales que muestre el QR).
2. Escritura del mismo contenido en una etiqueta en blanco, o en una etiqueta con
   UID configurable.
3. Producción en volumen: una lectura sirve para N copias.

**Controles implementados.**

| Control | Dónde |
|---|---|
| El sistema nunca declara `VERIFIED` una lectura NTAG 21x | `trust.ts` + `risk/engine.ts` |
| `CHIP_TYPE_NOT_CRYPTO_CAPABLE` se registra como hallazgo en cada verificación | `risk/engine.ts` |
| `MANY_DISTINCT_DEVICES` (25 pts) si >8 dispositivos en 24 h | `risk/engine.ts`, `DEFAULT_RISK_CONFIG` |
| `MANY_DISTINCT_IPS` (15 pts) si >15 redes en 24 h | ídem |
| `HIGH_READ_FREQUENCY` (25 pts) si >25 lecturas/hora | ídem |
| `IMPOSSIBLE_TRAVEL` (30 pts) entre lecturas | `domain/geo.ts` `detectImpossibleTravel()` |
| `MULTIPLE_ACTIVE_OWNERS` (40 pts) | `risk/engine.ts` + índice parcial `Ownership_active_unique` |
| El UID nunca se muestra al aficionado: conocerlo facilita fabricar una etiqueta con UID configurable | `identifiers.ts` `maskChipUid()`; `chips:read` es permiso sensible |
| Degradación a `SUSPICIOUS` al alcanzar 60 puntos, con bloqueo de recompensas | `risk/engine.ts` `RISK_THRESHOLDS` |

**Limitación deliberada de la detección.** Los pesos están calibrados para que
**ninguna señal blanda aislada** alcance el umbral. Hacen falta al menos dos, o
una señal dura. La razón: una camiseta que se lleva a un estadio produce muchas
lecturas desde muchos dispositivos y muchas redes en pocas horas, y eso es uso
legítimo. Un motor que marque sospechoso a un aficionado real en un partido es
peor que inútil.

Consecuencia honesta: **un clon usado con moderación no dispara nada.** La
detección solo funciona contra clonación masiva o descuidada.

**Riesgo residual: ALTO.** Con todas las letras: con NTAG 213/215/216 no existe
un control técnico que impida clonar. Lo implementado detecta *patrones de abuso*,
no clones. Un falsificador que fabrique 50 copias y las venda en 50 ciudades
distintas a 50 personas que las lean con moderación no será detectado por este
sistema.

**Qué haría falta.**
1. **NTAG 424 DNA con SUN y claves diversificadas por chip.** Es el único cambio
   que ataca la causa. Cada chip lleva una clave distinta derivada de la maestra
   custodiada; extraer la clave de un chip no compromete a los demás.
2. Verificación de la firma de originalidad de NXP como señal adicional (probaría
   que el silicio es NXP; **no** que el chip sea el que Marathon programó).
3. Contador monótono verificado en servidor, ya previsto en el motor
   (`COUNTER_NOT_INCREASING`, 80 pts) pero hoy sin fuente de datos real.

---

## Amenaza 3 — Repetición (replay)

**Descripción.** Un atacante captura una respuesta válida del chip y la
retransmite después para hacerse pasar por el chip legítimo.

**Vector.** Interceptación del mensaje autenticado (en tránsito, en el
dispositivo, o simplemente leyendo el chip una vez) y reenvío posterior a la API.

**Controles implementados.**

| Control | Dónde |
|---|---|
| `MESSAGE_ALREADY_SEEN` (80 pts) si la huella del mensaje ya se registró | `risk/engine.ts` + `services/verification.ts` `buildHistory()` |
| Se guarda solo la **huella** del mensaje, no el mensaje: una filtración de la base no entrega mensajes reutilizables | `lib/request-context.ts` `fingerprintMessage()`, columna `messageFingerprint` |
| Índice sobre `messageFingerprint` para que la comprobación sea barata | `schema.prisma` |
| `COUNTER_NOT_INCREASING` (80 pts) si el contador no supera al último aceptado | `risk/engine.ts` |
| `COUNTER_LARGE_GAP` (25 pts) si el salto supera 200 lecturas | ídem |
| **El contador solo avanza si la lectura fue `VERIFIED`**: aceptar el contador de una lectura sospechosa permitiría empujarlo hacia adelante y bloquear al chip legítimo | `services/verification.ts` |
| La comprobación anti-repetición solo se aplica sobre una firma válida: no tiene sentido antes | `risk/engine.ts`, dentro de la rama `signatureValid` |

**Riesgo residual: BAJO en el diseño, NO APLICABLE hoy.** Los controles están
escritos y probados, pero **no hay nada que repetir**: con NTAG 21x no existe
mensaje autenticado ni contador, así que `authenticatedMessage` y `readCounter`
son siempre `null` (`providers/ntag21x.ts`). El control está listo y sin uso.

**Qué haría falta.** Que exista un mensaje autenticado real. Es decir, la
integración de NTAG 424 DNA. Adicionalmente, cuando exista: ventana temporal
máxima entre la lectura y la presentación del mensaje, hoy no implementada.

---

## Amenaza 4 — Enumeración de identificadores

**Descripción.** Un atacante recorre el espacio de identificadores para
descubrir unidades válidas, construir un catálogo, o medir el volumen de
producción de Marathon.

**Vector.** Peticiones automatizadas contra `/v/<token>`, `/q/<token>` o
búsquedas por `publicRef`.

**Controles implementados.**

| Control | Dónde |
|---|---|
| `tagToken`: 256 bits. `qrToken`: 128 bits. No enumerables por fuerza bruta | `identifiers.ts` |
| `publicRef`: 8 símbolos Crockford = 2^40 combinaciones, **aleatorias**, no secuenciales | `identifiers.ts` `generateUnitPublicRef()` |
| Generación sin sesgo de módulo: se descartan los bytes fuera del mayor múltiplo del alfabeto, para que la distribución sea uniforme | `identifiers.ts` `randomString()` |
| Limitación de peticiones: 20/minuto por IP en verificación | `.env.example` `RATE_LIMIT_VERIFY_PER_MINUTE`, registrada en `app.ts` |
| **Se registra un `VerificationEvent` incluso con token desconocido**: quien enumera deja rastro | `services/verification.ts` |
| Mensajes de error genéricos: no se distingue "no existe" de "revocado" | `lib/errors.ts`, comentario de cabecera |
| La ficha del producto **no** se revela en `REVOKED` ni `NOT_ACTIVATED`: quien roba un lote de emblemas no puede averiguar a qué modelo pertenece cada uno | `services/verification.ts`, `LEVELS_WITH_PRODUCT_DETAIL` |
| `publicRef` se muestra enmascarado: una captura de pantalla compartida en redes no entrega el identificador completo | `identifiers.ts` `maskPublicRef()` |
| `TOKEN_UNKNOWN` pesa solo 10 puntos: la causa más común es un error de tecleo, no un ataque. La protección real es el rate limiting | `risk/engine.ts`, comentario explícito |

**Riesgo residual: MEDIO.**

Tres razones concretas:

1. **El almacén de rate limiting es en memoria del proceso.** Con varias
   instancias de API, el límite efectivo se multiplica por el número de
   instancias.
2. **La clave del límite es la IP.** Un atacante con una botnet o un pool de
   proxies residenciales obtiene 20 peticiones/minuto **por IP**.
3. No hay detección de enumeración a nivel de campaña: un pico de miles de
   `TOKEN_UNKNOWN` desde muchas IP no dispara ninguna alerta agregada hoy.

**Qué haría falta.**
- Almacén de rate limiting compartido (Redis o equivalente).
- Regla agregada sobre la tasa global de `TOKEN_UNKNOWN`, con alerta.
- Prueba de trabajo o desafío progresivo tras N fallos desde la misma IP o rango.
- Limitación por rango `/24` además de por IP individual.

---

## Amenaza 5 — Extracción física del emblema

**Descripción.** Alguien despega el emblema de un jersey legítimo, con el chip
intacto, para reutilizarlo.

**Vector.** Aplicación de calor o disolvente sobre el termosellado. El objetivo
puede ser el robo de emblemas en tienda, la recuperación desde prendas devueltas
o dañadas, o desde stock de saldo.

**Controles implementados.**

| Control | Dónde |
|---|---|
| Ciclo de vida con estados `REVOKED` y `DESTROYED`, y la obligación de registrar la destrucción física | `domain/states.ts` |
| `CHIP_REVOKED` (100 pts) corta la evaluación y bloquea recompensas | `risk/engine.ts` |
| Trazabilidad por lote: `ProductionBatch.flagged` permite marcar un lote completo | `schema.prisma` |
| Cuarentena alcanzable desde cualquier estado | `domain/states.ts` `CHIP_TRANSITIONS` |
| Protocolo de control por lote y de unidades desechadas | [protocolo-programacion.md](protocolo-programacion.md) |

**Riesgo residual: ALTO, y es un riesgo de proceso, no de software.**

El sistema no tiene forma de saber que un emblema se despegó. Los controles son
organizativos: inventario de mermas, destrucción registrada, conciliación de
lotes. Si un emblema sale de planta sin registrarse como destruido, el sistema lo
sigue considerando válido.

**Qué haría falta.**
- **Diseño destructivo del emblema:** que el intento de despegado rompa la antena
  o la conexión del chip de forma irreversible. Esto es una decisión de
  materiales y construcción, **que debe validarse con el fabricante del emblema y
  con ensayos físicos reales**. El protocolo de ensayos está en
  [pruebas-fisicas.md](pruebas-fisicas.md) y **no se ha ejecutado**.
- Conciliación obligatoria de inventario por lote al cierre de cada orden.
- Cámara y doble firma en la estación de destrucción de mermas.

---

## Amenaza 6 — Trasplante del emblema a un jersey falso

**Descripción.** Un emblema auténtico, con su chip auténtico, se cose o se sella
sobre una prenda falsificada. La lectura NFC responde correctamente porque el chip
**es** auténtico. Lo falso es el resto de la prenda.

**Vector.** Combinación de la amenaza 5 con una prenda falsificada de calidad.
Es el ataque más rentable contra este sistema: aprovecha exactamente el punto
ciego de una verificación basada en el emblema.

**Controles implementados.**

| Control | Dónde |
|---|---|
| Ninguno técnico que lo impida | — |
| `UnitCondition` (`NEW`, `GIFTED`, `USED`, `TRANSFERRED`, `COLLECTION`) permite al titular declarar la condición, lo que da contexto | `domain/states.ts` |
| Historial de titularidad y de transferencias, consultable por soporte | `Ownership`, `OwnershipTransfer` |
| `MULTIPLE_ACTIVE_OWNERS` (40 pts) detecta la situación en la que el emblema original y el trasplantado tienen titulares distintos y activos | `risk/engine.ts` |
| Casos de soporte con motivo `AUTHENTICITY_DOUBT` | `SupportCase.reason` |

**Riesgo residual: ALTO.**

**Este es el límite conceptual del sistema y debe comunicarse como tal.** Una
verificación NFC en el emblema autentica *el emblema*. No autentica el tejido, la
costura, el etiquetado ni la prenda. Ningún chip, por seguro que sea, resuelve
esto.

Nótese además que este riesgo **no mejora** al pasar a NTAG 424 DNA: el chip
trasplantado seguiría produciendo un mensaje autenticado perfectamente válido. Es
la única amenaza grave que el cambio de hardware no reduce.

**Qué haría falta.**
- Más de un punto de verificación por prenda: emblema, etiqueta interior, y
  posiblemente hilo o etiqueta de cuidado, cada uno con su propio identificador,
  y verificación cruzada de que los tres pertenecen a la misma unidad.
- Vínculo al canal de venta: importación de propiedad desde la compra, de modo
  que una unidad vendida en un canal oficial tenga un historial que una unidad
  trasplantada no puede reproducir (ver [integracion-tienda.md](integracion-tienda.md)).
- Comunicación honesta al aficionado: el certificado debe decir qué se verificó.

---

## Amenaza 7 — Robo de cuenta de aficionado

**Descripción.** Un atacante toma control de una `FanAccount` para apropiarse de
la titularidad de jerseys, canjear recompensas o iniciar transferencias.

**Vector.** Contraseña reutilizada, credenciales filtradas de otro servicio,
phishing, robo del token de sesión, o secuestro de la invitación de transferencia
enviada por correo.

**Controles implementados.**

| Control | Dónde |
|---|---|
| Contraseñas con Argon2id, 19 MiB / 2 iteraciones (por encima del mínimo OWASP) | `lib/passwords.ts` |
| Longitud mínima 12, priorizando longitud sobre complejidad tipográfica (NIST SP 800-63B) | `lib/passwords.ts` `validatePasswordStrength()` |
| Defensa contra enumeración por tiempo: `burnTime()` ejecuta una verificación señuelo cuando el correo no existe | `lib/passwords.ts` |
| Token de sesión de 32 bytes, almacenado solo hasheado | `auth/sessions.ts` |
| Un único mensaje para todos los fallos de sesión: inexistente, caducada, revocada y usuario desactivado son indistinguibles desde fuera | `auth/sessions.ts` `resolveUserSession()` |
| Límite de 5 intentos de login por minuto | `.env.example` `RATE_LIMIT_LOGIN_PER_MINUTE` |
| Token de transferencia de un solo uso con caducidad | `OwnershipTransfer.tokenHash`, `expiresAt` |
| Una sola transferencia pendiente por unidad | Índice parcial `OwnershipTransfer_pending_unique` |
| El aficionado no necesita cuenta para verificar: menos cuentas, menos superficie | `domain/privacy.ts` `FEATURES_WITHOUT_CONSENT` |

**Riesgo residual: MEDIO.**

- **No hay MFA para aficionados.** `mfaEnabled`/`mfaSecretRef` existen solo en
  `User`, y están marcados como fase 2 y sin implementar.
- La sesión de aficionado dura **30 días**, elección deliberada por el bajo riesgo
  asociado, pero amplía la ventana de un token robado.
- No hay notificación al titular cuando se inicia una transferencia desde su
  cuenta, ni historial de sesiones visible para él.
- No hay bloqueo progresivo de cuenta tras intentos fallidos repetidos, solo
  límite por IP.

**Qué haría falta.** MFA opcional; notificación por correo en cada transferencia
iniciada y aceptada; periodo de gracia revocable tras aceptar una transferencia;
pantalla de sesiones activas con revocación; bloqueo progresivo por cuenta además
de por IP.

---

## Amenaza 8 — Dispositivo de producción comprometido

**Descripción.** Un teléfono Android de planta es manipulado (rooteado, con una
aplicación modificada, o simplemente robado con sesión activa) y se usa para
programar chips fuera del proceso, o para extraer datos.

**Vector.** Acceso físico al teléfono; instalación de una versión modificada de
la app; extracción del token de sesión del almacenamiento del dispositivo.

**Controles implementados.**

| Control | Dónde |
|---|---|
| Lista de dispositivos autorizados con `deviceId` único | `AuthorizedDevice` |
| La sesión ligada a dispositivo **se invalida si el dispositivo deja de estar activo**, comprobado en cada resolución de sesión | `auth/sessions.ts` `resolveUserSession()` |
| Sesión de dispositivo de solo **4 horas**, frente a 12 del panel | `auth/sessions.ts` `DEVICE_SESSION_HOURS` |
| El operario solo tiene 5 permisos: `catalog:read`, `production:read`, `production:write`, `production:quarantine`, `chips:write` | `domain/rbac.ts` |
| **El operario no tiene `chips:read`**: no puede listar UID completos | ídem |
| **El operario no tiene `production:activate` ni `production:revoke`**: no puede activar comercialmente ni dar de baja | ídem |
| Idempotencia por clave: un reintento no duplica la operación | `lib/idempotency.ts` |
| Cada `PersonalizationJob` registra operario, dispositivo y estación | `schema.prisma` |
| El teléfono **nunca ve una clave** en el diseño NTAG 424 DNA: recibe APDU ya cifrados y los retransmite | `providers/ntag424.ts`, `SecureElementPersonalizationService` |

**Riesgo residual: MEDIO-ALTO.**

- **`AuthorizedDevice.attestationRef` está preparado para Play Integrity API pero
  no se verifica.** Hoy la autorización de un dispositivo es una fila en la base
  de datos: quien obtenga un `deviceId` válido y credenciales de operario puede
  presentarse como dispositivo autorizado desde cualquier cliente.
- La app Android **no existe** (`apps/nfc-android` está vacío), así que no hay
  ningún control de almacenamiento seguro de token implementado ni evaluado.
- No hay límite de operaciones por dispositivo y hora.

**Qué haría falta.** Verificación real de Play Integrity contra el servidor;
almacenamiento del token en el Android Keystore; límite de programaciones por
dispositivo y turno con alerta al superarlo; revocación remota inmediata del
dispositivo desde el panel; fijación de certificado (certificate pinning).

---

## Amenaza 9 — Operador malicioso

**Descripción.** Una persona con acceso legítimo abusa de él: programa chips
para emblemas no autorizados, activa unidades que no pasaron control, exfiltra
UID o datos personales, o revoca unidades ajenas.

**Vector.** Uso del acceso concedido, por interés propio o por coacción.

**Controles implementados.**

| Control | Dónde |
|---|---|
| RBAC con ámbito: un permiso se concede sobre GLOBAL, ORGANIZATION, CLUB o CAMPAIGN | `domain/rbac.ts` `hasAccess()` |
| Separación de funciones en la matriz: el operario programa pero no activa; soporte ve propiedad pero **no puede revocar ni reprogramar**; el club ve su contenido pero no toca producción ni UID | `domain/rbac.ts` `ROLE_PERMISSIONS` |
| `PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES`: lista de permisos que jamás pueden concederse a un rol externo, comprobada en las pruebas como red de seguridad frente a un cambio accidental de la matriz | `domain/rbac.ts` |
| `chips:read` (mostrar el UID completo) marcado explícitamente como permiso sensible | `domain/rbac.ts`, comentario |
| Registro de auditoría solo-anexar, con retención de 1825 días | `AuditEvent`, `RETENTION_DAYS.audit_event` |
| Cada trabajo de personalización queda atribuido a operario, dispositivo y estación | `PersonalizationJob` |
| El detalle del fallo de autorización va al registro; el cliente solo ve 403 | `auth/plugin.ts` |

**Riesgo residual: MEDIO.**

- **`AuditEvent` está en la misma base de datos que todo lo demás.** Quien tenga
  acceso a PostgreSQL puede borrar filas de auditoría, aunque la aplicación no lo
  permita. No hay envío a un almacén de solo-anexar externo ni encadenamiento
  criptográfico de los registros.
- No hay aprobación de doble persona para operaciones críticas (activación en
  masa, revocación en masa, asignación del rol `SUPERADMIN`).
- `SUPERADMIN` tiene **todos** los permisos, sin ámbito y sin excepción.
- No hay revisión periódica de accesos concedidos.
- No hay MFA implementado para el personal interno.

**Qué haría falta.** Reenvío de auditoría a un almacén externo append-only;
encadenamiento hash de los eventos de auditoría; MFA obligatorio para
`SUPERADMIN` y `MARATHON_ADMIN`; doble aprobación para revocación y activación en
masa; alerta automática ante la asignación de un rol privilegiado; revisión
trimestral de accesos.

---

## Amenaza 10 — Chip falsificado

**Descripción.** El proveedor entrega, por error o por fraude en su cadena de
suministro, chips que no son NXP auténticos, o de una familia distinta de la
declarada.

**Vector.** Sustitución en la cadena de suministro del proveedor de etiquetas;
mezcla de lotes; etiquetas de clon de bajo coste vendidas como NTAG originales.

**Controles implementados.**

| Control | Dónde |
|---|---|
| Estado `VALIDATED`: "se inspeccionó y el tipo declarado coincide con el detectado". La transición `RECEIVED → VALIDATED` es obligatoria antes de reservar | `domain/states.ts` |
| Comprobación de capacidad antes de escribir: una URI que no cabe se rechaza en lugar de truncarse | `ndef.ts` `checkUriFits()`, `ntag21x.ts` `preparePersonalization()` |
| `TAG_TYPE_UNSUPPORTED` si el tipo detectado no corresponde a la orden | `ntag21x.ts` `detectTag()` |
| Trazabilidad de lote: `supplierName`, `supplierLotRef`, `flagged`, `flagReason` | `ProductionBatch` |
| `BATCH_ANOMALY_FLAGGED` (20 pts) en cada verificación de una unidad de lote marcado | `risk/engine.ts` |
| Contrato `OriginalityResult` con campos `verified` / `notSupported` / `simulated` separados, para que "no se pudo comprobar" nunca se confunda con "es auténtico" | `provider.ts` |

**Riesgo residual: ALTO.**

**La verificación de originalidad no está implementada.** NXP documenta el
comando READ_SIG, que devuelve una firma ECC generada en fábrica sobre el UID,
pero verificarla exige la **clave pública de originalidad de NXP, que este
repositorio no incluye y que debe obtenerse del fabricante**. Sin esa clave, la
comprobación no puede realizarse, y `validateOriginality()` devuelve
`notSupported: true` en lugar de fingir un resultado (`providers/ntag21x.ts`).

Y aun cuando se implementara: la firma probaría que el **silicio** es de NXP. No
probaría que ese chip concreto sea el que Marathon programó, ni que siga en su
emblema original. Es señal de riesgo, no autenticación. Esto está escrito
literalmente en el contrato (`provider.ts`, `OriginalityResult`).

**Qué haría falta.**
1. Obtener la clave pública de originalidad de NXP y configurarla (nunca
   versionarla en el repositorio; el campo `nxpOriginalityPublicKey` ya existe en
   `Ntag21xProviderOptions`).
2. Implementar READ_SIG y la verificación ECDSA, **validada contra chips reales
   de cada familia** antes de habilitarse.
3. Muestreo de recepción con verificación de originalidad por lote.
4. Cláusulas contractuales de trazabilidad con el proveedor de etiquetas.

---

## Amenaza 11 — Abuso de transferencias de propiedad

**Descripción.** El mecanismo de transferencia se usa para apropiarse de una
unidad ajena, para "lavar" una unidad robada, o para generar múltiples titulares
aparentemente legítimos.

**Vector.** Generar varias invitaciones simultáneas; interceptar el correo de
invitación; aceptar una transferencia de una unidad robada; reclamar una unidad
sin titular que pertenece a otra persona.

**Controles implementados.**

| Control | Dónde |
|---|---|
| **Una sola titularidad activa por unidad**, garantizado por índice único parcial en base de datos, no por lógica de aplicación | `migration.sql` `Ownership_active_unique` |
| **Una sola transferencia pendiente por unidad**, ídem | `migration.sql` `OwnershipTransfer_pending_unique` |
| Token de invitación de 192 bits, de un solo uso, almacenado solo hasheado | `identifiers.ts` `generateTransferToken()`, `OwnershipTransfer.tokenHash` |
| Caducidad obligatoria (`expiresAt` no anulable) | `schema.prisma` |
| `MULTIPLE_ACTIVE_OWNERS` (40 pts) y revisión humana si la restricción fallara | `risk/engine.ts` |
| `acquiredVia` distingue `CLAIM`, `TRANSFER`, `PURCHASE_IMPORT`: el historial muestra cómo se obtuvo cada titularidad | `Ownership` |
| El reclamo solo se ofrece si `activeOwnerCount === 0` | `risk/engine.ts` acción `OFFER_CLAIM` |
| Una unidad revocada o en cuarentena no ofrece reclamo ni recompensas | `risk/engine.ts`, cortes tempranos |

**Riesgo residual: MEDIO.**

La restricción estructural es sólida. Los huecos son de proceso:

- **Cualquiera con acceso físico a un jersey sin titular puede reclamarlo.** Es
  el comportamiento deseado para el primer comprador, y también el vector de un
  ladrón que lea la prenda antes que el dueño.
- No hay periodo de gracia ni reversión tras aceptar una transferencia.
- No hay notificación al titular anterior cuando una transferencia se completa.
- No hay verificación del correo de destino antes de emitir la invitación.
- La única defensa contra el "lavado" de una unidad robada es que alguien abra un
  caso de soporte y un humano revoque.

**Qué haría falta.** Notificación a ambas partes en cada cambio de estado de la
transferencia; periodo de gracia de N días con reversión unilateral por el
titular anterior; marcado explícito de "reportado como robado" que bloquee
reclamo y transferencia; verificación del correo de destino; vínculo con la
compra (`PURCHASE_IMPORT`) que dé prioridad al comprador registrado.

---

## Amenaza 12 — Manipulación del QR

**Descripción.** El código QR de respaldo se sustituye por una pegatina con otro
QR, o se fotografía y se reutiliza. El objetivo puede ser redirigir al aficionado
a un sitio controlado por el atacante, o hacer pasar una prenda falsa.

**Vector.** Pegatina física sobre el QR original; fotografía del QR compartida en
redes sociales; impresión del QR en una prenda falsa.

**Controles implementados.**

| Control | Dónde |
|---|---|
| **El token del QR es un espacio de identificadores distinto del token NFC**: fotografiar el QR no revela el secreto del chip | `identifiers.ts`, comentario de cabecera; columnas `qrTokenHash` y `tagTokenHash` separadas |
| Techo de confianza: `QR_CODE` nunca supera `IDENTIFIED_ONLY`, garantizado por `applyMethodCeiling()` | `domain/trust.ts` |
| `QR_FALLBACK_USED` se registra como hallazgo: "Identificación por código visible. No otorga autenticación." | `risk/engine.ts` |
| Tras una lectura por QR se sugiere reintentar por NFC (`SUGGEST_RETRY_NFC`) | `risk/engine.ts` |
| Rotación y caducidad del QR: `qrRotatedAt`, `qrExpiresAt`. **Un QR caducado se trata como token desconocido**, para que la rotación surta efecto de verdad | `schema.prisma`, `services/verification.ts` `findUnitByQrToken()` |
| Token del QR deliberadamente más corto (128 bits) que el del chip, porque su nivel de confianza también es menor | `identifiers.ts` `generateQrToken()` |

**Riesgo residual: MEDIO.**

- Una pegatina sobre el QR original que apunte a un dominio del atacante no la
  detecta el sistema: el aficionado nunca llega a la API de Marathon. La defensa
  es la comunicación al usuario sobre el dominio legítimo, no un control técnico.
- Un QR fotografiado sigue siendo válido hasta que caduca o se rota, y **no hay
  job de rotación automática planificado**.

**Qué haría falta.** Rotación periódica automática del token del QR; rotación
forzada al detectar uso anómalo; comunicación clara del dominio oficial al
aficionado; QR impreso bajo una capa que se destruya al despegar.

---

## Amenaza 13 — Fuga de claves

**Descripción.** Material criptográfico (claves maestras NFC, pimienta de hash de
tokens, secreto de sesión, sal de analítica) acaba en manos de un atacante.

**Vector.** Commit accidental en el repositorio; variable de entorno expuesta en
un registro; volcado de la base de datos; acceso al sistema de ficheros del
servidor; clave escrita en la app móvil.

**Controles implementados.**

| Control | Dónde |
|---|---|
| **Regla inviolable declarada en tres sitios**: ninguna implementación de proveedor recibe, almacena ni devuelve claves maestras | `provider.ts`, `schema.prisma` (cabecera), `.env.example` |
| `NfcKeyReference` guarda **solo** `{ reference, custodian, version }`. Aquí no hay ninguna clave | `schema.prisma` |
| `KeyReference` es un tipo opaco; la operación criptográfica se ejecuta en el servicio que custodia la clave | `provider.ts` |
| El teléfono es un túnel: recibe APDU ya construidos y cifrados por el custodio | `providers/ntag424.ts`, `SecureElementPersonalizationService` |
| Barrera de arranque: si `SESSION_SECRET`, `TOKEN_HASH_PEPPER` o `ANALYTICS_IP_SALT` conservan el prefijo `dev-only-insecure` en producción, **el proceso no arranca** | `apps/api/src/config.ts` |
| Barrera de arranque: `NFC_PROVIDER=mock` en producción hace fallar el arranque | ídem |
| Saneador de auditoría: patrón que redacta `password`, `secret`, `token`, `apikey`, `authorization`, `cookie`, `pepper`, `salt`, `privatekey`, `masterkey`, `cmac`, `sdmmac`, `keyvalue` | `lib/audit.ts` `SENSITIVE_KEY_PATTERN` |
| Lista blanca de claves que sí pueden registrarse por ser referencias opacas: `tokenHash`, `keyReference`, `idempotencyKey`, `referenceId` | `lib/audit.ts` `ALLOWED_REFERENCE_KEYS` |
| Los tokens se guardan hasheados con pimienta: un volcado de la base no entrega tokens usables sin la pimienta | `identifiers.ts` `hashToken()` |
| `mfaSecretRef` previsto para ir **cifrado con clave de KMS**, no en claro | `schema.prisma`, comentario |
| La clave pública de originalidad de NXP nunca se versiona en el repositorio | `providers/ntag21x.ts`, comentario |

**Riesgo residual: MEDIO hoy, con matiz importante.**

- **No hay claves maestras NFC que filtrar, porque no hay ninguna.**
  `KMS_PROVIDER=null-kms` no custodia nada. Este riesgo es hoy teórico en su parte
  más grave.
- **La pimienta (`TOKEN_HASH_PEPPER`) sí es un secreto real y vive en una variable
  de entorno.** Si se filtra junto con un volcado de la base de datos, todos los
  `tagTokenHash` se vuelven atacables por diccionario... salvo que los tokens
  tienen 256 bits, así que ni con la pimienta son recuperables. El riesgo real de
  una fuga de pimienta es distinto: permite **verificar** si un token concreto
  conocido está en la base, no obtenerlo.
- **No hay rotación de la pimienta implementada.** Rotarla invalidaría todos los
  hashes existentes, lo que exige reprogramar los chips. Esta consecuencia debe
  tenerse presente antes del piloto.
- El `.env` real está en el directorio del proyecto y solo lo protege
  `.gitignore`.

**Qué haría falta.** Gestor de secretos real (AWS Secrets Manager, GCP Secret
Manager, Vault) en lugar de archivo `.env`; procedimiento de rotación de la
pimienta con doble hash durante la transición; escaneo de secretos en CI
(gitleaks o equivalente); custodia real en KMS para el piloto y HSM/SAM para
producción, con la ceremonia descrita en
[plan-gestion-claves.md](plan-gestion-claves.md).

---

## Amenaza 14 — Ataques contra la API

### 14.1 Inyección (SQL y similares)

**Vector.** Entrada no saneada que llega a una consulta.

**Controles.** Prisma con consultas parametrizadas en todo el código leído; Zod
para validar la configuración y previsto para las entradas de ruta; validación de
esquema de Fastify con traducción a 400 en `plugins/errors.ts`; validación de
formato hexadecimal **antes** de decodificar en `safeEqualHex()`
(`domain/identifiers.ts`), que además corrige un fallo sutil:
`Buffer.from('zz','hex')` devuelve un buffer vacío en vez de fallar, y dos
buffers vacíos son iguales para `timingSafeEqual`; sin esa validación, cualquier
par de cadenas no hexadecimales de igual longitud se compararía como idéntico.

**Riesgo residual: BAJO.** Advertencia: no hay ninguna ruta implementada
todavía, así que esta evaluación se basa en las utilidades y no en el código de
rutas, que aún no existe. Cualquier uso futuro de `$queryRaw` debe revisarse
específicamente.

### 14.2 XSS

**Vector.** Contenido controlado por un atacante que se ejecuta en el navegador
del aficionado.

**Controles.** Política de seguridad de contenido restrictiva en
`apps/api/src/app.ts` vía `@fastify/helmet`: `defaultSrc 'self'`,
`scriptSrc 'self'` (sin `unsafe-inline` ni `unsafe-eval`), `objectSrc 'none'`,
`frameAncestors 'none'`, `baseUri 'self'`, `formAction 'self'`. La respuesta
pública se construye con lista blanca explícita de campos y nunca serializa una
entidad de base de datos (`services/verification.ts`).

**Riesgo residual: MEDIO.**

- `styleSrc` incluye `'unsafe-inline'`, necesario para muchos marcos de CSS pero
  que amplía la superficie.
- **`fan-web` y `admin-web` no existen**, así que el escapado en el cliente no se
  ha evaluado. La CSP de la API no protege al frontend, que se sirve por separado
  y debe declarar la suya.
- `ContentItem.body` es JSON editable por `CONTENT_AGENCY` y `CLUB_ADMIN`. Si el
  frontend lo renderiza como HTML, es un vector de XSS almacenado con actores
  externos. **Debe renderizarse como texto o sanearse con una lista blanca.**

### 14.3 CSRF

**Vector.** Un sitio de terceros induce al navegador del usuario a ejecutar una
acción autenticada.

**Controles.** La autenticación se hace con `Authorization: Bearer`, extraída
explícitamente en `auth/plugin.ts` (`extractBearer`), no con cookies enviadas
automáticamente por el navegador. Eso elimina el vector clásico. CORS con **lista
blanca explícita de orígenes** (`FAN_WEB_PUBLIC_URL`, `ADMIN_WEB_PUBLIC_URL`) y
sin reflexión del `Origin`. Métodos y cabeceras permitidas acotados.

**Riesgo residual: BAJO.**

Advertencia: `@fastify/cookie` figura en las dependencias de `apps/api`. Si en
algún momento se introducen cookies de sesión, **este análisis deja de ser
válido** y hará falta `SameSite=Strict` más token anti-CSRF.

### 14.4 SSRF

**Vector.** Conseguir que el servidor haga una petición a un destino elegido por
el atacante.

**Controles.** No se ha encontrado ninguna llamada saliente HTTP en el código
leído. El campo `ContentItem.ctaHref` y `mediaUrl` son URL que **el navegador**
resolverá, no el servidor.

**Riesgo residual: BAJO hoy, ALTO en cuanto se añadan webhooks.**

Los webhooks previstos para la integración con la tienda
([integracion-tienda.md](integracion-tienda.md)) son exactamente el vector.
Cuando se implementen: lista blanca de dominios de destino, resolución DNS
validada contra rangos privados (169.254.0.0/16, 10/8, 172.16/12, 192.168/16,
127/8, ::1, fc00::/7), prohibición de redirecciones, y tiempo de espera estricto.

### 14.5 Denegación de servicio

**Vector.** Saturar la API con peticiones, o con peticiones individualmente caras.

**Controles.**

| Control | Dónde |
|---|---|
| Límite de tamaño de cuerpo: 256 KiB | `app.ts` `bodyLimit` |
| Límite de peticiones por IP, con cabecera `retry-after` | `app.ts` + `@fastify/rate-limit` |
| Traducción de 429 a un error con código estable | `plugins/errors.ts` |
| **Los tokens públicos se hashean con SHA-256, no con Argon2**, precisamente porque un KDF lento en la ruta de verificación pública sería un vector de denegación de servicio | `domain/identifiers.ts`, comentario explícito |
| `suppressSmallCohort` y las métricas de patrocinador son **contadores precalculados**, no consultas sobre la tabla de eventos | `domain/analytics.ts` |
| Índice `(jerseyUnitId, createdAt DESC)` para que la consulta del motor de riesgo sea barata | `migration.sql` |
| Deduplicación de alertas: repetir una lectura sospechosa no inunda la bandeja de soporte | `services/verification.ts` `openRiskAlert()` |
| Profundidad máxima y truncado a 512 caracteres en el saneador de auditoría | `lib/audit.ts` |

**Riesgo residual: MEDIO-ALTO.**

- **Almacén de rate limiting en memoria**: no funciona entre instancias.
- `buildHistory()` ejecuta **cuatro consultas** por verificación, una de ellas un
  `findMany` de todos los eventos de las últimas 24 h de la unidad, materializado
  en memoria para contar distintos. Con una unidad muy leída (un jersey expuesto
  en una tienda), ese `findMany` crece sin techo. **No hay `take` ni límite.**
  Debería sustituirse por agregaciones en SQL (`COUNT(DISTINCT ...)`).
- No hay protección contra ataques volumétricos a nivel de red: se delega en el
  proveedor o CDN, que no está decidido.
- `trustProxy` solo se activa en producción; si se activa sin un proxy propio
  delante, **cualquiera falsifica su IP** y evade el rate limiting. El comentario
  del código lo advierte.

**Qué haría falta.** Redis para el rate limiting; reescritura de `buildHistory`
con agregaciones SQL y límite superior; CDN con protección volumétrica; límites
por ruta además de globales; tiempos de espera de consulta en Prisma.

---

## Tabla resumen de riesgo residual

| # | Amenaza | Riesgo residual | Factor determinante |
|---|---|---|---|
| 2 | Clonación de la etiqueta | **ALTO** | NTAG 21x no puede autenticar. Propiedad del silicio |
| 1 | Copia de la URL | **ALTO** | Inherente a una URL estática |
| 6 | Trasplante del emblema a un jersey falso | **ALTO** | Límite conceptual: se verifica el emblema, no la prenda. **No mejora con NTAG 424** |
| 5 | Extracción física del emblema | **ALTO** | Riesgo de proceso. Sin ensayos físicos ejecutados |
| 10 | Chip falsificado | **ALTO** | Verificación de originalidad no implementada; falta la clave pública de NXP |
| 8 | Dispositivo de producción comprometido | **MEDIO-ALTO** | Atestación no verificada; la app Android no existe |
| 14.5 | DoS contra la API | **MEDIO-ALTO** | Rate limiting en memoria; `buildHistory` sin límite |
| 4 | Enumeración de identificadores | **MEDIO** | Rate limiting en memoria y por IP |
| 7 | Robo de cuenta de aficionado | **MEDIO** | Sin MFA, sesión de 30 días, sin notificaciones |
| 9 | Operador malicioso | **MEDIO** | Auditoría en la misma base; sin MFA ni doble aprobación |
| 11 | Abuso de transferencias | **MEDIO** | Estructura sólida; faltan notificación y reversión |
| 12 | Manipulación del QR | **MEDIO** | Sin rotación automática |
| 13 | Fuga de claves | **MEDIO** | `.env` en disco; sin rotación de pimienta. Sin claves maestras que filtrar hoy |
| 14.2 | XSS | **MEDIO** | Frontend no existe; `ContentItem` es JSON de actores externos |
| 3 | Repetición (replay) | **BAJO (no aplicable hoy)** | Controles listos; no hay mensaje autenticado que repetir |
| 14.1 | Inyección | **BAJO** | Prisma parametrizado; sin rutas implementadas todavía |
| 14.3 | CSRF | **BAJO** | Bearer, no cookies. Se invalida si se introducen cookies |
| 14.4 | SSRF | **BAJO** | Sin llamadas salientes. **ALTO en cuanto haya webhooks** |

### Lectura de la tabla

Cinco amenazas en **ALTO**. Cuatro de las cinco tienen la misma raíz o una raíz
puramente física:

- **2, 1, 10** se reducen sustancialmente con **NTAG 424 DNA** más la verificación
  de originalidad. Es la palanca de mayor impacto del proyecto.
- **5 y 6** no se resuelven con software. Requieren diseño destructivo del
  emblema, ensayos físicos reales (ver [pruebas-fisicas.md](pruebas-fisicas.md),
  **no ejecutadas**) y múltiples puntos de verificación por prenda.

Y una conclusión que conviene dejar escrita:

> **El trasplante del emblema a un jersey falso (amenaza 6) es la única amenaza
> de riesgo ALTO que no mejora al cambiar de chip.** Un NTAG 424 DNA trasplantado
> produce un mensaje autenticado perfectamente válido. Cualquier comunicación
> pública sobre el sistema debe ser precisa: se verifica el emblema.

---

## Documentos relacionados

- [plan-gestion-claves.md](plan-gestion-claves.md)
- [guia-ntag424-dna.md](guia-ntag424-dna.md)
- [pruebas-fisicas.md](pruebas-fisicas.md)
- [politica-logs.md](politica-logs.md)
- [limitaciones.md](limitaciones.md)
- [piloto-a-produccion.md](piloto-a-produccion.md)

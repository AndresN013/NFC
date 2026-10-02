# Limitaciones

Inventario honesto de lo que este repositorio **no** hace, no ha probado o no puede
sostener todavía. Está escrito para leerse antes de tomar una decisión, no después.

Regla del documento: si algo está a medias, se dice a medias. Si algo está simulado,
se dice simulado. Si algo no se ha probado, se dice que no se ha probado.

---

## 0. Las cinco frases que hay que leer primero

1. **Ninguna verificación alcanza `VERIFIED` hoy.** El techo real del sistema es
   `IDENTIFIED_ONLY`, que significa *identificado*, no *autenticado*.
2. **El proveedor NFC por defecto es un simulador.** No habla con hardware.
3. **La app Android nunca se ha compilado.** No hay Android SDK ni Gradle en este
   entorno.
4. **Ninguna prueba física se ha ejecutado.** Cero emblemas reales, cero ciclos de
   lavado, cero lecturas con teléfono físico.
5. **La retención de datos está declarada y no aplicada.** No hay ningún trabajo de
   purga planificado.

---

## 1. Lo que está simulado

### 1.1 El proveedor NFC simulado

`packages/nfc-contracts/src/providers/mock.ts`:

| Capacidad | Valor |
|---|---|
| `isSimulation` | `true` |
| `canProduceCryptographicProof` | `false` |
| Transporte de APDU crudos | Lanza `NOT_IMPLEMENTED`: *"El transporte simulado no ejecuta APDUs crudos"* |

`.env.example` trae `NFC_PROVIDER=mock`. Es el valor de desarrollo.

Dos barreras impiden que esto llegue a producción por descuido, ambas en
`apps/api/src/config.ts`:

1. Si `NFC_PROVIDER=mock` y el entorno es producción, **el proceso no arranca**.
2. Si `SESSION_SECRET`, `TOKEN_HASH_PEPPER` o `ANALYTICS_IP_SALT` conservan el
   prefijo `dev-only-insecure`, el arranque también falla.

Además, la marca de simulación se propaga y se conserva:

| Lugar | Campo |
|---|---|
| `GET /health` | `simulated` |
| Respuesta de inicio de sesión de planta | `provider.simulated`, que la app muestra como banner permanente |
| `PersonalizationJob` | `simulated` |
| `VerificationEvent` | `simulated` |
| `PostPressCheck` | `simulated` |

La marca **no se borra nunca**. Un registro simulado histórico debe seguir siendo
distinguible de uno real dentro de dos años.

### 1.2 Ninguna verificación alcanza `VERIFIED`

Es una consecuencia encadenada, no una decisión aislada:

1. `TRUST_CEILING_BY_METHOD` solo permite `VERIFIED` con el método
   `NFC_CRYPTOGRAPHIC`.
2. `supportsCryptographicAuthentication` devuelve `true` únicamente para
   `NTAG424DNA`. Es una propiedad del hardware, no una configuración.
3. Los tres proveedores declaran `canProduceCryptographicProof: false`, incluido el
   adaptador 424, cuyo `displayName` es literalmente
   *"NTAG 424 DNA (INTEGRACION PENDIENTE)"*.
4. `Ntag21xNdefProvider.readVerificationPayload` devuelve
   `authenticatedMessage: null` **siempre**, con el comentario *"Una NTAG 21x no
   produce mensajes autenticados"*.
5. El motor de riesgo nunca eleva a `VERIFIED` una evidencia marcada `simulated`.

**Resultado:** el mejor veredicto alcanzable hoy es `IDENTIFIED_ONLY`, cuyo texto al
aficionado ya dice que la lectura "no incluyó una comprobación de seguridad" y que
"sirve para consultar información, no para confirmar autenticidad".

Consecuencia de comunicación, no negociable: **no se puede afirmar que el sistema
autentica jerseys.** Identifica. Ver [arquitectura.md](arquitectura.md) y
[modelo-amenazas.md](modelo-amenazas.md).

### 1.3 El adaptador NTAG 424 DNA es un contrato vacío

`packages/nfc-contracts/src/providers/ntag424.ts` implementa la interfaz y **todos
sus métodos lanzan `NOT_IMPLEMENTED`**, de forma deliberada. La bandera
`canProduceCryptographicProof: false` describe la implementación, no el silicio: el
chip sí es capaz; el adaptador no.

`POST /production/jobs/reserve` rechaza `chipType: 'NTAG424DNA'` si el despliegue no
tiene ese proveedor habilitado, antes de reservar nada. Falla temprano y de forma
visible.

Ver [guia-ntag424-dna.md](guia-ntag424-dna.md).

### 1.4 El custodio de claves no custodia nada

`KMS_PROVIDER=null-kms`. Solo registra referencias. `NfcKeyReference.custodian`
tiene `none` por defecto. La jerarquía de claves está diseñada y **no existe**. Ver
[plan-gestion-claves.md](plan-gestion-claves.md).

### 1.5 El correo es simulado en desarrollo

`infra/docker-compose.yml` levanta Mailpit, que **captura** todo el correo saliente
y no lo entrega. No hay proveedor de correo transaccional configurado para
producción.

---

## 2. Lo que requiere hardware

Nada de esta sección puede resolverse escribiendo código.

### 2.1 NTAG 424 DNA

| Necesidad | Detalle |
|---|---|
| Chips físicos | Para validar cada comando contra silicio real, no contra una hoja de datos |
| Documentación oficial de NXP | El repositorio **no incluye** ningún comando, clave ni secuencia APDU inventada, y no debe incluirlos |
| Un lote sacrificable | La personalización criptográfica tiene pasos irreversibles |
| Un custodio de claves operativo | El teléfono es un túnel: recibe APDU ya cifrados por el custodio |
| Un teléfono con NFC probado | La transmisión de APDU crudos depende de la plataforma |

### 2.2 Bloqueo irreversible de NTAG 21x

`lockAllowedAreas` devuelve `NOT_IMPLEMENTED`:

> *El bloqueo irreversible de NTAG 21x no está implementado: requiere validación con
> hardware real.*

La razón, íntegra: escribir los lock bytes o los lock bits es **irreversible**, no
hay comando de desbloqueo, y **un error de offset inutiliza el chip de forma
permanente**, sobre un emblema que ya está cosido o a punto de coserse. El simulador
no tiene lock bytes, así que el error no aparece en pruebas: aparece en el primer
lote real. Y el mapa de memoria varía entre NTAG 213, 215 y 216.

Coherentemente, `lockPlan` se emite siempre con ambos campos en `false`.

Consecuencia asumida: **el contenido NDEF es reescribible por cualquier teléfono con
NFC.** Detalle y mitigaciones en
[protocolo-programacion.md](protocolo-programacion.md) sección 6.

### 2.3 Firma de originalidad de NXP

`validateOriginality` devuelve `notSupported: true` en los dos caminos posibles:

| Situación | Respuesta |
|---|---|
| Sin clave pública configurada | *"falta la clave pública de originalidad de NXP. Configúrela para habilitar esta comprobación"* |
| Con clave pública configurada | *"la verificación READ_SIG no está implementada. Requiere validación contra hardware real antes de habilitarse"* |

NXP documenta el comando `READ_SIG` (`0x3C 0x00`), que devuelve una firma ECC de 32
bytes generada en fábrica sobre el UID. **La clave pública de originalidad no está
en este repositorio y debe obtenerse del fabricante.**

Y una advertencia que conviene no perder: aunque se verificara, la firma probaría
que el **silicio** es de NXP. No probaría que ese chip concreto sea el que Marathon
programó, ni que siga en su emblema original. Es una señal de riesgo, no una
autenticación.

### 2.4 Pruebas físicas

Ninguna de las 20 de [pruebas-fisicas.md](pruebas-fisicas.md) se ha ejecutado. No
hay emblemas reales, ni jerseys de producción, ni prensa, ni teléfonos de ensayo, ni
laboratorio textil contratado.

En particular, **no se conoce**:

- La ventana de temperatura, presión y tiempo del termosellado.
- La tolerancia térmica del módulo NFC, que es un dato del fabricante del inlay y
  **hay que pedirlo por escrito**.
- Cuántos ciclos de lavado soporta el conjunto.
- La distancia máxima de lectura, ni antes ni después de la prensa.
- Qué modelos de teléfono leen el chip, a qué distancia y con qué comportamiento del
  sistema operativo.
- Si el emblema se puede extraer conservando el chip funcional, y si el daño es
  evidente.

Sobre lo último, con honestidad: `runPostPressCheck` devuelve
`signalStrength: null` porque **Android no expone RSSI para NFC**. No se puede medir
degradación parcial por este canal; el sustituto propuesto es la medida manual de
distancia y **no está implementado**.

### 2.5 Ausencia de mediciones cuantitativas

Todo lo anterior significa que el sistema **no tiene ni una sola medición física**.
Cualquier cifra que aparezca en una presentación comercial sobre resistencia,
distancia o compatibilidad sería inventada.

---

## 3. Lo que requiere credenciales o contratos comerciales

| Necesidad | Para qué | Bloquea |
|---|---|---|
| Documentación oficial de NXP para NTAG 424 DNA | Comandos, secuencias, gestión de claves | Toda la autenticación criptográfica |
| Clave pública de originalidad de NXP | `READ_SIG` | La comprobación de originalidad |
| Proveedor de KMS, HSM o SAM | Custodia real de claves y firma de certificados | `VERIFIED`, firma del certificado |
| Gestor de secretos en producción | `SESSION_SECRET`, `TOKEN_HASH_PEPPER`, `ANALYTICS_IP_SALT` | Cualquier despliegue real |
| Proveedor de alojamiento y base de datos gestionada | Infraestructura | Despliegue |
| Proveedor de correo transaccional | Invitaciones de transferencia, avisos | Transferencias de titularidad |
| API de la tienda electrónica y su secreto de firma | Activación al vender | Ver [integracion-tienda.md](integracion-tienda.md) |
| Play Integrity API de Google | Atestación del dispositivo de planta | Ver 5.2 |
| Laboratorio textil | Ensayos con norma reconocida | [pruebas-fisicas.md](pruebas-fisicas.md) |
| Proveedor de emblemas con inlay y su hoja de datos | Tolerancias del módulo | Receta de termosellado |
| Asesoría legal en protección de datos y registro ante la autoridad | Cumplimiento LOPDP | Ver [privacidad-lopdp.md](privacidad-lopdp.md) sección 11 |
| Certificado TLS y dominio definitivo | La URL grabada en el chip es permanente; cambiarla después obliga a reprogramar | Programación de producción |

El último merece énfasis: **la URL del chip no se puede cambiar una vez grabada** si
no se reprograma el chip. `FAN_WEB_PUBLIC_URL` debe ser la definitiva antes del
primer lote, y además corta: `checkUriFits` rechaza la reserva si la URL no cabe en
el tipo de chip.

---

## 4. Lo que no se ha probado

### 4.1 La app Android no se ha compilado

`apps/nfc-android` contiene **59 archivos Kotlin** organizados en `core`, `data`,
`domain`, `nfc` y `ui`, más `AndroidManifest.xml`, recursos y scripts Gradle.

**Nada de eso se ha compilado.** En el entorno de construcción:

| Comprobación | Resultado |
|---|---|
| `gradle` en el PATH | No existe |
| `gradle/wrapper/gradle-wrapper.jar` | **Ausente.** Solo está `gradle-wrapper.properties`, así que `./gradlew` no puede arrancar |
| `ANDROID_HOME` | Vacío |
| SDK de Android instalado | No |

Consecuencias, todas sin verificar:

- No se sabe si el código compila. Puede tener errores de tipos, de importación o de
  API de Android que ningún `typecheck` de TypeScript detecta.
- No se sabe si las dependencias de `gradle/libs.versions.toml` resuelven.
- No se ha ejecutado ninguna prueba instrumentada.
- No se ha probado la lectura NFC real: `AndroidTagTransport` no ha tocado un chip.
- No se ha probado el flujo completo contra la API.
- `apps/nfc-android` **no está en los `workspaces`** de `package.json`, porque es un
  proyecto Gradle y no un paquete npm. Por tanto `npm run build`, `npm run
  typecheck`, `npm test` y `npm run lint` **no lo tocan**: puede romperse sin que
  nada avise.

Lo que sí es verificable sin Android: la lógica compartida de dominio y de contratos
NFC, que está en TypeScript, tiene pruebas y se ejecuta con `npm test`.

### 4.2 Otras cosas sin probar

| Qué | Estado |
|---|---|
| El flujo de producción de extremo a extremo con hardware real | No probado |
| Comportamiento bajo carga | No probado. No hay pruebas de carga ni de estrés |
| Restauración de una copia de seguridad | No probada. No hay procedimiento escrito |
| Un despliegue en producción | No se ha hecho ninguno |
| El proceso de migración de base de datos sobre datos reales | Solo probado sobre base vacía |
| Rotación de `ANALYTICS_IP_SALT` | Declarada cada 30 días; **el procedimiento no se ha ejecutado nunca** |
| Rotación de `TOKEN_HASH_PEPPER` | Documentada; no ejecutada. Es la más delicada: invalida todos los hashes de token existentes |
| Recuperación ante pérdida del `TOKEN_HASH_PEPPER` | Sin pimienta, **ningún chip verifica**. No hay procedimiento de recuperación probado |
| Accesibilidad con lector de pantalla real | El panel tiene las marcas correctas; nadie lo ha probado con un lector |
| El comportamiento del modo de bajo consumo (`Save-Data`) | Implementado en el modelo; no medido |

El punto de la pimienta es el riesgo operativo mayor del sistema: **es un único
secreto cuya pérdida convierte todos los chips programados en tokens desconocidos.**
Ver [plan-gestion-claves.md](plan-gestion-claves.md).

---

## 5. Controles de seguridad no implementados

### 5.1 MFA

`User.mfaEnabled` y `User.mfaSecretRef` existen en el esquema. El inicio de sesión
del panel devuelve `mfaEnabled`. **No se exige ningún segundo factor.** El comentario
del código lo dice: *"MFA preparado para fase 2: hoy se registra la intención pero no
se exige un segundo factor"*.

Riesgo concreto: una contraseña de `SUPERADMIN` o de `MARATHON_ADMIN` comprometida da
acceso completo, incluida la capacidad de revocar unidades, autorizar dispositivos y
ver UID completos.

Mitigación actual, que es procedimiento y no control técnico: pocas cuentas
privilegiadas, contraseñas de gestor, revisión periódica del registro de auditoría
por otra persona.

Cuando se implemente, `mfaSecretRef` debe apuntar a un secreto **cifrado con clave
de KMS**, no guardarse en claro.

### 5.2 Atestación de dispositivo

`AuthorizedDevice.attestationRef` está preparado para Play Integrity API y **hoy no
se verifica**. La autorización del dispositivo de planta es **una lista en base de
datos**: el teléfono envía un `deviceId` y el servidor comprueba que existe y está
activo.

Consecuencia: quien conozca un `deviceId` válido puede presentarlo desde otro
teléfono. El `deviceId` debe tratarse como dato interno y no escribirse en etiquetas
visibles del equipo.

Lo que sí funciona: un operario válido en un teléfono **no registrado** no puede
programar, y el intento queda auditado como
`production.login.device_rejected`. Es una barrera real contra el uso de un
dispositivo personal; no lo es contra un atacante que ya conoce el `deviceId`.

Ver el vector "dispositivo de producción comprometido" en
[modelo-amenazas.md](modelo-amenazas.md).

### 5.3 Firma del certificado digital

`DigitalCertificate.signature` se crea como `null` en la activación, con el
comentario *"PENDIENTE: firmar con clave custodiada en KMS"*.

Consecuencia: **el certificado no es verificable fuera del sistema.** Su validez
depende de que quien lo consulta confíe en la API que lo sirve. Un certificado
exportado no prueba nada por sí mismo.

No se implementó porque firmar exige una clave custodiada, y `KMS_PROVIDER=null-kms`
no custodia nada. Firmar con una clave que vive en la aplicación sería peor que no
firmar: daría apariencia de garantía criptográfica sin la propiedad que la sostiene.

### 5.4 Otros controles ausentes

| Control | Estado |
|---|---|
| Cifrado en reposo de la base de datos | Delegado al proveedor. No configurado |
| Revocación de sesiones al desactivar un usuario o un dispositivo | La desactivación no revoca las sesiones abiertas; hay que hacerlo aparte |
| Auditoría de `GET /admin/chips` | **Ausente.** La consulta que revela UID completos no deja rastro |
| Detección de anomalías en el uso del panel | Ausente. Nadie vigila 300 exportaciones en una noche |
| Alertas operativas | Ausentes. No hay integración con ningún sistema de aviso |
| Procedimiento de notificación de brechas | Ausente |
| Verificación de identidad para solicitudes de derechos | Solo existe el estado `IDENTITY_PENDING`; el procedimiento no está implementado |
| Verificación de edad y consentimiento de representante | **Ausente.** Un jersey de club tiene demanda infantil evidente. Es una laguna que hay que cerrar antes de abrir el registro de cuentas |

---

## 6. Redis sustituido por limitación en memoria

El MVP **no despliega Redis**. `infra/docker-compose.yml` levanta únicamente
PostgreSQL y Mailpit.

La limitación de peticiones se registra en `apps/api/src/app.ts` con
`@fastify/rate-limit`, `global: false` y **el almacén por defecto del plugin, que es
en memoria del proceso**. Las rutas sensibles refinan la clave; el resto no está
limitado salvo declaración explícita.

| Variable | Valor por defecto | Aplica a |
|---|---|---|
| `RATE_LIMIT_VERIFY_PER_MINUTE` | 20 | Rutas públicas de verificación |
| `RATE_LIMIT_LOGIN_PER_MINUTE` | 5 | Autenticación |

### 6.1 Consecuencias, sin adornos

1. **No se comparte entre instancias.** Con `N` instancias de API, cada proceso
   cuenta por su cuenta y el límite efectivo es `N × límite`. Un atacante que
   distribuya sus peticiones obtiene `N` veces el presupuesto previsto.
2. **Se pierde al reiniciar.** Un despliegue reinicia los contadores. Quien esté
   limitado queda libre.
3. **El límite es por IP.** Detrás de un CGNAT, muchos usuarios legítimos comparten
   IP y pueden limitarse entre sí. Y quien disponga de varias IP evade el límite.
4. **Depende de `trustProxy`.** `trustProxy: config.isProduction` significa que en
   producción se confía en la cabecera del proxy. **Solo es correcto detrás de un
   proxy propio**: si la API queda expuesta directamente, cualquiera falsifica su IP
   con `X-Forwarded-For`, evade el límite y contamina los seudónimos de analítica.
5. **Un receptor de webhooks mal calibrado rechazaría eventos legítimos** durante un
   pico de ventas. Ver [integracion-tienda.md](integracion-tienda.md).

### 6.2 Por qué se aceptó, y cuándo deja de ser aceptable

Se aceptó por tres razones: una dependencia menos en el piloto, un volumen de 1.000
jerseys que no justifica un almacén distribuido, y un punto de extensión trivial
—`@fastify/rate-limit` acepta un `store` alternativo, de modo que pasar a Redis es
un cambio de configuración, no de arquitectura.

**Deja de ser aceptable en el momento en que se despliega más de una instancia de
API.** No es una mejora futura: es un prerrequisito del escalado horizontal.

### 6.3 Lo que Redis también resolvería

Además del límite compartido: bloqueo distribuido para operaciones de producción,
caché de contenido dinámico, y una cola para trabajos asíncronos —que hoy no
existe, ver 7.1.

---

## 7. Lo que no escala todavía

### 7.1 No hay planificador de tareas ni cola de trabajos

Es el hueco estructural más importante después de la criptografía. No hay ningún
mecanismo que ejecute nada de forma periódica ni diferida.

Los trabajos **existen** en `apps/api/src/jobs/index.ts`, con pruebas de
integración. **Lo que no existe es el planificador**: nada los invoca solo.

| Tarea | Estado |
|---|---|
| Purga de sesiones caducadas | Implementada (`limpiarCaducados`) |
| Purga de registros de idempotencia (TTL 48 h) | Implementada (`limpiarCaducados`) |
| Anonimización del detalle de `VerificationEvent` a los 180 días | Implementada (`aplicarRetencion`) |
| Caducidad de transferencias pendientes | Implementada (`caducarTransferencias`) |
| Cálculo de `CampaignMetric` | Implementado (`materializarMetricasDeCampana`) |
| Agregación de `AnalyticsDaily` | Implementada (`agregarAnaliticaDiaria`) |
| Detección de lotes con proporción anómala de alertas | Implementada (`marcarLotesAnomalos`) |
| **Planificador que los ejecute** | **No existe.** Hay que invocarlos desde un cron |
| Expiración del estado transitorio `PERSONALIZING` | El estado tiene expiración declarada; nada la aplica |
| Rotación de `qrToken` según `qrExpiresAt` | Sin trabajo |
| Envío de correo | Sin cola: un fallo del proveedor pierde el mensaje |

Ejecución manual, mientras no haya cron:

```bash
cd apps/api
npx tsx src/jobs/run.ts todos        # todos en el orden correcto
npx tsx src/jobs/run.ts retencion    # solo la política de retención
```

La ausencia de planificador es deliberada: acoplar uno concreto (node-cron, Bull,
Temporal) ataría el despliegue a una decisión que corresponde a infraestructura, no
a la aplicación. Ver el comentario de cabecera de `jobs/index.ts`.

**Consecuencia sobre la privacidad:** la política de `RETENTION_DAYS` está
implementada pero **no se aplica sola**. Hasta que haya un cron, la retención
depende de que alguien ejecute el trabajo. Es un riesgo operativo, no un hueco de
código. Ver [politica-logs.md](politica-logs.md) y
[privacidad-lopdp.md](privacidad-lopdp.md).

**Purga física frente a anonimización.** `aplicarRetencion` **anonimiza** el
detalle técnico en lugar de borrar la fila: se conserva el nivel de confianza para
estadística y desaparece el seudónimo de IP y la huella de dispositivo. La
eliminación de una cuenta sigue el mismo criterio
(`services/privacy-erasure.ts`), y la razón está explicada ahí: borrar la fila a
secas destruiría también la prueba de que el consentimiento existió.

### 7.2 Consultas que crecerán mal

| Consulta | Riesgo |
|---|---|
| Historial del motor de riesgo en **cada** verificación | Varias consultas agregadas por lectura. Mitigado por el índice `VerificationEvent_unit_recent`, pero no medido bajo carga |
| `VerificationEvent` sin purga | Crece indefinidamente. Es la tabla de mayor volumen por diseño |
| Exportación CSV | Límite de 5.000 filas con aviso de truncado. Por encima de eso, la exportación se vuelve inviable sin paginación o generación asíncrona |
| Listados del panel | Paginación en base de datos, sin cursor. Con volúmenes grandes, las páginas altas son costosas |
| Conteos globales del panel | `count` sin filtro sobre tablas grandes se degrada |

Ninguna de estas afirmaciones está medida. Son riesgos identificados, no
diagnósticos.

### 7.3 Arquitectura de una sola instancia

Hoy el sistema asume implícitamente una sola instancia de API:

- Límite de peticiones en memoria (ver 6).
- Sin bloqueo distribuido para operaciones de producción concurrentes. La protección
  real la dan las restricciones únicas de base de datos, que **sí** resisten la
  concurrencia: `Ownership_active_unique`, `OwnershipTransfer_pending_unique`,
  `PersonalizationJob.idempotencyKey`, `NfcChip.uid`.
- Sin caché compartida.
- Sin planificador con elección de líder: cuando existan trabajos periódicos, dos
  instancias los ejecutarían dos veces.

El diseño de los datos está preparado para varias instancias; la capa de
infraestructura no.

### 7.4 Observabilidad

| Necesidad | Estado |
|---|---|
| Registro estructurado | Sí, Pino con serializadores restrictivos |
| Métricas de aplicación | Ausentes. No hay endpoint de métricas |
| Trazas distribuidas | Ausentes |
| Cuadros de mando operativos | Ausentes |
| Alertas | Ausentes |
| Correlación de peticiones | No hay identificador de correlación propagado |

Se puede diagnosticar un incidente leyendo registros. **No se puede detectar un
incidente sin que alguien se queje.**

---

## 8. Huecos funcionales del producto

### 8.1 Permisos sin ruta

Estos permisos existen en la matriz y **ninguna ruta los ejerce**:

| Permiso | Quién lo tiene y no lo puede usar |
|---|---|
| `catalog:write` | `MARATHON_ADMIN`. El catálogo se carga por `prisma/seed.ts` |
| `content:write` | `CLUB_ADMIN`, `CONTENT_AGENCY`, `MARATHON_ADMIN`. Es la razón de ser del rol de agencia |
| `campaigns:read`, `campaigns:write` | `SPONSOR`, `CLUB_ADMIN`, `CONTENT_AGENCY`, `MARATHON_ADMIN` |
| `rewards:read`, `rewards:write` | `CLUB_ADMIN`, `MARATHON_ADMIN` |
| `roles:assign` | `MARATHON_ADMIN`. Las asignaciones se hacen por base de datos |
| `chips:write` | `PRODUCTION_OPERATOR` lo usa indirectamente desde la app; no hay ruta de panel |

**El rol `SUPPORT` ya tiene escritura efectiva.** Los cinco permisos que estaban
inertes (`support:write`, `privacy:write`, `fans:read`, `ownership:read`,
`ownership:write`) se ejercen desde `apps/api/src/routes/support.ts` y desde tres
pantallas del panel: detalle del caso, ficha del aficionado y detalle de la
solicitud de privacidad. Soporte puede asignar, responder, cerrar, consultar una
ficha, liberar una titularidad y resolver una solicitud de derechos.

Los huecos de escritura que quedan son de **catálogo y marketing**: el catálogo,
el contenido, las campañas y las recompensas se administran hoy por semilla o por
SQL, no por panel. Molesto, no roto: no bloquea ningún circuito del producto.

### 8.2 La pantalla del patrocinador existe y no tiene datos que mostrar

`apps/admin-web/src/app/patrocinador/campana/[id]/page.tsx` está implementada, con su
guardia de permiso, su agrupación por métrica, el marcado explícito de los valores
suprimidos y los textos que explican que "suprimido" no significa cero. La API que
consume también está implementada.

**Lo que falta es que el dato se calcule solo.** El trabajo que materializa
`CampaignMetric` ya existe (`materializarMetricasDeCampana`), pero sin planificador
hay que invocarlo a mano (ver 7.1). Los datos de demostración sí siembran métricas,
incluida una con cohorte por debajo del mínimo para que la supresión sea visible en
la pantalla.

### 8.3 Granularidad de ámbito en las rutas

`requirePermission` sin ámbito solo lo satisface una asignación `GLOBAL`, y casi
todas las rutas de `admin.ts` se declaran así. Efecto: **el panel solo es plenamente
usable con asignación `GLOBAL`**. Un `CLUB_ADMIN` con ámbito `CLUB` recibe 403.

Además, `/me` y `/logout` exigen `catalog:read`, que un `SPONSOR` no tiene. El
respaldo del cliente resuelve el menú; no resuelve el cierre de sesión en el
servidor.

Corrección pendiente, doble:

1. Proteger `/me` y `/logout` con una comprobación de sesión sin permiso de catálogo.
2. Pasar el ámbito del recurso en cada ruta que opere sobre un club, una
   organización o una campaña.

### 8.4 Otros huecos

| Hueco | Efecto |
|---|---|
| `apps/api/src/scripts/export-openapi.ts` no existe | El script `npm run openapi:export` de `apps/api/package.json` falla. La especificación sigue disponible en `GET /openapi.json` |
| `packages/config` está **vacío** | La configuración compartida de ESLint, TypeScript y Tailwind no está centralizada |
| Sin pantalla para marcar un lote | `ProductionBatch.flagged` se pone por base de datos, pese a tener consecuencias sobre producto vendido |
| Sin integración con la tienda | Ver [integracion-tienda.md](integracion-tienda.md) |
| Sin camino de activación para tienda física | Una venta en mostrador no activa la unidad |
| Sin rol de punto de venta | Activar exigiría `production:activate`, demasiado amplio para un mostrador |
| `PURCHASE_IMPORT` declarado y sin usar | Ninguna ruta escribe ese valor |
| Supresión de cohortes sin defensa diferencial | El umbral de 20 por celda no impide comparar celdas entre días. Ver [privacidad-lopdp.md](privacidad-lopdp.md) sección 7.3 |
| `PostPressCheck` sin identificador de prensa ni de receta | Solo hay texto libre en `detail`, que no es consultable de forma fiable. Ver [protocolo-termosellado.md](protocolo-termosellado.md) |

### 8.5 Nota sobre la documentación

`arquitectura.md` sección 2 describe `apps/fan-web`, `apps/admin-web`,
`apps/nfc-android`, `packages/ui` y los archivos de rutas de la API como
inexistentes. **Esa descripción está desactualizada**: las tres aplicaciones tienen
código, `packages/ui` tiene componentes, y `routes/public.ts`, `routes/fan.ts`,
`routes/production.ts`, `routes/admin.ts`, `openapi.ts` y `prisma/seed.ts` existen.
Lo que sigue siendo cierto de esa sección: `packages/config` está vacío y
`src/scripts/export-openapi.ts` no existe.

Se anota aquí en lugar de corregirlo allí para no introducir una discrepancia
silenciosa entre documentos.

---

## 9. Riesgos residuales que ninguna implementación futura elimina

Por honestidad, y porque conviene no prometer lo contrario.

| Riesgo | Por qué persiste |
|---|---|
| **Trasplante del emblema a otra prenda** | El chip es genuino y el token es el registrado. El chip no sabe a qué tela está pegado. Ni NTAG 424 DNA resuelve esto: solo prueba que el chip es el chip |
| **Copia del identificador con NTAG 21x** | El contenido NDEF es legible y copiable. Se detecta por patrones de uso, que no es detección fiable |
| **Falsificación de la prenda sin el chip** | Una prenda falsa sin emblema NFC no verifica, lo que ayuda; pero el sistema no puede impedir que se fabrique |
| **Operador malicioso en la línea** | Se mitiga con separación de funciones, auditoría e idempotencia; no se elimina |
| **Pérdida del `TOKEN_HASH_PEPPER`** | Sin la pimienta, ningún chip verifica. La custodia es un control organizativo |
| **Reidentificación por cruce externo** | La seudonimización reduce el riesgo; una base externa suficientemente rica puede reducirlo menos de lo esperado |

Ver [modelo-amenazas.md](modelo-amenazas.md) para el análisis completo y el riesgo
residual por vector.

---

## 10. Qué es sólido hoy

Para que el inventario sea honesto en las dos direcciones.

| Pieza | Estado |
|---|---|
| Dominio puro: confianza, estados, RBAC, privacidad, analítica, identificadores, riesgo | Implementado y con pruebas. Sin base de datos, sin HTTP, sin hardware |
| Máquinas de estado con transiciones validadas | Un salto no declarado devuelve 409 y no se ejecuta |
| Techo de confianza por método, que ninguna regla puede elevar | Implementado |
| Tres espacios de identificadores no derivables entre sí, con hash y pimienta | Implementado |
| Idempotencia exactamente-una-vez con detección de reutilización de clave | Implementada |
| Restricciones únicas parciales en base de datos | Implementadas. Son la única defensa que resiste la concurrencia |
| RBAC con ámbito y lista de permisos prohibidos a roles externos, con prueba | Implementado |
| Saneador de metadatos de auditoría | Implementado, con sus límites documentados |
| Seudonimización de IP: truncado y después hash con sal rotativa | Implementada |
| Serializadores de log que recortan `/v/<token>` y descartan cuerpos y cabeceras | Implementados |
| Respuesta pública por lista blanca de campos, con referencia enmascarada | Implementada |
| Verificación anónima, sin cuenta ni consentimiento | Implementada y probada |
| Reclamo de titularidad apoyado en tenencia física reciente (30 minutos) | Implementado |
| Marca de simulación propagada y conservada | Implementada |
| Panel con 17 pantallas, ocultación por permiso y errores de API visibles | Implementado |
| Vista de patrocinador que marca los agregados suprimidos en lugar de mostrar cero | Implementada |
| Exportación CSV auditada y con aviso de truncado | Implementada |
| Barreras de arranque: sin secretos de desarrollo y sin simulador en producción | Implementadas |
| Honestidad de los proveedores NFC: `notSupported` y `NOT_IMPLEMENTED` en lugar de resultados falsos | Implementada |

Lo último es la propiedad más valiosa del repositorio y conviene preservarla: **el
código prefiere fallar de forma visible antes que fingir una garantía.**

---

## 11. Documentos relacionados

- [arquitectura.md](arquitectura.md)
- [modelo-datos.md](modelo-datos.md)
- [modelo-amenazas.md](modelo-amenazas.md)
- [plan-gestion-claves.md](plan-gestion-claves.md)
- [guia-ntag424-dna.md](guia-ntag424-dna.md)
- [politica-logs.md](politica-logs.md)
- [privacidad-lopdp.md](privacidad-lopdp.md)
- [matriz-roles-permisos.md](matriz-roles-permisos.md)
- [guia-panel.md](guia-panel.md)
- [protocolo-programacion.md](protocolo-programacion.md)
- [protocolo-termosellado.md](protocolo-termosellado.md)
- [pruebas-fisicas.md](pruebas-fisicas.md)
- [integracion-tienda.md](integracion-tienda.md)
- [piloto-a-produccion.md](piloto-a-produccion.md)

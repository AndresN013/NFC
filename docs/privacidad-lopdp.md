# Privacidad y LOPDP

Aplicación de los principios de la **Ley Orgánica de Protección de Datos
Personales del Ecuador** (LOPDP) al diseño de Marathon Escudo Vivo.

> **Advertencia previa.** Este documento describe **controles técnicos**
> implementados o previstos en el código. No es asesoría legal y no sustituye ni
> la evaluación de impacto ni las obligaciones formales ante la autoridad de
> protección de datos. Ver la sección 11.

Los controles descritos aquí viven en `packages/domain/src/privacy.ts`,
`packages/domain/src/analytics.ts`, `apps/api/src/lib/request-context.ts` y
`apps/api/src/lib/audit.ts`.

---

## 1. Papel de las partes

| Parte | Papel | Notas |
|---|---|---|
| Marathon | Responsable del tratamiento | Decide las finalidades y los medios |
| Club | Corresponsable para las comunicaciones del club | Requiere acuerdo escrito que delimite responsabilidades |
| Patrocinador | **No es responsable ni encargado de datos personales** | Solo recibe agregados. Ver 8 |
| Agencia de contenido | Encargada, limitada a contenido | Sin acceso a datos de titulares |
| Proveedor de alojamiento / base de datos | Encargado | Exige contrato y control de transferencias internacionales |
| Persona aficionada | Titular de los datos | Ver 9 |

---

## 2. Los principios, uno por uno

### 2.1 Licitud

Cada tratamiento tiene una base declarada antes de ejecutarse. La declaración
está en el código, no en un documento aparte: `CONSENT_REQUIRED` enumera las
finalidades que exigen consentimiento, y la ausencia de la verificación en esa
lista es la declaración explícita de que la verificación **no** se ampara en
consentimiento. Ver la tabla de la sección 3.

### 2.2 Finalidad

Cada dato se recoge para un propósito concreto y no se reutiliza para otro sin
una nueva base.

Ejemplos de la separación aplicada:

| Dato | Finalidad para la que se recoge | Reutilización prohibida |
|---|---|---|
| `ipPseudonym` de una verificación | Detectar abuso de un identificador | Segmentación comercial, geolocalización de la persona |
| `deviceFingerprint` | Contar dispositivos distintos por unidad | Seguimiento entre sitios, publicidad |
| `countryCode` | Señal de riesgo geográfico de peso bajo | Perfilado de mercado sin agregación |
| Correo de `FanAccount` | Autenticación y avisos de servicio | Marketing, que exige consentimiento `MARKETING` |
| `Ownership` | Acreditar titularidad y garantía | Compartir con patrocinadores |

### 2.3 Minimización

Decisiones concretas que reducen el dato recogido:

- No se recoge la IP completa en ningún momento persistente: se trunca antes de
  guardar (`truncateIp`) y después se seudonimiza.
- No se recoge ubicación precisa. Solo código de país, y únicamente si una
  cabecera de CDN lo aporta. Ciudad y coordenadas exigen consentimiento
  `LOCATION`.
- La huella de dispositivo se construye con cabeceras de **baja entropía** a
  propósito. No se usa canvas, enumeración de fuentes ni sensores.
- Verificar un jersey no requiere cuenta, así que en el caso normal **no hay
  identidad que recoger**.
- `AnalyticsDaily` no tiene columna de sujeto: es una fila por evento, día y
  dimensión.
- No se guarda el mensaje autenticado del chip, solo su huella
  (`messageFingerprint`), porque el mensaje completo podría reutilizarse si la
  base se filtrara.
- El registro de auditoría trunca cualquier cadena de más de 512 caracteres.

### 2.4 Proporcionalidad

La pregunta que se aplica a cada campo: *¿el dato es adecuado a la finalidad, o
es el dato más cómodo de obtener?*

| Alternativa descartada | Por qué era desproporcionada | Qué se hace en su lugar |
|---|---|---|
| Guardar la IP completa para detectar clonación | La finalidad se cumple contando redes distintas; no hace falta saber cuál | IP truncada y seudonimizada |
| Fingerprinting de navegador robusto | Identificaría a la persona entre sitios, muy por encima de lo necesario | Huella de baja entropía con sal rotativa |
| Exigir cuenta para verificar | Convertiría una comprobación de autenticidad en una captación de usuarios | Verificación anónima |
| Conservar el detalle técnico indefinidamente | Un historial de lecturas de años es un perfil de comportamiento | 180 días (`verification_event_detail`) |
| Dar al patrocinador acceso de consulta a eventos | Un filtro suficientemente estrecho individualiza | Contadores materializados y supresión de cohortes |

### 2.5 Transparencia

- `CONSENT_COPY` contiene el título y la descripción de cada finalidad en
  lenguaje llano, y es lo que se muestra en la interfaz. El texto vive junto a la
  definición de la finalidad para que no puedan desincronizarse.
- `Consent.policyVersion` registra **qué versión del texto informativo** aceptó
  la persona. Sin esto no se puede demostrar qué se le dijo.
- `TRUST_LEVEL_COPY` explica al aficionado qué significa el veredicto sin revelar
  detalles útiles para un falsificador. La explicación de `IDENTIFIED_ONLY` dice
  literalmente que la lectura "no incluyó una comprobación de seguridad" y que
  "sirve para consultar información, no para confirmar autenticidad". No se le
  vende una garantía que el sistema no da.
- La ruta pública `GET /api/v1/consents/catalog` expone el catálogo de finalidades
  sin necesidad de sesión: se puede leer qué se pide antes de decidir.

### 2.6 Seguridad

| Control | Dónde |
|---|---|
| Contraseñas con Argon2id y defensa contra enumeración por tiempo | `apps/api/src/lib/passwords.ts` |
| Tokens almacenados solo como hash con pimienta de servidor | `packages/domain/src/identifiers.ts` |
| Separación de tablas y de sesiones entre personal y aficionados | `User` / `FanAccount` |
| RBAC con alcance y lista de permisos prohibidos a roles externos | `packages/domain/src/rbac.ts` |
| Auditoría solo-anexar con saneador de metadatos | `apps/api/src/lib/audit.ts` |
| Cabeceras de seguridad y CSP restrictiva | `apps/api/src/app.ts` (Helmet) |
| CORS con lista blanca explícita, sin reflexión de `Origin` | `apps/api/src/app.ts` |
| Ninguna clave maestra en la aplicación ni en la base de datos | [plan-gestion-claves.md](plan-gestion-claves.md) |
| Respuesta pública por lista blanca de campos | `buildPublicResult` |

Controles **ausentes** que un análisis de seguridad exigiría y que hay que
declarar: MFA no implementado, atestación de dispositivo no verificada, cifrado en
reposo delegado al proveedor de base de datos, jobs de purga no planificados. Ver
[limitaciones.md](limitaciones.md) y [modelo-amenazas.md](modelo-amenazas.md).

### 2.7 Consentimiento específico

Cinco finalidades, cada una con su propio registro. No hay casilla única ni
consentimiento agrupado.

```ts
export const CONSENT_PURPOSES = [
  'MARKETING',
  'LOCATION',
  'SPONSOR_ANALYTICS',
  'PERSONALIZATION',
  'CLUB_COMMUNICATIONS',
] as const;
```

Propiedades del modelo de consentimiento:

| Propiedad | Implementación |
|---|---|
| Específico | Un registro `Consent` por `(fanId, purpose)`, con unicidad en base de datos |
| Informado | `CONSENT_COPY` más `policyVersion` |
| Libre | `FEATURES_WITHOUT_CONSENT` garantiza que negarse no cuesta funcionalidad esencial. Ver 5 |
| Revocable | `revokedAt`. `hasActiveConsent` exige `granted === true` **y** `revokedAt == null` |
| Demostrable | `grantedAt`, `revokedAt`, `policyVersion`, retenidos 1825 días |
| Por omisión, negativo | `hasActiveConsent` devuelve `false` si no hay registro. La ausencia nunca se interpreta como aceptación |

---

## 3. Tabla de finalidades y base legal

| Finalidad | Datos tratados | Base legal | ¿Consentimiento? | Retención |
|---|---|---|---|---|
| **Verificar la autenticidad de una prenda** | IP truncada y seudonimizada, huella de dispositivo, código de país, huella de mensaje | Interés legítimo en combatir la falsificación + ejecución de la garantía del producto | **No** | 180 días el detalle técnico |
| **Detectar abuso y clonación** | Los mismos, agregados por unidad | Interés legítimo del responsable y de la propia persona titular | **No** | 180 días; alertas cerradas 365 |
| **Emitir y mostrar el certificado digital** | Referencia pública de la unidad, modelo, historial de titularidad | Ejecución de la relación contractual de venta | **No** | Mientras exista la unidad |
| **Crear y mantener una cuenta de aficionado** | Correo, nombre para mostrar, contraseña con hash | Ejecución del contrato solicitado por la propia persona | **No**, pero la cuenta es voluntaria | Mientras exista la cuenta |
| **Registrar y transferir titularidad** | Cuenta, unidad, fechas, correo del destinatario en una invitación | Ejecución del contrato y de la garantía | **No** | Historial conservado (parte del certificado) |
| **Atender un caso de soporte** | Correo de contacto, texto del caso, unidad afectada | Ejecución del contrato y atención de la garantía | **No** | 730 días desde el cierre |
| **Atender una solicitud de derechos** | Datos de identificación necesarios para verificar la identidad | Cumplimiento de obligación legal | **No** | 1825 días (prueba de atención) |
| **Auditoría administrativa** | Actor interno, acción, entidad, IP truncada | Cumplimiento de obligación de trazabilidad e interés legítimo de seguridad | **No** | 1825 días |
| **Marketing directo de Marathon** | Correo, nombre | **Consentimiento** (`MARKETING`) | **Sí** | Mientras no se revoque; el registro 1825 días |
| **Ubicación aproximada** | Ciudad aproximada | **Consentimiento** (`LOCATION`) | **Sí** | Según la finalidad concreta; nunca coordenadas exactas |
| **Métricas para patrocinadores** | Actividad incluida en agregados | **Consentimiento** (`SPONSOR_ANALYTICS`) | **Sí** | Agregados sin sujeto, indefinido |
| **Contenido personalizado** | Historial de interacciones con las prendas propias | **Consentimiento** (`PERSONALIZATION`) | **Sí** | Mientras exista la cuenta |
| **Comunicaciones del club** | Correo, club de interés | **Consentimiento** (`CLUB_COMMUNICATIONS`) | **Sí** | Mientras no se revoque |

Las cinco últimas son exactamente las de `CONSENT_PURPOSES`. Todo lo anterior a
ellas se ejecuta sin consentimiento y está declarado como tal.

---

## 4. La analítica y su clasificación

`EVENT_DATA_CLASS` clasifica cada evento respecto al dato personal. Es la base
para decidir qué puede agregarse y qué no puede salir del sistema.

| Clase | Significado | Eventos |
|---|---|---|
| `AGGREGATE_ONLY` | Nunca se asocia a una persona identificada | `NFC_OPENED`, `QR_OPENED`, `CERTIFICATE_VIEWED`, `CONTENT_VIEWED` |
| `PSEUDONYMOUS` | Se asocia a un identificador seudónimo de sesión o dispositivo | `VERIFICATION_COMPLETED`, `QUIZ_COMPLETED` |
| `IDENTIFIED` | Requiere cuenta; la finalidad lo justifica y es auditable | `JERSEY_CLAIMED`, `REWARD_REDEEMED`, `TRANSFER_STARTED`, `TRANSFER_COMPLETED`, `SUPPORT_OPENED` |

La regla derivada: **ningún evento `IDENTIFIED` entra en
`SPONSOR_VISIBLE_EVENTS`**, y hay una prueba que lo comprueba. El razonamiento
está en el propio código: aunque la API devolviera únicamente el conteo, el
proceso que lo calcula atravesaría filas personales y cualquier filtro adicional
(por modelo, por día, por ciudad) podría reducir la cohorte hasta
individualizarla.

Las métricas de `SPONSOR_AGGREGATE_METRICS`
(`campaign_reward_redemptions`, `campaign_content_views`,
`campaign_quiz_completions`) sí derivan de eventos identificados, y precisamente
por eso se exponen como **contador precalculado** en `CampaignMetric`, no como
consulta. La separación es deliberada.

---

## 5. Verificar el jersey no requiere consentimiento ni cuenta

Es la decisión de privacidad más importante del proyecto.

### 5.1 Qué dice el código

```ts
export const FEATURES_WITHOUT_CONSENT: readonly string[] = [
  'verificar_jersey',
  'ver_certificado',
  'ver_estado_de_confianza',
  'abrir_caso_de_soporte',
  'consultar_garantia',
];
```

Estas cinco funcionalidades **jamás pueden condicionarse a un consentimiento**.
Hay una prueba que lo comprueba. La razón está escrita en el archivo: *el
consentimiento debe ser libre para ser válido.*

Y en la cabecera de `CONSENT_REQUIRED`:

> La verificación del producto NO aparece aquí a propósito: se ejecuta sin
> consentimiento y sin cuenta, amparada en el interés legítimo de comprobar la
> autenticidad de un producto propio y en la ejecución de la garantía. Un
> aficionado DEBE poder verificar su jersey sin aceptar nada.

### 5.2 Por qué es la base correcta

**No es consentimiento, y no debe serlo.** Un consentimiento solo es válido si es
libre. Si la única forma de comprobar que la prenda que acabas de comprar es
auténtica fuera aceptar marketing, el consentimiento estaría comprado con la
garantía: no sería libre y, por tanto, no sería válido. Construirlo así no solo
sería abusivo; produciría consentimientos inválidos y, con ellos, un tratamiento
de marketing sin base.

**Es interés legítimo, en dos direcciones.** Marathon tiene un interés legítimo
evidente en detectar falsificaciones de su producto. La persona que lee el chip
tiene un interés legítimo simétrico y más fuerte: saber si lo que compró es
genuino. La ponderación es favorable porque el tratamiento es mínimo (IP truncada
y seudonimizada, huella de baja entropía, código de país), temporal (180 días) y
no produce ninguna decisión sobre la persona.

**Y es ejecución de la garantía.** El veredicto y el certificado digital forman
parte de la prestación que se compra con la prenda. Tratar los datos necesarios
para entregarla no requiere consentimiento adicional.

### 5.3 Consecuencias prácticas

| Consecuencia | Detalle |
|---|---|
| El chip abre una URL, no una aplicación | No hay instalación, no hay permiso de sistema, no hay registro |
| La ruta pública de verificación no exige sesión | `optionalFan` carga la sesión **si existe** y continúa como anónimo si es inválida. El comentario del código lo dice: verificar un jersey nunca debe fallar porque caducó una sesión |
| No hay muro de registro antes del veredicto | Ni "regístrate para ver el resultado" ni "acepta para continuar" |
| Sin cuenta, no hay identidad que tratar | El evento de verificación es seudónimo |
| Abrir un caso de soporte tampoco exige cuenta | `SupportCase.fanId` es opcional y `contactEmail` obligatorio |
| Una solicitud de derechos tampoco exige cuenta | `PrivacyRequest.fanId` es opcional |

### 5.4 Dónde empieza lo demás

El límite es explícito: crear cuenta, reclamar titularidad, transferir y canjear
recompensas **sí** requieren cuenta, porque sin identidad esas operaciones no
tienen sentido. Pero ninguna de ellas es condición para verificar.

---

## 6. Separación de tratamientos

Cuatro tratamientos que la interfaz y el modelo de datos mantienen separados. Si
se fusionan, se pierde la validez del consentimiento y la trazabilidad de la base
legal.

| Tratamiento | Base | Requiere cuenta | Datos | Se puede negar sin perder nada |
|---|---|---|---|---|
| **1. Autenticación del producto** | Interés legítimo + garantía | No | IP truncada seudonimizada, huella de dispositivo, país | No aplica: no se pide nada |
| **2. Creación de cuenta** | Ejecución del contrato solicitado | Es la cuenta misma | Correo, nombre para mostrar, contraseña con hash | Sí: sin cuenta se sigue verificando |
| **3. Marketing** | Consentimiento `MARKETING` | Sí | Correo, nombre | Sí |
| **4. Ubicación** | Consentimiento `LOCATION` | Sí | Ciudad aproximada, nunca coordenadas | Sí: el contenido se muestra sin segmentación geográfica |
| **5. Comunicación con patrocinadores** | Consentimiento `SPONSOR_ANALYTICS` | Sí | Inclusión de la actividad en agregados | Sí |

Reglas que hacen operativa la separación:

1. **Una pantalla, una decisión.** El catálogo de consentimientos se presenta con
   una casilla por finalidad, sin preseleccionar ninguna y sin "aceptar todo"
   como única salida visible.
2. **El flujo de verificación no contiene ninguna casilla.** Si aparece una
   casilla en la pantalla de veredicto, el diseño está mal.
3. **Revocar una finalidad no afecta a las demás.** `Consent` es una fila por
   finalidad.
4. **Revocar `SPONSOR_ANALYTICS` no borra los agregados históricos**, porque un
   contador sin sujeto ya no contiene datos personales. Lo que cambia es que la
   actividad futura deja de alimentarlos. Esto debe decirse en el texto
   informativo.
5. **El patrocinador nunca es destinatario de un dato personal**, ni siquiera con
   consentimiento `SPONSOR_ANALYTICS`: ese consentimiento autoriza la
   *inclusión en un agregado*, no una cesión.

---

## 7. Supresión de cohortes pequeñas

```ts
export const MIN_AGGREGATE_COHORT_SIZE = 20;

export function suppressSmallCohort(count: number): number | null {
  return count >= MIN_AGGREGATE_COHORT_SIZE ? count : null;
}
```

### 7.1 Por qué existe

Un agregado con 1 o 2 sujetos no es un agregado: identifica a una persona. Si un
patrocinador puede ver "2 canjes de esta recompensa en Cuenca el martes", y sabe
por otra vía quién estuvo allí, la agregación no protegió nada. El umbral de 20
convierte el resultado en algo que no permite atribuir la acción a nadie en
concreto.

### 7.2 Cómo se aplica

| Capa | Qué hace |
|---|---|
| Trabajo de cálculo | Materializa `CampaignMetric` y marca `suppressed` cuando la cohorte está por debajo del umbral |
| Ruta del panel | Aplica `suppressSmallCohort` **otra vez** sobre el valor leído, y devuelve `null` si `suppressed` es verdadero |
| Respuesta al patrocinador | Incluye `minCohortSize` y una nota que explica que los valores por debajo del mínimo se muestran como `null` |

La doble aplicación es intencionada: la marca en la fila puede quedar obsoleta
tras un recálculo, y la función es barata.

### 7.3 Lo que este control **no** resuelve

Con honestidad: el umbral por celda no impide un **ataque diferencial**. Si un
patrocinador consulta la misma métrica día a día y una celda pasa de `null` a 20,
ha aprendido algo sobre la frontera. Y consultas sobre dimensiones solapadas
pueden combinarse.

Mitigaciones previstas y no implementadas:

- Redondeo de los valores publicados a múltiplos, no solo supresión.
- Supresión secundaria: ocultar también celdas adyacentes cuando una queda
  suprimida, para que no se deduzca por diferencia.
- Límite al número de recortes dimensionales simultáneos por consulta.

Hoy el control real es la **granularidad gruesa** de `CampaignMetric`
(`campaignId`, `metricKey`, `bucketDate`) y el hecho de que el patrocinador no
puede pedir cortes arbitrarios. Ver [limitaciones.md](limitaciones.md).

---

## 8. El patrocinador y los datos personales

Resumen de las cuatro barreras, detalladas en
[matriz-roles-permisos.md](matriz-roles-permisos.md):

1. El rol `SPONSOR` tiene dos permisos: `campaigns:read` y
   `analytics:campaign_scoped`.
2. `PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES` impide, con una prueba, que se le
   conceda `fans:read`, `ownership:read`, `chips:read`, `privacy:read` y otros.
3. La consulta del patrocinador lee contadores materializados, nunca la tabla de
   eventos.
4. La supresión de cohortes pequeñas se aplica antes de devolver el valor.

Formulación operativa para cuando llegue la petición comercial: **el patrocinador
recibe números, no personas.** Si una necesidad de patrocinio no puede satisfacerse
con un número agregado, la respuesta es no.

---

## 9. Derechos de la persona titular

`PRIVACY_REQUEST_TYPES` define los seis tipos que el sistema acepta.

| Derecho | Tipo en el código | Qué implica en este sistema |
|---|---|---|
| Acceso | `ACCESS` | Copia de los datos asociados a la cuenta: perfil, titularidades, consentimientos con su versión de texto, casos de soporte, y los eventos de verificación aún retenidos que estén vinculados a la cuenta |
| Rectificación | `RECTIFICATION` | Corrección del nombre para mostrar, del correo y, con intervención de soporte, de una titularidad mal registrada |
| Eliminación | `DELETION` | Marca `FanAccount.deletedAt` y un trabajo purga. Ver 9.3 |
| Oposición | `OPPOSITION` | Oposición a un tratamiento basado en interés legítimo. Ver 9.4 |
| Portabilidad | `PORTABILITY` | Entrega en formato estructurado y legible por máquina de los datos que la persona aportó y de su historial de titularidad |
| Retiro del consentimiento | `CONSENT_WITHDRAWAL` | Marca `revokedAt` en la finalidad indicada. Efecto inmediato sobre el tratamiento futuro |

### 9.1 Cómo se ejercen

| Vía | Ruta | Requiere cuenta |
|---|---|---|
| Formulario público | `POST /api/v1/privacy/requests` | **No**. `PrivacyRequest.fanId` es opcional |
| Panel de la persona | `GET` y `PUT /api/v1/fan/consents` | Sí, para el retiro directo de consentimientos |
| Soporte | `POST /api/v1/support/cases` | No |

El retiro de un consentimiento debe ser **tan fácil como concederlo**: se hace
desde la misma pantalla que lo otorga, con un solo cambio, sin escribir un correo
ni abrir un caso.

### 9.2 Tramitación

| Estado | Significado |
|---|---|
| `RECEIVED` | Registrada |
| `IDENTITY_PENDING` | Falta comprobar que quien pide es la persona titular |
| `IN_PROGRESS` | En ejecución |
| `COMPLETED` | Atendida |
| `REJECTED` | Rechazada, con motivo |

`PRIVACY_REQUEST_SLA_DAYS = 15`, y `PrivacyRequest.dueAt` materializa la fecha
límite. El comentario del código lo explica: es un **plazo interno más estricto
que el legal, para dar margen**. No es el plazo de la ley; es el de la casa.

**Verificación de identidad.** Es obligatoria y es un control de seguridad, no un
obstáculo: atender una solicitud de acceso sin comprobar la identidad convierte
el derecho de acceso en un canal de fuga. Se hace por el canal ya asociado a la
cuenta cuando existe cuenta, y con comprobación adicional cuando no. **El
procedimiento concreto de comprobación no está implementado todavía**; hoy el
estado `IDENTITY_PENDING` existe y la decisión es humana.

### 9.3 Qué se borra y qué no en una eliminación

| Dato | Comportamiento | Motivo |
|---|---|---|
| `FanAccount` | Borrado lógico (`deletedAt`) y purga posterior por trabajo | — |
| `Consent` | Cascada con la cuenta | El consentimiento muere con la cuenta |
| `FanSession` | Cascada | — |
| `Ownership` | Se cierra con `endedAt`; la fila se conserva desvinculada de la persona | El historial de titularidad forma parte del certificado de la unidad, que es un dato de la prenda, no de la persona |
| `VerificationEvent` | No se borra en el acto; se purga por retención (180 días) | Es seudónimo y sostiene la detección de fraude. El vínculo con la cuenta, si existía, se rompe |
| `AuditEvent` | **No se borra** | Solo-anexar. Es prueba de trazabilidad con base legal propia, y su retención es de 1825 días |
| `AnalyticsDaily`, `CampaignMetric` | No se tocan | No tienen sujeto |
| `SupportCase` | Se conserva hasta su plazo de retención, con los datos de contacto minimizados | Garantía y prueba de atención |

Hay que decirlo con claridad en la respuesta a la persona: **la eliminación de la
cuenta no borra el registro de auditoría ni el historial de la prenda**, y se
explica por qué. Prometer un borrado total que no se ejecuta es peor que explicar
el límite.

> **Estado de implementación:** el trabajo de purga que ejecuta la eliminación
> tras el borrado lógico **no está planificado**. Hoy la marca se pone y nada la
> consume. Ver [limitaciones.md](limitaciones.md).

### 9.4 Oposición al tratamiento por interés legítimo

Caso concreto: alguien se opone a que sus lecturas alimenten la detección de
abuso. La respuesta honesta es que esa oposición **no puede atenderse
suprimiendo el tratamiento**, porque sin `VerificationEvent` no hay verificación
posible: el evento se crea siempre, incluso cuando el token es desconocido, y sin
él el sistema no puede emitir un veredicto ni detectar enumeración.

Lo que sí puede ofrecerse: el tratamiento ya es mínimo y seudónimo, la retención
es de 180 días, y la persona puede dejar de leer el chip. Esta ponderación debe
documentarse antes del piloto por escrito y con revisión legal; aquí queda
declarada, no resuelta.

---

## 10. Registro de actividades de tratamiento

Insumo para el registro formal, derivado del código. No es el registro; es lo que
hay que trasladar a él.

| Tratamiento | Categorías de datos | Categorías de titulares | Destinatarios | Transferencia internacional | Plazo |
|---|---|---|---|---|---|
| Verificación de autenticidad | IP truncada seudonimizada, huella de dispositivo, país, idioma | Cualquier persona que lea un chip | Ninguno externo | Según proveedor de alojamiento | 180 días |
| Cuentas de aficionado | Correo, nombre para mostrar, hash de contraseña | Personas registradas | Proveedor de correo transaccional | Según proveedor | Vida de la cuenta |
| Titularidad y transferencias | Cuenta origen, correo destino, fechas | Personas registradas y personas invitadas | Proveedor de correo | Según proveedor | Historial conservado |
| Soporte | Correo de contacto, texto libre, unidad | Cualquier persona | Ninguno externo | Según proveedor | 730 días |
| Consentimientos | Finalidad, fechas, versión de texto | Personas registradas | Ninguno | Según proveedor | 1825 días |
| Auditoría | Actor, acción, entidad, IP truncada | Personal interno y aficionados | Ninguno | Según proveedor | 1825 días |
| Analítica agregada | Contadores sin sujeto | — | Patrocinadores (solo agregados) | Según proveedor | Indefinido |

Las columnas de transferencia internacional quedan pendientes a propósito: se
determinan al elegir el proveedor de alojamiento y **no deben rellenarse por
suposición**.

---

## 11. Alcance y límites de este documento

Lo que está aquí son **controles técnicos**. Lo que sigue **no está resuelto por
el código** y requiere trabajo jurídico y organizativo antes del piloto:

1. **Registro de la base de datos ante la autoridad de protección de datos.** No
   es algo que el software haga.
2. **Evaluación de impacto.** El tratamiento combina detección de fraude,
   seudonimización y perfilado opcional de contenido. La evaluación debe hacerla
   quien tenga competencia legal.
3. **Designación de la persona delegada de protección de datos**, si procede según
   el volumen y la naturaleza del tratamiento.
4. **Política de privacidad publicada y versionada**, coherente con
   `Consent.policyVersion`. El código guarda la versión; alguien tiene que
   escribir el texto y mantener el archivo histórico de versiones.
5. **Contratos con encargados**: alojamiento, base de datos, correo,
   observabilidad, y los propios clubes como corresponsables.
6. **Ponderación escrita del interés legítimo** para la verificación y la
   detección de abuso, con el análisis de necesidad y de impacto.
7. **Procedimiento de notificación de brechas**, con plazos, destinatarios y
   responsable. Ver [modelo-amenazas.md](modelo-amenazas.md).
8. **Procedimiento de verificación de identidad** para las solicitudes de
   derechos, hoy solo representado por un estado.
9. **Cláusulas para menores de edad.** Un jersey de club es un producto con
   demanda infantil evidente y el sistema **no contempla hoy** ninguna
   verificación de edad ni consentimiento de representante. Es una laguna que hay
   que cerrar antes de abrir el registro de cuentas.
10. **Ejecución efectiva de la retención.** Está declarada en `RETENTION_DAYS` y
    **no aplicada**: sin los trabajos de purga, la política es una intención.

> Repetido a propósito: este documento no es asesoría legal. Describe qué hace el
> software y dónde están sus límites, para que quien deba hacer el análisis
> jurídico parta de hechos y no de suposiciones.

---

## 12. Documentos relacionados

- [matriz-roles-permisos.md](matriz-roles-permisos.md)
- [politica-logs.md](politica-logs.md)
- [modelo-datos.md](modelo-datos.md)
- [arquitectura.md](arquitectura.md)
- [integracion-tienda.md](integracion-tienda.md)
- [modelo-amenazas.md](modelo-amenazas.md)
- [limitaciones.md](limitaciones.md)

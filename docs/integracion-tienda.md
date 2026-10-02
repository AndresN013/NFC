# Integración con la tienda electrónica

Cómo conectar la plataforma con la tienda electrónica de Marathon.

> **Estado.** No existe ninguna integración implementada. No hay receptor de
> webhooks, no hay cliente de la API de la tienda, no hay tarea de conciliación y
> no hay ninguna ruta que escriba `Ownership.acquiredVia = 'PURCHASE_IMPORT'`. El
> valor está declarado en el esquema y **nadie lo usa todavía**. Este documento
> define el diseño previsto y separa con precisión lo que existe de lo que falta.

---

## 1. Qué conecta con qué

| Sistema | Papel |
|---|---|
| Tienda electrónica de Marathon | Catálogo comercial, carrito, pago, facturación, envío |
| Marathon Escudo Vivo | Identidad de la unidad física, veredicto de confianza, certificado, titularidad, contenido |

No comparten base de datos y no deben compartirla. La tienda sabe de pedidos; la
plataforma sabe de unidades. Lo que hace falta es una **clave de correlación** y
unos pocos eventos bien definidos.

Hay una asimetría importante: la tienda vende un **SKU**, es decir un modelo en una
talla. La plataforma gestiona una **unidad física concreta**, con su chip y su
emblema. Un pedido de la tienda no dice qué unidad concreta se envió; eso lo sabe
el almacén al preparar el envío. Toda la integración gira alrededor de cerrar esa
brecha.

---

## 2. El SKU como clave de correlación

### 2.1 Qué es hoy

`Sku` en `apps/api/prisma/schema.prisma`:

| Campo | Restricción | Papel |
|---|---|---|
| `code` | **Único** | **La clave de correlación con la tienda electrónica** |
| `jerseyModelId` | — | Modelo al que pertenece |
| `size` | — | Talla |
| `priceCents` | Entero | Ecuador usa USD y el dinero no se representa con flotantes |

`Sku.code` es único en toda la base de datos. Es el único identificador que las dos
partes pueden compartir hoy sin inventar nada.

### 2.2 Dónde se usa ya

| Uso | Ruta | Detalle |
|---|---|---|
| Vinculación en planta | `POST /api/v1/production/units/link` | El cuerpo lleva `skuCode`; el servidor hace `db.sku.findUnique({ where: { code } })` y responde 404 si no existe |
| Ficha pública del certificado | `GET /api/v1/units/:handle/certificate` | Devuelve `size` derivada del SKU de la unidad |
| Listado de unidades del panel | `GET /api/v1/admin/units` | Devuelve `sku` como `code` y `size` |

La consecuencia es que **el `skuCode` que el operario introduce en planta tiene que
ser el mismo que la tienda usa en su catálogo**. Si divergen, se pierde la
correlación y no hay forma automática de recuperarla.

### 2.3 Requisitos sobre el código de SKU

| Requisito | Motivo |
|---|---|
| Único en ambos sistemas y **el mismo valor** | Es lo único que los une |
| Estable en el tiempo | Un SKU renombrado rompe la correlación de pedidos históricos |
| Sin caracteres ambiguos ni espacios significativos | Se teclea en planta desde un teléfono |
| Legible por una persona | El operario lo introduce; un UUID sería inviable |
| Una talla por SKU | Si un SKU cubre varias tallas, la ficha del certificado será incorrecta |

La fuente de verdad del catálogo debe ser **una sola**, y lo razonable es que sea la
tienda: es donde nacen los productos comercialmente. La plataforma importa el
catálogo de SKU desde la tienda y no los crea a mano. **Esa importación no existe
hoy**: no hay ruta de `catalog:write`, así que los SKU se cargan por
`prisma/seed.ts`.

### 2.4 Lo que el SKU no puede hacer

El SKU identifica un modelo y una talla, **no una unidad**. Un pedido de "camiseta
local talla M" no dice qué `publicRef` se envió. Por tanto:

- El SKU permite decir "este pedido corresponde a este modelo".
- **No** permite decir "este pedido corresponde a esta unidad".

Para lo segundo hay que capturar el `publicRef` o el código del emblema **en el
momento del envío**, en el almacén. Ver 4.

---

## 3. Activación al vender

### 3.1 Qué existe

`POST /api/v1/production/units/:unitId/activate`, con permiso
`production:activate`. Hoy la ejecuta una persona desde producción o
administración. El efecto:

1. Valida la transición del chip a `ACTIVATED`: solo se activa lo que superó el
   control posterior al calor.
2. Pone el chip y la unidad en `ACTIVATED` con `activatedAt`.
3. Crea el `DigitalCertificate` si no existía, con `serial` derivado del
   `publicRef` y **`signature: null`**, porque la firma con clave custodiada está
   pendiente.
4. Audita `production.unit.activated`.
5. Devuelve `unitId`, `publicRef`, estado y fecha.

Antes de la activación, una lectura pública devuelve `NOT_ACTIVATED` y suma 15
puntos de riesgo. Es lo que impide que un emblema robado de la línea produzca un
veredicto favorable.

### 3.2 Las dos estrategias posibles

| Estrategia | Cuándo se activa | Ventaja | Inconveniente |
|---|---|---|---|
| **A. Activar al salir de producción** | Tras `POST_PRESS_PASSED`, antes de enviar a tienda | Simple; la prenda funciona desde que existe | Una prenda robada del almacén o en tránsito verifica como si fuera legítima |
| **B. Activar al vender** | Cuando la tienda confirma el pago | Una prenda robada antes de la venta devuelve `NOT_ACTIVATED` | Exige integración fiable; un fallo deja al cliente con un jersey que no verifica |

**La estrategia B es la correcta desde el punto de vista de seguridad**, y es la que
justifica que exista el estado `NOT_ACTIVATED` y que sume riesgo. Requiere que la
integración sea muy fiable, porque el modo de fallo es visible para el cliente y
llega directo a soporte.

Punto intermedio recomendado: activar al vender, y dar a soporte una vía de
activación manual con motivo registrado para resolver casos en el momento. Esa vía
ya existe técnicamente (`production:activate`), pero soporte **no** tiene ese
permiso: hoy la escalada sería a `MARATHON_ADMIN`.

### 3.3 El problema de la venta en tienda física

Una venta en mostrador no pasa por la tienda electrónica. Si se elige la estrategia
B, hace falta un camino para el punto de venta físico:

- Un puesto con acceso a una acción de activación, que hoy exigiría
  `production:activate`, un permiso demasiado amplio para un mostrador.
- O un rol nuevo de punto de venta con un permiso estrecho de activación, que no
  existe en `ROLES`.

**Decisión pendiente** antes del piloto. Si el piloto es solo de venta en línea, se
puede posponer; si incluye tienda física, no.

---

## 4. Importación de propiedad tras la compra

### 4.1 El valor declarado

`Ownership.acquiredVia` admite tres valores:

| Valor | Significado | Implementado |
|---|---|---|
| `CLAIM` | El aficionado reclamó la prenda tras verificarla | **Sí**, en `POST /api/v1/fan/claims` |
| `TRANSFER` | Llegó por una transferencia aceptada | **Sí**, en las rutas de transferencia |
| `PURCHASE_IMPORT` | Se importó desde un registro de compra | **No. Ningún código lo escribe** |

### 4.2 Cómo funciona `CLAIM` hoy, y por qué importa

`POST /api/v1/fan/claims` exige:

1. Sesión de aficionado.
2. `unitHandle` y `eventRef`, la referencia de un `VerificationEvent`.
3. Que el evento sea **de la misma unidad**.
4. Que el evento tenga **menos de 30 minutos**. El comentario del código lo explica:
   *demuestra tenencia física ahora, no en algún momento del pasado*.
5. Que el nivel de confianza del evento sea `VERIFIED` o `IDENTIFIED_ONLY`.
6. Que la unidad esté en `ACTIVATED` o `SOLD`.

El índice único parcial `Ownership_active_unique` garantiza que dos reclamos
concurrentes no creen dos titularidades activas; la segunda recibe 409.

**La propiedad por reclamo se apoya en la tenencia física.** Eso es lo que hace que
sea razonablemente segura: quien no tiene la prenda en la mano no puede reclamarla.

### 4.3 Por qué `PURCHASE_IMPORT` es distinto, y más delicado

Una importación por compra crea una titularidad **sin prueba de tenencia física**.
Se apoya en una afirmación de otro sistema: "esta cuenta compró esta unidad". Si esa
afirmación es manipulable, se puede asignar la titularidad de una prenda ajena.

Reglas mínimas que el flujo debe cumplir:

| Regla | Motivo |
|---|---|
| El origen debe ser **servidor a servidor**, autenticado, nunca una llamada del navegador del cliente | Un cliente puede falsificar cualquier cosa que su navegador envíe |
| Debe identificar una **unidad concreta** (`publicRef` o código de emblema), no solo un SKU | Un SKU no identifica la unidad |
| Debe identificar la cuenta por el **correo verificado** del pedido | Si el correo no está verificado, la titularidad se asigna a quien lo escribió |
| Debe ser **idempotente** por identificador de pedido | Un webhook se reintenta; una titularidad no debe duplicarse |
| Debe respetar `Ownership_active_unique` | Si ya hay titular, la importación **no** lo desplaza: abre un caso de soporte |
| Debe quedar auditada con el identificador del pedido | Trazabilidad de por qué existe esa titularidad |
| Debe poder revertirse por soporte | Una devolución cierra la titularidad con `endedAt` |

Regla dura: **una importación por compra nunca desplaza a un titular activo.** Si la
unidad ya tiene titular, el sistema abre un caso de soporte y una persona decide. El
escenario es real: el comprador la regaló, el destinatario la reclamó, y después
llega el webhook del pedido.

### 4.4 El eslabón que falta: qué unidad se envió

Para importar propiedad hace falta saber qué unidad concreta salió en el pedido. Las
opciones:

| Opción | Cómo | Coste | Fiabilidad |
|---|---|---|---|
| **Captura en el almacén** | Al empaquetar, se lee el chip o se escanea el código del emblema y se asocia al pedido | Un puesto de lectura en logística | Alta |
| **Captura del código impreso** | Se teclea o escanea el `Emblem.code` | Bajo, propenso a error humano | Media |
| **Reclamo del cliente** | No se importa nada; el cliente reclama con `CLAIM` tras verificar | **Cero coste de integración** | Alta, pero depende de que el cliente lo haga |
| **Inferencia por SKU** | Asignar cualquier unidad del SKU vendido | Trivial | **Inaceptable.** Asignaría una unidad que está en otro pedido |

La última hay que descartarla explícitamente porque es la tentación obvia.

**Recomendación para el piloto: no importar propiedad.** Dejar que el cliente
reclame con `CLAIM`, que ya está implementado y se apoya en tenencia física. La
importación por compra es una comodidad que introduce un vector de suplantación y
exige un puesto de captura en logística. Con 1.000 unidades, el reclamo funciona.

---

## 5. Webhooks previstos

Ninguno está implementado. Diseño propuesto.

### 5.1 De la tienda hacia la plataforma

| Evento | Cuándo | Efecto previsto | Idempotencia |
|---|---|---|---|
| `order.paid` | Pago confirmado | Si se conoce la unidad, activarla. Si no, encolar pendiente de captura en almacén | Por identificador de pedido |
| `order.fulfilled` | Envío preparado, con la unidad capturada | Asociar `publicRef` al pedido; activar si no lo estaba | Por identificador de pedido y línea |
| `order.cancelled` | Pedido anulado antes del envío | Revertir la activación si la hubo | Por identificador de pedido |
| `order.refunded` | Devolución | Cerrar la titularidad importada con `endedAt`. Decidir si la unidad se revoca | Por identificador de devolución |
| `customer.email_verified` | Correo verificado | Prerrequisito para importar propiedad | — |
| `catalog.sku.upserted` | Alta o cambio de SKU | Sincronizar `Sku` | Por `code` y versión |

### 5.2 De la plataforma hacia la tienda

| Evento | Cuándo | Para qué |
|---|---|---|
| `unit.activated` | Unidad activada | La tienda puede mostrar el enlace al certificado |
| `unit.revoked` | Unidad revocada | Detener la venta de una unidad retirada |
| `batch.flagged` | Lote marcado | Aviso de calidad al equipo comercial |

### 5.3 Requisitos técnicos del receptor

Nada de esto existe y todo es necesario:

| Requisito | Detalle |
|---|---|
| Autenticación | Firma HMAC de la carga con secreto compartido, verificada **antes** de interpretar el cuerpo. El secreto va en el gestor de secretos, no en `.env` versionado |
| Comparación en tiempo constante | La verificación de la firma no debe filtrar información por tiempo |
| Idempotencia | Reutilizar `apps/api/src/lib/idempotency.ts`. El identificador del evento de la tienda es la clave natural; `IdempotencyRecord` tiene TTL de 48 h, que hay que revisar frente a la ventana de reintentos de la tienda |
| Tolerancia al desorden | Los webhooks llegan desordenados. `order.refunded` puede llegar antes que `order.paid` |
| Reintentos y cola de fallidos | Un webhook rechazado no se pierde: se reintenta y, si sigue fallando, queda en una cola visible para operaciones |
| Límite de peticiones propio | Ver 5.4 |
| Lista blanca de origen | Si la tienda publica sus rangos de IP, restringir. No sustituye la firma |
| Auditoría | Cada webhook procesado deja entrada en `AuditEvent` con el identificador del pedido, nunca con la carga completa |
| Sin datos de pago | La plataforma **no** recibe ni almacena datos de tarjeta, ni los últimos dígitos, ni el identificador de la transacción del procesador |

### 5.4 Advertencia sobre el límite de peticiones

El MVP **no despliega Redis**: la limitación es **en memoria del proceso**
(`@fastify/rate-limit` con el almacén por defecto). Con más de una instancia de API,
cada proceso cuenta por su cuenta.

Para un receptor de webhooks esto tiene dos consecuencias:

1. El límite efectivo se multiplica por el número de instancias.
2. Un límite mal calibrado puede **rechazar webhooks legítimos** durante un pico de
   ventas, con pérdida de eventos si la tienda no reintenta lo suficiente.

La ruta de webhooks debe tener su propio límite, calibrado con el pico de pedidos
esperado y con margen amplio. Ver [arquitectura.md](arquitectura.md) y
[limitaciones.md](limitaciones.md).

### 5.5 Alternativa sin webhooks

Si integrar webhooks resulta caro o la tienda no los ofrece con garantías:
**consulta periódica**. Una tarea que consulta los pedidos pagados desde la última
marca y aplica los mismos efectos.

| Ventaja | Inconveniente |
|---|---|
| No expone endpoint público | Latencia de un ciclo |
| No exige verificación de firma | Hay que gestionar el cursor y su persistencia |
| Reintento trivial | Carga sobre la API de la tienda |

Para un piloto de 1.000 unidades, una consulta cada pocos minutos es probablemente
suficiente y **claramente más sencilla de operar** que un receptor de webhooks
robusto.

---

## 6. Qué existe hoy y qué falta

### 6.1 Existe

| Pieza | Estado |
|---|---|
| `Sku.code` único como clave de correlación | Implementado |
| Uso de `skuCode` en la vinculación de planta | Implementado |
| Talla del SKU en el certificado público | Implementado |
| `POST /production/units/:unitId/activate` con idempotencia y auditoría | Implementado |
| Creación del `DigitalCertificate` al activar | Implementado, **sin firma** |
| Estado `NOT_ACTIVATED` con 15 puntos de riesgo | Implementado |
| Reclamo por tenencia física (`CLAIM`) con ventana de 30 minutos | Implementado |
| `Ownership_active_unique` como garantía de un solo titular activo | Implementado |
| Valor `PURCHASE_IMPORT` en el esquema | Declarado, **sin usar** |
| Infraestructura de idempotencia reutilizable | Implementada |

### 6.2 Falta

| Pieza | Impacto si no se hace |
|---|---|
| Receptor de webhooks | Sin activación automática al vender |
| Verificación de firma HMAC | Sin ella, cualquiera activaría o importaría propiedad |
| Cliente de la API de la tienda | Sin consulta periódica como alternativa |
| Sincronización de catálogo de SKU | Los SKU se cargan a mano y divergen |
| Ruta de `catalog:write` | No se pueden crear SKU desde el panel |
| Captura de la unidad en el almacén | No se sabe qué unidad se envió; la importación de propiedad es imposible |
| Ruta que escriba `PURCHASE_IMPORT` | El valor del esquema no se usa |
| Reversión por devolución | Una devolución deja la titularidad abierta |
| Camino de activación para tienda física | Las ventas en mostrador quedan sin activar |
| Rol de punto de venta | Activar exigiría un permiso demasiado amplio para un mostrador |
| Cola de webhooks fallidos y observabilidad | Los eventos perdidos no se detectan |
| Conciliación periódica | Las divergencias entre tienda y plataforma no se detectan |
| Firma del certificado digital | `signature` es `null`; el certificado no es verificable fuera del sistema |

### 6.3 Orden razonable de implementación

1. Sincronización de catálogo de SKU. Sin catálogo coherente, nada más funciona.
2. Consulta periódica de pedidos pagados, más simple que los webhooks.
3. Activación al vender por SKU y pedido, con activación manual de respaldo.
4. Conciliación e informe de divergencias.
5. Captura de la unidad en el almacén.
6. Importación de propiedad (`PURCHASE_IMPORT`), solo cuando 5 sea fiable.
7. Webhooks, si la latencia de la consulta periódica resulta insuficiente.

---

## 7. Privacidad al cruzar datos de compra con la plataforma

Es la parte de la integración que puede deshacer las garantías del resto del
sistema. Ver [privacidad-lopdp.md](privacidad-lopdp.md).

### 7.1 El riesgo concreto

Hoy la plataforma tiene una propiedad valiosa: **verificar un jersey es anónimo**. No
hay cuenta, y el evento de verificación es seudónimo. Si la integración con la
tienda permite unir un pedido con eventos de verificación, esa propiedad
desaparece: un `ipPseudonym` que era anónimo pasa a ser "la persona que compró el
pedido número X".

El cruce no lo hace ninguna consulta por sí sola: lo hace el **hecho de que ambos
datos existan en el mismo sistema con una clave común**.

### 7.2 Reglas de diseño

| Regla | Justificación |
|---|---|
| **No importar de la tienda más datos de los necesarios** | Para activar hace falta el SKU o el `publicRef` y el identificador de pedido. **No** hace falta dirección de envío, ni teléfono, ni importe, ni método de pago |
| **Nunca datos de pago** | Ni tarjeta, ni últimos dígitos, ni identificador de transacción. El alcance de una brecha crece de forma desproporcionada |
| **El identificador de pedido se guarda como referencia opaca** | En `AuditEvent.metadata` bajo una clave permitida (`referenceId`), sujeta al saneador de `lib/audit.ts` |
| **No crear cuenta de aficionado automáticamente al comprar** | Crear cuenta es un tratamiento distinto, con su propia base. Comprar no es pedir una cuenta. Si se quiere ofrecer, se invita; no se crea |
| **No usar el correo del pedido para marketing** | El correo llega por ejecución del contrato de venta. El marketing exige consentimiento `MARKETING` otorgado en la plataforma, con su `policyVersion` |
| **No unir eventos de verificación con pedidos en ninguna consulta ni informe** | Es el cruce que rompe el anonimato de la verificación |
| **No enviar nada de la compra a patrocinadores** | Un patrocinador recibe contadores agregados. Un dato de compra no es un contador agregado |
| **No exportar la unión de ambos conjuntos** | Ninguna exportación debe contener a la vez identificador de pedido y datos de verificación |

### 7.3 Qué cruce sí es legítimo

| Cruce | Base | Límite |
|---|---|---|
| Pedido → unidad, para activar | Ejecución del contrato de venta | Solo el identificador de pedido y la unidad |
| Pedido → titularidad, con correo verificado | Ejecución del contrato y de la garantía | No desplaza a un titular activo |
| Devolución → cierre de titularidad | Ejecución del contrato | — |
| Pedido → caso de soporte sobre la garantía | Atención de la garantía | Con caso abierto que lo justifique |

El criterio: **el cruce se justifica por la garantía o por la ejecución de la venta,
nunca por conocer mejor al cliente.** Lo segundo es una finalidad distinta y
requiere su propia base.

### 7.4 Consecuencias sobre los roles

Una vez existan datos de compra en la plataforma, hay que revisar:

- **Qué rol los ve.** Probablemente `SUPPORT` con un caso abierto, y
  `MARATHON_ADMIN`. No `CLUB_ADMIN`, no `CONTENT_AGENCY`, no `SPONSOR`.
- **Si hace falta un permiso nuevo**, del tipo `orders:read`, en lugar de colgarlos
  de `ownership:read`. Un permiso nuevo es preferible a ensanchar uno existente:
  ensanchar `ownership:read` cambiaría el alcance del rol `SUPPORT` sin que nadie
  lo revise.
- **Si `PERMISSIONS_FORBIDDEN_FOR_EXTERNAL_ROLES` debe incluirlo.** Sí, en cuanto
  exista.

### 7.5 Registro de actividades

La integración añade un tratamiento nuevo que hay que reflejar en el registro de
actividades de tratamiento: *"correlación de pedidos con unidades para activación y
garantía"*, con sus categorías de datos, su base legal (ejecución del contrato), su
plazo y sus destinatarios. Ver [privacidad-lopdp.md](privacidad-lopdp.md) sección
10.

---

## 8. Criterios de aceptación de la integración

Antes de considerarla terminada:

### 8.1 Correlación

- [ ] Todo SKU de la tienda existe en `Sku` con el mismo `code`.
- [ ] Un SKU que no existe en la plataforma produce un error visible, no un pedido
      silenciosamente inactivado.
- [ ] Un informe de divergencias de catálogo se ejecuta y se revisa periódicamente.

### 8.2 Activación

- [ ] Un pedido pagado activa la unidad correspondiente en un plazo acordado.
- [ ] Un webhook o una consulta repetida no activa dos veces, verificado con prueba.
- [ ] Un pedido cancelado antes del envío revierte la activación.
- [ ] Existe activación manual con motivo registrado para resolver incidencias.
- [ ] Un fallo de la integración es visible en menos de un ciclo, no se descubre por
      una reclamación de cliente.

### 8.3 Propiedad

- [ ] `PURCHASE_IMPORT` solo se escribe desde un origen autenticado servidor a
      servidor.
- [ ] Nunca desplaza a un titular activo; abre un caso de soporte.
- [ ] Solo con correo verificado del pedido.
- [ ] Una devolución cierra la titularidad con `endedAt`.
- [ ] Toda importación queda auditada con el identificador de pedido.

### 8.4 Seguridad

- [ ] Verificación de firma HMAC antes de interpretar el cuerpo, con comparación en
      tiempo constante.
- [ ] El secreto vive en el gestor de secretos, no en un archivo versionado.
- [ ] Una carga con firma inválida se rechaza y se registra sin volcar el cuerpo.
- [ ] Límite de peticiones propio, calibrado con el pico de ventas esperado.
- [ ] Ningún dato de pago entra en la plataforma.

### 8.5 Privacidad

- [ ] Ninguna consulta, informe o exportación une eventos de verificación con
      pedidos.
- [ ] Ningún rol externo accede a datos de compra.
- [ ] El correo del pedido no se usa para marketing sin consentimiento otorgado en
      la plataforma.
- [ ] No se crea cuenta de aficionado automáticamente al comprar.
- [ ] El tratamiento está reflejado en el registro de actividades.

---

## 9. Documentos relacionados

- [modelo-datos.md](modelo-datos.md)
- [arquitectura.md](arquitectura.md)
- [privacidad-lopdp.md](privacidad-lopdp.md)
- [matriz-roles-permisos.md](matriz-roles-permisos.md)
- [protocolo-programacion.md](protocolo-programacion.md)
- [plan-gestion-claves.md](plan-gestion-claves.md)
- [piloto-a-produccion.md](piloto-a-produccion.md)
- [limitaciones.md](limitaciones.md)

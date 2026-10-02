# Protocolo de termosellado

Procedimiento de la estación de prensa y del control posterior al calor. Es el
paso del proceso donde un chip correctamente programado puede dejar de funcionar
sin que nadie lo note hasta que el aficionado acerca el teléfono.

Corresponde a los estados `READY_FOR_HEAT_PRESS → POST_PRESS_PASSED` de
`packages/domain/src/states.ts`, a la entidad `PostPressCheck` y a la ruta
`POST /api/v1/production/units/:unitId/post-press`.

> **Estado.** El registro de la comprobación está implementado. **Los parámetros
> de la receta de termosellado no están determinados**: dependen del adhesivo, del
> tejido, del emblema y del modelo de prensa, y deben establecerse
> experimentalmente antes del piloto. Este documento define **qué se registra y
> cómo se decide**, no qué temperatura usar. Ver
> [pruebas-fisicas.md](pruebas-fisicas.md).

---

## 1. Por qué este paso tiene protocolo propio

Un módulo NFC es una antena de cobre o aluminio muy fina y un troquel de silicio
unidos por dos soldaduras. El termosellado le aplica, simultáneamente,
temperatura, presión mecánica y tiempo. Los modos de fallo conocidos en este tipo
de montaje son:

| Modo de fallo | Efecto en la lectura |
|---|---|
| Rotura de una pista de la antena por deformación | El chip deja de responder |
| Fallo de una soldadura entre antena y troquel | Respuesta intermitente o nula |
| Desintonización de la antena por deformación del sustrato | Distancia de lectura reducida, lectura errática |
| Daño en el silicio por temperatura o presión | Respuesta corrupta o nula |
| Corrupción parcial de la memoria | El chip responde pero el NDEF no es el grabado |

El último es el más peligroso: el chip **responde**, así que una comprobación
superficial parece correcta. Por eso el criterio no es "el chip responde", sino
"el chip responde **y** el contenido es exactamente el grabado". Es la distinción
entre `readable` y `contentIntact`.

No se listan aquí valores umbral de temperatura o presión tolerados por el módulo:
**ese dato lo aporta el fabricante del inlay** y debe verificarse con hardware. Ver
sección 8.

---

## 2. Parámetros a registrar

Los tres primeros son los campos que la API acepta y persiste en `PostPressCheck`.

| Parámetro | Campo en la API | Tipo y rango aceptado | Origen del valor |
|---|---|---|---|
| Temperatura | `temperatureC` | Entero, 0 a 400 | Lectura del instrumento, no la consigna del panel |
| Presión | `pressureBar` | Decimal, 0 a 100 (`Decimal(6,2)`) | Manómetro o ajuste calibrado de la prensa |
| Tiempo | `durationSec` | Entero, 0 a 600 | Temporizador de la prensa |
| Legibilidad posterior | `readable` | Booleano, **obligatorio** | Lectura NFC tras la prensa |
| Integridad del contenido | `contentIntact` | Booleano, **obligatorio** | Comparación del URI releído |
| Detalle | `detail` | Texto, hasta 1000 caracteres | Observación del operario |

Registrados automáticamente por el servidor: `operatorId`, `deviceId`,
`providerId`, `simulated`, `passed` y la marca de tiempo.

**Temperatura medida frente a temperatura de consigna.** El valor que se registra
debe ser el **medido en la placa**, no el que muestra el panel de la prensa. La
diferencia entre ambos es el defecto más común en prensas mal mantenidas y es
exactamente lo que este registro permite detectar a posteriori.

### 2.1 Parámetros que hay que controlar y que la API no persiste

No hay campo para ellos: van al registro de lote de la estación y, si son
relevantes para una unidad concreta, al campo `detail`.

| Parámetro | Por qué importa |
|---|---|
| Identificador de la prensa | Correlacionar fallos con una máquina concreta |
| Posición del emblema en la placa | Una placa con zonas frías produce fallos agrupados por posición |
| Material de protección intermedio (papel siliconado, teflón, espuma) | Cambia la transmisión de calor y la distribución de presión |
| Tipo de adhesivo y referencia del lote de adhesivo | Es la variable que justifica la receta |
| Composición y gramaje del tejido | Un tejido técnico fino transmite calor de forma distinta |
| Tiempo de enfriamiento antes de manipular | Manipular caliente puede deformar el módulo ya sellado |
| Número de ciclos de la prensa en el turno | Una prensa recién encendida no está en régimen |
| Temperatura ambiente y humedad | Afectan al tiempo de puesta en régimen |

Recomendación: añadir estos campos al modelo de `PostPressCheck` antes del piloto,
o al menos un `stationId` y una referencia de receta. Hoy solo `detail` los puede
contener, y el texto libre no es consultable de forma fiable. Ver
[limitaciones.md](limitaciones.md).

---

## 3. Lectura antes de la prensa

### 3.1 Por qué es obligatoria

Sin una lectura inmediatamente anterior a la prensa no se puede atribuir un fallo
posterior al calor. Si el chip ya estaba mal antes, el termosellado carga con una
culpa que no es suya, la receta se ajusta sobre un diagnóstico falso y el problema
real —programación, manipulación, transporte— sigue sin resolverse.

### 3.2 Procedimiento

1. Confirmar que el chip está en `LINKED` o `READY_FOR_HEAT_PRESS`.
2. Leer con el teléfono autorizado. Se ejecuta `readVerificationPayload`.
3. Comprobar que se obtiene un mensaje NDEF válido y que el URI es el esperado.
4. Anotar la posición del emblema en la placa antes de cerrar la prensa.

| Resultado | Acción |
|---|---|
| Legible y URI correcto | Continuar a la prensa |
| No legible | **Cuarentena.** El fallo es anterior al calor y debe investigarse como tal |
| Legible con URI distinto del esperado | **Cuarentena + escalada.** Indica manipulación entre la programación y la prensa |

Esta lectura **no** se registra como `PostPressCheck`: esa entidad es del control
posterior. Se anota en el registro de la estación.

---

## 4. Lectura después de la prensa

### 4.1 Tiempo de espera

La lectura se hace **después del enfriamiento**, no con la unidad caliente. Dos
razones: manipular caliente puede deformar el montaje que acaba de sellarse, y una
antena caliente puede comportarse de forma distinta a su estado estable, lo que
produce lecturas no representativas.

El tiempo de enfriamiento concreto debe determinarse experimentalmente y fijarse
como parámetro de la estación. **No se propone aquí un número**: depende del
adhesivo, del tejido y de la masa térmica de la placa.

### 4.2 Procedimiento

1. Dejar enfriar la unidad el tiempo establecido.
2. Leer con el teléfono autorizado, que ejecuta `runPostPressCheck` con el URI
   esperado. El proveedor devuelve:

   | Campo | Significado |
   |---|---|
   | `readable` | Se obtuvo un mensaje NDEF válido |
   | `contentIntact` | El URI leído es exactamente el esperado |
   | `signalStrength` | **Siempre `null`.** Android no expone RSSI para NFC. No se inventa un valor |
   | `detail` | Texto explicativo del proveedor |

3. Reportar a `POST /api/v1/production/units/:unitId/post-press` con
   `Idempotency-Key`, junto con los tres parámetros de la prensa.

### 4.3 Qué hace el servidor

```
passed = readable && contentIntact
```

| `passed` | Chip | Unidad | Mensaje |
|---|---|---|---|
| `true` | `POST_PRESS_PASSED` | `READY` | "Prueba superada. La unidad puede activarse." |
| `false` | `QUARANTINED` | `QUARANTINED` | "La unidad no superó la prueba y pasó a cuarentena." |

Se crea un `PostPressCheck` **siempre**, también cuando falla. El registro del
fallo es más valioso que el del éxito: es lo que permite ajustar la receta.

La marca `simulated` se conserva deliberadamente: una prueba simulada no debe
confundirse nunca con una prueba física real, ni hoy ni dentro de dos años al
revisar el histórico.

### 4.4 Sobre la ausencia de intensidad de señal

`signalStrength` es `null` porque Android no expone RSSI para NFC. Consecuencia
práctica: **no se puede medir la degradación parcial** de la antena por este
canal. Un chip que antes se leía a 20 mm y después de la prensa solo a 3 mm da
`readable: true` y `contentIntact: true`, y pasa la prueba, aunque su
comportamiento en manos del aficionado sea malo.

Sustituto propuesto, y no implementado: medir la **distancia máxima de lectura**
con una guía física graduada, como magnitud manual comparable antes y después.
Ver el ensayo de distancia y orientación en
[pruebas-fisicas.md](pruebas-fisicas.md).

---

## 5. Criterios de aprobación y rechazo

### 5.1 Por unidad

**Aprobación.** Las tres condiciones, sin excepción:

1. `readable = true`: el chip responde con un mensaje NDEF válido.
2. `contentIntact = true`: el URI releído es **exactamente** el grabado.
3. Los tres parámetros de la prensa están dentro de la receta establecida y se han
   registrado con valores medidos.

**Rechazo.** Cualquiera de estas:

| Causa | Gravedad |
|---|---|
| `readable = false`: el chip no responde | Fallo de hardware |
| `readable = true`, `contentIntact = false` | **El más grave.** El chip responde y el contenido cambió: corrupción de memoria |
| Deformación, ampolla, delaminación o quemadura visible | Rechazo por inspección visual, con independencia de la lectura |
| Parámetro de la prensa fuera de receta | Rechazo por proceso, aunque la lectura sea correcta |
| Adhesión insuficiente: el emblema se levanta en un borde | Rechazo, y probable repetición del sellado según el criterio de calidad del tejido |

La cuarta merece énfasis: **una unidad sellada fuera de receta se rechaza aunque
lea perfectamente.** Si se acepta, el registro de `PostPressCheck` deja de ser
comparable y se pierde la capacidad de correlacionar fallos futuros con la receta.
Un chip dañado de forma marginal por un exceso de temperatura puede leer hoy y
fallar tras diez lavados.

### 5.2 Criterios por turno o lote

Señales de proceso fuera de control, independientes de la unidad individual:

| Señal | Interpretación | Acción |
|---|---|---|
| Fallos agrupados en la misma posición de la placa | Zona caliente o fría, o presión desigual | Detener la prensa. Mapear la placa |
| Fallos agrupados en el mismo lote de chips | Problema del proveedor, no de la prensa | Marcar el lote (`ProductionBatch.flagged`) |
| Fallos agrupados en las primeras unidades del turno | Prensa no en régimen | Ajustar el protocolo de puesta en marcha y descartar las primeras unidades |
| Tasa de rechazo por encima del umbral acordado con calidad | Proceso fuera de control | Detener y revisar receta y calibración |
| Aumento progresivo de rechazos a lo largo del turno | Deriva térmica o desgaste del material intermedio | Sustituir el material intermedio y recalibrar |

Los umbrales numéricos de tasa de rechazo aceptable **deben fijarse con el plan de
calidad de la planta**. No se inventan aquí.

---

## 6. Muestreo por lote

### 6.1 Control al 100 %

La comprobación posterior al termosellado **se hace en todas las unidades**, sin
muestreo. La razón es económica antes que técnica: el coste marginal de la
comprobación es acercar un teléfono unos segundos, y el coste de un falso negativo
es una prenda vendida con un chip muerto y una reclamación de garantía.

El muestreo se aplica a los **ensayos destructivos y de larga duración**, que por
definición no pueden hacerse al 100 %.

### 6.2 Qué se muestrea

| Ensayo | Naturaleza | Frecuencia propuesta |
|---|---|---|
| Comprobación posterior al calor (`PostPressCheck`) | No destructiva | **100 %** |
| Inspección visual de adhesión | No destructiva | **100 %** |
| Distancia máxima de lectura con guía graduada | No destructiva, más lenta | Muestra por turno y por prensa |
| Lavado por ciclos | Consume la prenda | Muestra por lote |
| Tracción y pelado del emblema | Destructivo | Muestra por lote |
| Flexión y torsión repetidas | Degradante | Muestra por lote |
| Envejecimiento acelerado | Muy lento | Muestra por receta, no por lote |

Los tamaños de muestra propuestos están en
[pruebas-fisicas.md](pruebas-fisicas.md). Son propuestas de protocolo, **no
resultados**: ningún ensayo físico se ha ejecutado todavía.

### 6.3 Muestreo de arranque

Al inicio de cada turno y tras cada cambio de receta, adhesivo, tejido o material
intermedio: sellar unidades de prueba, someterlas al control completo y no
producir hasta que todas pasen. Las unidades de arranque se rotulan como material
de prueba y **no entran en el flujo comercial**, con independencia de que pasen.

---

## 7. Tratamiento de las unidades que fallan

### 7.1 Efecto inmediato

El fallo pasa chip y unidad a `QUARANTINED` de forma automática. La unidad sale
físicamente del flujo y va a la bandeja de cuarentena, que está separada de la de
producto conforme.

### 7.2 Diagnóstico antes de decidir

Antes de resolver la cuarentena hay que responder tres preguntas. El `PostPressCheck`
está diseñado para poder responderlas.

| Pregunta | Cómo se responde |
|---|---|
| ¿Estaba bien el chip antes de la prensa? | Lectura previa registrada en la estación (sección 3) |
| ¿Estuvo la prensa dentro de receta? | `temperatureC`, `pressureBar`, `durationSec` del registro |
| ¿Es un caso aislado o un patrón? | Consulta de los `PostPressCheck` del turno, agrupados por posición, lote y receta |

### 7.3 Decisiones posibles

| Diagnóstico | Decisión | Estado final |
|---|---|---|
| Fallo de lectura por colocación del teléfono, confirmado con una segunda lectura correcta | Rehabilitar | `POST_PRESS_PASSED` vía resolución de cuarentena |
| Chip no responde, emblema sin daño visible, unidad con valor recuperable | Retirar el emblema y sustituirlo por uno nuevo programado, si el tejido lo permite | Chip anterior a `DESTROYED`; unidad vuelve a `IN_PRODUCTION` |
| Chip no responde y el emblema no se puede retirar sin dañar la prenda | Baja de la unidad como producto | Chip a `REVOKED` y después `DESTROYED` |
| `contentIntact = false` con `readable = true` | **Nunca se rehabilita.** El chip tiene memoria comprometida | `DESTROYED` |
| Daño visible en el emblema | Baja del emblema | `DESTROYED` |
| Fuera de receta con lectura correcta | Decisión de calidad, no del puesto | Según criterio; si se rehabilita, se documenta por qué |

Regla dura: **un chip cuyo contenido cambió no vuelve al flujo.** No se reprograma,
no se rehabilita. La memoria demostró ser inestable y un chip que hoy acepta una
escritura puede perderla mañana, ya en manos del aficionado. Se destruye.

### 7.4 Reprogramar no es una salida

La máquina de estados **no permite** volver de `QUARANTINED` a `PERSONALIZING`.
Las salidas son `VALIDATED`, `RESERVED`, `LINKED`, `ACTIVATED`, `REVOKED` y
`DESTROYED`. Si se decide reutilizar un chip que pasó por cuarentena, hay que
llevarlo explícitamente a `VALIDATED` o `RESERVED` con una decisión humana
registrada, y eso exige `production:write`, que el puesto de prensa no debería
tener.

En la práctica, para un chip que falló tras el calor **la respuesta correcta casi
siempre es destruirlo**. Un módulo que pasó por una prensa fuera de receta ya sufrió
un estrés térmico que no se revierte, y su fiabilidad a largo plazo es
desconocida.

### 7.5 Destrucción

| Requisito | Detalle |
|---|---|
| Debe inutilizar el **chip**, no solo el emblema | Cortar el emblema sin dañar el módulo deja un chip funcional |
| Se verifica con una lectura posterior | Debe no responder |
| Se registra con la transición a `DESTROYED` | La fila del chip se conserva siempre |
| Con testigo y conteo | El conteo físico de destruidos debe cuadrar con el del sistema |

Un chip programado que desaparece del conteo es una incidencia de seguridad, no un
error administrativo: aunque el emblema esté roto, el chip sigue llevando una URL
que resuelve a una unidad registrada.

---

## 8. Lo que este documento no determina

Por honestidad, y para que nadie tome un número de aquí:

1. **La receta de termosellado.** Temperatura, presión y tiempo dependen del
   adhesivo, el tejido, el emblema y la prensa. Se determinan experimentalmente
   siguiendo [pruebas-fisicas.md](pruebas-fisicas.md).
2. **La tolerancia térmica del módulo NFC.** Es un dato del fabricante del inlay.
   **Hay que pedirlo por escrito** y validarlo con hardware antes de fijar la
   receta. No se debe suponer a partir de especificaciones genéricas de chips NFC.
3. **El tiempo de enfriamiento antes de la lectura posterior.** Experimental.
4. **Los tamaños de muestra y los niveles de aceptación.** Corresponden al plan de
   calidad de la planta.
5. **La tasa de rechazo aceptable.** Decisión de negocio y de calidad.
6. **Si el emblema se puede retirar y volver a sellar sin degradar la prenda.**
   Depende del tejido y debe ensayarse.

Todo lo anterior son huecos conocidos. Están listados en
[limitaciones.md](limitaciones.md) y son parte de los criterios de salida de la
fase de validación física en [piloto-a-produccion.md](piloto-a-produccion.md).

---

## 9. Documentos relacionados

- [protocolo-programacion.md](protocolo-programacion.md)
- [pruebas-fisicas.md](pruebas-fisicas.md)
- [modelo-datos.md](modelo-datos.md)
- [modelo-amenazas.md](modelo-amenazas.md)
- [piloto-a-produccion.md](piloto-a-produccion.md)
- [limitaciones.md](limitaciones.md)

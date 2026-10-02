# Protocolo de pruebas físicas

> ## NINGUNA DE ESTAS PRUEBAS SE HA EJECUTADO
>
> Este documento es un **protocolo de ensayo**, no un informe de resultados. A la
> fecha no existe ningún emblema real programado, ningún ciclo de lavado
> ejecutado, ninguna medida de distancia de lectura y ninguna prueba con teléfono
> físico.
>
> Todo lo que contiene son: objetivos, métodos propuestos, tamaños de muestra
> propuestos y criterios de decisión propuestos. Los tamaños de muestra y los
> umbrales **deben validarse con el plan de calidad de la planta y con el
> fabricante del inlay** antes de ejecutarse.
>
> Cualquier cifra de este documento que parezca un resultado, no lo es.

Relacionado con [protocolo-programacion.md](protocolo-programacion.md) y
[protocolo-termosellado.md](protocolo-termosellado.md).

---

## 0. Cómo usar este documento

### 0.1 Requisitos previos

Antes de ejecutar el primer ensayo hace falta:

| Requisito | Estado | Nota |
|---|---|---|
| Emblemas reales con inlay NFC montado | Pendiente | Con referencia de inlay y de adhesivo documentada |
| Jerseys reales del tejido de producción | Pendiente | El tejido es variable del ensayo, no un detalle |
| Prensa de termosellado de producción | Pendiente | La misma máquina que se usará, no una equivalente |
| Teléfonos de ensayo: varios modelos iPhone y Android | Pendiente | Ver ensayo 17 |
| API en ejecución con `NFC_PROVIDER=ntag21x` | Posible hoy | Con el simulador los resultados **no son válidos** |
| Hoja de datos del inlay del fabricante | **Pendiente y bloqueante** | Tolerancia térmica, mecánica y de humedad |
| Guía física graduada para medir distancia de lectura | Pendiente | Regla o soporte con separadores no metálicos |
| Plan de calidad con niveles de aceptación acordados | Pendiente | Los umbrales de este documento son propuestas |

**El requisito bloqueante es la hoja de datos del inlay.** Sin los límites del
fabricante, los ensayos de temperatura, presión y humedad se ejecutarían a ciegas
y sus resultados no serían interpretables. Hay que pedirla por escrito.

### 0.2 Reglas transversales

1. **Toda lectura se hace con el proveedor real** (`NFC_PROVIDER=ntag21x`). Una
   lectura simulada no prueba nada sobre el hardware. Si un registro sale con
   `simulated: true`, el ensayo es nulo.
2. **Cada muestra se identifica** por UID del chip y por `publicRef` de la unidad,
   y se sigue nominalmente durante todo el ensayo.
3. **Lectura de referencia antes de cualquier ensayo.** Sin medida inicial no hay
   comparación posible.
4. **Un teléfono de referencia único** para todas las lecturas comparativas,
   excepto en el ensayo 17. Cambiar de teléfono a mitad de un ensayo introduce una
   variable no controlada.
5. **Se registra el fallo con el mismo detalle que el éxito.** Un ensayo que solo
   anota los éxitos no sirve.
6. **Ningún resultado se extrapola a otro tejido, adhesivo, inlay o prensa.** Un
   cambio de cualquiera de los cuatro invalida los ensayos anteriores.
7. **Las muestras destructivas no vuelven al flujo comercial**, ni aunque pasen.
8. **Lo que no se puede medir, se declara no medido.** No se rellena una celda por
   estimación.

### 0.3 Definiciones operativas

| Término | Definición usada en todo el documento |
|---|---|
| **Lectura correcta** | El chip responde con un mensaje NDEF válido y el URI releído es **exactamente** el grabado (`readable && contentIntact`) |
| **Fallo de lectura** | El chip no responde, o responde sin NDEF válido |
| **Fallo de integridad** | El chip responde pero el URI no coincide. Es el fallo más grave |
| **Distancia máxima de lectura** | Separación máxima, medida con guía graduada, a la que se obtiene lectura correcta en 3 de 3 intentos |
| **Lectura de referencia** | Medida tomada antes del ensayo, con el mismo teléfono y la misma posición |
| **Degradación de distancia** | Reducción porcentual de la distancia máxima respecto a la lectura de referencia |

### 0.4 Sobre `signalStrength`

`runPostPressCheck` devuelve `signalStrength: null` **siempre**, porque Android no
expone RSSI para NFC. No se inventa un valor. En consecuencia, la magnitud
cuantitativa de todos estos ensayos es la **distancia máxima de lectura medida
manualmente**, no una intensidad de señal. Es menos precisa y es la que hay.

---

## Ensayo 1 — Lectura previa al termosellado

**Objetivo.** Establecer la línea base de cada muestra y descartar que un fallo
posterior sea anterior al calor.

**Método.**
1. Confirmar que el chip está en `LINKED` o `READY_FOR_HEAT_PRESS`.
2. Leer con el teléfono de referencia. Registrar `readable` y `contentIntact`.
3. Medir la distancia máxima de lectura con la guía graduada, en el centro del
   emblema y con el teléfono paralelo a la superficie.
4. Fotografiar el emblema y anotar su posición prevista en la placa de la prensa.

**Muestras.** 100 % de las unidades que vayan a sellarse, en todos los ensayos de
este documento.

**Aprobación.** Lectura correcta y distancia máxima registrada.

**Rechazo.** Cualquier fallo de lectura o de integridad. La muestra se aparta y se
investiga como fallo previo al calor; **no entra en ningún otro ensayo**.

---

## Ensayo 2 — Temperatura de termosellado

**Objetivo.** Determinar el rango de temperatura que consigue adhesión aceptable
**sin** dañar el módulo NFC, y localizar el umbral a partir del cual el chip falla.

**Método.**
1. Obtener del fabricante del inlay la temperatura máxima declarada. **Si no está
   disponible, este ensayo no puede diseñarse correctamente** y debe ejecutarse
   como exploración destructiva, no como validación.
2. Fijar presión y tiempo en un valor constante de partida.
3. Definir una serie de escalones de temperatura desde claramente por debajo de la
   recomendada por el adhesivo hasta por encima del límite del inlay, con paso
   fino en la zona de transición.
4. Sellar el grupo de muestras de cada escalón.
5. Dejar enfriar el tiempo establecido.
6. Lectura posterior (ensayo 5) y medida de distancia.
7. Inspección visual de adhesión, ampollas, brillo, marca de la placa y
   delaminación.
8. Registrar **temperatura medida en la placa**, no la consigna del panel.

**Muestras.** Propuesta: 10 unidades por escalón, con un mínimo de 5 escalones. Los
escalones se fijan tras conocer el límite del fabricante.

**Aprobación del escalón.** 10 de 10 con lectura correcta, degradación de distancia
por debajo del umbral acordado con calidad, y adhesión conforme a criterio visual.

**Rechazo del escalón.** Cualquier fallo de lectura o de integridad, o degradación
de distancia por encima del umbral, o defecto visual.

**Resultado esperado del ensayo.** Una **ventana de temperatura** con margen por
ambos lados: por encima del mínimo de adhesión y por debajo del primer escalón que
produjo un fallo, con un margen de seguridad explícito. La receta de producción se
sitúa en el centro de la ventana, no en su borde.

---

## Ensayo 3 — Presión de termosellado

**Objetivo.** Determinar el rango de presión que consigue adhesión sin romper la
antena ni deformar el módulo.

**Método.**
1. Fijar la temperatura en el centro de la ventana del ensayo 2 y el tiempo
   constante.
2. Serie de escalones de presión, desde insuficiente para adherir hasta claramente
   excesiva.
3. Sellar, enfriar, leer, medir distancia, inspeccionar.
4. Repetir con y sin material intermedio de reparto (espuma o silicona), porque la
   distribución de presión es tan relevante como su magnitud: una placa rígida
   sobre un módulo rígido concentra la carga en el troquel de silicio.
5. Registrar presión **medida**, e identificar la prensa y su calibración.

**Muestras.** Propuesta: 10 unidades por escalón y por condición de material
intermedio. Mínimo 4 escalones.

**Aprobación.** 10 de 10 con lectura correcta, degradación de distancia por debajo
del umbral, adhesión conforme, sin marca de la placa sobre el tejido.

**Rechazo.** Cualquier fallo de lectura o integridad, deformación visible del
módulo palpable a través del emblema, o marca permanente en el tejido.

**Nota.** Un fallo por presión suele producir **fallo total de lectura** (pista
rota) y no degradación progresiva. Si aparece degradación progresiva sin fallo
total, hay que sospechar desintonización por deformación del sustrato.

---

## Ensayo 4 — Tiempo de prensa

**Objetivo.** Determinar el tiempo mínimo que consigue adhesión duradera y el
tiempo máximo que el módulo tolera a la temperatura de receta.

**Método.**
1. Fijar temperatura y presión en el centro de las ventanas de los ensayos 2 y 3.
2. Serie de escalones de tiempo, desde claramente insuficiente hasta al menos el
   doble del recomendado por el adhesivo.
3. Sellar, enfriar, leer, medir distancia, inspeccionar.
4. Someter una submuestra de cada escalón a **10 ciclos de lavado** (ensayo 6
   abreviado) para comprobar que la adhesión es duradera y no solo aparente. Un
   tiempo insuficiente adhiere lo bastante para pasar la inspección visual y se
   despega en el primer lavado.

**Muestras.** Propuesta: 10 por escalón, mínimo 4 escalones; de cada escalón, 5 al
lavado abreviado.

**Aprobación.** 10 de 10 con lectura correcta y 5 de 5 con adhesión conforme tras
los 10 ciclos de lavado.

**Rechazo.** Cualquier fallo de lectura o integridad, o cualquier levantamiento de
borde tras el lavado abreviado.

**Resultado esperado.** La receta final: temperatura, presión y tiempo, cada uno con
su tolerancia, documentada como referencia de receta y registrada en cada
`PostPressCheck`.

---

## Ensayo 5 — Lectura posterior al termosellado

**Objetivo.** Confirmar que el chip sobrevive al ciclo completo con el contenido
intacto. Es el control que después se ejecuta al 100 % en producción.

**Método.**
1. Dejar enfriar la unidad el tiempo establecido.
2. Leer con el teléfono de referencia. El proveedor ejecuta `runPostPressCheck` con
   el URI esperado y devuelve `readable`, `contentIntact` y `detail`.
3. Medir la distancia máxima y calcular la degradación respecto al ensayo 1.
4. Reportar a `POST /api/v1/production/units/:unitId/post-press` con temperatura,
   presión y tiempo **medidos**.
5. Verificar que el `PostPressCheck` creado tiene `simulated: false`.

**Muestras.** 100 % en producción. En el ensayo, todas las muestras selladas.

**Aprobación.** `readable = true` **y** `contentIntact = true`, y degradación de
distancia por debajo del umbral acordado.

**Rechazo.**
- `readable = false`: fallo de hardware. Cuarentena automática.
- `contentIntact = false` con `readable = true`: **fallo de integridad.** Cuarentena
  automática y **destrucción**: el chip no vuelve al flujo.
- Degradación de distancia por encima del umbral, aunque la lectura sea correcta:
  rechazo por proceso.

---

## Ensayo 6 — Lavado por ciclos

**Objetivo.** Determinar cuántos ciclos de lavado y secado soporta el conjunto
emblema-chip manteniendo lectura correcta y adhesión.

**Método.**
1. Definir el ciclo de referencia según la etiqueta de cuidado de la prenda:
   programa, temperatura del agua, detergente, carga acompañante y método de
   secado. **El ciclo debe ser el que declara la prenda**, no uno de laboratorio
   arbitrario.
2. Lectura de referencia y medida de distancia de cada muestra.
3. Ejecutar ciclos y **leer en puntos de control**: propuesta de 1, 5, 10, 20, 30,
   50 ciclos. Después de cada punto: lectura, medida de distancia, inspección
   visual de bordes, fotografía.
4. Repartir las muestras en al menos tres condiciones: lavado normal, lavado del
   revés, y secado en máquina frente a secado al aire.
5. Registrar cada lectura de control asociada al UID.

**Muestras.** Propuesta: 30 unidades, 10 por condición. Las muestras se consumen.

**Aprobación.** Se define como **número de ciclos garantizados**: el mayor punto de
control en el que el 100 % de las muestras mantiene lectura correcta, sin
levantamiento de borde y con degradación de distancia por debajo del umbral.

**Rechazo.** Cualquier fallo de lectura o integridad, o levantamiento de borde de
más de la tolerancia acordada, **por debajo del número de ciclos que se pretenda
comunicar al cliente**.

**Regla de comunicación.** No se comunica al aficionado ninguna resistencia al
lavado que no esté respaldada por este ensayo. Si soporta 20 ciclos, se dice 20, no
"resistente al lavado".

---

## Ensayo 7 — Sudor

**Objetivo.** Comprobar el efecto del sudor sobre el adhesivo, el sustrato y las
pistas de la antena. Un jersey deportivo lo recibe en cada uso, mucho antes del
primer lavado.

**Método.**
1. Preparar una solución de sudor sintético según una norma textil reconocida
   (existen formulaciones ácida y alcalina). **La norma y la formulación concretas
   deben confirmarse con el laboratorio textil**; no se transcriben aquí de
   memoria.
2. Lectura de referencia y medida de distancia.
3. Impregnar la zona del emblema y mantener en cámara a temperatura controlada
   durante el periodo que indique la norma.
4. Leer y medir **en húmedo** y después **en seco**, tras secado al aire.
5. Repetir el ciclo varias veces: propuesta de 5 ciclos, con lectura en cada uno.
6. Inspeccionar bordes, migración de adhesivo, decoloración y cualquier signo de
   corrosión en la zona del módulo.

**Muestras.** Propuesta: 10 unidades por formulación (ácida y alcalina), 20 en
total. Destructivo.

**Aprobación.** Lectura correcta en húmedo y en seco en todos los ciclos, sin
levantamiento de borde y sin señales de corrosión.

**Rechazo.** Cualquier fallo de lectura, degradación progresiva de la distancia a lo
largo de los ciclos (indicio de corrosión de la antena), o levantamiento de borde.

---

## Ensayo 8 — Humedad

**Objetivo.** Evaluar la resistencia a humedad ambiental sostenida, que es la
condición real de un armario en Guayaquil o de un almacén sin climatizar.

**Método.**
1. Obtener del fabricante del inlay el límite de humedad declarado. Si no existe,
   declararlo como no verificado.
2. Lectura de referencia y medida de distancia.
3. Cámara climática a humedad relativa alta y temperatura controlada, con los
   valores que indique la norma textil aplicable.
4. Puntos de control: propuesta de 24 h, 72 h, 168 h (una semana) y 336 h.
5. En cada punto: lectura, medida de distancia, inspección de bordes y de migración
   de adhesivo.
6. Un grupo de control en condiciones ambientales normales, para separar el efecto
   de la humedad del simple paso del tiempo.

**Muestras.** Propuesta: 15 en cámara y 5 de control.

**Aprobación.** Lectura correcta en todos los puntos, degradación de distancia por
debajo del umbral y sin diferencia significativa con el grupo de control en
adhesión.

**Rechazo.** Cualquier fallo de lectura, o degradación progresiva no presente en el
grupo de control.

---

## Ensayo 9 — Flexión

**Objetivo.** Determinar cuántos ciclos de flexión soporta la antena. Es el estrés
que el uso normal aplica con más frecuencia.

**Método.**
1. Definir el eje de flexión respecto a la geometría de la antena. **Hay que
   ensayar al menos dos ejes**: la sensibilidad puede ser muy distinta según la
   dirección respecto a las pistas.
2. Fijar el radio de curvatura y el ángulo con un útil repetible. Una flexión a
   mano no es un ensayo: es una anécdota.
3. Lectura de referencia y medida de distancia.
4. Ciclos con puntos de control: propuesta de 100, 500, 1.000, 5.000, 10.000.
5. En cada punto: lectura, medida de distancia, palpación del módulo, inspección
   visual.

**Muestras.** Propuesta: 10 por eje, 20 en total. Destructivo.

**Aprobación.** Número de ciclos garantizados en el que el 100 % mantiene lectura
correcta.

**Rechazo.** Primer punto de control con cualquier fallo de lectura o con
degradación de distancia por encima del umbral.

**Nota de interpretación.** El fallo por flexión suele ser **abrupto**: la pista se
rompe y el chip deja de responder. Si en cambio se observa degradación gradual, hay
que investigar si es desintonización o una soldadura marginal.

---

## Ensayo 10 — Torsión

**Objetivo.** Evaluar el efecto de la torsión, que aplica esfuerzo cortante sobre
las soldaduras entre antena y troquel. Es el modo de fallo que la flexión pura no
reproduce.

**Método.**
1. Útil de torsión con ángulo y eje repetibles, aplicado sobre la zona del emblema.
2. Lectura de referencia y medida de distancia.
3. Ciclos con puntos de control: propuesta de 50, 200, 500, 1.000, 2.000.
4. En cada punto: lectura, medida de distancia, palpación e inspección.
5. Registrar el ángulo de torsión aplicado y su repetibilidad.

**Muestras.** Propuesta: 10 unidades. Destructivo.

**Aprobación.** Número de ciclos garantizados con el 100 % en lectura correcta.

**Rechazo.** Primer punto con fallo de lectura o degradación por encima del umbral.

**Nota.** Se espera que la torsión sea **más agresiva** que la flexión para el mismo
número de ciclos, por el esfuerzo sobre las soldaduras. Si el resultado es el
contrario, revisar el útil antes de creerlo.

---

## Ensayo 11 — Abrasión

**Objetivo.** Evaluar la resistencia de la cara visible del emblema y el efecto del
desgaste superficial sobre la lectura. Un jersey de uso deportivo roza contra
mochilas, respaldos y otras prendas en la lavadora.

**Método.**
1. Ensayo de abrasión con abradante y carga según norma textil aplicable, a
   confirmar con el laboratorio.
2. Lectura de referencia y medida de distancia.
3. Puntos de control por número de ciclos de abrasión, según la escala de la norma.
4. En cada punto: lectura, medida de distancia, inspección de la superficie
   impresa, y comprobación de que el **código impreso del emblema sigue legible**.
5. Anotar si la abrasión llega a exponer el sustrato o el módulo.

**Muestras.** Propuesta: 10 unidades. Destructivo.

**Aprobación.** Lectura correcta en todos los puntos de control hasta el nivel de
abrasión que se pretenda declarar, y código impreso legible.

**Rechazo.** Fallo de lectura, exposición del módulo, o **código impreso ilegible**.
Este último es rechazo por sí solo: sin código legible se pierde la trazabilidad y
la vía de respaldo para soporte.

---

## Ensayo 12 — Tracción

**Objetivo.** Determinar la fuerza necesaria para despegar el emblema y comprobar si
el conjunto falla por adhesivo, por tejido o por módulo.

**Método.**
1. Máquina de tracción con célula de carga y mordazas adecuadas al tejido.
2. Lectura de referencia.
3. Tracción en el plano del tejido, a velocidad constante, hasta el fallo.
4. Registrar la fuerza máxima y el **modo de fallo**: fallo adhesivo (el emblema se
   despega limpio), fallo cohesivo (el adhesivo se parte), fallo del tejido (el
   tejido se rompe antes), fallo del módulo (el emblema aguanta y el chip deja de
   leer).
5. Leer el chip después del ensayo, aunque el emblema esté separado.

**Muestras.** Propuesta: 10 unidades. Destructivo por definición.

**Aprobación.** Fuerza máxima por encima del mínimo que fije el plan de calidad, con
modo de fallo **adhesivo o del tejido**, no del módulo.

**Rechazo.** Fuerza por debajo del mínimo, o **fallo del módulo antes del fallo
adhesivo**. Este último significa que el chip es el eslabón débil: cede antes que
la unión, lo que producirá fallos en campo sin señal visible.

---

## Ensayo 13 — Delaminación

**Objetivo.** Evaluar la resistencia al pelado progresivo desde un borde, que es como
falla el adhesivo en la práctica: no de golpe, sino desde una esquina levantada.

**Método.**
1. Ensayo de pelado con ángulo fijo, según la norma de adhesivos aplicable, a
   confirmar con el laboratorio.
2. Lectura de referencia.
3. Pelado progresivo, registrando la fuerza a lo largo del recorrido.
4. Detener a intervalos y **leer el chip** con el emblema parcialmente despegado:
   interesa saber si una unidad con una esquina levantada sigue leyendo, porque es
   un caso real de soporte.
5. Ensayar también muestras ya sometidas a lavado (ensayo 6) y a sudor (ensayo 7),
   para medir la degradación de la adhesión con el uso.

**Muestras.** Propuesta: 10 vírgenes, 10 post-lavado, 10 post-sudor. 30 en total.
Destructivo.

**Aprobación.** Fuerza de pelado por encima del mínimo del plan de calidad, tanto en
muestras vírgenes como envejecidas, y lectura correcta con la delaminación parcial
que se considere tolerable.

**Rechazo.** Fuerza por debajo del mínimo, caída desproporcionada tras lavado o
sudor, o pérdida de lectura con una delaminación mínima.

---

## Ensayo 14 — Envejecimiento acelerado

**Objetivo.** Estimar el comportamiento a largo plazo en un tiempo razonable:
degradación del adhesivo, del sustrato y de la antena.

**Método.**
1. Definir el protocolo con el laboratorio: ciclos de temperatura y humedad,
   exposición a radiación ultravioleta si procede, y el factor de aceleración
   declarado. **El factor de aceleración lo aporta la norma o el laboratorio; no se
   estima aquí.**
2. Lectura de referencia y medida de distancia.
3. Puntos de control correspondientes al equivalente de 1, 2 y 3 años según el
   factor declarado.
4. En cada punto: lectura, medida de distancia, fuerza de pelado sobre una
   submuestra, inspección visual de amarilleo, fragilidad y migración de adhesivo.
5. Grupo de control en condiciones ambientales normales.

**Muestras.** Propuesta: 20 en cámara y 10 de control.

**Aprobación.** Lectura correcta en todos los puntos y fuerza de pelado por encima
del mínimo en el equivalente de vida útil que se pretenda declarar.

**Rechazo.** Cualquier fallo de lectura, o caída de la fuerza de pelado por debajo
del mínimo antes de la vida útil declarada.

**Advertencia de interpretación.** Un ensayo acelerado **estima**, no demuestra. El
factor de aceleración es una hipótesis del modelo. Estos resultados no deben
comunicarse como garantía de años, solo usarse para comparar recetas y materiales
entre sí.

---

## Ensayo 15 — Lectura en mojado y en seco

**Objetivo.** Comprobar el efecto del agua sobre la lectura. Es el caso de uso más
inmediato y frecuente: un jersey sudado, mojado por lluvia o recién sacado de la
lavadora.

**Método.**
1. Lectura de referencia en seco y medida de distancia.
2. Condiciones a ensayar, con lectura y medida de distancia en cada una:

   | Condición | Descripción |
   |---|---|
   | Seco | Referencia |
   | Húmedo | Tejido humedecido, superficie sin película de agua |
   | Empapado | Tejido saturado, escurriendo |
   | Sumergido | Emblema bajo agua, con el teléfono fuera |
   | Recién escurrido de lavadora | Condición real |
   | Secado al aire tras empapado | Recuperación |
   | Secado en máquina tras empapado | Recuperación |

3. Repetir el ciclo empapado-secado varias veces: propuesta de 5, para detectar
   degradación acumulada.
4. Anotar la degradación de distancia en cada condición.

**Muestras.** Propuesta: 10 unidades, todas por todas las condiciones. No
destructivo, pero las muestras quedan marcadas y no vuelven al flujo comercial.

**Aprobación.** Lectura correcta en **seco, húmedo y recién escurrido** y
recuperación completa de la distancia de referencia tras el secado.

**Criterio informativo, no de rechazo.** Es aceptable que la distancia se reduzca en
empapado o sumergido: el agua atenúa el acoplamiento por radiofrecuencia. Lo que se
documenta es **cuánto**, para poder instruir al aficionado ("seque la zona del
escudo antes de acercar el teléfono") en lugar de dejarlo con un fallo
inexplicable.

**Rechazo.** Fallo de lectura en seco o húmedo. Falta de recuperación de la
distancia tras el secado, que indica daño y no atenuación.

---

## Ensayo 16 — Distancia y orientación de lectura

**Objetivo.** Caracterizar la zona de lectura efectiva, para poder escribir la
instrucción correcta al aficionado y para tener una magnitud comparable antes y
después de cada ensayo.

**Método.**
1. Guía graduada con separadores **no metálicos**.
2. Barrido de posiciones del teléfono sobre el emblema: centro, cuatro bordes,
   cuatro esquinas.
3. Barrido de orientaciones: teléfono paralelo a la superficie, a 45 grados y
   perpendicular; y rotación del teléfono en su propio plano, porque la antena NFC
   del teléfono no está centrada ni es isótropa.
4. En cada combinación, determinar la distancia máxima con lectura correcta en 3 de
   3 intentos.
5. Construir un mapa de la zona de lectura y localizar el **punto óptimo**.
6. Repetir sobre el jersey puesto en un torso, no solo extendido en una mesa: la
   proximidad del cuerpo cambia el comportamiento.
7. Ensayar con el jersey **doblado** y con otra prenda encima, que son situaciones
   reales.

**Muestras.** Propuesta: 5 unidades, para separar la variabilidad de la unidad de la
del método.

**Aprobación.** Existe un punto óptimo con distancia máxima por encima del mínimo
utilizable que fije el plan de calidad, y ese punto es **describible en una
instrucción simple** para el aficionado.

**Rechazo.** Distancia máxima por debajo del mínimo utilizable en el punto óptimo, o
zona de lectura tan pequeña o tan dependiente de la orientación que no se pueda
explicar en una frase.

**Salida del ensayo.** El texto de la instrucción al aficionado. `TRUST_LEVEL_COPY`
para `UNVERIFIABLE` ya dice "intente acercar el teléfono nuevamente **al centro del
escudo**"; este ensayo debe confirmar que el centro es realmente el punto óptimo o
corregir el texto.

---

## Ensayo 17 — Modelos de iPhone y Android

**Objetivo.** Documentar el comportamiento real con los teléfonos que el público de
Ecuador usa, sin suponer nada.

> **Advertencia.** Este documento **no afirma** qué modelos son compatibles, a qué
> distancia leen, dónde tienen la antena ni cómo se comportan sus sistemas
> operativos ante una etiqueta NDEF. Ninguna de esas afirmaciones puede hacerse sin
> el teléfono en la mano. Todo lo de abajo es el método para averiguarlo.

**Método.**
1. Definir la lista de modelos a ensayar con datos reales de mercado: distribución
   de modelos en Ecuador y, si existe, en la base de clientes de Marathon. **No se
   fija aquí una lista**, porque sería inventada.
2. La lista debe cubrir, como criterio de diseño: varias generaciones de iPhone,
   varias marcas Android, varias gamas —incluida gama de entrada, que es donde más
   sorpresas aparecen—, y al menos un teléfono con funda gruesa y otro con funda
   metálica o con anillo magnético.
3. Para cada modelo, registrar: marca, modelo exacto, versión de sistema operativo,
   funda usada.
4. Para cada modelo y sobre la **misma unidad de referencia**:
   - ¿El sistema detecta la etiqueta sin abrir ninguna aplicación?
   - ¿Abre la URL automáticamente, pide confirmación, muestra una notificación o no
     hace nada?
   - ¿Hay que activar algo en ajustes?
   - Distancia máxima de lectura en el punto óptimo.
   - Posición de la zona sensible en el cuerpo del teléfono, determinada
     empíricamente por barrido.
   - Comportamiento con la pantalla apagada y con el teléfono bloqueado.
   - Número de intentos hasta la primera lectura correcta por una persona que no
     conoce el sistema.
5. Repetir cada medida 3 veces y registrar la dispersión.
6. Documentar **literalmente** lo observado, sin generalizar a otros modelos de la
   misma familia.

**Muestras.** Una unidad de referencia común a todos los modelos, más una segunda de
contraste. Propuesta: mínimo 12 modelos distintos; el número final lo fija la
cobertura de mercado buscada.

**Aprobación.** Se define como cobertura: el porcentaje del parque de teléfonos
objetivo que consigue lectura correcta en 3 de 3 intentos por una persona sin
instrucción previa, por encima del umbral que fije negocio.

**Rechazo.** Cobertura por debajo del umbral. Un modelo muy extendido que no
funcione es, por sí solo, un bloqueante de lanzamiento.

**Salida del ensayo.**
1. Una tabla de compatibilidad observada, con fecha y versión de sistema operativo,
   que se revisa cuando aparezcan modelos nuevos.
2. El texto de ayuda para el aficionado cuya lectura falla.
3. La justificación real del **código QR de respaldo**: si la cobertura no llega al
   100 %, el QR no es un adorno, es el camino alternativo. Recordando que un QR
   **solo identifica** y jamás alcanza `VERIFIED`, por el techo de
   `TRUST_CEILING_BY_METHOD`.

---

## Ensayo 18 — Extracción del emblema

**Objetivo.** Medir cuánto cuesta separar el emblema de la prenda **conservando el
chip funcional**. Es el paso previo de la amenaza de trasplante.

**Método.**
1. Lectura de referencia y medida de distancia.
2. Intentar la extracción con medios progresivamente más sofisticados, registrando
   tiempo, herramientas y resultado de lectura tras cada intento:

   | Nivel | Medios |
   |---|---|
   | 1 | Solo manos |
   | 2 | Herramientas domésticas: tijeras, cuchilla, pinzas |
   | 3 | Calor doméstico: plancha, secador |
   | 4 | Disolventes domésticos |
   | 5 | Prensa de termosellado y herramientas de taller |

3. Para cada nivel registrar: tiempo empleado, daño visible en el emblema, daño
   visible en la prenda, y si el chip **sigue leyendo correctamente**.
4. Anotar si el daño resultante es **evidente para un comprador** que examine la
   prenda.

**Muestras.** Propuesta: 5 unidades por nivel, 25 en total. Destructivo.

**Aprobación.** No hay "aprobación" en el sentido de los otros ensayos. Lo que se
busca es **caracterizar el coste del ataque**. El resultado deseable: la extracción
con chip funcional exige nivel 4 o 5 y deja daño evidente.

**Rechazo, entendido como hallazgo crítico.** Que la extracción con chip funcional
sea posible en nivel 1 o 2 **sin daño evidente**. Si ocurre, el diseño del montaje
debe revisarse antes del piloto: el emblema debe estar construido para que sacarlo
lo destruya.

**Relación con el modelo de amenazas.** Corresponde al vector "extracción física del
emblema" de [modelo-amenazas.md](modelo-amenazas.md). El resultado de este ensayo
es lo que permite decir si esa amenaza está mitigada por el montaje o solo por la
detección posterior.

---

## Ensayo 19 — Trasplante a otra prenda

**Objetivo.** Comprobar si un emblema extraído puede montarse en un jersey
falsificado de forma convincente, y si el sistema puede detectarlo.

**Método.**
1. Partir de emblemas extraídos con chip funcional del ensayo 18.
2. Intentar montarlos en otra prenda con los mismos cinco niveles de medios.
3. Registrar por cada intento: resultado de lectura, calidad estética del montaje,
   y si un comprador detectaría el trasplante por inspección visual y al tacto.
4. Verificar qué produce el sistema al leer la unidad trasplantada: el veredicto
   será `IDENTIFIED_ONLY` si el chip lee, porque una NTAG 21x no puede probar nada
   más.
5. Evaluar si las señales blandas del motor de riesgo detectan algo: la unidad
   original y la trasplantada son **el mismo chip**, así que no hay dos
   identificadores en circulación; no hay señal de duplicación que detectar.

**Muestras.** Los emblemas que sobrevivan al ensayo 18. Destructivo.

**Aprobación / hallazgo deseable.** Que el trasplante sea detectable por inspección
visual de la prenda, o que la extracción previa haya destruido el chip.

**Rechazo, entendido como hallazgo crítico.** Que el trasplante sea indetectable a
la vista y el chip siga leyendo.

**Conclusión que hay que anticipar, con honestidad.** Es muy probable que este
ensayo confirme lo que [modelo-amenazas.md](modelo-amenazas.md) ya declara: **el
trasplante no se detecta criptográficamente con NTAG 21x.** El chip es genuino, el
token es el registrado, la lectura es correcta. Lo único que cambió es la prenda,
y el chip no sabe a qué tela está pegado.

Las mitigaciones reales son de montaje y de proceso, no de software: construcción
que se destruya al extraer, y la trazabilidad `chip → emblema → unidad → SKU` que
permite comprobar si el modelo y la talla declarados coinciden con la prenda que
alguien tiene delante. Un trasplante a una prenda de otro modelo produce una
incoherencia visible entre la ficha que muestra la web y la prenda física. Ese es
el control disponible hoy, y depende de que el aficionado lo mire.

---

## Ensayo 20 — Inspección por lote

**Objetivo.** Validar un lote recibido del proveedor antes de consumirlo, y detectar
problemas de cadena de suministro.

**Método.**
1. Verificar la documentación del lote: `supplierName`, `supplierLotRef`, cantidad,
   tipo de chip declarado.
2. Conteo físico. **El conteo manda sobre el albarán.**
3. Sobre la muestra, para cada chip:
   - Leer el UID y el tipo detectado. Comparar con el tipo declarado.
   - Registrar el UID para detectar **duplicados dentro del lote**.
   - `inspectTag`: comprobar que no llega bloqueado (`readOnly: false`) y que no
     trae un NDEF previo inesperado.
   - Comprobar la capacidad de memoria de usuario correspondiente al tipo.
   - `POST /production/chips/inspect`: confirmar que el UID no está ya registrado
     en el sistema.
4. Inspección visual del emblema: posición del módulo, planitud, acabado,
   legibilidad del código impreso.
5. Ejecutar la secuencia completa de programación y verificación sobre la muestra.
6. Consignar el resultado en el registro de lote.

**Muestras.** El tamaño de muestra y el nivel de aceptación **deben fijarse con el
plan de calidad** según una norma de muestreo reconocida. Propuesta de partida para
el piloto: 32 chips por lote, o el 100 % si el lote es menor de 100.

**Aprobación del lote.** Todas las condiciones:
- Conteo físico conforme.
- 100 % de la muestra con tipo detectado igual al declarado.
- **Cero UID duplicados.**
- Cero chips que lleguen bloqueados o con NDEF inesperado.
- Cero UID ya registrados en el sistema.
- 100 % de la muestra completa la secuencia de programación y verificación.
- Inspección visual conforme y código impreso legible.

**Rechazo del lote.**

| Hallazgo | Acción |
|---|---|
| **Cualquier UID duplicado** | Rechazo inmediato del lote completo y escalada. El UID es único en `NfcChip`; un duplicado implica etiquetas con UID escribible o emuladores en la cadena de suministro |
| Tipo detectado distinto del declarado en cualquier chip | Rechazo; lote posiblemente mezclado |
| Chip que llega bloqueado | Rechazo |
| UID ya registrado en el sistema | Rechazo y escalada: puede indicar reingreso de material |
| Fallos de programación por encima del nivel de aceptación | Rechazo |
| Código impreso ilegible por encima del nivel de aceptación | Rechazo |

**Marcado en lugar de rechazo.** Si un lote ya se consumió parcialmente cuando
aparece el hallazgo, se marca `ProductionBatch.flagged`. El motor de riesgo lo lee
en **cada** verificación y suma 20 puntos (`BATCH_ANOMALY_FLAGGED`) a todas las
unidades del lote, incluidas las ya vendidas. Es una decisión con consecuencias
sobre producto en manos de clientes: la toma un `MARATHON_ADMIN` con motivo escrito
y aviso a soporte.

---

## 21. Resumen de ensayos

| # | Ensayo | Destructivo | Muestras propuestas | Bloqueante para el piloto |
|---|---|:-:|---|:-:|
| 1 | Lectura previa | No | 100 % | Sí |
| 2 | Temperatura | Sí | 10 × escalones (mín. 5) | Sí |
| 3 | Presión | Sí | 10 × escalones × 2 condiciones | Sí |
| 4 | Tiempo | Sí | 10 × escalones (mín. 4) | Sí |
| 5 | Lectura posterior | No | 100 % | Sí |
| 6 | Lavado por ciclos | Sí | 30 | Sí |
| 7 | Sudor | Sí | 20 | Sí |
| 8 | Humedad | Sí | 20 | No |
| 9 | Flexión | Sí | 20 | Sí |
| 10 | Torsión | Sí | 10 | No |
| 11 | Abrasión | Sí | 10 | No |
| 12 | Tracción | Sí | 10 | Sí |
| 13 | Delaminación | Sí | 30 | Sí |
| 14 | Envejecimiento acelerado | Sí | 30 | No |
| 15 | Mojado y seco | No | 10 | Sí |
| 16 | Distancia y orientación | No | 5 | Sí |
| 17 | Modelos de teléfono | No | mín. 12 modelos | Sí |
| 18 | Extracción del emblema | Sí | 25 | Sí |
| 19 | Trasplante | Sí | Supervivientes del 18 | Sí |
| 20 | Inspección por lote | Parcial | 32 por lote | Sí |

La columna "bloqueante" es una **propuesta** de criterio de salida para la fase de
validación física de [piloto-a-produccion.md](piloto-a-produccion.md). Debe
acordarse con calidad y negocio.

---

## 22. Formulario de resultados

Listo para imprimir y llenar. Una copia por campaña de ensayos.

### 22.1 Cabecera de la campaña

| Campo | Valor |
|---|---|
| Código de campaña de ensayo | |
| Fecha de inicio | |
| Fecha de fin | |
| Responsable del ensayo | |
| Testigo | |
| Referencia del inlay NFC | |
| Tipo de chip | |
| Referencia del adhesivo y lote | |
| Referencia del tejido y gramaje | |
| Modelo de prensa e identificador | |
| Fecha de última calibración de la prensa | |
| `NFC_PROVIDER` en uso | |
| ¿Algún registro salió con `simulated: true`? | Sí / No |
| Teléfono de referencia (marca, modelo, SO) | |
| Instrumento de medida de distancia | |
| Laboratorio externo, si aplica | |
| Normas aplicadas | |

> Si la respuesta a `simulated` es **Sí**, la campaña entera es nula.

### 22.2 Receta resultante

| Parámetro | Mínimo | Nominal | Máximo | Ensayo que lo determinó |
|---|---|---|---|---|
| Temperatura (°C) | | | | 2 |
| Presión (bar) | | | | 3 |
| Tiempo (s) | | | | 4 |
| Tiempo de enfriamiento (s) | | | | 5 |
| Material intermedio | | | | 3 |

### 22.3 Registro por muestra

Una fila por muestra. Reproducir la tabla tantas veces como haga falta.

| Muestra | UID | `publicRef` | Ensayo # | Lectura ref. OK | Dist. ref. (mm) | Resultado final | Dist. final (mm) | Degrad. (%) | `readable` | `contentIntact` | Estado final del chip | Observaciones |
|---|---|---|---|:-:|---|:-:|---|---|:-:|:-:|---|---|
| 001 | | | | | | | | | | | | |
| 002 | | | | | | | | | | | | |
| 003 | | | | | | | | | | | | |
| 004 | | | | | | | | | | | | |
| 005 | | | | | | | | | | | | |
| 006 | | | | | | | | | | | | |
| 007 | | | | | | | | | | | | |
| 008 | | | | | | | | | | | | |
| 009 | | | | | | | | | | | | |
| 010 | | | | | | | | | | | | |

### 22.4 Ensayos 2, 3 y 4 — Barrido de parámetros

| Escalón | Parámetro variado | Valor medido | Muestras | Lecturas correctas | Fallos de lectura | Fallos de integridad | Degrad. media (%) | Adhesión conforme | Veredicto del escalón |
|---|---|---|---|---|---|---|---|:-:|---|
| 1 | | | | | | | | | |
| 2 | | | | | | | | | |
| 3 | | | | | | | | | |
| 4 | | | | | | | | | |
| 5 | | | | | | | | | |
| 6 | | | | | | | | | |

### 22.5 Ensayo 6 — Lavado por ciclos

| Condición | Muestras | 1 ciclo | 5 | 10 | 20 | 30 | 50 | Ciclos garantizados | Modo de fallo |
|---|---|---|---|---|---|---|---|---|---|
| Normal, secado al aire | | | | | | | | | |
| Normal, secado en máquina | | | | | | | | | |
| Del revés, secado al aire | | | | | | | | | |

Celdas: número de muestras con lectura correcta sobre el total.

### 22.6 Ensayos 7 y 8 — Sudor y humedad

| Ensayo | Condición | Muestras | Punto 1 | Punto 2 | Punto 3 | Punto 4 | Punto 5 | Veredicto |
|---|---|---|---|---|---|---|---|---|
| 7 | Sudor ácido | | | | | | | |
| 7 | Sudor alcalino | | | | | | | |
| 8 | Humedad alta | | | | | | | |
| 8 | Control ambiental | | | | | | | |

### 22.7 Ensayos 9, 10 y 11 — Flexión, torsión, abrasión

| Ensayo | Eje / condición | Muestras | Pto. 1 | Pto. 2 | Pto. 3 | Pto. 4 | Pto. 5 | Ciclos garantizados | Modo de fallo |
|---|---|---|---|---|---|---|---|---|---|
| 9 | Flexión eje A | | | | | | | | |
| 9 | Flexión eje B | | | | | | | | |
| 10 | Torsión | | | | | | | | |
| 11 | Abrasión | | | | | | | | |

Para el ensayo 11, añadir: código impreso legible al final, Sí / No.

### 22.8 Ensayos 12 y 13 — Tracción y delaminación

| Muestra | Ensayo | Estado previo (virgen / lavado / sudor) | Fuerza máx. o de pelado | Unidad | Modo de fallo | Chip lee tras el ensayo | Veredicto |
|---|---|---|---|---|---|:-:|---|
| | 12 | | | | | | |
| | 12 | | | | | | |
| | 13 | | | | | | |
| | 13 | | | | | | |

Modo de fallo: adhesivo / cohesivo / tejido / módulo.

### 22.9 Ensayo 14 — Envejecimiento acelerado

| Grupo | Muestras | Factor de aceleración declarado | Equiv. 1 año | Equiv. 2 años | Equiv. 3 años | Fuerza de pelado final | Veredicto |
|---|---|---|---|---|---|---|---|
| Cámara | | | | | | | |
| Control | | | | | | | |

### 22.10 Ensayo 15 — Mojado y seco

| Condición | Muestras | Lecturas correctas | Dist. media (mm) | Degrad. vs. seco (%) | Recuperación tras secado |
|---|---|---|---|---|:-:|
| Seco (referencia) | | | | 0 | — |
| Húmedo | | | | | |
| Empapado | | | | | |
| Sumergido | | | | | |
| Recién escurrido | | | | | |
| Secado al aire | | | | | |
| Secado en máquina | | | | | |

### 22.11 Ensayo 16 — Distancia y orientación

| Posición | Paralelo (mm) | 45° (mm) | Perpendicular (mm) | Observaciones |
|---|---|---|---|---|
| Centro | | | | |
| Borde superior | | | | |
| Borde inferior | | | | |
| Borde izquierdo | | | | |
| Borde derecho | | | | |
| Esquina sup. izq. | | | | |
| Esquina sup. der. | | | | |
| Esquina inf. izq. | | | | |
| Esquina inf. der. | | | | |

| Escenario | Dist. máx. en punto óptimo (mm) |
|---|---|
| Jersey extendido sobre mesa | |
| Jersey puesto en torso | |
| Jersey doblado | |
| Con otra prenda encima | |

Punto óptimo identificado: ______________
Instrucción propuesta para el aficionado: ____________________________________

### 22.12 Ensayo 17 — Modelos de teléfono

| # | Marca | Modelo | Versión SO | Funda | Detecta sin app | Comportamiento al detectar | Requiere ajuste | Dist. máx. (mm) | Zona sensible | Con pantalla apagada | Intentos hasta 1.ª lectura | Veredicto |
|---|---|---|---|---|:-:|---|:-:|---|---|:-:|---|---|
| 1 | | | | | | | | | | | | |
| 2 | | | | | | | | | | | | |
| 3 | | | | | | | | | | | | |
| 4 | | | | | | | | | | | | |
| 5 | | | | | | | | | | | | |
| 6 | | | | | | | | | | | | |
| 7 | | | | | | | | | | | | |
| 8 | | | | | | | | | | | | |
| 9 | | | | | | | | | | | | |
| 10 | | | | | | | | | | | | |
| 11 | | | | | | | | | | | | |
| 12 | | | | | | | | | | | | |

Cobertura calculada sobre el parque objetivo: ______ %
Modelos con fallo que se consideran bloqueantes: ____________________________

### 22.13 Ensayos 18 y 19 — Extracción y trasplante

| Nivel de medios | Muestras | Extracciones con chip funcional | Tiempo medio | Daño evidente en prenda | Daño evidente en emblema | Trasplantes logrados | Trasplante detectable a la vista |
|---|---|---|---|:-:|:-:|---|:-:|
| 1 — Manos | | | | | | | |
| 2 — Herramientas domésticas | | | | | | | |
| 3 — Calor doméstico | | | | | | | |
| 4 — Disolventes | | | | | | | |
| 5 — Taller | | | | | | | |

Hallazgo crítico detectado: Sí / No — Descripción: ____________________________

### 22.14 Ensayo 20 — Inspección por lote

| Campo | Valor |
|---|---|
| Código de lote (`ProductionBatch.code`) | |
| Proveedor | |
| Referencia de lote del proveedor | |
| Cantidad según albarán | |
| Cantidad contada físicamente | |
| Tipo de chip declarado | |
| Tamaño de muestra | |
| Chips con tipo detectado distinto del declarado | |
| **UID duplicados detectados** | |
| Chips que llegan bloqueados | |
| Chips con NDEF previo inesperado | |
| UID ya registrados en el sistema | |
| Fallos de programación en la muestra | |
| Códigos impresos ilegibles | |
| Veredicto | Aceptado / Rechazado / Aceptado con marcado |
| `flagged` aplicado | Sí / No |
| Motivo | |

### 22.15 Cierre de la campaña

| Campo | Valor |
|---|---|
| Ensayos ejecutados | |
| Ensayos no ejecutados y motivo | |
| Ensayos bloqueantes superados | |
| Ensayos bloqueantes no superados | |
| Receta final aprobada | Sí / No |
| Ciclos de lavado a comunicar al cliente | |
| Cobertura de teléfonos alcanzada | |
| Hallazgos críticos de extracción o trasplante | |
| ¿Se autoriza el piloto? | Sí / No |
| Firma del responsable del ensayo | |
| Firma de calidad | |
| Fecha | |

---

## 23. Documentos relacionados

- [protocolo-programacion.md](protocolo-programacion.md)
- [protocolo-termosellado.md](protocolo-termosellado.md)
- [modelo-amenazas.md](modelo-amenazas.md)
- [guia-ntag424-dna.md](guia-ntag424-dna.md)
- [piloto-a-produccion.md](piloto-a-produccion.md)
- [limitaciones.md](limitaciones.md)

# Marathon NFC Studio

Aplicación Android para el puesto de programación de emblemas NFC de la línea de
producción de jerseys. Forma parte del monorepo **Marathon Escudo Vivo**.

Es la herramienta que usa un operario de planta para: grabar el chip de un
emblema, comprobar que quedó bien grabado, unirlo al jersey correcto, y
verificarlo otra vez después de que el emblema pasa por la prensa de
termosellado. Cada paso queda registrado en el servidor con quién lo hizo, con
qué teléfono y cuándo.

---

## Índice

1. [Qué hace exactamente](#qué-hace-exactamente)
2. [Qué NO hace, y por qué](#qué-no-hace-y-por-qué)
3. [Requisitos](#requisitos)
4. [Cómo abrirlo en Android Studio](#cómo-abrirlo-en-android-studio)
5. [Arquitectura](#arquitectura)
6. [Los tres proveedores NFC](#los-tres-proveedores-nfc)
7. [Modo simulación](#modo-simulación)
8. [Manual del operario, paso a paso](#manual-del-operario-paso-a-paso)
9. [Decisiones de seguridad](#decisiones-de-seguridad)
10. [Pruebas](#pruebas)
11. [**Qué NO está probado**](#qué-no-está-probado)

---

## Qué hace exactamente

El flujo de producción es fijo y la aplicación no permite saltarse ningún paso:

```
1.  Ingreso del operario (correo + contraseña)
2.  Comprobación de que ESTE teléfono está habilitado para programar
3.  Selección de la orden de producción
4.  Confirmación visual de modelo / club / temporada / lote
5.  Se apoya el emblema en la parte de atrás del teléfono
6.  Identificación de la familia del chip
7.  Lectura de la información técnica del chip
8.  Consulta al servidor: ¿este chip ya estaba registrado?
9.  El servidor asigna el siguiente identificador y autoriza la operación
10. Escritura del registro NDEF (o ejecución del proveedor correspondiente)
11. RELECTURA del chip y comparación con lo grabado
12. Escaneo del código de barras del jersey
13. Vinculación emblema ↔ jersey
14. Registro de operario / teléfono / fecha / resultado
15. La unidad queda READY_FOR_HEAT_PRESS
16. Tras el termosellado: prueba final de lectura
17. Desenlace: ACTIVATED o QUARANTINED
```

El paso 11 es el que da valor a todo lo demás: sin relectura, «la escritura no
dio error» no significa «el chip contiene lo que debe contener».

### Pantallas

| Pantalla | Archivo | Para qué |
|---|---|---|
| Login | `ui/screens/login/` | Ingreso del operario |
| Estado NFC del teléfono | `ui/screens/estadonfc/` | Hardware NFC + autorización del puesto |
| Órdenes disponibles | `ui/screens/ordenes/` | Elegir en qué trabajar |
| Detalle de orden | `ui/screens/detalleorden/` | Confirmar club / modelo / lote |
| Programación | `ui/screens/programacion/` | Grabar y comprobar el emblema |
| Verificación | `ui/screens/verificacion/` | Control de calidad y formación |
| Asociación con jersey | `ui/screens/asociacion/` | Unir emblema y prenda |
| Control post-termosellado | `ui/screens/postpress/` | Prueba tras la prensa |
| Historial del operario | `ui/screens/historial/` | Revisar el turno sin red |
| Errores y reintentos | `ui/screens/errores/` | Avisos pendientes de enviar |
| Cuarentena | `ui/screens/cuarentena/` | Apartar una unidad |
| Configuración | `ui/screens/configuracion/` | Servidor, simulación, estado |

---

## Qué NO hace, y por qué

**No autentica jerseys.** Con los chips NTAG 213/215/216 que usa hoy la línea, la
aplicación escribe una URL en el chip y la vuelve a leer. Eso permite
**identificar** el producto, no **autenticarlo**: el contenido NDEF es copiable
con cualquier teléfono y en el mercado existen etiquetas con UID escribible. La
distinción está desarrollada en `packages/domain/src/trust.ts` y la interfaz de
esta app la repite con todas las letras en la pantalla de verificación.

**No toca claves.** No hay ni un campo en toda la aplicación donde se pueda
introducir, pegar o importar material criptográfico. El material se referencia
por `ReferenciaClave` opaca (un puntero a un KMS/HSM/SAM) y las operaciones
criptográficas se ejecutan en el servicio que custodia la clave.

**No decide.** El teléfono no elige identificadores, no elige URIs, no juzga
niveles de confianza y no se autocalifica como íntegro. Todo eso lo hace el
servidor. El teléfono acerca una antena a un chip y transmite lo que ocurrió.

---

## Requisitos

| | |
|---|---|
| JDK | **17** |
| Android SDK | **compileSdk 34**, `targetSdk 34` |
| `minSdk` | **26** (Android 8.0) |
| Gradle | 8.7 (lo descarga el wrapper) |
| AGP | 8.5.2 |
| Kotlin | 1.9.24 |
| Android Studio | Koala (2024.1) o posterior |

`minSdk 26` no es arbitrario: por debajo de Android 8 el modo lector de NFC
(`enableReaderMode`) se comporta de forma inconsistente entre fabricantes, y
`EncryptedSharedPreferences` necesita un almacén de claves que no siempre existe.

**Hardware del puesto:** teléfono con NFC (ISO/IEC 14443 tipo A). La aplicación
se instala también en teléfonos sin NFC, pero solo sirven para el modo
simulación.

---

## Cómo abrirlo en Android Studio

Este módulo **no** forma parte del espacio de trabajo de npm del monorepo. Se
abre por separado:

```bash
# 1. Abrir Android Studio
# 2. File > Open...
# 3. Seleccionar la carpeta:
#      <repo>/apps/nfc-android
#    (NO la raíz del monorepo: Gradle no encontraría settings.gradle.kts)
```

En la primera sincronización, Android Studio descarga el wrapper de Gradle y las
dependencias. El binario `gradle/wrapper/gradle-wrapper.jar` **no está
versionado** en este repositorio; si prefiere generarlo a mano:

```bash
cd apps/nfc-android
gradle wrapper --gradle-version 8.7
```

Compilar e instalar:

```bash
./gradlew :app:assembleDebug
./gradlew :app:installDebug
```

Pruebas unitarias (no necesitan dispositivo ni emulador):

```bash
./gradlew :app:testDebugUnitTest
```

La compilación **debug** apunta por defecto a `http://10.0.2.2:3000/`, que es el
host anfitrión visto desde el emulador, es decir, la API del monorepo corriendo
en local (`npm run dev`). La compilación **release** apunta al servidor de
producción y no permite cambiar la dirección desde el teléfono.

---

## Arquitectura

```
ec.marathon.nfcstudio
├── MarathonNfcStudioApp.kt      Application: construye el contenedor
├── MainActivity.kt              Activity única; gestiona el modo lector NFC
├── ContenedorApp.kt             Inyección de dependencias MANUAL
├── EstadoFlujoUnidad.kt         Estado compartido de la unidad en curso
│
├── core/                        Sin dependencias de Android salvo Log
│   ├── Result.kt                Resultado<T> + ErrorApp + mensajes de operario
│   ├── Logging.kt               Registro + RedactorDeSecretos
│   ├── Idempotencia.kt          ClaveIdempotencia + ClavesDeUnidad
│   └── atestacion/              DeviceAttestationProvider + implementación nula
│
├── domain/                      Lógica pura, comprobable en la JVM
│   ├── model/                   EstadoChip, TipoChip, NivelConfianza, …
│   └── usecase/                 ProgramarChip, VincularConJersey, …
│
├── data/
│   ├── api/                     Retrofit, DTO, interceptores, mapeo de errores
│   ├── session/                 AlmacenSesion (cifrado) + PreferenciasApp
│   └── repository/              Autenticación, órdenes, producción, historial
│
├── nfc/                         La capa que habla con los chips
│   ├── NdefCodec.kt             Lógica pura: NDEF URI + TLV de Type 2 Tag
│   ├── TagTransport.kt          Abstracción + transporte simulado
│   ├── AndroidTagTransport.kt   ÚNICO archivo que importa android.nfc.tech.*
│   ├── NfcPersonalizationProvider.kt   El contrato
│   ├── MockNfcProvider.kt       Simulación
│   ├── Ntag21xNdefProvider.kt   NTAG 213/215/216, escritura NDEF real
│   ├── Ntag424DnaProvider.kt    Solo contrato; lanza NotImplementedError
│   ├── LectorNfcAndroid.kt      enableReaderMode + flujo de etiquetas
│   └── DetectorTipoChip.kt      Identificación de familia + fábrica
│
└── ui/                          Compose + Material 3
    ├── Navegacion.kt            Grafo; refleja el flujo obligatorio
    ├── theme/                   Paleta y tipografía para trabajar de pie
    ├── components/              Andamio, banner de simulación, FLAG_SECURE
    └── screens/                 Una carpeta por pantalla (pantalla + ViewModel)
```

### Decisiones que merecen explicación

**Inyección manual, sin Hilt.** El grafo tiene una docena de nodos, todos de
ámbito de aplicación. Hilt añadiría un procesador de anotaciones y generación de
código que **en este entorno no se puede verificar** (no hay SDK ni Gradle
instalados). `ContenedorApp.kt` se lee de arriba abajo en un minuto. Si el
proyecto creciera a varios módulos de features, Hilt sería la elección correcta
y ese archivo es el único que habría que sustituir.

**`Resultado<T>` en lugar de excepciones en las fronteras.** En planta, el fallo
no es excepcional: es frecuente. Un chip que se separa del teléfono a mitad de
escritura no es un error de programa. Modelarlo como valor obliga a que cada
punto de la interfaz decida qué mostrarle al operario.

**El estado sensible no viaja por la navegación.** La URI que se graba en el chip
contiene el token de la unidad. Los argumentos de navegación de Compose acaban en
el `savedInstanceState` del sistema, que puede llegar a disco. Por eso lo
sensible vive en `EstadoFlujoUnidad`, en memoria, y por la navegación solo pasa
el identificador público de una orden.

**Una sola Activity.** El modo lector de NFC se asocia a una Activity concreta;
con varias habría que registrarlo y desregistrarlo en cada transición, y existiría
una ventana en la que un emblema apoyado no se detectaría.

---

## Los tres proveedores NFC

Todos implementan la misma interfaz, portada literalmente de
`packages/nfc-contracts/src/provider.ts`.

### 1. `MockNfcProvider` — simulación

- `isSimulation = true`, `canProduceCryptographicProof = false`.
- Todo payload que emite lleva `simulated = true`. El motor de riesgo del
  servidor trata esa marca como regla dura: una evidencia simulada **jamás**
  produce el nivel `VERIFIED`.
- Permite forzar los fallos que ocurren de verdad (fallo de escritura, relectura
  corrupta, chip que no responde tras la prensa), tanto para las pruebas como
  para formar operarios.

### 2. `Ntag21xNdefProvider` — NTAG 213 / 215 / 216

- Escritura NDEF **real** por `android.nfc.tech.Ndef` (ruta preferida, la
  plataforma gestiona el TLV y el bloque de capacidad) con respaldo crudo por
  `NfcA` para etiquetas que no exponen `Ndef`.
- Relectura y comparación.
- Comprobación de capacidad **antes** de escribir: NTAG213 = 144 B,
  NTAG215 = 504 B, NTAG216 = 888 B de memoria de usuario.
- Manejo de etiquetas de solo lectura: se detecta con `Ndef.isWritable` sin
  escribir nada.
- `canProduceCryptographicProof = false`.
- **Este proveedor NO es un mecanismo anticlonación.** Escribe una URL y la
  vuelve a leer. Nada más.
- El bloqueo irreversible (`lockAllowedAreas`) **no está implementado**: devuelve
  `NOT_IMPLEMENTED` en lugar de fingir éxito. Escribir los lock bytes de un
  NTAG 21x es permanente y no hay hardware con el que validar el offset de cada
  familia.
- La verificación de la firma de originalidad de NXP **no está implementada**:
  exige la clave pública de originalidad del fabricante, que no forma parte de
  este repositorio. Se reporta como `notSupported`, no como `verified = false`
  silencioso.

### 3. `Ntag424DnaProvider` — solo contrato

Todos los métodos operativos lanzan `NotImplementedError` con un mensaje que
explica por qué. Esto es deliberado. Personalizar un NTAG 424 DNA exige tres
cosas que este entorno no tiene:

1. Hardware real para validar cada comando: un error en la configuración de los
   ajustes de fichero o en el orden de cambio de claves deja el chip inutilizable
   de forma **permanente**;
2. la documentación oficial de NXP del conjunto de comandos, que se distribuye
   bajo registro;
3. un custodio de claves (KMS/HSM/SAM) operativo.

Escribir APDU inventados sería **peor** que no escribir nada: produciría un
adaptador que parece funcional, pasa una revisión superficial y destruye
inventario en la primera prueba real. **No hay un solo byte de comando en ese
archivo.**

Puntos de integración documentados en el propio código:

- `personalizeSecureTag`: debe delegar en un servicio de servidor que derive las
  claves diversificadas y devuelva al teléfono **únicamente los APDU ya
  cifrados** que debe retransmitir. El teléfono actúa como túnel: nunca ve una
  clave.
- `readVerificationPayload`: debe devolver el mensaje autenticado **intacto**. La
  validación del CMAC y el descifrado del contador ocurren en el servidor.
- `canProduceCryptographicProof` debe seguir siendo `false` hasta que exista una
  implementación validada contra hardware.

La pantalla de Configuración muestra esta lista de pendientes **dentro de la
aplicación**, para que nadie asuma que ya funciona.

---

## Modo simulación

Se activa desde la pantalla «Estado del teléfono» o desde «Configuración».

Mientras está activo:

- **Un banner naranja permanente** ocupa el ancho completo en la parte superior
  de todas las pantallas, con el texto `MODO SIMULACIÓN — NO ES PRODUCCIÓN REAL`.
  No se puede cerrar, no se desvanece y no se encoge al hacer scroll.
- No se toca ningún chip. El proveedor simulado trabaja sobre memoria.
- Todo lo que se envía al servidor va marcado como `simulated: true`.
- La pantalla de programación ofrece botones para ensayar los tres escenarios que
  el operario debe saber reconocer: todo correcto, fallo de grabación y
  comprobación que no coincide.

El color naranja `NaranjaSimulacion` está reservado en exclusiva para este
banner: ningún otro elemento de la aplicación lo usa, de modo que su presencia en
pantalla significa una sola cosa.

**Para qué sirve:** formar a un operario nuevo sin gastar inventario, y
desarrollar contra la API desde un teléfono sin antena NFC.

**Para qué NO sirve:** para una demostración comercial que sugiera que el
producto está autenticado. El banner está precisamente para impedirlo.

---

## Manual del operario, paso a paso

> Esta sección está escrita para imprimir y pegar en el puesto de trabajo.

### Antes de empezar el turno

1. Compruebe que el teléfono tiene el **NFC encendido**. Si la aplicación le dice
   que está apagado, pulse «Abrir los ajustes de NFC», actívelo y vuelva.
2. Ingrese con **su** correo y contraseña. No use la sesión de un compañero: cada
   emblema queda registrado a nombre de quien lo graba.
3. Si la pantalla dice **«Este teléfono no está habilitado»**, entréguelo al
   supervisor. No intente continuar.
4. Si ve un **banner naranja**, está en modo simulación: nada de lo que haga
   cuenta como producción. Si no era su intención, desactívelo en Configuración.

### Programar un emblema

1. **Elija la orden** en la lista. Verá cuántas unidades faltan.
2. **Compare la ficha de la orden con la etiqueta de la caja de emblemas**: club,
   temporada, modelo y lote. Si algo no cuadra, pare y avise. Este es el momento
   de detectar un cruce de lotes.
3. Pulse **«Empezar a programar»**.
4. **Apoye el emblema** contra la parte de atrás del teléfono, **en el centro**, y
   **no lo mueva**. El teléfono hace varias cosas seguidas y las verá avanzar en
   la lista de pasos.
5. Espere el aviso. Si la pantalla dice **«Se perdió el contacto»**, vuelva a
   apoyar el emblema y pulse «Reintentar con el mismo emblema». Reintentar es
   seguro: el sistema reconoce que es el mismo intento.
6. Cuando aparezca **«Emblema grabado y comprobado»**, pulse «Unir con el jersey».

### Unir el emblema al jersey

1. Escanee o escriba el **código del emblema** (está en el sobre o en la hoja del
   lote).
2. Escanee el **código de barras del jersey** (etiqueta interior). El campo ya
   tiene el foco: si usa lector de anillo o pistola, dispare sin tocar la
   pantalla.
3. Pulse **«Unir emblema y jersey»**.
4. Cuando lea **«Listo para la prensa»**, coloque la unidad en el carro de
   termosellado.

### Después de la prensa

1. Con el jersey ya prensado, apoye **otra vez** el emblema en el teléfono.
2. Si tiene a mano los datos de la prensa (°C, bar, segundos), anótelos. Son
   opcionales: sirven para localizar el problema si mañana aparecen varias
   unidades falladas del mismo turno.
3. Resultado **«Unidad aprobada»** → siga con la siguiente.
4. Resultado **«Unidad en cuarentena»** → **caja roja** y anote en la hoja el
   número de orden.

### Cuando algo va mal

| La pantalla dice | Qué hacer |
|---|---|
| «Se perdió el contacto» | Vuelva a apoyar el emblema sin moverlo y reintente |
| «No se pudo grabar» | Retire el teléfono, vuelva a acercarlo, reintente |
| «Este chip ya está bloqueado» | **Aparte la unidad.** No se puede grabar |
| «La comprobación posterior no coincide» | La unidad va a cuarentena sola. Caja roja |
| «Otro puesto ya tomó esta unidad» | Aparte el emblema y tome el siguiente |
| «El teléfono no tiene conexión» | Acérquese al punto de red y reintente. **No perderá el avance** |
| «Su sesión ya no es válida» | Vuelva a ingresar. No perderá nada de lo ya enviado |

**Apartar una unidad nunca es un problema.** Si duda de un emblema o de un
jersey, apártelo: es lo correcto. El botón de cuarentena está disponible en todo
momento y no hace falta pedir permiso.

### Pendientes de enviar

Si la nave se queda sin cobertura, algunos avisos al sistema pueden quedar
pendientes. La pantalla **«Pendientes de enviar»** los lista y permite
reintentarlos cuando vuelva la red. Reintentar es seguro y no duplica nada.

Lo importante: **la lista de pendientes son avisos, no trabajo por hacer.** El
emblema ya está grabado y el jersey ya está unido; lo que falta es que el sistema
se entere.

---

## Decisiones de seguridad

Cada requisito está documentado con un comentario en el punto exacto del código
donde se implementa. Aquí va el índice:

| Requisito | Dónde |
|---|---|
| **Ninguna clave maestra en la app** | `domain/model/ModelosProduccion.kt` (`ReferenciaClave`), `nfc/NfcPersonalizationProvider.kt` |
| **El operario no puede introducir claves** | `ui/screens/configuracion/ConfiguracionViewModel.kt` — no existe tal campo en ninguna pantalla |
| **Sin secretos en logs** | `core/Logging.kt` (`RedactorDeSecretos`, 9 reglas con su motivo) + `proguard-rules.pro` elimina `Log.v/d/i` en release |
| **Tokens de corta duración cifrados** | `data/session/AlmacenSesion.kt` (`EncryptedSharedPreferences`, AES256-GCM, clave en el Keystore) |
| **`FLAG_SECURE` en vistas sensibles** | `ui/components/PantallaSegura.kt`; se aplica en Login, Programación, Verificación y Configuración |
| **Operaciones idempotentes** | `core/Idempotencia.kt`, `data/api/ApiProduccion.kt` (cabecera obligatoria por firma de método), `data/repository/RepositorioReintentos.kt` |
| **Modo simulación etiquetado** | `ui/components/BannerSimulacion.kt` + `ui/components/Comunes.kt` (`AndamioPlanta` lo impone) |
| **Preparación para Play Integrity** | `core/atestacion/DeviceAttestationProvider.kt` + `InterceptorAtestacion` en `data/api/ClienteHttp.kt` |

Algunas notas adicionales:

- **`Idempotency-Key` es un parámetro obligatorio** en la firma de cada método de
  escritura de `ApiProduccion`. No tiene valor por defecto: el compilador obliga
  a decidir de dónde sale la clave. Es imposible añadir una llamada de escritura
  sin pensarlo.
- **La clave se genera una vez por intento lógico**, no por petición HTTP, y se
  reutiliza intacta en cada reintento. Cambia solo cuando el operario empieza una
  unidad nueva, porque entonces el contenido de la petición también cambia.
- **Se envía el hash del payload grabado, no el payload.** El contenido incluye el
  token del chip y no hay motivo para que circule dos veces por la red.
- **El identificador de dispositivo es un UUID aleatorio por instalación**, no el
  `ANDROID_ID` ni el IMEI. Cumple su función (saber qué teléfono grabó qué chip)
  sin arrastrar un identificador persistente de hardware, y se invalida al
  desinstalar.
- **Tráfico en claro prohibido** salvo hacia direcciones de desarrollo local
  (`res/xml/configuracion_seguridad_red.xml`).
- **Respaldo en la nube y transferencia entre dispositivos desactivados**
  (`res/xml/reglas_extraccion_datos.xml`): restaurar el almacén cifrado en otro
  teléfono equivaldría a clonar una credencial de planta.
- **El registro de red nunca usa `Level.BODY` ni `Level.HEADERS`**, ni en debug.
- **La URL del servidor solo es editable en compilaciones debug.** En release,
  apuntar el teléfono a otro servidor sería una forma trivial de exfiltrar la
  producción.

---

## Pruebas

Pruebas unitarias **JVM puras** (JUnit 4 + `kotlin.test`), sin dispositivo ni
emulador:

```bash
./gradlew :app:testDebugUnitTest
```

| Archivo | Qué comprueba |
|---|---|
| `nfc/NdefCodecTest.kt` | Codificación **byte a byte** contra la especificación RTD-URI (no solo ida y vuelta), los 36 prefijos, selección del prefijo más largo, registro corto y registro largo, decodificación defensiva de mensajes truncados, TLV corto y de tres bytes, el umbral exacto de 255 bytes, relleno con TLV nulos, capacidad de cada familia NTAG |
| `domain/EstadoChipTest.kt` | Los 13 estados, el recorrido completo de producción, los saltos prohibidos (en especial `PROGRAMMED → LINKED`, que se saltaría la relectura), el bucle `PERSONALIZING → PERSONALIZING` del reintento seguro, alcanzabilidad de cuarentena, terminalidad de `DESTROYED` y `REVOKED` |
| `nfc/MockNfcProviderTest.kt` | Ciclo completo, fallo de escritura, relectura corrupta, memoria destrozada por el calor, chip bloqueado, URI que no cabe, bloqueo, contador de lecturas; y las **garantías de seguridad** del simulador (`isSimulation`, `canProduceCryptographicProof`, `simulated`, `authenticatedMessage = null`). Además ejercita el proveedor NTAG 21x **real** sobre el transporte simulado |
| `core/RedactorDeSecretosTest.kt` | Cada fuga concreta: `Bearer`, contraseña en JSON, campos sensibles, cadenas de consulta, UID, volcados hexadecimales, `tagToken` en base64url, último segmento de la URL de verificación, bloques PEM; que **no** altere los mensajes de operario; idempotencia |

Las pruebas de `NdefCodecTest` comparan contra bytes literales escritos a mano a
partir de la especificación, no contra el resultado de la propia función: una
prueba que dice `decode(encode(x)) == x` no detecta un error de formato que ambas
funciones compartan. Es el seguro de que esta implementación y la de TypeScript
producen los mismos bytes.

---

## Qué NO está probado

**Esta sección es la más importante del documento. Léala antes de llevar la
aplicación a la planta.**

El entorno en el que se escribió este código **no tenía Android SDK, ni Gradle,
ni un JDK moderno instalados**. En consecuencia:

### No se compiló

- El proyecto **nunca se ha compilado**. No ha pasado por el compilador de Kotlin
  ni por AGP. Es previsible que la primera sincronización en Android Studio
  requiera correcciones: importaciones que sobran o faltan, una firma de API que
  cambió entre versiones de Compose, un `when` que el compilador considere no
  exhaustivo.
- Las **versiones de dependencias** de `gradle/libs.versions.toml` son versiones
  publicadas y mutuamente compatibles según la documentación oficial, pero **no
  se han resuelto ni descargado**. La pareja Kotlin 1.9.24 ↔ extensión del
  compilador de Compose 1.5.14 es la que exige la tabla de compatibilidad
  oficial; si se sube una, hay que subir la otra.
- Las **pruebas unitarias nunca se han ejecutado**. Están escritas para ser
  significativas, no para pasar: es posible que alguna revele un error real de la
  implementación en su primera ejecución. Eso es lo que se espera de ellas.
- `gradle/wrapper/gradle-wrapper.jar` **no está en el repositorio** (es un
  binario y no había Gradle con el que generarlo). Android Studio lo descarga
  solo.

### No se probó en hardware

**Nada de lo relacionado con NFC se ha ejecutado contra un chip real.** En
concreto:

- **Escritura, relectura y comparación**: la lógica está escrita y la parte pura
  (`NdefCodec`) está probada en la JVM, pero la ruta completa hacia un chip
  físico no se ha ejercitado nunca.
- **`GET_VERSION` (0x60) y la identificación de familia**: el formato de la
  respuesta de 8 bytes y los valores de tamaño de almacenamiento
  (`0x0F`/`0x11`/`0x13` → NTAG 213/215/216) provienen de las hojas de datos
  públicas de NXP. **No se han comprobado contra chips reales.** La vía de
  respaldo (inferir la familia por `Ndef.getMaxSize()`) tampoco.
- **Lectura y escritura crudas por `NfcA`** (comandos `READ` 0x30 y `WRITE`
  0xA2, con la lógica de lectura-modificación-escritura para rangos no alineados
  a página): sin validar contra hardware.
- **Compatibilidad entre modelos de teléfono**: `enableReaderMode`, el retardo
  del chequeo de presencia (500 ms) y el comportamiento al alternar entre las
  tecnologías `Ndef` y `NfcA` varían entre fabricantes y versiones de Android.
  **No se ha probado en ningún dispositivo.** El valor de 500 ms es un punto de
  partida razonable, no un valor medido.
- **Distancia y orientación de acoplamiento**: la instrucción «apoye el emblema
  en el centro de la parte de atrás» asume que la antena NFC está ahí. En varios
  modelos está en la parte superior. **Hay que medirlo en los teléfonos concretos
  del puesto y ajustar el texto.**

### Funcionalidad declarada pendiente

| Qué | Por qué falta |
|---|---|
| **Personalización de NTAG 424 DNA** | Requiere hardware, documentación oficial de NXP y un custodio de claves. Todos los métodos lanzan `NotImplementedError` |
| **Bloqueo irreversible de NTAG 21x** | `Ndef.makeReadOnly()` sería la vía correcta, pero es permanente y el flujo de confirmación con el operario no se ha podido ensayar. Devuelve `NOT_IMPLEMENTED` |
| **Firma de originalidad de NXP (`READ_SIG`)** | Falta la clave pública de originalidad del fabricante, que no está en este repositorio. Se reporta como `notSupported` |
| **Play Integrity** | Necesita la app dada de alta en Google Play Console, la clave de descifrado del veredicto y el endpoint de verificación en la API. La interfaz y el interceptor ya están montados |
| **Escaneo con la cámara** | Hoy los códigos se introducen por teclado (o por lector externo, que se presenta al sistema como teclado). La cámara necesita permiso, biblioteca de decodificación y pruebas de enfoque sobre etiqueta impresa en tela |
| **Transición explícita a `READY_FOR_HEAT_PRESS`** | La lista de endpoints acordada no incluye una operación para ese paso. La app asume que el servidor lo hace al vincular la unidad y, si el servidor no lo confirma, **lo dice en pantalla** en lugar de darlo por hecho |
| **Sonido y vibración de confirmación** | El texto del manual habla de «espere a que suene». La reproducción del aviso acústico está pendiente: hay que elegir un sonido audible sobre el ruido de la nave, y eso se decide midiendo en la nave |
| **Pruebas de interfaz** | No hay pruebas de Compose ni instrumentadas. Requieren emulador o dispositivo |

### Antes de usarlo en producción

1. Compilar y corregir lo que salga.
2. Ejecutar las pruebas unitarias y corregir lo que salga.
3. Validar la ruta NFC completa con **chips de descarte**, no con inventario.
4. Medir la posición de la antena en el modelo de teléfono del puesto y ajustar
   las instrucciones de la interfaz.
5. Ensayar el ciclo completo con la prensa real, incluido el caso del chip que
   muere en la prensa.
6. Revisar con el equipo de la API que el estado que devuelve la vinculación es
   `READY_FOR_HEAT_PRESS`.
7. Decidir e implementar el aviso acústico.

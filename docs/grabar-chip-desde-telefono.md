# Grabar un chip NFC desde un teléfono

Guía para preparar una camiseta y grabar su chip con un teléfono corriente y una
app gratuita de escritura NFC. Es el camino para **pruebas y pilotos pequeños**,
mientras la app Android de planta (`apps/nfc-android`) no esté compilada.

Para la línea de producción, ver [protocolo-programacion.md](protocolo-programacion.md).

---

## Lo que necesitas

| | |
|---|---|
| Chips | NTAG 213, 215 o 216 **en blanco y sin bloquear** |
| Teléfono | Android con NFC, o iPhone 7 o posterior |
| App | **NFC Tools** (gratuita, Android e iOS). Cualquier escritor NDEF sirve |
| Red | El teléfono y el ordenador en la **misma red WiFi** |

---

## Por qué `localhost` no sirve

Es el error más fácil de cometer y el más difícil de diagnosticar: la escritura
funciona, el chip queda grabado, y cuando el aficionado acerca el teléfono **no
se abre nada**.

`localhost` significa "este mismo aparato". En el chip acaba una dirección que
apunta al propio teléfono del aficionado, donde no hay ningún servidor.

La dirección grabada tiene que ser una que **el teléfono del aficionado** pueda
abrir:

| Situación | Dirección a usar |
|---|---|
| Pruebas en tu WiFi | La IP de red del ordenador, p. ej. `http://192.168.1.119:3000` |
| Demostración fuera de tu red | Un túnel (`cloudflared`, `ngrok`) que dé una URL pública |
| Producción | El dominio real, p. ej. `https://escudovivo.marathon.ec` |

La API **rechaza** grabar una dirección a `localhost` o `127.0.0.1`, con un
mensaje que explica qué usar en su lugar.

---

## Paso a paso

### 1. Arranca los servicios

```bash
npm run db:up                  # PostgreSQL
npm run dev                    # API           :4000
npm run dev -w @mev/fan-web    # Web            :3000
npm run dev -w @mev/admin-web  # Panel          :3001
```

Los tres escuchan en toda la red (`-H 0.0.0.0`), no solo en `localhost`. Es
justo lo que permite que el teléfono los alcance.

### 2. Averigua la dirección de red del ordenador

En macOS y Linux:

```bash
ipconfig getifaddr en0     # macOS
hostname -I | awk '{print $1}'   # Linux
```

No hace falta memorizarla: el panel la detecta y la ofrece ya seleccionada.

### 3. Abre el panel **en el teléfono**

Escribe en el navegador del teléfono:

```
http://<IP-del-ordenador>:3001/produccion/programar
```

Por ejemplo `http://192.168.1.119:3001/produccion/programar`.

Entra con una cuenta que tenga permiso `production:activate` (en la demostración,
`marathon@escudovivo.local`).

### 4. Prepara la camiseta

En la pantalla **Grabar un chip NFC**:

1. **Dirección que abrirá el aficionado** — viene preseleccionada con la IP de tu
   red. Cámbiala solo si usas un túnel o un dominio.
2. **Modelo y talla** — elige el SKU.
3. **Jugador** — opcional; si lo eliges, su dorsal sale en grande en la pantalla
   del aficionado.
4. Pulsa **Preparar y obtener la dirección**.

### 5. Graba el chip

La pantalla muestra la dirección y un botón **Copiar dirección**.

> **La dirección se muestra una sola vez.** El sistema guarda su identificador
> cifrado y no puede recuperarlo. Si la pierdes, prepara otra camiseta.

Con la dirección copiada:

1. Abre **NFC Tools**.
2. Pestaña **Escribir** → **Añadir un registro** → **URL / Dirección web**.
3. Pega la dirección.
4. Pulsa **Escribir / Write**.
5. Apoya el teléfono sobre el chip y **no lo muevas** hasta que confirme.

**No actives "proteger contra escritura" ni "bloquear" en pruebas.** Es
irreversible: si algo sale mal, el chip queda inservible para siempre.

### 6. Compruébalo

Aparta el teléfono, vuelve a acercarlo al chip. Debe abrirse la pantalla de la
camiseta con el escudo verde y **Camiseta oficial**.

Si no se abre nada, ver más abajo.

---

## Dónde apoyar el teléfono

La antena NFC no está en el mismo sitio en todos los teléfonos:

| Teléfono | Antena |
|---|---|
| iPhone | Borde superior, junto a la cámara trasera |
| Android (mayoría) | Centro de la parte trasera, o tercio superior |

Si no lee, prueba a mover el teléfono despacio por la parte de atrás hasta que
vibre o suene.

---

## Si algo falla

| Síntoma | Causa más probable | Qué hacer |
|---|---|---|
| Un chip que **ayer funcionaba** hoy no abre nada | **La IP del ordenador cambió** (el router las reparte por DHCP) | Comprueba la IP actual y regraba. Ver abajo |
| Se graba, pero al acercar no abre nada | La dirección era `localhost` | Prepara otra con la IP de red |
| "No se pudo escribir" | El chip está bloqueado o se movió el teléfono | Usa un chip nuevo; apóyalo sin moverlo |
| El teléfono no detecta el chip | NFC desactivado, o antena mal colocada | Actívalo en ajustes; mueve el teléfono por la parte trasera |
| Se abre pero dice "Casi lo tenemos" | El teléfono no alcanza el servidor | Comprueba que está en la misma WiFi |
| Se abre pero dice "No se pudo verificar" | La dirección se grabó incompleta | Prepara otra camiseta y regraba |
| El iPhone no abre nada al acercarlo | iPhone anterior al 7, o iOS antiguo | Usa el código QR de respaldo |

---

### La IP de tu ordenador caduca

Es el fallo más desconcertante de todos, porque el chip **funcionaba y deja de
funcionar sin que nadie lo toque**.

El router reparte las IP de la red por DHCP y las renueva cada cierto tiempo. Si
tu ordenador pasa de `192.168.1.119` a `192.168.1.148`, todos los chips grabados
con la dirección vieja apuntan a un sitio donde ya no hay nada.

Para pruebas de un rato no importa. Si vas a dejar chips grabados varios días:

- **Fija la IP del ordenador** en la configuración del router (reserva por MAC), o
- **Usa un túnel con dominio estable**, o
- **Usa el dominio real** cuando lo tengas.

El panel siempre muestra la IP actual, así que ante la duda vuelve a
`/produccion/programar` y compara.

---

## Qué NO hace este camino

Conviene tenerlo claro para no confundirlo con la línea de producción:

- **No registra el UID real del chip.** Una app genérica no lo reporta, así que
  la unidad se guarda con un identificador sintético con prefijo `PILOT-`. En el
  panel se distingue a simple vista de una unidad de producción.
- **No hay relectura verificada por el servidor.** En la línea de planta, la app
  relee el chip y el servidor compara con lo que ordenó grabar. Aquí la
  comprobación la haces tú acercando el teléfono.
- **No hay control posterior al termosellado.** Ver
  [protocolo-termosellado.md](protocolo-termosellado.md).
- **No autentica criptográficamente.** Una NTAG 21x guarda una dirección que
  cualquier teléfono puede copiar a otra etiqueta. Por eso la pantalla dice
  *"Camiseta oficial · Registrada en el sistema oficial de Marathon"* y no
  *"verificada"*. Ver [limitaciones.md](limitaciones.md) y
  [guia-ntag424-dna.md](guia-ntag424-dna.md).

---

## Para enseñarlo fuera de tu WiFi

Mientras uses la IP de tu red (`192.168.x.x`), el chip **solo funciona con el
teléfono conectado a esa misma WiFi**. Desde datos móviles no abre nada.

Un túnel da una URL pública temporal que funciona desde cualquier red.

### Instalar cloudflared

No necesita cuenta. Es un único binario; se descarga dentro del proyecto para no
tocar nada del sistema:

```bash
cd <raíz-del-repositorio>
mkdir -p tools
curl -L -o tools/cloudflared.tgz \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
tar -xzf tools/cloudflared.tgz -C tools/ && rm tools/cloudflared.tgz
chmod +x tools/cloudflared
./tools/cloudflared --version
```

En un Mac Intel, cambia `darwin-arm64` por `darwin-amd64`. Comprueba cuál
necesitas con `uname -m` (`arm64` o `x86_64`).

### Abrir el túnel

```bash
./tools/cloudflared tunnel --url http://localhost:3000
```

Entre la salida aparece una línea como:

```
https://palabra-palabra-palabra.trycloudflare.com
```

Esa es la dirección pública. Déjalo abierto en su terminal: si lo cierras, el
túnel muere.

### Usarla

Al preparar la camiseta en `/produccion/programar`, el desplegable de direcciones
no la incluye (el servidor no puede adivinarla). Pégala a mano en el campo, o usa
la API directamente:

```bash
curl -X POST http://localhost:4000/api/v1/admin/tags/provision \
  -H "authorization: Bearer <token>" -H 'content-type: application/json' \
  -d '{"skuCode":"AND-HOME-26-M","baseUrl":"https://TU-TUNEL.trycloudflare.com"}'
```

### Tres avisos que importan

- **La URL cambia en cada arranque.** Un chip grabado hoy deja de funcionar en
  cuanto reinicies el túnel. Sirve para una demostración, **no** para dejar chips
  grabados.
- **Expone tu servidor a internet** mientras esté abierto, incluido el panel si
  también lo tuneleas. Tunela solo el puerto 3000 (la web del aficionado) y
  ciérralo al terminar.
- **El Mac tiene que seguir encendido** y sin dormir.

Para chips que funcionen siempre y en cualquier sitio hace falta un despliegue
real con dominio fijo. Ver [piloto-a-produccion.md](piloto-a-produccion.md).

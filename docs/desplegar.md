# Subirlo a internet

Guía para que los chips funcionen **desde cualquier red**, sin depender de tu
ordenador y sin que la dirección cambie.

Es el único camino que permite grabar chips de verdad. Mientras uses la IP de tu
WiFi (`192.168.x.x`), un chip solo funciona en tu casa y deja de funcionar cada
vez que el router cambia la IP.

---

## Qué hay que levantar

| Pieza | Qué es | ¿Público? |
|---|---|---|
| **Base de datos** | PostgreSQL 16 | No. Solo accesible por la API |
| **API** | `apps/api`, puerto 4000 | No hace falta exponerla |
| **Web del aficionado** | `apps/fan-web`, puerto 3000 | **Sí.** Es la que abre el chip |
| **Panel** | `apps/admin-web`, puerto 3001 | **No.** Ver el aviso de abajo |

> **El panel no debe quedar abierto a internet.** Da acceso a datos personales de
> aficionados y al UID de los chips. Ponlo detrás de una VPN, una lista de IP
> permitidas, o la autenticación del proveedor. Su propio inicio de sesión existe,
> pero todavía **no tiene segundo factor** (ver [limitaciones.md](limitaciones.md)).

Los tres servicios tienen `Dockerfile`. Se construyen **desde la raíz** del
repositorio, no desde su carpeta:

```bash
docker build -f apps/api/Dockerfile      -t escudo-vivo-api   .
docker build -f apps/fan-web/Dockerfile  -t escudo-vivo-fan   .
docker build -f apps/admin-web/Dockerfile -t escudo-vivo-admin .
```

---

## Dónde alojarlo

Cualquier proveedor que lea un `Dockerfile` sirve. Para un piloto:

| Opción | A favor | En contra |
|---|---|---|
| **Railway** | Postgres incluido, lee Dockerfiles, dominio gratis, despliega desde GitHub | De pago desde ~5 USD/mes |
| **Render** | Tiene nivel gratuito | El gratuito se duerme; la base de datos gratis caduca |
| **Fly.io** | Barato, servidores cerca de Ecuador | Más configuración manual |
| **Vercel + Neon** | Lo mejor para las webs Next | La API Fastify necesita otro sitio |

Para el piloto, **Railway** es lo más sencillo: una cuenta, una factura, los tres
servicios y la base de datos en el mismo sitio.

---

## Pasos

### 1. Subir el código a GitHub

Casi todos los proveedores despliegan desde un repositorio. Comprueba antes que
`.env` **no** se sube (ya está en `.gitignore`).

### 2. Crear la base de datos

En el proveedor, añade un PostgreSQL. Te dará una cadena de conexión tipo:

```
postgresql://usuario:clave@host:5432/basededatos
```

### 3. Generar los secretos de verdad

**No reutilices los del `.env.example`.** La API se niega a arrancar si los
detecta, a propósito.

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 48   # TOKEN_HASH_PEPPER
openssl rand -base64 24   # ANALYTICS_IP_SALT
```

> `TOKEN_HASH_PEPPER` es el más delicado: con él se calculan los identificadores
> guardados de los chips. **Si lo cambias, todos los chips grabados dejan de
> reconocerse.** Guárdalo donde no se pierda.

### 4. Variables de la API

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | La del paso 2 |
| `SESSION_SECRET` | Generado en el paso 3 |
| `TOKEN_HASH_PEPPER` | Generado en el paso 3 |
| `ANALYTICS_IP_SALT` | Generado en el paso 3 |
| `NFC_PROVIDER` | `ntag21x` |
| `FAN_WEB_PUBLIC_URL` | `https://tu-dominio.com` |
| `ADMIN_WEB_PUBLIC_URL` | La URL del panel |
| `API_PORT` | El que pida el proveedor (a menudo `PORT`) |

`NFC_PROVIDER=ntag21x` es lo que apaga el aviso de **"entorno de prueba · lectura
simulada"** en la pantalla del aficionado. Con `mock`, la API ni siquiera arranca
en producción.

### 5. Variables de las webs

| Variable | Valor |
|---|---|
| `API_ORIGIN` | URL interna de la API, p. ej. `http://api:4000` |
| `NODE_ENV` | `production` |

El navegador **nunca** llama a la API directamente: va por el propio servidor de
Next. Por eso la API no necesita estar expuesta ni abrir CORS a nadie.

### 6. El dominio

Apunta tu dominio a la web del aficionado. **Cuanto más corto, mejor**: la URL
entera tiene que caber en 144 bytes de una NTAG213.

```
https://escudovivo.marathon.ec/v/<43 caracteres>   ← ~75 bytes, entra de sobra
```

Con HTTPS, además, iOS abre el enlace del chip sin preguntar tanto.

### 7. Datos iniciales

La imagen de la API aplica las migraciones sola al arrancar. Para cargar el
catálogo de demostración, una vez:

```bash
DATABASE_URL="<la de produccion>" npm run db:seed -w @mev/api
```

> **No ejecutes la semilla en una base con datos reales.** Lo primero que hace es
> vaciar todas las tablas.

### 8. Grabar los chips definitivos

Con el dominio en marcha, en `/produccion/programar` escribe tu dominio real en
**Dirección que abrirá el aficionado**. Esos chips ya funcionan desde cualquier
red y para siempre.

---

## Antes de enseñárselo a nadie

- [ ] El panel **no** es accesible desde internet abierto
- [ ] Los secretos son los generados, no los del ejemplo
- [ ] `TOKEN_HASH_PEPPER` guardado en sitio seguro y respaldado
- [ ] HTTPS activo en el dominio del aficionado
- [ ] Copias de seguridad de la base de datos activadas
- [ ] Comprobado que un chip grabado abre bien **desde datos móviles**, no solo WiFi

---

## Lo que sigue sin resolver

Subirlo a internet arregla el alcance, no la seguridad del chip. Con NTAG 213 la
URL grabada **se puede copiar a otra etiqueta**, y por eso la pantalla dice
*"Camiseta oficial · Registrada"* y no *"verificada"*.

Para autenticación de verdad hacen falta chips NTAG 424 DNA y completar la
integración: [guia-ntag424-dna.md](guia-ntag424-dna.md).

Tampoco queda resuelto el planificador de tareas (la política de retención se
aplica a mano), ni el segundo factor del panel. Ver
[limitaciones.md](limitaciones.md) y [piloto-a-produccion.md](piloto-a-produccion.md).

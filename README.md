# Marathon Escudo Vivo

MVP de autenticación NFC para emblemas de jerseys de fútbol. Monorepo con la
experiencia web del aficionado, el panel administrativo, la API, la aplicación
Android interna de programación de chips y la documentación operativa.

---

## Lo primero, porque condiciona todo lo demás

**Identificar no es autenticar.**

- **Identificar** = el sistema reconoce a qué unidad se refiere un identificador
  presentado. Cualquiera que copie ese identificador logra lo mismo.
- **Autenticar** = la unidad demuestra poseer un secreto que no puede extraerse
  ni reproducirse trivialmente, mediante una operación criptográfica ejecutada
  por el propio chip.

Una URL estática, un UID legible, un código QR o una etiqueta NTAG 213 **sólo
permiten identificar**. Las NTAG 213/215/216 **no son una solución
anticlonación robusta**: su contenido NDEF es copiable con cualquier teléfono, y
existen en el mercado etiquetas con UID configurable.

**En este despliegue, ninguna lectura puede alcanzar el nivel `VERIFIED`.** El
adaptador de NTAG 424 DNA está definido como contrato pero **no implementado**,
porque hacerlo requiere hardware, la documentación oficial de NXP y un custodio
de claves. El máximo alcanzable hoy es `IDENTIFIED_ONLY`, y el sistema lo dice
con claridad al aficionado en lugar de maquillarlo.

Ver [`docs/limitaciones.md`](docs/limitaciones.md) y
[`docs/modelo-amenazas.md`](docs/modelo-amenazas.md).

---

## Niveles de confianza

| Nivel | Significado | Cómo se alcanza hoy |
|---|---|---|
| `VERIFIED` | El chip ejecutó una operación criptográfica válida, verificada en servidor. | **Inalcanzable** — requiere NTAG 424 DNA integrado |
| `IDENTIFIED_ONLY` | Se reconoció el producto, sin prueba criptográfica. | Lectura NDEF o QR |
| `SUSPICIOUS` | El identificador es conocido pero el patrón de uso sugiere copia o abuso. | Cuarentena, replay, o acumulación de señales |
| `UNVERIFIABLE` | No hay datos suficientes para emitir un juicio. | Token desconocido o payload ilegible |
| `REVOKED` | La unidad o el chip fueron dados de baja administrativamente. | Revocación desde el panel |
| `NOT_ACTIVATED` | La unidad existe pero no completó la activación comercial. | Lectura antes de salir de producción |

Una anomalía geográfica aislada **nunca** declara falso un jersey: una VPN o el
roaming producen el mismo patrón. Ver
[`packages/domain/src/risk/engine.ts`](packages/domain/src/risk/engine.ts).

---

## Estructura

```
apps/
  api/            API REST (Fastify + Prisma + PostgreSQL), OpenAPI generado
  fan-web/        Web móvil del aficionado (Next.js 15, App Router)
  admin-web/      Panel administrativo (Next.js 15)
  nfc-android/    "Marathon NFC Studio" (Kotlin + Jetpack Compose) — NO compilado aquí
packages/
  domain/         Reglas de negocio puras: confianza, estados, riesgo, RBAC, privacidad
  nfc-contracts/  Abstracción de proveedores NFC + codificación NDEF real
  ui/             Componentes accesibles compartidos
infra/            Docker Compose (PostgreSQL + correo simulado)
docs/             Arquitectura, amenazas, protocolos, privacidad, limitaciones
```

Dependencias: `apps/*` → `packages/*`. `packages/domain` no depende de nada del
proyecto y no conoce HTTP, base de datos ni hardware.

---

## Requisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node.js | ≥ 20.11 (probado en 22.23) | Todo el monorepo |
| npm | ≥ 10 | Workspaces |
| Docker | cualquiera reciente | PostgreSQL y correo simulado |
| JDK 17 + Android SDK 34 | — | **Sólo** para la app Android (no requerido para el resto) |

---

## Puesta en marcha

```bash
# 1. Variables de entorno. Ningún valor del ejemplo es un secreto real.
cp .env.example .env

# 2. Dependencias
npm install

# 3. PostgreSQL y correo simulado (Mailpit en http://localhost:8025)
npm run db:up

# 4. Compilar los paquetes de dominio (la API y las webs los consumen)
npm run build -w @mev/domain
npm run build -w @mev/nfc-contracts

# 5. Migraciones y datos de demostración
npm run db:migrate
npm run db:seed
```

El comando `npm run setup` ejecuta los pasos 2 a 5 de una vez.

> **Puertos.** PostgreSQL se publica en **5434** porque 5432 y 5433 suelen estar
> ocupados por otros proyectos locales. Si 5434 también lo está, cámbielo en
> `infra/docker-compose.yml` y en `DATABASE_URL` de su `.env`.

### Arrancar los servicios

```bash
npm run dev                  # API en http://localhost:4000
npm run dev -w @mev/fan-web  # Web del aficionado en http://localhost:3000
npm run dev -w @mev/admin-web # Panel en http://localhost:3001
```

- Documentación OpenAPI: <http://localhost:4000/openapi.json>
- Estado del servicio: <http://localhost:4000/health>

### Probar la experiencia del aficionado

`npm run db:seed` imprime al final las URL de verificación de demostración.
Equivalen a acercar el teléfono a cada emblema. Cubren los seis niveles de
confianza:

```
.../v/<token>   → unidad activada        → IDENTIFIED_ONLY
.../v/<token>   → unidad revocada        → REVOKED
.../v/<token>   → unidad en producción   → NOT_ACTIVATED
.../v/<token>   → unidad en cuarentena   → SUSPICIOUS
.../q/<token>   → código QR de respaldo  → IDENTIFIED_ONLY (nunca VERIFIED)
```

### Cuentas de demostración

Contraseña de todas: `EscudoVivo2026!` — **sólo para desarrollo local**.

| Correo | Rol |
|---|---|
| `super@escudovivo.local` | Superadministrador |
| `marathon@escudovivo.local` | Administrador de Marathon |
| `club@escudovivo.local` | Administrador del club (alcance: un club) |
| `operario@escudovivo.local` | Operario de producción |
| `soporte@escudovivo.local` | Soporte |
| `agencia@escudovivo.local` | Agencia de contenidos |
| `patrocinador@escudovivo.local` | Patrocinador (alcance: una campaña) |
| `hincha@escudovivo.local` | Aficionado con una prenda |
| `hincha2@escudovivo.local` | Aficionado sin prendas |

Identificador del teléfono autorizado para la app Android:
`demo-device-android-0001`.

---

## Pruebas, lint y compilación

```bash
npm run lint         # ESLint en todo el monorepo
npm run typecheck    # tsc --noEmit en cada paquete
npm run build        # Compilación de todos los paquetes y apps
npm test             # Todas las suites
```

Las pruebas de la API necesitan una base de datos de pruebas **separada**:

```bash
docker exec mev-postgres psql -U marathon -d postgres -c "CREATE DATABASE escudo_vivo_test OWNER marathon;"
DATABASE_URL="postgresql://marathon:marathon_dev_only@localhost:5434/escudo_vivo_test?schema=public" \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm test -w @mev/api
```

### Qué está probado y qué no

| Tipo | Estado |
|---|---|
| Pruebas unitarias del dominio (confianza, riesgo, estados, RBAC, privacidad) | **Automatizadas** |
| Codificación y decodificación NDEF, capacidad por familia de chip | **Automatizadas** |
| Proveedor NFC simulado y proveedor NTAG 21x sobre transporte simulado | **Automatizadas** (lógica real, hardware simulado) |
| API: verificación, autorización, idempotencia, transferencias, privacidad, circuito de soporte | **Automatizadas** contra PostgreSQL real |
| Flujo de producción completo de extremo a extremo | **Automatizado** con proveedor NFC **simulado** |
| Escritura NDEF sobre un chip físico | **Pendiente** — requiere hardware |
| NTAG 424 DNA | **Pendiente** — requiere hardware, SDK y custodio de claves |
| Compilación de la app Android | **No verificada** — este entorno no tiene Android SDK ni Gradle |
| Ensayos físicos del emblema (calor, lavado, flexión, extracción…) | **Pendiente** — protocolo en [`docs/pruebas-fisicas.md`](docs/pruebas-fisicas.md) |

Ninguna afirmación de esta tabla se apoya en hardware que no exista.

---

## Seguridad y privacidad, en breve

- **Las claves maestras NFC no están en este repositorio, ni en la base de datos,
  ni en la app móvil.** La tabla `NfcKeyReference` guarda únicamente referencias
  opacas al custodio. Ver [`docs/plan-gestion-claves.md`](docs/plan-gestion-claves.md).
- Los tokens de alta entropía (chip, QR, transferencia) se almacenan **sólo
  hasheados** con pimienta de servidor. El valor en claro existe una vez y se
  descarta.
- Existen **tres espacios de identificadores separados y no derivables entre sí**:
  interno (UUID), público (`MEV-XXXXXXXX`, mostrado enmascarado) y el token del
  chip. El QR usa un cuarto, para que fotografiarlo no revele el del NFC.
- **Verificar un jersey no requiere cuenta ni aceptar publicidad.** Marketing,
  ubicación, métricas para patrocinadores y personalización son consentimientos
  separados, y todos empiezan desactivados.
- Las IP se **truncan y seudonimizan** antes de persistirse. Nunca se guarda
  ubicación precisa sin consentimiento explícito.
- Un patrocinador **nunca** accede a datos personales: sólo a métricas agregadas
  de su campaña, con supresión de cohortes pequeñas.
- El arranque en producción **aborta** si detecta un secreto de ejemplo o el
  proveedor NFC simulado.

---

## Documentación

| Documento | Contenido |
|---|---|
| [`docs/arquitectura.md`](docs/arquitectura.md) | Componentes, decisiones técnicas y sus razones |
| [`docs/modelo-datos.md`](docs/modelo-datos.md) | Entidades, relaciones, restricciones, ciclo de vida |
| [`docs/modelo-amenazas.md`](docs/modelo-amenazas.md) | Amenaza por amenaza: controles y **riesgo residual** |
| [`docs/plan-gestion-claves.md`](docs/plan-gestion-claves.md) | Jerarquía de claves, custodios, rotación |
| [`docs/guia-ntag424-dna.md`](docs/guia-ntag424-dna.md) | Cómo completar la integración criptográfica |
| [`docs/matriz-roles-permisos.md`](docs/matriz-roles-permisos.md) | Tabla rol × permiso y modelo de alcances |
| [`docs/politica-logs.md`](docs/politica-logs.md) | Qué se registra, qué no, y retención |
| [`docs/privacidad-lopdp.md`](docs/privacidad-lopdp.md) | Principios de la LOPDP aplicados |
| [`docs/grabar-chip-desde-telefono.md`](docs/grabar-chip-desde-telefono.md) | **Grabar un chip con un teléfono y NFC Tools** (pruebas y pilotos) |
| [`docs/desplegar.md`](docs/desplegar.md) | **Subirlo a internet** para que los chips funcionen desde cualquier red |
| [`docs/protocolo-programacion.md`](docs/protocolo-programacion.md) | Procedimiento de planta paso a paso |
| [`docs/protocolo-termosellado.md`](docs/protocolo-termosellado.md) | Parámetros y criterios de la prensa |
| [`docs/pruebas-fisicas.md`](docs/pruebas-fisicas.md) | Protocolo de ensayos físicos + formulario |
| [`docs/guia-panel.md`](docs/guia-panel.md) | Manual del panel por rol |
| [`docs/integracion-tienda.md`](docs/integracion-tienda.md) | Conexión con la tienda electrónica |
| [`docs/limitaciones.md`](docs/limitaciones.md) | **Lista honesta de lo que falta** |
| [`docs/piloto-a-produccion.md`](docs/piloto-a-produccion.md) | Camino de 1.000 jerseys a producción |
| [`apps/nfc-android/README.md`](apps/nfc-android/README.md) | Manual del operario y requisitos Android |

---

## Aviso sobre marcas y datos de demostración

El club de demostración (**Deportivo Andino FC**), sus jugadores, su patrocinador
y sus colores son **ficticios**. No se utiliza ningún escudo, nombre de club,
fotografía de jugador ni marca protegida. Los activos visuales son formas
geométricas genéricas.

Los datos de demostración no contienen información de personas reales.

---

## Licencia

Sin licencia pública. Uso interno.

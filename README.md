# Filo Atlántico

Juego web de carreras de motos para dos jugadores, construido con Three.js y una simulación autoritativa. La experiencia está diseñada en español y utiliza una identidad visual original inspirada en el motociclismo arcade de alta velocidad, sin reutilizar assets ni marcas de otros juegos.

## Arquitectura

```text
apps/
  web/          Cliente Three.js, interfaz, audio y controles
  server/       Servidor Colyseus autoritativo y endpoint de salud
packages/
  protocol/     Estado sincronizado, mensajes y validación compartida
  simulation/   Simulación determinista independiente del render
```

El cliente crea una sala `private_race` y comparte su `roomId` como código de invitación. El segundo jugador entra mediante `joinById`. Las salas no aparecen en listados, admiten exactamente dos pilotos, validan todos los mensajes y avanzan con un tick fijo de 60 Hz. El estado se replica a 20 Hz.

## Requisitos

- Node.js 22 o superior.
- pnpm 10.17.1.
- Navegador moderno con WebGL 2.

## Puesta en marcha

```bash
pnpm install
pnpm dev
```

Servicios locales:

- Web: URL mostrada por Vite, normalmente `http://localhost:5173`.
- WebSocket/HTTP: `http://localhost:2567`.
- Salud: `GET http://localhost:2567/health`.

Para ejecutarlos por separado:

```bash
pnpm dev:web
pnpm dev:server
```

Variables opcionales del servidor:

| Variable         | Predeterminado | Uso                        |
| ---------------- | -------------- | -------------------------- |
| `HOST`           | `0.0.0.0`      | Interfaz HTTP de escucha   |
| `PORT`           | `2567`         | Puerto HTTP/WebSocket      |
| `ALLOWED_ORIGIN` | `*`            | Origen permitido para HTTP |

## Contrato multijugador

- Versión de protocolo: `1`.
- Sala: `private_race`.
- Máximo: dos jugadores.
- Mensajes cliente: `player:input`, `player:ready`, `connection:ping`.
- Mensajes servidor: `room:info`, `race:event`, `protocol:error`, `connection:pong`.
- Un cliente con versión incompatible se desconecta antes de añadirse al estado.
- Inputs antiguos, excesivamente adelantados o mal formados se descartan.

El código compartido vive en `@game-moto/protocol`; no deben duplicarse strings de mensajes ni formas de payload en el cliente.

## Validación

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

`pnpm check` ejecuta typecheck, lint, tests y formato. La simulación y las capturas visuales deben usar seeds fijas para permitir reproducción exacta.

## Producción

El workflow `.github/workflows/deploy-pages.yml` valida todo el monorepo y publica `apps/web/dist` en GitHub Pages al hacer push a `main`. GitHub Pages solo aloja el cliente estático; `apps/server` debe desplegarse en un servicio Node con WebSockets persistentes y TLS. Cree la variable de repositorio `VITE_COLYSEUS_URL` con la URL `wss://` pública del servidor y limite `ALLOWED_ORIGIN` al dominio público.

Para compilar y arrancar el servidor:

```bash
pnpm build:server
pnpm --filter @game-moto/server start
```

## Dirección visual y rendimiento

La guía detallada de iluminación, materiales, perfiles de calidad, cámaras y puertas de revisión está en [RENDER_BLUEPRINT.md](./RENDER_BLUEPRINT.md). La simulación conserva siempre su tick fijo; ante carga gráfica se reducen postprocesado, sombras y resolución en ese orden.

## Convenciones

- Ramas en inglés: `feat/private-race-lobby`, `fix/server-reconciliation`.
- Commits en inglés y Conventional Commits: `feat(server): add private race room`.
- No incluir secretos ni `.env` en Git.
- Toda dependencia debe quedar fijada en el lockfile antes de desplegar.

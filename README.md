# Asphalt Rivals

Juego web de carreras de motos para dos jugadores, construido con Three.js y una simulación autoritativa. La experiencia está diseñada en español y utiliza una identidad visual original inspirada en el motociclismo arcade de alta velocidad, sin reutilizar assets ni marcas de otros juegos.

## Arquitectura

```text
apps/
  web/          Cliente Three.js, interfaz, audio y controles
  server/       Servidor Colyseus opcional para desarrollo local
packages/
  protocol/     Estado sincronizado, mensajes y validación compartida
  simulation/   Simulación determinista (arcade online + tráfico local)
supabase/
  migrations/   Lobby Postgres + Realtime (aplicar con el CLI)
  schema.sql    Copia del esquema para el SQL Editor del dashboard
```

**Producción (GitHub Pages):** quien crea la sala actúa como host en el navegador. El lobby vive en Supabase Postgres; la carrera usa Broadcast (`race:{code}`) con input del invitado a 10 Hz y snapshots del host cada ~180 ms. No hace falta `apps/server` en producción.

**Desarrollo local:** `pnpm dev` sigue levantando Vite + Colyseus para probar el servidor Node autoritativo.

## Requisitos

- Node.js 22 o superior.
- pnpm 10.17.1.
- Navegador moderno con WebGL 2.
- Proyecto Supabase (plan free) para multijugador online en Pages.

## Puesta en marcha

```bash
pnpm install
pnpm dev
```

Servicios locales:

- Web: URL mostrada por Vite, normalmente `http://localhost:5173`.
- WebSocket/HTTP (opcional): `http://localhost:2567`.
- Salud: `GET http://localhost:2567/health`.

Para ejecutarlos por separado:

```bash
pnpm dev:web
pnpm dev:server
```

### Supabase (multijugador online)

1. Crea un proyecto en [supabase.com/dashboard](https://supabase.com/dashboard).
2. **Authentication → Providers → Anonymous sign-in:** actívalo (cada móvil usa `signInAnonymously()`; RLS lo exige).
3. Enlaza y aplica el esquema (recomendado):

```bash
npx supabase link --project-ref TU_PROJECT_REF
npx supabase db push
```

Si `db push` no puede conectar a Postgres, usa la Management API:

```bash
npx supabase db query --linked -f supabase/migrations/20260902151915_lobby_schema.sql
```

También puedes ejecutar [`supabase/schema.sql`](supabase/schema.sql) en el **SQL Editor**.

4. Copia **Project URL** y la clave **anon** (Settings → API).
5. Local: crea `apps/web/.env`:

```env
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

6. GitHub Pages: en el repositorio, **Settings → Secrets and variables → Actions → Variables**, define:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

La clave `anon` es pública por diseño; la defensa es RLS.

**Plan free pausado:** tras ~7 días sin uso, Supabase pausa el proyecto. Antes de jugar, abre el dashboard y pulsa **Restore project**.

El anfitrión no debe minimizar la pestaña (Safari recorta los timers). El cliente pide Wake Lock de pantalla cuando el navegador lo permite.

Variables opcionales del servidor Colyseus (solo dev local):

| Variable         | Predeterminado | Uso                        |
| ---------------- | -------------- | -------------------------- |
| `HOST`           | `0.0.0.0`      | Interfaz HTTP de escucha   |
| `PORT`           | `2567`         | Puerto HTTP/WebSocket      |
| `ALLOWED_ORIGIN` | `*`            | Origen permitido para HTTP |

## Contrato multijugador

- Versión de protocolo: `1`.
- Sala: `private_race` (Colyseus local) o código de 6 caracteres (Supabase).
- Máximo: dos jugadores.
- Mensajes cliente (Colyseus): `player:input`, `player:ready`, `connection:ping`.
- Mensajes servidor (Colyseus): `room:info`, `race:event`, `protocol:error`, `connection:pong`.
- Online Pages: lobby vía Postgres; carrera vía Broadcast `input` / `state`.

El código compartido vive en `@game-moto/protocol` y `@game-moto/simulation`; no dupliques física arcade ni strings de mensajes.

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

El workflow `.github/workflows/deploy-pages.yml` valida todo el monorepo y publica `apps/web/dist` en GitHub Pages al hacer push a `main`. El build inyecta `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` desde variables de repositorio. Sin ellas, el lobby online muestra un error claro y la demo local sigue funcionando.

`apps/server` puede desplegarse por separado en un servicio Node con WebSockets (desarrollo o alternativa a Supabase):

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

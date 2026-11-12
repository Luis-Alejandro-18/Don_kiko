# MEMORY.md — Memoria del proyecto

> Contexto persistente para agentes. `AGENT.md` = reglas (≤ 80 líneas); este archivo = hechos, decisiones y estado.
> Última actualización: 2026-11-06

## 1. Contexto

- Panel web para jugar **Don Kiko: la aventura completa (3 niveles, v2.1)**, ver telemetría, KPIs, historial y un ranking global compartido con autenticación de usuarios.
- Stack: HTML + CSS + JavaScript vanilla, canvas 2D. Sin dependencias ni build en el frontend (Supabase JS client vía CDN para Auth).
- El modo local funciona sin red; el ranking global usa **Supabase** (Postgres + REST + Auth).
- El juego vive en `game/don_kiko.html`; el panel en `index.html` + `js/config.js` + `js/dashboard.js` + `js/charts.js`.
- El archivo original `../don_kiko_3_niveles_v2_1.html` **no está en la carpeta**; este proyecto incluye su copia con telemetría.
- Se abre con doble clic (`file://`) o con un servidor local (`python -m http.server 8000`).
- Repositorio: <https://github.com/Luis-Alejandro-18/Don_kiko>.
- El archivo original `../don_kiko_3_niveles_v2_1.html` **no está en la carpeta**; este proyecto incluye su copia con telemetría.
- Se abre con doble clic (`file://`) o con un servidor local (`python -m http.server 8000`).
- Repositorio: <https://github.com/Luis-Alejandro-18/Don_kiko>.

## 2. Decisiones

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-11-03 | Escritorio primero (Chrome/Edge/Firefox en Windows) | Requisito del proyecto |
| 2026-11-03 | Sin frameworks, CDN ni build | Simplicidad y funcionamiento con `file://` |
| 2026-11-03 | Móvil como alcance secundario | El panel oculta los controles táctiles del embed |
| 2026-11-03 | Mantener `postMessage` como contrato panel ↔ juego | Ya funciona con `file://` y no requiere servidor |
| 2026-11-04 | Repo GitHub `Luis-Alejandro-18/Don_kiko`; `main` estable y ramas feature | Versionado, revisión y deploy |
| 2026-11-04 | Supabase (Postgres + REST) para el ranking | Base compartida sin backend propio |
| 2026-11-04 | Identidad por `player_name` en el MVP | Simplicidad; cuentas/Auth en otra fase |
| 2026-11-04 | Ranking de campaña (`start_stage = 1`) | Evitar que las pruebas de nivel 2/3 inflen el ranking |
| 2026-11-04 | RLS: `anon` solo lee e inserta | Evitar ediciones/borrados desde el cliente |
| 2026-11-04 | Cliente directo a Supabase REST; Functions opcional | Menos piezas; se puede endurecer después |
| 2026-11-05 | URL y publishable key en `js/config.js` | La clave es pública y RLS protege la escritura |
| 2026-11-06 | Registro de usuarios con Supabase Auth (email/password) | Evitar suplantación de nombres en el ranking |
| 2026-11-06 | Ranking solo para usuarios autenticados | Modo local sigue disponible sin cuenta |
| 2026-11-06 | Tabla `public.profiles` vinculada a `auth.users` | Alias público único por usuario |
| 2026-11-05 | Enviar solo campañas terminadas desde Nivel 1 | Evitar pruebas de nivel y abandonadas en el ranking |
| 2026-11-05 | Ranking top 50: puntaje, mejor tiempo de victoria y última partida | Orden claro y consulta simple |
| 2026-11-05 | No crear niveles desde snapshots fuera de `playing` | Evitar niveles fantasma en menú/intermission |
| 2026-11-05 | Nombre sin cuenta; se guarda en `localStorage` | Identidad mínima para el MVP |

## 3. Arquitectura

- `js/config.js`: `window.DK_CONFIG` con `supabaseUrl`, `supabaseKey` (publishable) y `leaderboardLimit`.
- `js/dashboard.js`: IIFE con estado en memoria (`state.runs`, `state.current`, `state.snap`, `state.ranking`, `state.playerName`, `state.auth`), persistencia en `localStorage`, KPIs, historial, ranking, import/export, comandos y autenticación.
- `js/charts.js`: expone `window.DKCharts` con `scores`, `results`, `hurts`, `funnel`; dibuja en canvas sin librerías.
- `game/don_kiko.html`: juego autocontenido; emite telemetría cada 250 ms y en eventos; con `?embed=1` oculta el marco y los controles táctiles.
- El panel envía comandos al iframe con `postMessage`; el juego solo los acepta si `source === 'dashboard'`.
- `db/schema.sql`: tabla `runs`, tabla `profiles`, vista `leaderboard`, índices y RLS para Supabase.
- `db/README.md`: pasos para crear el proyecto, ejecutar el esquema y probar RLS.
- Ranking: `loadRanking()` consulta `GET /rest/v1/leaderboard` con `fetch` y timeout de 9 s; `submitRun()` hace `POST /rest/v1/runs` al terminar una campaña. La tarjeta muestra carga, vacío, error, actualización manual y resaltado del jugador actual.
- Autenticación: `initAuth()` verifica sesión al cargar; `signUp`/`signIn`/`signOut` gestionan cuenta de Supabase Auth; `submitRun` requiere autenticación e incluye `user_id`; el ranking solo muestra partidas de usuarios registrados.

## 3.1 GitHub y despliegue

- Repo: <https://github.com/Luis-Alejandro-18/Don_kiko>.
- `main`: baseline + PR #1 (`474404b`) + PR #2 (`d1db77e`) + PR #3 (`2a3938b`); contiene ranking y `netlify.toml`.
- `feature/db-schema`: esquema inicial; PR #1 mergeado después de verificar insert/RLS. Rama remota eliminada.
- `feature/ranking-global`: nombre, envío de campañas y tarjeta de ranking; PR #2 mergeado (`d1db77e`): <https://github.com/Luis-Alejandro-18/Don_kiko/pull/2>.
- `feature/netlify-deploy`: `netlify.toml` (build vacío, publish `.`) y pasos en README; PR #3 mergeado (`2a3938b`): <https://github.com/Luis-Alejandro-18/Don_kiko/pull/3>.
- Netlify: no hay CLI ni Node en este equipo; falta conectar la cuenta y verificar el sitio HTTPS.
- No se debe subir la `service_role` key; la publishable/`anon key` es pública y la protege RLS.

## 4. Contrato de datos

- Claves locales: `donkiko_dashboard_runs_v1` (máximo 100 partidas) y `donkiko_dashboard_player_v1` (nombre, 1–24 caracteres).
- Partida: `id`, `startedAt`, `lastSeenAt`, `endedAt`, `durationMs`, `result`, `startStage`, `stageReached`, `score`, `livesLeft`, `cause`, `levels[]`.
- Nivel: `stage`, `completed`, `closed`, `timeMs`, `hurts`, `tokens`, `startedAt`.
- Resultados: `won`, `game_over`, `pau_caught`, `abandoned`, `playing` (solo en curso).
- Metas por nivel: `goalX` = 799 / 1453 / 2345; el juego las envía en cada snapshot.
- `snapshot` incluye además `floor`, `friendX`, `pauActive`, `pauX`, `objects`, `elapsed`, `levelName`, `muted`.
- Comandos: `start {level}`, `continue`, `toggle`, `pause`, `resume`, `restart`, `mute {value}`, `status`.
- Supabase `runs`: `id`, `client_run_id` (único), `user_id` (ref a auth.users, nullable), `player_name`, `score`, `result`, `start_stage`, `stage_reached`, `duration_ms`, `active_time_ms`, `levels` (JSONB), `created_at`.
- Supabase `profiles`: `id` (ref a auth.users), `alias` (único, 1–24), `created_at`.
- Vista `leaderboard`: `player_name`, `user_id`, `best_score`, `best_stage`, `best_time_ms`, `runs`, `last_played`.
- La vista filtra `start_stage = 1` y `result <> 'abandoned'`; las pruebas de nivel 2/3 quedan fuera del ranking de campaña.
- Envío del panel: solo `startStage === 1` y resultado `won`/`game_over`/`pau_caught`; **requiere autenticación**, incluye `user_id`, usa el alias del perfil como `player_name`.
- `active_time_ms` = suma de `levels[].timeMs`; `duration_ms` es tiempo de pared. El cliente limita score/tiempos y usa `client_run_id` para idempotencia (409 = ya enviada).
- Lectura: `GET /rest/v1/leaderboard?select=...&order=best_score.desc,best_time_ms.asc.nullslast,last_played.asc&limit=50`.
- UI del ranking: estados `loading`, `ok`, `error`; vacío; botón **Actualizar**; refresco al enviar, al volver a la pestaña tras 30 s y al recuperar red; resalta el nombre actual.
- Si no hay sesión iniciada, la partida queda local y se muestra un aviso; no se envía al ranking global.

## 5. Estado de bugs

Estado tras la revisión inicial y la fase 2 (2026-11-05).

| ID | Severidad | Estado | Descripción | Archivos |
| --- | --- | --- | --- | --- |
| B1 | Alta | Corregido | No se podía avanzar de nivel desde el panel: se añadió comando `continue` y botón **Continuar** | `index.html`, `game/don_kiko.html`, `dashboard.js` |
| B2 | Alta | Corregido | Pausa/Reanudar se peleaba con el auto-pausa por `blur`: ahora hay comandos `pause`/`resume` y el juego emite `pause` al perder foco | `game/don_kiko.html`, `dashboard.js` |
| B3 | Alta | Corregido | Se perdía la partida en curso: persistencia cada 3 s, `lastSeenAt`, `pagehide`/`visibilitychange` y normalización a abandonada | `dashboard.js` |
| B4 | Alta | Corregido | XSS por `r.id` al importar: id validado y escapado; límite de 2 MB por archivo | `dashboard.js` |
| B5 | Media | Corregido | JuanMa muestra piso en nivel 1 y distancia absoluta en 2/3; progreso basado en `goalX` | `dashboard.js`, `game/don_kiko.html` |
| B6 | Media | Mitigado | `startStage` en el modelo, embudo corregido y etiqueta **prueba**; el KPI "Mejor nivel" aún incluye pruebas | `charts.js`, `dashboard.js` |
| B7 | Media | Corregido | `postMessage` verifica `event.source` (y origen en http); historial ordenado por fecha | `dashboard.js` |
| B8 | Baja | Corregido | README actualizado: Enter, comandos, estructura, formato y archivo original | `README.md` |
| B9 | Baja | Corregido | Log limpio al iniciar partida; sonido sincronizado desde el snapshot | `dashboard.js` |
| B10 | Media | Mitigado | Importar se bloquea durante una partida; borrar/eliminar avisan que se deja de registrar | `dashboard.js` |
| B11 | Baja | Limitación | "Abrir juego" en pestaña nueva no envía telemetría (documentado) | `dashboard.js`, `README.md` |
| B12 | Baja | Corregido | Bucle muerto eliminado; error de JSON ya no muestra aviso de storage | `dashboard.js` |
| B13 | Baja | Corregido | Canvas con `role="img"`, log con `aria-live` y foco visible al importar | `index.html`, `styles.css` |
| B14 | Baja | Abierto | Dos pestañas comparten `localStorage` sin sincronizarse | `dashboard.js` |
| B15 | Baja | Abierto | Gráficas solo se redibujan con `resize` | `charts.js` |
| B16 | Alta | Corregido | Un snapshot de menú/intermission podía crear un nivel fantasma y corromper el nivel/tiempo activo; ahora solo se cambia de nivel con `phase === 'playing'` y `ensureLevel` normaliza 1–3 | `dashboard.js` |
| B17 | Media | Limitación | Si la partida termina sin nombre, no se envía al ranking; queda local y solo se avisa una vez | `dashboard.js` |
| B18 | Baja | Limitación | El ranking depende de la red; `file://` funciona en Chrome probado, pero un navegador podría bloquear CORS | `js/config.js`, `dashboard.js` |

## 6. Cambios

### 2026-11-03

- Revisión inicial completa del proyecto.
- Creados `AGENT.md` y `MEMORY.md`.
- Correcciones de escritorio:
  - Juego: comando `continue`, comandos explícitos `pause`/`resume`, emisión de `pause` al perder foco, snapshots con `goalX` y `muted`, y aceptación de comandos solo desde la ventana padre.
  - Panel: botón **Continuar** y estados de Pausa/Continuar; persistencia cada 3 s; guardado en `pagehide`/`visibilitychange`; `lastSeenAt`; validación/escape del id importado; verificación de `postMessage`; orden por fecha; `startStage` y etiqueta **prueba**; lecturas de JuanMa/progreso; log y sonido sincronizados; mejoras de accesibilidad.
  - README actualizado con Enter, comandos, estructura y formato.

### 2026-11-04

- Creado el repositorio `Luis-Alejandro-18/Don_kiko` y subido el baseline a `main` (commit `70af080`).
- Añadidos `.gitignore` y `.gitattributes`; se usa el correo noreply de GitHub para no publicar el correo de la universidad.
- Creada la rama `feature/db-schema` con:
  - `db/schema.sql`: `runs`, índices, RLS, vista `leaderboard` de campaña.
  - `db/README.md`: creación de Supabase, ejecución del SQL, pruebas y RLS.
- Actualizados `AGENT.md`, `MEMORY.md` y `README.md`.
- PR #1 (draft) abierto para revisar el esquema; no mergear hasta probarlo en Supabase.
- Pendiente: crear el proyecto en Supabase y ejecutar `db/schema.sql` (requiere la cuenta del usuario).

### 2026-11-05

- Proyecto Supabase creado y `db/schema.sql` ejecutado sin errores.
- Verificado con la publishable key: `POST /rest/v1/runs` → `201`; `DELETE` → `401`; `GET /rest/v1/leaderboard` → `200`.
- PR #1 mergeado a `main` (`474404b`); rama `feature/db-schema` remota eliminada.
- Fase 2 implementada en `feature/ranking-global`:
  - `js/config.js` con URL, publishable key y límite 50.
  - Campo **Tu nombre** persistido en `localStorage`; resaltado “tú” en la tabla.
  - Envío de campañas terminadas (`startStage = 1`, `won`/`game_over`/`pau_caught`), con `levels`, `active_time_ms`, `duration_ms` y `client_run_id`.
  - Tarjeta **Ranking global** con carga, vacío, error, actualización manual/tras envío, orden y top 50.
  - Corrección de niveles fantasma: `ensureLevel` normaliza 1–3 y los snapshots solo cambian de nivel con `phase === 'playing'`.
- Verificación E2E con Chrome headless (CDP) en localhost y `file://`: carga vacía, envío `pau_caught`, campaña completa de 3 niveles, orden por puntaje/tiempo y captura 1440×1800.
- Filas de prueba pendientes de borrar en Supabase (SQL Editor):
  `delete from public.runs where client_run_id = 'anon-rls-test-1' or player_name in ('Prueba E2E', 'Prueba Won', 'Prueba Won 2');`
- Actualizados `AGENT.md`, `README.md`, `db/README.md` y este archivo. PR #2 mergeado en `main` (`d1db77e`): <https://github.com/Luis-Alejandro-18/Don_kiko/pull/2>.
- Fase 3 preparada: `netlify.toml` con build vacío y publish `.`, y sección de despliegue en README; PR #3 mergeado (`2a3938b`). No hay Netlify CLI ni Node en el equipo; falta conectar la cuenta del usuario y verificar la URL HTTPS.

## 7. Backlog

- B6: decidir si "Mejor nivel" debe excluir las partidas de prueba.
- B14: sincronización entre pestañas (evaluar si compensa).
- B15: `ResizeObserver` en las tarjetas de gráficas.
- B11: evaluar si "Abrir juego" puede conservar la telemetría (hoy es una pestaña suelta).
- B17: evaluar una cola de envío si el jugador termina sin nombre o sin red.
- Móvil: decidir entre controles táctiles dentro del panel o mantener "Abrir juego" como flujo aparte.
- Probar un nivel completo real para validar el intermission con el nuevo filtro de snapshots.
- Probar Edge y Firefox; el ranking se probó en Chrome headless.
- Limpiar las filas de prueba de Supabase antes de compartir el ranking.
- Conectar Netlify al repo (`main`, build vacío, publish `.`) y verificar HTTPS; `netlify.toml` ya está listo.
- Probar estados de error/carga del ranking con red lenta o clave inválida.
- Fase 2 (pendiente): encuesta de mejora del juego (tabla `survey_responses`, formulario en el panel, RLS).
- Evaluar después: ranking por nivel/tiempo, gráficas globales, Functions y validación de puntajes en servidor.

## 8. Verificación

Verificado el 2026-11-03 con Chrome headless y `file://`:

- [x] La página carga, el badge pasa a "Menú" y llega el primer snapshot.
- [x] **Jugar** (`continue`) inicia la partida, crea la fila del historial y actualiza el panel.
- [x] Pausa y Reanudar funcionan; un clic real en Pausa con el foco dentro del juego deja el juego en pausa (no se reanuda solo).
- [x] La partida en curso se guarda como `playing` con `lastSeenAt`.
- [x] Tras recargar, la partida aparece como **Abandonada** con su duración.
- [x] Captura 1440×1800: layout de escritorio correcto y gráficas cargadas.

Pendiente de verificar manualmente:

- [ ] Intermission real: completar un nivel y avanzar con **Siguiente nivel** (el filtro de snapshots se probó con eventos simulados).
- [ ] Exportar e importar desde la interfaz.
- [ ] Edge y Firefox; el ranking se verificó en Chrome headless.
- [ ] Comportamiento en móvil.
- [ ] Dos perfiles/navegadores simultáneos; se verificó la lectura compartida desde `localhost` y `file://`.
- [ ] Estados de carga/error con red lenta o clave inválida.

### Fase 2 (ranking) — 2026-11-05

Verificado con Chrome headless + CDP, `http://127.0.0.1:8000/` y `file://`:

- [x] `file://` y localhost cargan el ranking vacío sin errores CORS.
- [x] El nombre se guarda en `localStorage` y sobrevive a la recarga.
- [x] Un `pau_caught` de campaña se envía con `201`, aparece en `leaderboard` y se muestra en la tabla.
- [x] Una campaña simulada de 3 niveles envía `levels` 1/2/3, `active_time_ms = 60000` y `best_time_ms = 60000`.
- [x] El orden por puntaje y mejor tiempo es correcto; el jugador actual se resalta con “tú”.
- [x] La tarjeta muestra estados de carga, vacío y ok; no hubo errores de consola.
- [x] El botón **Actualizar** pasa a “Actualizando…” y vuelve a “Actualizar” al terminar.
- [x] Captura 1440×1800 con la tarjeta de ranking y layout de escritorio correcto.

### Fase 1 (Supabase)

- [x] Proyecto creado y `db/schema.sql` ejecutado sin errores.
- [x] Insert de prueba y `select * from leaderboard` devuelven datos.
- [x] `anon` puede insertar/leer, pero no actualizar ni borrar (`DELETE` → `401`).
- [ ] Filas de prueba eliminadas; ver el SQL pendiente en la sección de cambios.

### Fase 3 (Netlify)

- [x] `netlify.toml` con build vacío y publish `.`; pasos en README.
- [ ] Conectar la cuenta de Netlify al repo y desplegar `main`.
- [ ] Verificar la URL HTTPS y el ranking desde el sitio desplegado.

### Fase 4 (registro de usuarios) — 2026-11-06

- [x] `db/schema.sql` actualizado: tabla `profiles`, columna `user_id` en `runs`, vista `leaderboard` con `user_id`, RLS para perfiles.
- [x] `js/dashboard.js`: cliente Supabase Auth, `initAuth()`, `signUp()`, `signIn()`, `signOut()`, `updateAuthUI()`.
- [x] `index.html`: paneles de login/registro/cerrar sesión en la cabecera.
- [x] `css/styles.css`: estilos para panel de autenticación y usuario conectado.
- [x] `submitRun()` requiere autenticación e incluye `user_id` en el payload.
- [x] Fix: `window.supabase` (no `supabaseClient`) para inicializar el cliente Auth; PR #5 mergeado (`c640f35`).
- [x] Fix: trigger `on_auth_user_created` en `auth.users` crea automáticamente el perfil en `public.profiles`; PR #6 mergeado (`f67b3c4`).
- [x] Fix: `loadProfile` crea automáticamente el perfil si no existe al hacer login, usando el email como alias; permite iniciar sesión incluso si el trigger no se ejecutó; commit `e4c3c66` en `main`.
- [x] `currentPlayerNameForRanking()` usa el alias del perfil si hay sesión.
- [x] PR `feature/auth-users` abierto: <https://github.com/Luis-Alejandro-18/Don_kiko/pull/4>.
- [ ] Pendiente: ejecutar `db/schema.sql` en Supabase SQL Editor (migración).
- [ ] Pendiente: habilitar Auth (email/password) en Supabase → Authentication.
- [ ] Pendiente: probar registro, login, logout y envío al ranking desde cuenta autenticada.

### Fase 5 (login visible y ranking funcional) — 2026-11-11

- [x] Diagnóstico: el merge de la encuesta eliminó el CSS `auth-*`; el panel se abría al final del documento y parecía que el botón no hacía nada.
- [x] `css/styles.css`: `#authPanel` vuelve a ser modal fijo (fondo + tarjeta), estilos de campos, error, botones y bloque de usuario; estilos del ranking.
- [x] Bug real de login: `authAlias` y `authPasswordConfirm` eran `required` estando ocultos, así que el navegador bloqueaba el envío sin mostrar error. Ahora `required` se activa solo en modo registro y la validación es propia (`novalidate`).
- [x] `signUp()` exige sesión en la respuesta: si `Confirm email` está activo, muestra un error claro en vez de simular una sesión.
- [x] Errores de Supabase traducidos (credenciales, correo sin confirmar, rate limit, correo ya registrado).
- [x] `startRun()` guarda `startStage`; antes `submitRun()` descartaba todas las partidas por `run.startStage !== 1`.
- [x] `state.ranking` restaurado y sección "Ranking global" de vuelta en `index.html` (`#rankingBody`, `#rankingStatus`, `#rankingEmpty`, `#refreshRankingBtn`).
- [x] `loadProfile()` trunca el alias a 24 caracteres (`profiles_alias_len`) y usa `maybeSingle()`.
- [x] Trigger `handle_new_user()` defensivo: alias del formulario o prefijo del correo, `on conflict do nothing`; `schema.sql` rellena perfiles faltantes de cuentas antiguas.
- [ ] Requiere acción manual en Supabase: Authentication → Providers → Email → **Confirm email OFF**, y volver a ejecutar `schema.sql`.

### Fase 6 (causa raíz de "los botones no hacen nada") — 2026-11-11

- [x] Causa real: `index.html` no cargaba `js/config.js`, así que `window.DK_CONFIG` no existía y `createClient('','')` lanzaba `Uncaught Error: supabaseUrl is required` al inicio del IIFE. Se abortaba todo `dashboard.js`: sin listeners de botones, sin KPIs, sin historial y sin ranking. Los botones visibles eran HTML inerte.
- [x] Fix `8888ed6`: `<script src="js/config.js">` antes de `charts.js`/`dashboard.js`, y `createClient` envuelto en `try/catch` para degradar a modo local si falta la configuración.
- [x] `mailer_autoconfirm: true` confirmado en Supabase; registro devuelve sesión.
- [x] Verificado con Chrome headless sobre el sitio desplegado: badge "Menú", ranking con 1 fila, modal de login/registro abre, login real deja el alias en la cabecera y la campaña desde Nivel 1 genera payload con `start_stage: 1` y `user_id`.
- [ ] Limpiar datos de prueba: usuario `agente.prueba.mwcy13bd@example.com` y `delete from public.runs where client_run_id = 'test-agente-mwcy13bd';`.

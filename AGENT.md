# AGENT.md — Don Kiko Dashboard

Panel web para jugar **Don Kiko** (3 niveles) y ver telemetría, KPIs, historial y ranking global.
HTML/CSS/JS sin dependencias ni build. El modo local funciona sin red; el ranking usa Supabase.

## Alcance
- **Prioridad: escritorio** (Chrome/Edge/Firefox en Windows, doble clic en `index.html`).
- Móvil/táctil: funciona, pero es secundario; no bloquear cambios de escritorio por móvil.
- Ranking global compartido con Supabase; el modo local sigue funcionando sin red.
- No reescribir la lógica del juego; tocarla solo para telemetría o bugs que rompan el panel.

## Ejecutar
1. Abrir `index.html` con doble clic (file://).
2. Alternativa: `python -m http.server 8000` y abrir `http://localhost:8000/`.
3. Hacer clic en el juego antes de usar el teclado.

## Estructura
- `index.html`: panel.
- `css/styles.css`: estilos.
- `js/config.js`: URL y publishable key de Supabase (pública).
- `js/dashboard.js`: estado, partidas, KPIs, historial, import/export y ranking.
- `js/charts.js`: gráficas canvas (`window.DKCharts`).
- `game/don_kiko.html`: juego + puente `postMessage` (`?embed=1`).
- `db/schema.sql`: tablas, vista y RLS del ranking.
- `db/README.md`: pasos para crear y probar Supabase.
- `netlify.toml`: despliegue estático (publish `.`, sin build).
- `README.md`: uso · `MEMORY.md`: decisiones y estado.

## Contrato postMessage
Juego → panel (`source: 'donkiko'`):
`ready`, `snapshot`, `run_start`, `stage_complete`, `hurt`, `token`, `punch_hit`, `pause`, `resume`, `pau_caught`, `game_over`, `won`.
Panel → juego (`source: 'dashboard'`):
`start {level}`, `continue`, `toggle`, `pause`, `resume`, `restart`, `mute {value}`, `status`.
- `snapshot` cada 250 ms: phase, stage, score, lives, x, friendX, floor, pauActive, pauX, objects, elapsed, levelName, goalX, muted.
- No cambiar nombres ni campos sin actualizar dashboard y `MEMORY.md`.

## Datos (Supabase)
- `js/config.js` contiene la URL y la publishable key; es pública y no debe incluir `service_role`.
- Esquema en `db/schema.sql`; ejecutarlo en Supabase SQL Editor.
- `runs` guarda partidas; `leaderboard` es la vista de campaña (`start_stage = 1`).
- RLS: `anon` solo lee e inserta; nunca `service_role` en el frontend.
- Identidad MVP: `player_name` (1–24, `localStorage: donkiko_dashboard_player_v1`); sin cuentas.
- El panel envía solo campañas terminadas (`won`, `game_over`, `pau_caught`) y lee `leaderboard`; pruebas de nivel 2/3 y abandonadas quedan locales.
- `active_time_ms` = suma de niveles; orden por puntaje y mejor tiempo de victoria como desempate.
- `file://` se probó en Chrome; si un navegador bloquea la red, usar Netlify o `http://localhost`; el modo local no depende del ranking.

## Convenciones
- JS vanilla, IIFE, `'use strict'`; sin frameworks, CDN ni build.
- UI y textos en español; formatos `es-ES`.
- Claves y nombres estables (`localStorage: donkiko_dashboard_runs_v1`).
- Comentarios breves en español; cambios pequeños y revisables.
- Mantener este archivo ≤ 80 líneas; el detalle va en `MEMORY.md`.

## Verificación manual (escritorio)
- [ ] `index.html` abre por file:// y el badge sale de "Conectando…".
- [ ] Nivel 1/2/3 inician y crean una partida en el historial.
- [ ] Pausa/Reanudar desde el panel funciona con el foco dentro del juego.
- [ ] Al completar un nivel, "Siguiente nivel" avanza desde el panel.
- [ ] Cerrar a mitad de nivel y verificar puntos guardados al reabrir.
- [ ] Exportar, borrar e importar el JSON.
- [ ] `db/schema.sql` ejecutado en Supabase; `select * from leaderboard` responde.
- [ ] Nombre guardado en localStorage y resaltado en el ranking.
- [ ] Partida de campaña enviada; el ranking se actualiza sin recargar.
- [ ] Ranking con estados de carga, vacío, error y actualización manual.
- [ ] Sin errores en la consola del panel ni del iframe.

## Reglas para agentes
- Verificar en escritorio antes de dar algo por terminado; si no se puede probar, decirlo.
- No añadir dependencias ni cambiar el stack.
- No subir `service_role` ni contraseñas; la `anon key` es pública.
- Actualizar `MEMORY.md` con decisiones, bugs y cambios.
- No tocar `README.md` salvo que cambie el uso.

# MEMORY.md — Memoria del proyecto

> Contexto persistente para agentes. `AGENT.md` = reglas (≤ 80 líneas); este archivo = hechos, decisiones y estado.
> Última actualización: 2026-11-03

## 1. Contexto

- Panel web offline para jugar **Don Kiko: la aventura completa (3 niveles, v2.1)** y ver telemetría, KPIs e historial.
- Stack: HTML + CSS + JavaScript vanilla, canvas 2D. Sin dependencias, sin build, sin red.
- El juego vive en `game/don_kiko.html`; el panel en `index.html` + `js/dashboard.js` + `js/charts.js`.
- El archivo original `../don_kiko_3_niveles_v2_1.html` **no está en la carpeta**; este proyecto incluye su copia con telemetría.
- Se abre con doble clic (`file://`) o con un servidor local (`python -m http.server 8000`).

## 2. Decisiones

| Fecha | Decisión | Motivo |
| --- | --- | --- |
| 2026-11-03 | Escritorio primero (Chrome/Edge/Firefox en Windows) | Requisito del proyecto |
| 2026-11-03 | Sin frameworks, CDN ni build | Simplicidad y funcionamiento con `file://` |
| 2026-11-03 | Móvil como alcance secundario | El panel oculta los controles táctiles del embed |
| 2026-11-03 | Mantener `postMessage` como contrato panel ↔ juego | Ya funciona con `file://` y no requiere servidor |

## 3. Arquitectura

- `js/dashboard.js`: IIFE con estado en memoria (`state.runs`, `state.current`, `state.snap`), persistencia en `localStorage`, KPIs, historial, import/export y comandos.
- `js/charts.js`: expone `window.DKCharts` con `scores`, `results`, `hurts`, `funnel`; dibuja en canvas sin librerías.
- `game/don_kiko.html`: juego autocontenido; emite telemetría cada 250 ms y en eventos; con `?embed=1` oculta el marco y los controles táctiles.
- El panel envía comandos al iframe con `postMessage`; el juego solo los acepta si `source === 'dashboard'`.

## 4. Contrato de datos

- Clave de almacenamiento: `donkiko_dashboard_runs_v1` (máximo 100 partidas).
- Partida: `id`, `startedAt`, `lastSeenAt`, `endedAt`, `durationMs`, `result`, `startStage`, `stageReached`, `score`, `livesLeft`, `cause`, `levels[]`.
- Nivel: `stage`, `completed`, `closed`, `timeMs`, `hurts`, `tokens`, `startedAt`.
- Resultados: `won`, `game_over`, `pau_caught`, `abandoned`, `playing` (solo en curso).
- Metas por nivel: `goalX` = 799 / 1453 / 2345; el juego las envía en cada snapshot.
- `snapshot` incluye además `floor`, `friendX`, `pauActive`, `pauX`, `objects`, `elapsed`, `levelName`, `muted`.
- Comandos: `start {level}`, `continue`, `toggle`, `pause`, `resume`, `restart`, `mute {value}`, `status`.

## 5. Estado de bugs

Estado tras la revisión y las correcciones del 2026-11-03.

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

## 6. Cambios

### 2026-11-03

- Revisión inicial completa del proyecto.
- Creados `AGENT.md` y `MEMORY.md`.
- Correcciones de escritorio:
  - Juego: comando `continue`, comandos explícitos `pause`/`resume`, emisión de `pause` al perder foco, snapshots con `goalX` y `muted`, y aceptación de comandos solo desde la ventana padre.
  - Panel: botón **Continuar** y estados de Pausa/Continuar; persistencia cada 3 s; guardado en `pagehide`/`visibilitychange`; `lastSeenAt`; validación/escape del id importado; verificación de `postMessage`; orden por fecha; `startStage` y etiqueta **prueba**; lecturas de JuanMa/progreso; log y sonido sincronizados; mejoras de accesibilidad.
  - README actualizado con Enter, comandos, estructura y formato.

## 7. Backlog

- B6: decidir si "Mejor nivel" debe excluir las partidas de prueba.
- B14: sincronización entre pestañas (evaluar si compensa).
- B15: `ResizeObserver` en las tarjetas de gráficas.
- B11: evaluar si "Abrir juego" puede conservar la telemetría (hoy es una pestaña suelta).
- Móvil: decidir entre controles táctiles dentro del panel o mantener "Abrir juego" como flujo aparte.
- Probar un nivel completo para validar el intermission real.
- Probar Edge y Firefox.

## 8. Verificación

Verificado el 2026-11-03 con Chrome headless y `file://`:

- [x] La página carga, el badge pasa a "Menú" y llega el primer snapshot.
- [x] **Jugar** (`continue`) inicia la partida, crea la fila del historial y actualiza el panel.
- [x] Pausa y Reanudar funcionan; un clic real en Pausa con el foco dentro del juego deja el juego en pausa (no se reanuda solo).
- [x] La partida en curso se guarda como `playing` con `lastSeenAt`.
- [x] Tras recargar, la partida aparece como **Abandonada** con su duración.
- [x] Captura 1440×1800: layout de escritorio correcto y gráficas cargadas.

Pendiente de verificar manualmente:

- [ ] Intermission real: completar un nivel y avanzar con **Siguiente nivel**.
- [ ] Exportar e importar desde la interfaz.
- [ ] Edge, Firefox y servidor local (`http://localhost`).
- [ ] Comportamiento en móvil.

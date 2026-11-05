# Don Kiko — Dashboard

Panel web para jugar *Don Kiko: la aventura completa (3 niveles, v2.1)* y ver estadísticas en vivo, historial de partidas y un ranking global compartido. El modo local funciona sin Internet y sin instalar nada; el ranking usa Supabase.

> Repositorio: <https://github.com/Luis-Alejandro-18/Don_kiko>

> Prioridad: **escritorio** (Chrome, Edge o Firefox en Windows, abriendo el archivo con doble clic). En móvil funciona, pero es un alcance secundario.

## Cómo abrirlo

1. Abre `index.html` con doble clic (Edge, Chrome o Firefox).
2. El juego se carga dentro del panel.
3. Haz clic sobre el juego antes de usar el teclado.

> Si el navegador muestra un aviso al abrir archivos locales, permite el contenido. El panel y el juego se comunican con `postMessage`, que funciona incluso con `file://`.

## Controles

| Acción | Tecla |
| --- | --- |
| Mover | `←` `→` o `A` `D` |
| Escaleras | `↑` `↓` |
| Saltar | `Espacio` |
| Golpear | `J` |
| Pausa | `P` |
| Continuar / siguiente nivel | `Enter` |
| Reiniciar nivel | `R` |

También puedes usar los botones **Nivel 1/2/3**, **Continuar**, **Pausa**, **Reiniciar** y **Sonido** del panel.

> El botón **Continuar** avanza al siguiente nivel y arranca la campaña desde el menú, game over o victoria. Pausa y Reanudar usan comandos explícitos para no chocar con la auto-pausa que ocurre al hacer clic fuera del juego.

> En móvil, el panel oculta los controles táctiles dentro del iframe para que el canvas llene el espacio. Usa **Abrir juego** para jugar a pantalla completa con los botones táctiles; esa pestaña no envía telemetría al panel.

## Qué muestra

- **En vivo**: nivel, puntos, vidas, tiempo, escenario, posición, distancia a Pau, objetos y piso/distancia a JuanMa. La barra de progreso usa la meta de cada nivel.
- **KPIs**: partidas finalizadas, récord, porcentaje de victorias, mejor nivel, tiempo medio y puntos acumulados.
- **Gráficas**: puntos por partida, distribución de resultados, vidas perdidas por nivel y embudo de progreso.
- **Historial**: fecha, nivel, puntos, vidas, duración, resultado y causa. Se puede filtrar, borrar una partida o todo el historial.
- **Ranking global**: el mejor puntaje de cada jugador en campañas desde el **Nivel 1**, con nivel alcanzado, mejor tiempo de victoria, partidas y última fecha. Se actualiza al terminar una partida o con el botón **Actualizar**.

## Ranking global

El ranking se guarda en Supabase y se comparte entre jugadores. La base está definida en [`db/schema.sql`](db/schema.sql) y las instrucciones para crear el proyecto en Supabase están en [`db/README.md`](db/README.md).

- Escribe tu nombre en **Tu nombre**, dentro de la tarjeta **Ranking global**. Se guarda en este navegador (`donkiko_dashboard_player_v1`).
- Al terminar una campaña iniciada en el **Nivel 1** se envían el nombre, puntaje, resultado, niveles y tiempos.
- Solo cuentan partidas terminadas (`won`, `game_over`, `pau_caught`). Las pruebas de **Nivel 2/3** y las abandonadas quedan solo en el historial local.
- Orden: mejor puntaje; desempate: mejor tiempo de victoria; luego la última partida.
- El historial local sigue funcionando sin Internet; el ranking necesita conexión. Si `file://` funciona en tu Chrome, el ranking también; si el navegador bloquea la red, abre el panel desde Netlify o `http://localhost`.
- Los nombres son públicos: usa un alias, no tu nombre completo. Si cambias el nombre, tus marcas anteriores quedan con el nombre anterior. Si dos jugadores usan el mismo nombre, sus marcas se agrupan.
- La publishable key está en `js/config.js`; es pública. Nunca se usa la `service_role` en el frontend.

## Guardado y respaldo

El historial local se guarda en `localStorage` con la clave `donkiko_dashboard_runs_v1`; el nombre del jugador usa `donkiko_dashboard_player_v1`. El ranking global se guarda en Supabase.

- **Exportar** descarga un JSON con todas las partidas.
- **Importar** reemplaza el historial por el del archivo; se bloquea mientras hay una partida en curso.
- **Borrar historial** elimina todo (pide confirmación) y deja de registrar la partida en curso.

Si el navegador bloquea `localStorage` para archivos locales, aparece un aviso y el historial dura solo la sesión; exporta antes de cerrar.

## Publicar en Netlify

El repositorio incluye `netlify.toml` con build vacío y publish en la raíz:

1. En Netlify, elige **Add new site → Import an existing project** y conecta el repositorio.
2. Rama de producción: `main`. Build command: vacío. Publish directory: `.`.
3. Despliega y abre la URL HTTPS. El panel y el ranking funcionan igual que en local.
4. Netlify publica también `AGENT.md`, `MEMORY.md` y `db/`; son documentos públicos y no contienen secretos. La publishable key de `js/config.js` ya es pública.
5. Si cambias la URL o la clave de Supabase, edita `js/config.js` y vuelve a desplegar.

No hay Node ni paso de build: Netlify solo sirve archivos estáticos.

## Estructura

```
don_kiko_dashboard/
├─ index.html          Panel principal
├─ css/styles.css      Estilos
├─ js/config.js        URL y publishable key de Supabase
├─ js/dashboard.js     Telemetría, partidas, KPIs, historial y ranking
├─ js/charts.js        Gráficas en canvas (sin librerías)
├─ game/don_kiko.html  Copia del juego con telemetría
├─ db/schema.sql       Esquema del ranking (Supabase)
├─ db/README.md        Instrucciones de Supabase
├─ netlify.toml        Configuración de despliegue estático
├─ AGENT.md            Reglas para agentes (≤ 80 líneas)
├─ MEMORY.md           Decisiones, bugs y estado del proyecto
└─ README.md
```

El juego original no se incluye en esta carpeta; la copia jugable y telemetrizada es `game/don_kiko.html`.

## Cómo funciona la telemetría

El juego envía mensajes al panel con `window.parent.postMessage`:

```js
{ source: 'donkiko', type: 'snapshot', stage, phase, score, lives, x, floor, friendX, pauActive, pauX, elapsed, goalX, muted, ... }
{ source: 'donkiko', type: 'evento', ... }   // run_start, stage_complete, hurt, token, ...
```

El panel responde con comandos:

```js
{ source: 'dashboard', command: 'start', level: 2 }
{ source: 'dashboard', command: 'continue' | 'pause' | 'resume' | 'restart' | 'mute' | 'status' }
```

El panel solo acepta mensajes que vengan de su propio iframe, y el juego solo acepta comandos de su ventana padre. Para depurar, abre la consola del navegador y ejecuta `window.donKikoStatus()` dentro del juego (o en la pestaña del juego).

## Formato de una partida

```json
{
  "id": "r...",
  "startedAt": 1760000000000,
  "lastSeenAt": 1760000050000,
  "endedAt": 1760000060000,
  "durationMs": 60000,
  "result": "won",
  "startStage": 1,
  "stageReached": 3,
  "score": 5400,
  "livesLeft": 2,
  "cause": "goal",
  "levels": [
    { "stage": 1, "completed": true, "timeMs": 21000, "hurts": 0, "tokens": 2 }
  ]
}
```

Resultados posibles: `won`, `game_over`, `pau_caught`, `abandoned` y `playing` (solo mientras se juega).

Las partidas iniciadas directamente en **Nivel 2/3** se marcan como **prueba** en el historial y no cuentan como avance de campaña en el embudo.

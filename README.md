# Don Kiko — Dashboard

Panel web para jugar *Don Kiko: la aventura completa (4 niveles)*, ver estadísticas en vivo, historial de partidas y los resultados de una encuesta breve de opinión. Funciona sin Internet y sin instalar nada.

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
| Reiniciar nivel | `R` |

También puedes usar los botones **Nivel 1/2/3**, **Pausa**, **Reiniciar** y **Sonido** del panel.

> En móvil, el panel oculta los controles táctiles dentro del iframe para que el canvas llene el espacio. Usa **Abrir juego** para jugar a pantalla completa con los botones táctiles.

## Qué muestra

- **En vivo**: nivel, puntos, vidas, tiempo, escenario, posición, distancia a Pau, objetos y distancia a JuanMa.
- **KPIs**: partidas finalizadas, récord, porcentaje de victorias, mejor nivel, tiempo medio y puntos acumulados.
- **Gráficas**: puntos por partida, distribución de resultados, vidas perdidas por nivel, embudo de progreso, sentimientos y dificultad percibida.
- **Opiniones**: satisfacción media, respuestas, porcentaje de valoraciones positivas, dificultad más votada y comentarios de los jugadores.
- **Historial**: fecha, nivel, puntos, valoración con estrellas, vidas, duración, resultado y causa. Se puede filtrar, borrar una partida o todo el historial.

## Encuesta de jugadores

Al terminar una partida (`won`, `game_over` o `pau_caught`) se abre automáticamente una encuesta breve:

1. **¿Cómo te sentiste?** — 1 a 5 estrellas.
2. **Dificultad** — Fácil, Justo o Difícil (opcional).
3. **Comentario** — opcional, máximo 280 caracteres.

La respuesta se guarda dentro de la partida y se puede editar o borrar después con el botón **★** del historial. El botón **Encuesta automática: sí/no** permite desactivar o reactivar el aviso automático; la preferencia se guarda en `localStorage` con la clave `donkiko_survey_autoshow`.

Si Pau atrapa a Don Kiko, el reinicio automático de la campaña se pausa mientras la encuesta está abierta. Al guardar o cerrar la encuesta, el juego continúa.

**Exportar encuestas CSV** descarga únicamente las partidas con respuesta, con columnas de fecha, nivel, puntos, resultado, estrellas, dificultad y comentario (UTF-8 con BOM para Excel).

## Guardado y respaldo

El historial se guarda en `localStorage` con la clave `donkiko_dashboard_runs_v1`.

- **Exportar** descarga un JSON con todas las partidas.
- **Importar** reemplaza el historial por el del archivo.
- **Borrar historial** elimina todo (pide confirmación).

Si el navegador bloquea `localStorage` para archivos locales, aparece un aviso y el historial dura solo la sesión; exporta antes de cerrar.

## Estructura

```
don_kiko_dashboard/
├─ index.html          Panel principal
├─ css/styles.css      Estilos
├─ js/dashboard.js     Telemetría, partidas, KPIs, encuesta e historial
├─ js/charts.js        Gráficas en canvas (sin librerías)
├─ game/don_kiko.html  Copia del juego con telemetría
└─ README.md
```

El archivo original `../don_kiko_3_niveles_v2_1.html` no se modifica.

## Cómo funciona la telemetría

El juego envía mensajes al panel con `window.parent.postMessage`:

```js
{ source: 'donkiko', type: 'snapshot', stage, phase, score, lives, x, pauActive, ... }
{ source: 'donkiko', type: 'evento', ... }   // run_start, stage_complete, hurt, token, ...
```

El panel responde con comandos:

```js
{ source: 'dashboard', command: 'start', level: 2 }
{ source: 'dashboard', command: 'toggle' | 'restart' | 'mute' | 'status' }
{ source: 'dashboard', command: 'hold' | 'continue' }   // pausa/reanuda el reinicio tras Pau
```

Para depurar, abre la consola del navegador y ejecuta `window.donKikoStatus()` dentro del juego (o en la pestaña del juego).

## Formato de una partida

```json
{
  "id": "r...",
  "startedAt": 1760000000000,
  "endedAt": 1760000060000,
  "durationMs": 60000,
  "result": "won",
  "stageReached": 3,
  "score": 5400,
  "livesLeft": 2,
  "cause": "goal",
  "levels": [
    { "stage": 1, "completed": true, "timeMs": 21000, "hurts": 0, "tokens": 2 }
  ],
  "feedback": {
    "feeling": 5,
    "difficulty": "fair",
    "comment": "Muy divertido.",
    "createdAt": "2026-11-03T18:40:00.000Z"
  }
}
```

Resultados posibles: `won`, `game_over`, `pau_caught`, `abandoned` y `playing` (solo mientras se juega).

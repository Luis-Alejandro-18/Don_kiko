# Base de datos del ranking (Supabase)

Esta carpeta contiene el esquema inicial para compartir el ranking entre jugadores.
La integración con el panel llega en la fase 2; por ahora solo se prepara la base.

## 1. Crear el proyecto

1. Entra a <https://supabase.com> y crea un proyecto.
2. Guarda la contraseña de la base de datos en un lugar seguro. **No** va al repositorio.
3. Espera a que el proyecto termine de aprovisionarse.

## 2. Ejecutar el esquema

1. Abre **SQL Editor** en el panel de Supabase.
2. Crea una consulta nueva.
3. Copia todo el contenido de [`schema.sql`](./schema.sql).
4. Pulsa **Run**.
5. Verifica en **Table Editor** que existen `runs` y `leaderboard`.

El script es idempotente para la primera instalación: crea la tabla, los índices,
las políticas RLS, la vista y los permisos.

## 3. Probar la base

Desde el SQL Editor (como propietario, sin RLS):

```sql
insert into public.runs (
  client_run_id, player_name, score, result,
  start_stage, stage_reached, duration_ms, active_time_ms, levels
) values (
  'test-1', 'Prueba', 1234, 'won',
  1, 3, 60000, 55000,
  '[{"stage":1,"completed":true,"timeMs":20000,"hurts":0,"tokens":2}]'::jsonb
);

select * from public.leaderboard;
```

Para limpiar la partida de prueba:

```sql
delete from public.runs where client_run_id = 'test-1';
```

## 4. Claves de API

En **Project Settings → API** copia:

- **Project URL** → `https://<proyecto>.supabase.co`
- **anon public key** → clave pública; puede ir en el frontend.

No copies la **service_role key** al frontend ni al repositorio. La `anon key`
está diseñada para ser pública; la protección real está en RLS.

## 5. Probar RLS

Con la `anon key`, un `DELETE` o un `UPDATE` debe fallar o afectar a 0 filas.
En PowerShell:

```powershell
$headers = @{
  apikey = $env:SUPABASE_ANON_KEY
  Authorization = "Bearer $env:SUPABASE_ANON_KEY"
}
Invoke-RestMethod -Method Delete `
  -Uri "$env:SUPABASE_URL/rest/v1/runs?client_run_id=eq.test-1" `
  -Headers $headers
```

En Git Bash / curl:

```bash
curl -X DELETE "$SUPABASE_URL/rest/v1/runs?client_run_id=eq.test-1" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Si devuelve 401/403 o 0 filas, RLS está bloqueando correctamente. Para probar un
insert como `anon`, usa la API REST con la misma clave y un `client_run_id`
nuevo; el insert debe funcionar y el delete no.

## 6. Modelo de datos

- `runs`: una fila por partida terminada.
  - `client_run_id`: id local de la partida; evita duplicados.
  - `player_name`: nombre visible (1–24 caracteres, sin espacios al inicio/final).
  - `score`, `result`, `start_stage`, `stage_reached`.
  - `duration_ms`: tiempo total de pared.
  - `active_time_ms`: suma de tiempos de nivel (sin pausas), para el ranking de tiempo.
  - `levels`: JSON con los niveles jugados (tiempo, vidas perdidas, tokens).
  - `created_at`: lo pone el servidor.
- `leaderboard`: vista de campaña (`start_stage = 1`).
  - `best_score`, `best_stage`, `best_time_ms`, `runs`, `last_played`.

Las partidas iniciadas en nivel 2/3 no aparecen en `leaderboard`, pero sí se
pueden guardar en `runs` para estadísticas futuras. El panel solo enviará
partidas terminadas (`won`, `game_over`, `pau_caught`); las abandonadas se
quedan en el historial local.

## 7. Seguridad y límites

- RLS activo: `anon` solo lee e inserta; no puede editar ni borrar.
- No hay autenticación en el MVP: cualquiera puede usar un nombre. Para una
  clase suele ser suficiente; si se necesita identidad fuerte, se añade
  Supabase Auth en otra fase.
- El juego corre en el navegador, así que un usuario avanzado puede enviar un
  puntaje falso. RLS evita modificaciones, no trampas.
- El plan gratuito de Supabase puede pausar el proyecto por inactividad.
  Para una demo, ábrelo antes de presentar.
- Los nombres y puntajes serán públicos. Usa un alias, no el nombre completo.

## 8. Siguiente fase

Integrar en el panel:

1. Campo “Tu nombre” (guardado en `localStorage`).
2. Envío del resumen al terminar una partida.
3. Tarjeta **Ranking global** con `GET /rest/v1/leaderboard`.
4. Estado de carga, error y vacío.

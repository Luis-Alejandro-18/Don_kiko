# Base de datos del ranking (Supabase)

Esta carpeta contiene el esquema del ranking compartido. El panel ya lee la vista
`leaderboard` y envía las campañas terminadas con la publishable key.

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

## 2.1 Autenticación (registro y login)

1. **Authentication → Sign In / Providers → Email**: proveedor **Enabled**.
2. Desactiva **Confirm email**. Sin esto, `signUp` no devuelve sesión: la cuenta
   se crea pero el usuario no puede entrar hasta confirmar el correo, y además
   choca con el límite de envíos de Supabase.
3. `schema.sql` instala el trigger `on_auth_user_created`, que crea la fila de
   `public.profiles` usando el alias del formulario (o el prefijo del correo).
4. Volver a ejecutar `schema.sql` también rellena los perfiles que falten de
   cuentas creadas antes del trigger.

## 2.2 Migraciones

Si la base ya existía antes de la campaña de 5 niveles, ejecuta una vez
[`migrations/2026-11-12_levels_1_5.sql`](./migrations/2026-11-12_levels_1_5.sql)
en el SQL Editor. Amplía los límites de `runs` y de la política de inserción a
`1..5`, y recrea la vista `leaderboard`. Es idempotente.

Comprobación rápida:

```sql
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.runs'::regclass
  and conname in ('runs_start_stage_range', 'runs_stage_reached_range');
```

Debe mostrar `between 1 and 5` en ambas.

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
- **Publishable key** (o **anon public key** en proyectos anteriores) → clave pública; puede ir en el frontend.

El panel lee ambas desde `js/config.js`. No copies la **service_role key** al
frontend ni al repositorio. La publishable/anon key está diseñada para ser
pública; la protección real está en RLS.

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

Verificado en este proyecto: el insert con la publishable key devuelve `201`,
el `DELETE` devuelve `401` (`permission denied for table runs`) y
`GET /rest/v1/leaderboard` devuelve `200`.

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
pueden guardar en `runs` para estadísticas futuras. El panel solo envía
campañas terminadas (`won`, `game_over`, `pau_caught`) iniciadas en el Nivel 1;
las pruebas de nivel 2/3 y las abandonadas se quedan en el historial local.
`active_time_ms` es la suma de `levels[].timeMs`; el ranking usa el mejor tiempo
de las victorias como desempate.

## 7. Seguridad y límites

- RLS activo: `anon` solo lee e inserta; no puede editar ni borrar.
- Registro y login con Supabase Auth (correo + contraseña). Solo las cuentas
  registradas envían al ranking global; el modo local no necesita cuenta.
- El juego corre en el navegador, así que un usuario avanzado puede enviar un
  puntaje falso. RLS evita modificaciones, no trampas.
- El plan gratuito de Supabase puede pausar el proyecto por inactividad.
  Para una demo, ábrelo antes de presentar.
- Los nombres y puntajes serán públicos. Usa un alias, no el nombre completo.

## 8. Cliente del panel (implementado)

1. `js/config.js` contiene la URL y la publishable key.
2. El nombre se guarda en `localStorage` (`donkiko_dashboard_player_v1`).
3. Al terminar una campaña desde el Nivel 1, el panel hace `POST /rest/v1/runs`
   con `client_run_id`, nombre, puntaje, resultado, niveles y tiempos.
4. La tarjeta **Ranking global** hace `GET /rest/v1/leaderboard` y muestra
   carga, vacío, error, actualización manual y resaltado del jugador actual.

## 9. Siguiente fase

Conectar Netlify al repositorio (`main`, build vacío, publish `.`) y verificar
el sitio HTTPS. Después: probar Edge/Firefox y evaluar identidad con Auth si
hace falta.

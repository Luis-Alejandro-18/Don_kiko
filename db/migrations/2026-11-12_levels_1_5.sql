-- Don Kiko · Migración: permitir campañas de hasta 5 niveles
-- Fecha: 2026-11-12
-- Ejecutar en Supabase → SQL Editor (una sola vez).
--
-- Qué hace:
--   1. Amplía los límites de `runs` de 1..3 a 1..5.
--   2. Recrea la política de inserción con el mismo límite.
--   3. Recrea la vista `leaderboard` (su validación interna también era 1..3).
--
-- Es idempotente: se puede volver a ejecutar sin errores.
-- El ranking histórico no cambia: la vista sigue filtrando `start_stage = 1`.

begin;

-- 1. Límites de la tabla.
alter table public.runs drop constraint if exists runs_start_stage_range;
alter table public.runs drop constraint if exists runs_stage_reached_range;
alter table public.runs drop constraint if exists runs_levels_array;

alter table public.runs
  add constraint runs_start_stage_range check (start_stage between 1 and 5);
alter table public.runs
  add constraint runs_stage_reached_range check (stage_reached between 1 and 5);
alter table public.runs
  add constraint runs_levels_array check (
    jsonb_typeof(levels) = 'array'
    and jsonb_array_length(levels) between 1 and 5
  );

-- 2. Política de inserción (si no se recrea, seguiría bloqueando niveles 4 y 5).
drop policy if exists runs_insert_public on public.runs;
create policy runs_insert_public on public.runs
  for insert
  to anon, authenticated
  with check (
    char_length(client_run_id) between 1 and 64
    and char_length(btrim(player_name)) between 1 and 24
    and player_name = btrim(player_name)
    and score between 0 and 100000000
    and result in ('won', 'game_over', 'pau_caught', 'abandoned')
    and start_stage between 1 and 5
    and stage_reached between 1 and 5
    and duration_ms between 0 and 86400000
    and active_time_ms between 0 and 86400000
    and jsonb_typeof(levels) = 'array'
    and jsonb_array_length(levels) between 1 and 5
    and (user_id is null or auth.uid() = user_id)
  );

-- 3. Vista del ranking (misma definición, con validación 1..5).
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  coalesce(p.alias, r.player_name) as player_name,
  r.user_id,
  max(r.score) as best_score,
  max(r.stage_reached) as best_stage,
  min(r.active_time_ms) filter (
    where r.result = 'won' and r.active_time_ms > 0
  ) as best_time_ms,
  count(*)::integer as runs,
  max(r.created_at) as last_played
from public.runs r
left join public.profiles p on p.id = r.user_id
where r.start_stage = 1
  and r.result <> 'abandoned'
group by r.user_id, p.alias, r.player_name
order by best_score desc, best_time_ms asc nulls last, last_played asc;

revoke all on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

commit;

-- Don Kiko · Esquema inicial del ranking global (Supabase / PostgreSQL)
-- Ejecutar completo en Supabase → SQL Editor.
--
-- Identidad MVP: nombre del jugador.
-- Ranking de campaña: solo partidas iniciadas en el nivel 1 (`start_stage = 1`).
-- Las partidas de prueba (nivel 2/3) no entran en ese ranking.
--
-- Seguridad:
--   - `anon` y `authenticated` solo pueden leer e insertar.
--   - No hay políticas de UPDATE ni DELETE.
--   - La `service_role` key nunca debe usarse en el frontend.

create extension if not exists pgcrypto;

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  client_run_id text not null unique,
  player_name text not null,
  score integer not null default 0,
  result text not null,
  start_stage smallint not null,
  stage_reached smallint not null,
  duration_ms integer not null default 0,
  active_time_ms integer not null default 0,
  levels jsonb not null,
  created_at timestamptz not null default now(),
  constraint runs_client_run_id_len check (char_length(client_run_id) between 1 and 64),
  constraint runs_player_name_len check (char_length(btrim(player_name)) between 1 and 24),
  constraint runs_player_name_trimmed check (player_name = btrim(player_name)),
  constraint runs_score_range check (score between 0 and 100000000),
  constraint runs_result_valid check (result in ('won', 'game_over', 'pau_caught', 'abandoned')),
  constraint runs_start_stage_range check (start_stage between 1 and 3),
  constraint runs_stage_reached_range check (stage_reached between 1 and 3),
  constraint runs_duration_range check (duration_ms between 0 and 86400000),
  constraint runs_active_time_range check (active_time_ms between 0 and 86400000),
  constraint runs_levels_array check (
    jsonb_typeof(levels) = 'array'
    and jsonb_array_length(levels) between 1 and 3
  )
);

create index if not exists runs_created_at_idx on public.runs (created_at desc);
create index if not exists runs_player_name_idx on public.runs (player_name);
create index if not exists runs_score_idx on public.runs (score desc);
create index if not exists runs_campaign_idx on public.runs (start_stage, score desc);

alter table public.runs enable row level security;

drop policy if exists runs_select_public on public.runs;
create policy runs_select_public on public.runs
  for select
  to anon, authenticated
  using (true);

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
    and start_stage between 1 and 3
    and stage_reached between 1 and 3
    and duration_ms between 0 and 86400000
    and active_time_ms between 0 and 86400000
    and jsonb_typeof(levels) = 'array'
    and jsonb_array_length(levels) between 1 and 3
  );

-- El cliente no puede editar ni borrar partidas.
revoke all on public.runs from anon, authenticated;
grant select, insert on public.runs to anon, authenticated;

-- Ranking de campaña: mejor puntaje por jugador.
-- `security_invoker` hace que se aplique la RLS de `runs` al consultar la vista.
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  player_name,
  max(score) as best_score,
  max(stage_reached) as best_stage,
  min(active_time_ms) filter (
    where result = 'won' and active_time_ms > 0
  ) as best_time_ms,
  count(*)::integer as runs,
  max(created_at) as last_played
from public.runs
where start_stage = 1
  and result <> 'abandoned'
group by player_name
order by best_score desc, best_time_ms asc nulls last, last_played asc;

revoke all on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

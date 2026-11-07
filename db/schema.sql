-- Don Kiko · Esquema del ranking global con autenticación (Supabase / PostgreSQL)
-- Ejecutar completo en Supabase → SQL Editor.
-- Fase 1: Registro de usuarios.

-- Identidad: auth.users de Supabase Auth + public.profiles para alias público.
-- Ranking de campaña: solo partidas iniciadas en el nivel 1 (`start_stage = 1`).
-- Las partidas de prueba (nivel 2/3) no entran en ese ranking.

-- Seguridad:
--   - `anon` y `authenticated` solo pueden leer e insertar runs.
--   - No hay políticas de UPDATE ni DELETE en runs.
--   - La `service_role` key nunca debe usarse en el frontend.

create extension if not exists pgcrypto;

-- Tabla de perfiles públicos vinculada a auth.users de Supabase.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  alias text not null unique,
  created_at timestamptz not null default now(),
  constraint profiles_alias_len check (char_length(btrim(alias)) between 1 and 24),
  constraint profiles_alias_trimmed check (alias = btrim(alias))
);

alter table public.profiles enable row level security;

-- Cualquiera puede leer los perfiles públicos (para mostrar alias en el ranking).
drop policy if exists profiles_select_public on public.profiles;
create policy profiles_select_public on public.profiles
  for select
  to anon, authenticated
  using (true);

-- Solo el usuario autenticado puede insertar/actualizar su propio perfil.
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update
  to authenticated
  using (auth.uid() = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete
  to authenticated
  using (auth.uid() = id);

grant select on public.profiles to anon, authenticated;
grant insert, update, delete on public.profiles to authenticated;

-- Tabla de partidas con vinculación opcional a usuario autenticado.
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

-- Agregar user_id a runs si la tabla ya existía (migración desde versión anterior).
alter table public.runs add column if not exists user_id uuid references auth.users on delete set null;

create index if not exists runs_created_at_idx on public.runs (created_at desc);
create index if not exists runs_player_name_idx on public.runs (player_name);
create index if not exists runs_score_idx on public.runs (score desc);
create index if not exists runs_campaign_idx on public.runs (start_stage, score desc);
create index if not exists runs_user_id_idx on public.runs (user_id);

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
    -- Si hay user_id, debe ser el del usuario autenticado.
    and (user_id is null or auth.uid() = user_id)
  );

-- El cliente no puede editar ni borrar partidas.
revoke all on public.runs from anon, authenticated;
grant select, insert on public.runs to anon, authenticated;

-- Ranking de campaña: mejor puntaje por usuario autenticado o por nombre anónimo.
-- `security_invoker` hace que se aplique la RLS de `runs` al consultar la vista.
drop view if exists public.leaderboard;

create view public.leaderboard
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

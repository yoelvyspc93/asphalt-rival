-- Asphalt Rivals — Supabase lobby schema
--
-- Setup (once per project):
-- 1. Create a project at https://supabase.com/dashboard
-- 2. Authentication → Providers → Anonymous sign-in: enable it.
--    Each phone calls signInAnonymously(); RLS depends on auth.uid().
-- 3. Run this file in the SQL editor.
-- 4. Copy Project URL + anon public key into VITE_SUPABASE_URL and
--    VITE_SUPABASE_ANON_KEY. The anon key is public by design; RLS is the defense.
--
-- Free-tier pause: unused projects sleep after about 7 days. On race day,
-- open the dashboard and click Restore before anyone tries to join a room.
--
-- Realtime: tables below are added to the supabase_realtime publication for
-- lobby postgres_changes. Race frames travel on Broadcast channel race:{code}
-- (events "input" and "state") and are not written to Postgres.
--
-- Room codes use the same 6-character alphabet as the local Colyseus server:
-- ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no I, O, 0, 1).

create table if not exists public.rooms (
  code text primary key,
  host_id uuid not null references auth.users (id) on delete cascade,
  phase text not null default 'waiting'
    check (phase in ('waiting', 'countdown', 'racing', 'finished')),
  seed bigint not null,
  countdown_ms integer not null default 0,
  elapsed_ms integer not null default 0,
  winner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_code_alphabet check (
    code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'
  )
);

create table if not exists public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null default 'Piloto',
  slot smallint not null check (slot in (0, 1)),
  ready boolean not null default false,
  connected boolean not null default true,
  constraint room_players_unique_user unique (room_code, user_id),
  constraint room_players_unique_slot unique (room_code, slot)
);

create index if not exists room_players_room_code_idx on public.room_players (room_code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
before update on public.rooms
for each row
execute function public.set_updated_at();

-- Join as the second rider. Locks the room row so a third client cannot sneak in.
create or replace function public.join_room(p_code text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_name text;
  v_room public.rooms%rowtype;
  v_count integer;
  v_slot smallint;
  v_player public.room_players%rowtype;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  v_code := upper(trim(p_code));
  v_name := nullif(trim(both from coalesce(p_display_name, '')), '');
  if v_name is null then
    v_name := 'Piloto';
  else
    v_name := left(v_name, 20);
  end if;

  select * into v_room from public.rooms where code = v_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_room.phase is distinct from 'waiting' then
    raise exception 'RACE_ALREADY_STARTED' using errcode = 'P0001';
  end if;

  select * into v_player
  from public.room_players
  where room_code = v_code and user_id = v_user;
  if found then
    return to_jsonb(v_player);
  end if;

  select count(*) into v_count from public.room_players where room_code = v_code;
  if v_count >= 2 then
    raise exception 'ROOM_FULL' using errcode = 'P0003';
  end if;

  select s.slot into v_slot
  from (select 0 as slot union all select 1) as s
  where s.slot not in (select rp.slot from public.room_players rp where rp.room_code = v_code)
  order by s.slot
  limit 1;

  insert into public.room_players (room_code, user_id, display_name, slot)
  values (v_code, v_user, v_name, v_slot)
  returning * into v_player;

  return to_jsonb(v_player);
end;
$$;

revoke all on function public.join_room(text, text) from public;
grant execute on function public.join_room(text, text) to authenticated;

-- SECURITY DEFINER so membership checks do not recurse through RLS on room_players.
create or replace function public.is_room_member(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.room_players
    where room_code = p_code
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_room_member(text) from public;
grant execute on function public.is_room_member(text) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;

drop policy if exists rooms_select_member on public.rooms;
create policy rooms_select_member on public.rooms
  for select
  using (host_id = auth.uid() or public.is_room_member(code));

drop policy if exists rooms_insert_host on public.rooms;
create policy rooms_insert_host on public.rooms
  for insert
  with check (host_id = auth.uid());

drop policy if exists rooms_update_host on public.rooms;
create policy rooms_update_host on public.rooms
  for update
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists room_players_select_member on public.room_players;
create policy room_players_select_member on public.room_players
  for select
  using (
    user_id = auth.uid()
    or public.is_room_member(room_code)
    or exists (
      select 1
      from public.rooms
      where rooms.code = room_code
        and rooms.host_id = auth.uid()
    )
  );

grant select, insert, update on public.rooms to authenticated;
grant select, insert, update on public.room_players to authenticated;

drop policy if exists room_players_insert_self on public.room_players;
create policy room_players_insert_self on public.room_players
  for insert
  with check (user_id = auth.uid());

drop policy if exists room_players_update_self on public.room_players;
create policy room_players_update_self on public.room_players
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.rooms replica identity full;
alter table public.room_players replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.room_players;
exception
  when duplicate_object then null;
end $$;

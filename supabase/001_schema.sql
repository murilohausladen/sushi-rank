create extension if not exists pgcrypto with schema extensions;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 18),
  nick text not null default '' check (char_length(nick) <= 14),
  photo text not null default '' check (char_length(photo) <= 60000),
  pieces int not null default 0 check (pieces between 0 and 999),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_secrets (
  player_id uuid primary key references public.players(id) on delete cascade,
  secret uuid not null default gen_random_uuid()
);

create table public.game (
  id int primary key default 1 check (id = 1),
  status text not null default 'live' check (status in ('live', 'ended')),
  ended_at timestamptz
);
insert into public.game (id, status) values (1, 'live');

create table public.host_config (
  id int primary key default 1 check (id = 1),
  pin_hash text not null
);

alter table public.players enable row level security;
alter table public.game enable row level security;
alter table public.player_secrets enable row level security;
alter table public.host_config enable row level security;

create policy players_read on public.players for select to anon, authenticated using (true);
create policy game_read on public.game for select to anon, authenticated using (true);

revoke all on public.players, public.game, public.player_secrets, public.host_config from anon, authenticated;
grant select on public.players, public.game to anon, authenticated;

create or replace function public.join_player(p_name text, p_nick text, p_photo text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_secret uuid;
begin
  if (select status from game where id = 1) <> 'live' then raise exception 'game_ended'; end if;
  if (select count(*) from players) >= 60 then raise exception 'table_full'; end if;
  p_name := btrim(coalesce(p_name, '')); p_nick := btrim(coalesce(p_nick, '')); p_photo := coalesce(p_photo, '');
  if char_length(p_name) < 1 or char_length(p_name) > 18 then raise exception 'bad_name'; end if;
  if char_length(p_nick) > 14 then raise exception 'bad_nick'; end if;
  if p_photo <> '' and (p_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' or char_length(p_photo) > 60000) then raise exception 'bad_photo'; end if;
  insert into players (name, nick, photo) values (p_name, p_nick, p_photo) returning id into v_id;
  insert into player_secrets (player_id) values (v_id) returning secret into v_secret;
  return json_build_object('id', v_id, 'secret', v_secret);
end $$;

create or replace function public.set_pieces(p_id uuid, p_secret uuid, p_pieces int)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from player_secrets where player_id = p_id and secret = p_secret) then raise exception 'forbidden'; end if;
  if (select status from game where id = 1) <> 'live' then raise exception 'game_ended'; end if;
  if p_pieces is null or p_pieces < 0 or p_pieces > 999 then raise exception 'bad_value'; end if;
  update players set pieces = p_pieces, updated_at = now() where id = p_id;
end $$;

create or replace function public.update_profile(p_id uuid, p_secret uuid, p_name text, p_nick text, p_photo text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from player_secrets where player_id = p_id and secret = p_secret) then raise exception 'forbidden'; end if;
  p_name := btrim(coalesce(p_name, '')); p_nick := btrim(coalesce(p_nick, '')); p_photo := coalesce(p_photo, '');
  if char_length(p_name) < 1 or char_length(p_name) > 18 then raise exception 'bad_name'; end if;
  if char_length(p_nick) > 14 then raise exception 'bad_nick'; end if;
  if p_photo <> '' and (p_photo !~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' or char_length(p_photo) > 60000) then raise exception 'bad_photo'; end if;
  update players set name = p_name, nick = p_nick, photo = p_photo, updated_at = now() where id = p_id;
end $$;

create or replace function public.check_host(p_pin text)
returns boolean language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from host_config where pin_hash = crypt(coalesce(p_pin, ''), pin_hash));
$$;

create or replace function public.set_game_status(p_pin text, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not check_host(p_pin) then raise exception 'forbidden'; end if;
  if p_status not in ('live', 'ended') then raise exception 'bad_status'; end if;
  update game set status = p_status, ended_at = case when p_status = 'ended' then now() else null end where id = 1;
end $$;

revoke all on function public.join_player(text, text, text), public.set_pieces(uuid, uuid, int), public.update_profile(uuid, uuid, text, text, text), public.check_host(text), public.set_game_status(text, text) from public;
grant execute on function public.join_player(text, text, text), public.set_pieces(uuid, uuid, int), public.update_profile(uuid, uuid, text, text, text), public.check_host(text), public.set_game_status(text, text) to anon, authenticated;

alter publication supabase_realtime add table public.players, public.game;

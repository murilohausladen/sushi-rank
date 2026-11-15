-- Histórico de peças: cada mudança de contagem vira uma linha com o horário.
-- Alimenta o gráfico "Peças por horário" do pódio. Quem preenche é um gatilho,
-- então o app não precisa mudar nada para gravar.
create table public.pieces_log (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players(id) on delete cascade,
  pieces int not null,
  at timestamptz not null default now()
);
create index pieces_log_player_at on public.pieces_log (player_id, at);

alter table public.pieces_log enable row level security;
create policy pieces_log_read on public.pieces_log for select to anon, authenticated using (true);
revoke all on public.pieces_log from anon, authenticated;
grant select on public.pieces_log to anon, authenticated;

create or replace function public.log_pieces()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into pieces_log (player_id, pieces) values (new.id, new.pieces);
  return new;
end $$;
revoke all on function public.log_pieces() from public, anon, authenticated;

create trigger players_log_insert after insert on public.players
  for each row execute function public.log_pieces();
create trigger players_log_update after update of pieces on public.players
  for each row when (old.pieces is distinct from new.pieces) execute function public.log_pieces();

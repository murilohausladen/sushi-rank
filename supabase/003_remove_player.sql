create or replace function public.remove_player(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not check_host(p_pin) then raise exception 'forbidden'; end if;
  delete from players where id = p_id;
end $$;

revoke all on function public.remove_player(text, uuid) from public;
grant execute on function public.remove_player(text, uuid) to anon, authenticated;

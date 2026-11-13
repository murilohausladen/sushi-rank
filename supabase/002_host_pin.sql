-- Troque TROQUE_O_PIN por um PIN só seu (8 ou mais caracteres) antes de rodar.
-- O banco guarda apenas o hash.
insert into public.host_config (id, pin_hash)
values (1, extensions.crypt('TROQUE_O_PIN', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;

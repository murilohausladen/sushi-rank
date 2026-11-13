# Sushi Rank

Contador de peças de sushi com ranking ao vivo e pódio no final. Cada pessoa abre o link no próprio celular, escolhe foto, nome e apelido e soma ou subtrai as peças que comeu. O anfitrião encerra a contagem e todo mundo vê o pódio.

Página estática (HTML, CSS e JS) que conversa com um banco Supabase. Não precisa de conta para participar.

## Como funciona

- `index.html` e `app.js`: o app inteiro. `vendor/supabase.js` é a biblioteca cliente do Supabase (v2.45.4, licença MIT).
- Ranking em tempo real pelo Realtime do Supabase, com ressincronização a cada 8 segundos como rede de segurança.
- Cada pessoa recebe um segredo ao entrar, guardado só no aparelho dela. Só quem tem o segredo muda a própria contagem.
- O anfitrião usa um PIN para encerrar e reabrir a contagem. O PIN fica no banco só como hash.
- As tabelas não aceitam escrita direta. Toda escrita passa por funções do banco (`join_player`, `set_pieces`, `update_profile`, `set_game_status`).

## Banco de dados

Os scripts estão em `supabase/`:

1. `001_schema.sql`: tabelas, regras de acesso, funções e Realtime.
2. `002_host_pin.sql`: modelo para definir o PIN do anfitrião (troque o valor antes de rodar).
3. `003_remove_player.sql`: função para o anfitrião remover participantes (exige o PIN).

Para usar outro projeto Supabase, rode os três scripts nele e troque `SB_URL` e `SB_KEY` no começo de `app.js` pela URL e pela chave `anon` do novo projeto.

## Publicação

O site é servido pelo GitHub Pages, a partir da raiz da branch `main`.

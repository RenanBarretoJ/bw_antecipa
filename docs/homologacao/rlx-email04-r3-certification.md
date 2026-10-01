# RLX-EMAIL-04-R3 — recertificação operacional

Roteiro autorizado em 01/10/2026. Produção proibida; homologação depende de
certificação Linux e de todos os gates do Preview no HEAD esperado.

## Correção de cleanup

O Preview anterior concluiu os testes reais das NFs 940002, 940003 e 940004,
mas a remoção padrão dos agendamentos falhou. `cron.unschedule` possui
sobrecargas por nome (`text`) e ID (`bigint`). O parâmetro sem tipo resolveu
para nome mesmo recebendo o ID retornado por `cron.job`, causando XX000.

`scripts/email-intake/automation-scheduler.mjs` agora usa `$1::bigint`.
A mudança preserva o filtro por projeto/tarefa, a transação e a remoção
dos secrets e da função de dispatch. Não altera migrations, pipeline fiscal,
autorização, start_at, parser, reservas, Storage ou regras de negócio.

O diagnóstico anterior reproduziu a falha em transação com rollback e validou
a chamada tipada. A limpeza foi concluída de forma controlada, com evidências
preservadas; isso não certificava o comando padrão.

## Gates desta execução

1. Certificar o novo HEAD no Linux: testes, TypeScript, lint, build, banco,
   Auth, Storage, 255 migrations e regressões fiscais/temporais.
2. Conferir Preview sem integração ativa/resíduos; executar o comando padrão
   de ativação e remoção, incluindo repetição idempotente, e conferir jobs,
   função de dispatch e Vault.
3. Publicar o HEAD certificado no Preview e revalidar automação, recovery,
   lifecycle, health, alertas, SLO, mensagens QA novas e cleanup.
4. Promover somente o escopo autorizado para homolog após todos os gates.
5. Executar os smokes reais e cleanup homolog; parar em Homolog_READY.

Resultados serão registrados em `rehearsal/reports/RLX_EMAIL_04_R3_CHECKPOINT.json`.
Gates pendentes não equivalem a PASS. Evidências anteriores não certificam
automaticamente o novo HEAD. O PR #82 permanece draft até a promoção preparada.

Referência: [assinaturas de remoção do pg_cron](https://github.com/citusdata/pg_cron#removing-a-cron-job).

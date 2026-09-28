# P16 — rollout controlado em produção

Em 28/09/2026, às 19:50:01 UTC (16:50:01 de Brasília), foi aplicada exclusivamente
a migration `20260928185439_p16_liberar_nf_de_operacao_cancelada.sql` em produção.
O postflight passou. **O encerramento permanece pendente da disponibilidade do
Cedente para validar a interface e realizar uma única solicitação legítima.**
Não houve criação de operação pelo agente nem uso de impersonação.

## P16_PROD_BRANCH_GRAPH_DIAGNOSIS

- Main e aplicação em produção: `83ece9c676a4f39ff130a8885847735c8b1da17d`.
- Deployment READY, target production: `dpl_C4Jb3Q2GVxekaJDZAWaSZieg5jUD`.
- Domínio: `https://bw-antecipa.better-with.tech`.
- Branch: `hotfix/p16-reutilizar-nf-operacao-cancelada`; PR #65.
- Commits homologados: `3603dcd`, `315cf55`, `65ba24f`.
- Delta homologado contra main: 9 arquivos, 802 inserções, sem código de aplicação.
- Arquivos: migration P16; scripts `apply-homolog.mjs`, `homolog-env.mjs`,
  `smoke-homolog.mjs`, `verify-local.mjs`; relatório P16 e três evidências JSON de homolog.
- Promoção: somente a migration certificada e seu registro exato no history,
  na mesma transação. Nenhum merge em main ou novo deploy de aplicação necessário.
- C2.1-R2, C5-R2, CERC e RLX Email preservados.

Project ref confirmado: `wwsndnuvnjuabpbjwlck`; host PostgreSQL
`aws-1-us-east-1.pooler.supabase.com`, usuário de conexão vinculado ao ref de
produção, database `postgres`. O projeto de homolog é distinto:
`fhgkmggthxikfpogrvaa`.

SHA-256 do arquivo certificado e do SQL registrado em produção:
`6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1`.

## Pré-checagem e ensaio

O caso real é a operação cancelada `8cbb79f2-7829-462e-b350-518b459092d6`,
com 20 NFs aprovadas, sem outra operação reservante. Números:
279742, 279749, 279754, 279760, 279767, 279775, 279785, 279790, 279797,
282676, 282681, 282708, 282731, 282742, 282823, 282830,
285264, 285273, 285290 e 285303.
IDs e todos os vínculos estão no [checkpoint](p16-prod-checkpoint.json), sem CNPJ
ou informações cadastrais.

Os objetos P14 estavam presentes e suas definições eram idênticas ao baseline
homologado. A versão antiga `20260922182301` não estava no migration history de
produção. Essa lacuna preexistente foi apenas registrada, conforme a instrução
de não reconciliar history antigo. C1.1 estava registrado e íntegro; P16 estava
ausente tanto no history quanto na definição do predicado.

O banco local exclusivo `bw-antecipa-p16-clean-room`, porta 56322, foi restaurado
até `20260925205512`. Sete funções, incluindo os dois overloads de solicitação e
os controles organizacionais, foram comparadas com produção: definições e ACLs
iguais, normalizando apenas finais de linha CRLF. O ensaio aplicou somente P16
após esse baseline e passou nas 17 verificações SQL reais:

- matriz completa de status; reutilização de canceladas e reprovadas;
- bloqueio de cada status reservante; histórico múltiplo com e sem reserva ativa;
- Cedente, Consultor/C2, LEITOR, cross-org e cross-Cedente;
- ambos os corpos RPC, histórico, auditoria e parcelas;
- duas sessões concorrentes, espera de lock observada, uma vencedora,
  uma negada e exatamente uma reserva ativa.

A chamada SQL de 16 argumentos é ambígua no baseline devido ao parâmetro default
do overload de 17. O teste do corpo legado o isola por rename transacional apenas
no banco local, revertido ao final. Nada disso foi executado em produção.

A primeira inicialização local falhou por health check de Realtime, e o reset
simultâneo foi interrompido. O ensaio foi refeito sequencialmente com apenas
PostgreSQL, sem alterar os outros ambientes locais. O banco foi parado após o
teste; suas fixtures sintéticas permanecem apenas no volume local descartável.

Evidência: [p16-prod-rehearsal.json](p16-prod-rehearsal.json).

## Aplicação e postflight

Executor: [production-rollout.mjs](../../scripts/homologacao/p16/production-rollout.mjs),
com alvo fixo, hash certificado, checks de baseline, transação, timeouts e lock
de aplicação. Uma única versão foi inserida no history junto com o SQL integral.
Qualquer falha anterior ao commit teria revertido a transação.

O checkpoint anterior à escrita contém definições, grants, migration history,
contagens e hashes de operações/NFs/vínculos, além de hashes específicos da
operação cancelada, seus vínculos e sua auditoria. O rollback SQL do predicado
foi preparado em `rehearsal/tmp/p16-prod-rollback.sql`; não foi executado.
Rollback posterior deve preservar qualquer operação legítima e usar uma nova
migration compensatória, sem apagar o histórico de aplicação do P16.

Resultados confirmados na transação e em leitura independente após o commit:

- cancelada e reprovada não reservam; os outros seis status reservam;
- predicado final e os dois RPCs equivalentes aos homologados;
- locks `FOR UPDATE`, grants e funções organizacionais preservados;
- history anterior intacto e P16 registrado exatamente uma vez;
- contagens e hashes de dados iguais antes/depois dentro da transação;
- operação cancelada, seus 20 vínculos e auditoria histórica intactos;
- 20 NFs aprovadas, zero reservas ativas no caso; zero NFs aprovadas com reserva
  ativa no snapshot global; zero sessões esperando lock no snapshot do postflight.

O snapshot transacional comprova ausência de DML pelo executor. Não se pretende
atribuir a ele atividades legítimas de outras sessões concorrentes.

Evidências: [migration](p16-prod-migration.json),
[postflight](p16-prod-postflight.json), [preflight](p16-prod-preflight.json).

## Validação pendente e monitoramento

O usuário informou que precisa aguardar a disponibilidade do Cedente. Instrução
já fornecida: login normal com MFA, Minhas Operações → Nova solicitação de
antecipação, selecionar as NFs pretendidas e conferir o resumo financeiro,
**sem enviar ainda**. Registrar números selecionados, ausência de erros e que
NFs com operação ativa não aparecem como elegíveis.

Após UI eligibility PASS, repetir leitura de reservas das NFs selecionadas antes
de liberar uma única criação legítima. Conferir novo ID, status, vínculos,
exclusividade, ator Cedente da auditoria, timestamps e preservação dos hashes do
histórico cancelado. Não executar concorrência nem criar fixtures em produção.
Se a NF não aparecer, parar antes do submit e diagnosticar.

Monitoramento inicial de 19:50:01 a 19:52:45 UTC: 29 registros Vercel, todos HTTP
200, zero registros de erro, 4xx/5xx ou padrões de erro de reserva/RPC/lock/auditoria.
A janela é curta e não contém o smoke real; não certifica a experiência do Cedente.
Evidência: [p16-prod-monitoring.json](p16-prod-monitoring.json).

O CI do commit homologado `65ba24f` passou no run `36472748392`; os testes de app,
lint, TypeScript e build já constam no relatório de homolog. Esta etapa alterou
somente executores operacionais/evidências; lint desses executores e diff check
passaram. Não houve novo deploy de produção.

## Status do runbook

```text
P16_PROD_DELTA_ISOLATED = YES
P16_PRODUCTION_TARGET_CONFIRMED = YES
P16_REAL_CASE_FOUND = YES
P16_REAL_CASE_CANCELLED_OPERATION = YES
P16_OTHER_ACTIVE_RESERVATION_FOUND = NO
P16_PROD_SCHEMA_PRECHECK = PASS
P16_PROD_REHEARSAL = PASS
P16_PROD_MIGRATION = PASS
P16_PROD_HISTORY_POSTCHECK = PASS
P16_PROD_DB_EQUIVALENT_TO_HOMOLOG = PASS
P16_PROD_UNINTENDED_DATA_MUTATION = ZERO
P16_PROD_APP_CHANGE_REQUIRED = NO
P16_PROD_APP_TESTS = NOT_REQUIRED
P16_PROD_CI = NOT_REQUIRED
P16_PROD_DEPLOY = NOT_REQUIRED
P16_PROD_UI_ELIGIBILITY = NOT_EXECUTED
P16_PROD_REAL_SMOKE = NOT_EXECUTED
P16_PROD_CANCELLED_HISTORY_PRESERVED = NOT_EXECUTED
P16_PROD_ACTIVE_EXCLUSIVE = NOT_EXECUTED
P16_PROD_AUDIT = NOT_EXECUTED
P16_PROD_P14_REGRESSION = PASS
P16_PROD_C2_REGRESSION = PASS
P16_PROD_C1_1_REGRESSION = PASS
P16_ROLLBACK_EXECUTED = NO
P16_PRODUCTION_READY = NO
C2_1_R2_CHANGED = NO
C5_R2_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

As flags de histórico, exclusividade e auditoria acima referem-se ao resultado
após a futura criação real. O histórico já foi conferido como intacto no
postflight da migration; a criação ainda não ocorreu.

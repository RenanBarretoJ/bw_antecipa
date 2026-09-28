# P16 — reutilização de NF de operação cancelada

## Diagnóstico

Base: `origin/main` em `83ece9c676a4f39ff130a8885847735c8b1da17d`.
Classificação: `KNOWN_GAP_NOW_MATERIALIZED`. A migration P14
`20260922182301` documenta explicitamente a manutenção de `cancelada` como
reservante. A função privada `operacao_status_reserva_nf` mantém essa regra
em produção e homologação. Não é uma regressão introduzida pelo P15.1.

As duas sobrecargas de `solicitar_operacao_antecipacao_atomica` usam o mesmo
predicado. A versão de 16 argumentos vem do P14; a de 17 argumentos foi
atualizada pelo C1.1 (`20260925144547`) e atende Cedente/Consultor, com e sem
parcelas. Ambas mantêm locks antes da checagem de reserva. O fluxo com
parcelas também mantém sua verificação de disponibilidade por parcela.

`src/lib/actions/operacao.ts`, função `cancelarOperacao`, valida o Cedente e
o estado solicitada/em_analise, cancela a operação, restaura a NF para
aprovada, libera parcelas e registra log/evento. Essas escritas existentes
são separadas; P16 não altera esse fluxo porque a restauração foi observada
no caso real. `operacoes_nfs` permanece como histórico.

`src/lib/operacoes/nova-solicitacao.server.ts` seleciona NFs aprovadas do
contexto ativo, dentro do vencimento e com elegibilidade documental. A UI
apresentava as NFs restauradas, mas o submit rejeitava seu histórico cancelado.

## Caso real e baseline de produção

Projeto confirmado: `wwsndnuvnjuabpbjwlck` (`bw-antecipa`). O usuário confirmou
a operação `8cbb79f2-7829-462e-b350-518b459092d6`. Consulta somente leitura:
cancelada, 20 vínculos históricos, 20 NFs aprovadas, nenhum outro vínculo de
operação para essas NFs. A situação deve ser conferida novamente antes da
migration e do smoke produtivo.

| Status | Baseline medido: reserva | P16 esperado: reserva |
| --- | --- | --- |
| solicitada | sim | sim |
| em_analise | sim | sim |
| aprovada | sim | sim |
| em_andamento | sim | sim |
| liquidada | sim | sim |
| inadimplente | sim | sim |
| reprovada | não | não |
| cancelada | sim | não |

MD5 de `pg_get_functiondef`, iguais em produção/homolog antes do P16:

- predicado: `90cbdcc13789bfe14907f403903a5cac`;
- RPC 16 argumentos: `3e8de55f12866ef332af984fde40c102`;
- RPC 17 argumentos: `bf0ba6dfc83993afd4106c46408edb05`.

## Correção

Migration incremental `20260928185439_p16_liberar_nf_de_operacao_cancelada.sql`.
Altera somente a função privada compartilhada: remove `cancelada` da lista
reservante. Preserva assinatura, volatilidade, search_path e ACL restrita.
Nenhum DML, exclusão de histórico, mudança de RPC público, RLS, grant
operacional, app, taxa, template ou integração.

Referências consultadas: [funções Supabase](https://supabase.com/docs/guides/database/functions)
e [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html).

## Validação local

- Suíte: 2284 testes aprovados, 12 ignorados; TypeScript aprovado.
- Lint: zero erros; aviso preexistente em `src/lib/actions/liquidacao.ts`.
- Build Webpack aprovado.
- Banco isolado `bw-antecipa-p16-clean-room`, portas 563xx, sem tocar os
  outros stacks locais. Inicialização e reset completo até P16 aprovados.
- `node scripts/homologacao/p16/verify-local.mjs --concurrency`: 17 checks
  aprovados, com SQL real sob role authenticated e claims sintéticos.
  Cobre cancelamento/reuso/histórico/auditoria, oito estados, múltiplo
  histórico, C2, LEITOR, cross-org, cross-Cedente, parcelas e concorrência.
- Concorrência: segunda transação observada esperando lock; exatamente um
  sucesso, uma negação, uma reserva ativa e um log de solicitação do vencedor.
- O teste reutiliza fixtures C1.1. O modo concorrente deixa apenas dados
  sintéticos no clean-room, removidos por reset local ao concluir.
- Os oito testes pgTAP de `supabase/tests/c1_1_organizacao_consultora.test.sql`
  passaram após habilitar a extensão pgTAP no banco local.

Limitação legada encontrada: chamada SQL direta com 16 argumentos é ambígua
porque a sobrecarga de 17 tem DEFAULT NULL. Para verificar o corpo legado,
o teste renomeia temporariamente a sobrecarga atual dentro de uma transação
local e desfaz com rollback. Nenhuma alteração equivalente é proposta nos
ambientes remotos. O app usa a assinatura atual com `p_parcela_ids` explícito.

## Rollback e promoção

Rollback da mudança: nova migration restaurando a definição anterior do
predicado, com `cancelada` reservante. Não desfaz operações legítimas criadas
após o hotfix nem remove vínculos históricos. Antes de qualquer rollback,
reavaliar reservas ativas; preservar todas as operações e seus documentos.

Promoção pendente dos gates Preview/Homolog, CI, aplicação explícita e
smoke produtivo. Não executar db push. Conferir hash, aplicar só P16 em
transação com parada em erro, registrar a versão exata e comparar definições.

## Preview e homologação

PR: https://github.com/RenanBarretoJ/bw_antecipa/pull/65.
CI do primeiro commit `3603dcd`: run `36469462413`, aprovado.
Preview Vercel: deployment `7rzrHpyGdFzKGFtrVLSboUhjSk1L`, aprovado.
Produção observada: `dpl_C4Jb3Q2GVxekaJDZAWaSZieg5jUD`, READY, anterior ao P16.

O check Supabase Preview foi **cancelado**, sem criar branch P16:
`Maximum number of concurrent branches reached. You can update this limit in Project Integrations Settings.`
A branch temporária existente pertence ao C2.1-R2; foi preservada conforme
o congelamento de outras frentes. Após informar o impedimento, o usuário
determinou: **"Manter pendente por enquanto"**. Promoção suspensa nesse ponto.

Homologação persistente `fhgkmggthxikfpogrvaa`: teste SQL da migration em
transação com rollback. O comando reproduzível é
`node scripts/homologacao/p16/verify-local.mjs --homolog-env=<arquivo-local>`.
O alvo remoto é fixo e produção é recusada. Concorrência com fixtures
persistentes é proibida nesse modo. Não há gravação no migration history.

O ensaio final aprovou 15 checks, incluindo parcelas.
O rollback foi conferido por consulta independente: predicado anterior
restaurado, zero usuários QA e zero fundos QA restantes. Essas evidências
são de SQL sob role authenticated e claims sintéticos; não equivalem a login
real, navegação do Cedente ou smoke HTTP da aplicação.

Homologação tem migrations C5-R2 adicionais, mas as definições dos três
objetos relevantes são idênticas ao baseline produtivo. Nenhuma migration
C5-R2 foi aplicada, removida ou promovida por este trabalho.

## Status dos gates

`FAIL` abaixo significa gate ainda não satisfeito quando a observação indica
pendência; não significa que um teste inexistente tenha sido executado.
Resultados PASS de fluxo/reutilização referem-se ao ensaio SQL descrito acima.

```text
P16_CLASSIFICATION = KNOWN_GAP_NOW_MATERIALIZED
P16_ROOT_CAUSE_IDENTIFIED = YES
P16_REAL_CASE_VALIDATED = YES
P16_OTHER_ACTIVE_RESERVATION_FOUND = NO
P16_STATUS_MATRIX_BASELINE = PASS
P16_CANCELADA_REUSE = PASS
P16_REPROVADA_REUSE = PASS
P16_ACTIVE_BLOCK = PASS
P16_MULTI_HISTORY = PASS
P16_CONCURRENCY = PASS
P16_CEDENTE_FLOW = PASS
P16_C2_REGRESSION = PASS
P16_C1_1_REGRESSION = PASS
P16_C4_REGRESSION = PASS
P16_P14_REGRESSION = PASS
P16_MIGRATION_REQUIRED = YES
P16_CLEAN_ROOM = PASS
P16_APP_TESTS = PASS
P16_CI = PASS
P16_PREVIEW = FAIL
P16_HOMOLOG = FAIL
P16_PRODUCTION_TARGET_CONFIRMED = YES
P16_PROD_MIGRATION = FAIL
P16_PROD_HISTORY_POSTCHECK = FAIL
P16_PROD_DB_EQUIVALENT_TO_HOMOLOG = FAIL
P16_PROD_APP_DEPLOY = NOT_REQUIRED
P16_PROD_REAL_SMOKE = NOT_EXECUTED
P16_PROD_CANCELLED_HISTORY_PRESERVED = NOT_EXECUTED
P16_PROD_ACTIVE_EXCLUSIVE = NOT_EXECUTED
P16_PROD_AUDIT = NOT_EXECUTED
P16_ROLLBACK_EXECUTED = NO
P16_PRODUCTION_READY = NO
C2_1_R2_CHANGED = NO
C5_R2_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

Pendências: vaga Preview Supabase; smoke autenticado Preview/Homolog;
migration produtiva explícita e seu postflight; integração; tentativa real
controlada do Cedente e auditoria. Nenhum merge em main, migration persistente
remota ou pedido produtivo foi realizado pelo agente. O rollback do ensaio
de homologação não é um rollback de release produtiva.

SHA-256 do arquivo da migration validada:
`6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1`.

O CI PASS refere-se ao commit inicial identificado acima. O complemento de
evidências e teste de parcelas foi validado por SQL local/remoto, ESLint e
diff-check; qualquer novo CI automático deve ser conferido antes da retomada.

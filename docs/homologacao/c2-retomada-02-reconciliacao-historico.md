# C2 RETOMADA 02 - reconciliacao do historico de homologacao

Data de referencia: 23/09/2026

Projeto Supabase de homologacao: `fhgkmggthxikfpogrvaa`

Branch de integracao: `validation/c2-retomada-02-homolog-infra`

## Resultado

O historico remoto de migrations foi reconciliado com a cadeia canonica do Git sem executar SQL de migration e sem alterar schema ou dados operacionais. O procedimento foi ensaiado antes em um banco local isolado e depois executado em homologacao, uma versao por comando, usando somente `supabase migration repair`.

A versao remota legitima `20260827150923` foi preservada. Como seu efeito material, o helper exclusivo de homologacao `private.excluir_usuarios_homolog(uuid[])`, ja havia sido removido pela migration forward `20260922161558`, foi adicionado ao Git um anchor historico no-op. O anchor permite manter a versao imutavel no historico sem recriar o helper e sem introduzir comportamento de homologacao na cadeia destinada a producao.

O P14 foi reconciliado pela equivalencia comprovada do SQL: a versao canonica `20260922182301` ficou registrada e o alias remoto `20260922190141` foi removido somente do metadata.

## Evidencias antes e depois

| Evidencia | Antes | Depois |
|---|---:|---:|
| Migrations remotas | 206 | 210 |
| Hash do historico | `27d6bd2a09f211923941ce9b1ccdaa8d` | `0fe7ac6343d2361c9d3ed5859ef9729b` |
| Hash do schema-alvo | `40ee0e6871bd6ece3588388549e0fc82` | `40ee0e6871bd6ece3588388549e0fc82` |
| Cedentes | 118 | 118 |
| Notas fiscais | 187 | 187 |
| Operacoes | 18 | 18 |
| Usuarios Auth | 249 | 249 |

O rehearsal local terminou com 210 versoes, paridade integral e `db push --dry-run` vazio. Em homologacao, cada reparo foi seguido por consulta read-only do hash e das contagens. Todos permaneceram invariaveis.

## Certificacao final

- `supabase migration list --linked`: todas as 210 versoes possuem correspondencia local/remota;
- `supabase db push --dry-run --linked`: `Remote database is up to date`, sem migrations, seeds ou roles;
- `20260827150923`: presente em ambos os lados;
- `20260922182301`: presente em ambos os lados;
- `20260922190141`: ausente;
- deployment Vercel de homologacao: `Ready`, target `homolog`, com o alias `homolog.bw-antecipa.better-with.tech`;
- checks HTTP automatizados responderam 200 durante o reparo e depois passaram a receber `X-Vercel-Mitigated: challenge`; isso foi classificado como mitigacao anti-bot, nao indisponibilidade do deployment.

## Validacoes do pacote Git

| Gate | Resultado |
|---|---|
| Teste estatico do anchor historico | PASS - 2/2 |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS - 3 warnings preexistentes |
| `npm test` | PASS - 262 arquivos, 3 skipped; 2.219 testes, 12 skipped |
| `npm run build` | PASS |
| `npm run rehearsal:test` | BASELINE CONHECIDA - 20 PASS / 13 FAIL |

As 13 falhas de rehearsal continuam concentradas nos manifestos de producao congelados, cuja cobertura ja divergia da cadeia atual antes desta retomada. O anchor adicionou dois testes que passaram e nao introduziu uma nova classe de falha. Os manifestos de producao nao foram atualizados porque isso ampliaria o escopo e alteraria o bundle congelado.

## Limites

- nenhuma acao foi executada em producao;
- nenhuma migration SQL foi aplicada pelo reparo de historico;
- P13 e P14 nao tiveram codigo funcional alterado;
- nenhuma alteracao de layout, menu lateral ou texto de autenticacao integra este escopo;
- o pedido de alteracao do menu lateral e do texto de autenticacao foi explicitamente retirado do escopo; nenhum arquivo de layout foi modificado.

## C2 reconstruido sobre a main atual

O C2 foi reconstruido a partir da `main` `3597e07428f1beae7a4546704fb4968ed0c9ffb6`, sem merge cego da branch historica. A migration foi reposicionada depois do P14, em `20260922214000`, e passou a usar `private.operacao_status_reserva_nf(op.status)`. Isso preserva o reuso de NF vinculada apenas a operacao reprovada e mantem o bloqueio quando existe uma operacao ativa.

O Preview limpo confirmou a migration nova, a ausencia da versao C2 antiga, a presenca do helper P14 e a RPC com autorizacao de Consultor e sem regressao da regra P14. A integracao permanente em homologacao aplicou somente `20260922214000_c2_consultor_criacao_operacao_cedente.sql`.

| Evidencia C2 | Resultado |
|---|---|
| Branch de validacao | `validation/c2-consultor-on-current-main` |
| Pull request de validacao | `#42` |
| Commit final em homologacao | `cc8f01a63b38e8fe8a8cb2f8ee6a846e54a4551e` |
| Migrations remotas apos C2 | 211 |
| Hash do historico apos C2 | `dcd800edfba2d1ce664d8009eac7792d` |
| `supabase db push --dry-run --linked` | vazio / up to date |
| CI de homologacao | PASS |
| Supabase check | PASS |
| Vercel homologacao | PASS / Ready |
| Deployment | `dpl_5e9uxkxzpCcx4Gxvq1sZupRJhGAX` |

## Smoke autenticado do Consultor em homologacao

O script `scripts/homologacao/c2-consultor/e2e.mjs` criou atores, Cedentes, NFs e operacoes exclusivamente sinteticos no projeto `fhgkmggthxikfpogrvaa`. O script exige confirmacao explicita do project ref, bloqueia producao, usa JWTs reais para RLS/RPC, autentica o Consultor com TOTP e remove a fixture em uma transacao ao final.

A rodada final `QA_C2_1790167910630_` terminou com **30/30 verificacoes aprovadas**:

- seletor obrigatorio, minimo de quatro caracteres e estado vazio;
- busca sem acento, sem diferenca de caixa e por CNPJ;
- limite de dez resultados e invisibilidade de Cedente nao vinculado ou pendente;
- navegacao por teclado, foco operacional e viewport mobile sem overflow horizontal;
- selecao do Cedente A, troca para B e descarte da selecao/contexto anterior;
- criacao por Consultor para A com NF nova e NF reutilizada de operacao reprovada;
- criacao por Consultor para B;
- negacao de NF de outro Cedente, UUID de Cedente sem vinculo e NF reservada por operacao ativa;
- concorrencia sobre a mesma NF com exatamente um vencedor;
- auditoria com o `usuario_id` do Consultor real e `solicitado_por_role=consultor`;
- regressao de criacao pelo Cedente e leitura pelo Gestor;
- zero vinculo cross-tenant entre operacao e NF;
- cleanup com zero Cedentes, NFs, operacoes, escrows ou usuarios QA residuais e restauracao exata das contagens iniciais.

As memorias logisticas append-only geradas pelos triggers foram removidas no cleanup usando o mesmo padrao controlado dos resets oficiais de homologacao: desativacao temporaria do trigger dentro da transacao, `DELETE` limitado aos IDs QA e reativacao antes do commit.

```ini
HOMOLOG_HISTORY_REPAIR_REHEARSAL = PASS
HOMOLOG_MIGRATION_HISTORY_RECONCILED = PASS
HOMOLOG_GIT_ALIGNED_WITH_SCHEMA = PASS
INFRA_HOMOLOG_READY = YES

C2_DEPENDENCY_C1 = PASS
C2_REBASED_ON_CURRENT_MAIN = PASS
C2_P14_COMPATIBILITY = PASS
C2_FEATURE_TESTS = PASS
C2_FEATURE_CI = PASS
C2_SUPABASE_PREVIEW = PASS
C2_VERCEL_PREVIEW = PASS
C2_READY_FOR_HOMOLOG = YES

C2_HOMOLOG_SELECTOR = PASS
C2_HOMOLOG_SEARCH = PASS
C2_HOMOLOG_P14_COMPATIBILITY = PASS
C2_HOMOLOG_SINGLE_CEDENTE = PASS
C2_HOMOLOG_SECURITY = PASS
C2_HOMOLOG_CONCURRENCY = PASS
C2_HOMOLOG_AUDIT = PASS
C2_HOMOLOG_CEDENTE_REGRESSION = PASS
C2_HOMOLOG_GESTOR_REGRESSION = PASS
C2_HOMOLOG_CLEANUP = PASS
C2_HOMOLOG_READY = YES

P14_CHANGED = NO
P13_CHANGED = NO
PRODUCTION_CHANGED = NO
```

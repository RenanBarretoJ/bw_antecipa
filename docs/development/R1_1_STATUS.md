# R1.1 — parada no rehearsal focado (2026-10-06)

Resultado: **NO_GO**. A compatibilidade SQL ainda não está certificada e o R1
completo não foi retomado. Nenhum commit, push, deploy ou SQL remoto.

## Trabalho preservado

Branch `reconcile/main-homolog-2026-10-06`, HEAD
`2e8146ebe7582c5bdc10ddee1f8862d806607ee2`.
Os 227 arquivos existentes foram comparados por SHA-256 ao checkpoint
`rehearsal/reports/R1_1_WORKTREE_BEFORE.json`: zero arquivos alterados nesta
etapa. As adições R1.1 estão separadas; nenhuma migration histórica foi editada.

Contrato: [R1_1_FISCAL_IDENTITY_CONTRACT.md](R1_1_FISCAL_IDENTITY_CONTRACT.md).
Nova migration preparada, mas **não certificada**:
`20261006201914_fiscal_intake_nfse_municipal_identity_compat.sql`.
SHA-256: `74ba5ff87d70ffd16a1aac4ac0be8d3c4c032454c1d0bec360567ee18f27cc0b`.
Os helpers privados e as três substituições conservam as assinaturas externas.

## Execução e falha

Comando local: `node scripts/qa/reconciliation/r1-1-focused.mjs --local-only`.
Runner não aceita URL, linked, project-ref ou arquivo de ambiente.

1. Bootstrap oficial Supabase em Docker isolado.
2. Restauração do snapshot somente de schema com hashes conferidos. O snapshot
   contém HEALTH municipal e líquido calculado, sem dados operacionais/history.
3. Aplicação de 20 migrations RLX/DOC por lista explícita, seguida da forward
   R1.1 (21 arquivos). Todos os arquivos foram conferidos por hash.
4. Matriz negativa inicial de identidades rejeitadas passou.
5. A primeira NF-e HUMAN reservou e fez stage; stage de outra chave foi negado.
6. `fiscal_intake_prepare_storage` lançou `P0001: FISCAL_DOCUMENT_INVALID`.
   Nenhum commit fiscal nem upload havia sido executado.

O bloqueio é no preparo do ambiente de teste, antes da prova municipal:
o snapshot é exclusivamente DDL, sem linhas de `documento_tipos`, e o runner
não semeou esse catálogo. A definição vigente de prepare_storage (migration
DOC `20261006170514`, linhas 615–619) exige tipo documental ativo para toda
NF-e, mesmo sem requisito na política. A fixture C2.1 cria atores/políticas,
mas não cria tipos documentais. Os registros oficiais são definidos nas
migrations `20260721132903` e `20260722193500`.

Isso **não demonstra defeito da identidade municipal nem sucesso do fix**.
Também não autoriza remover o guard, dispensar documento-base, ignorar o
cenário NF-e ou classificar a falha como PASS.

Conforme seção 17 do roteiro, a execução foi interrompida. Próxima retomada:
completar a fixture local com catálogo documental mínimo derivado do contrato
existente, conferir hash/preconditions e repetir todo o rehearsal. Não é
necessário copiar dados reais nem alterar ambientes remotos.

## Gates

`FAIL` nos cenários ainda não executados significa **evidência insuficiente**,
não um resultado funcional negativo observado. Somente os itens explicitamente
indicados abaixo têm prova de execução. Não reutilizar PASS de outro roteiro.

| Gate | Estado | Evidência / motivo |
| --- | --- | --- |
| R1_1_EXISTING_WORK_PRESERVED | PASS | 227 hashes iguais |
| R1_1_MUNICIPAL_IDENTITY_CONTRACT | PASS | Contrato existente documentado |
| R1_1_IDENTITY_MATRIX | PASS | Matriz contratual; prova positiva SQL incompleta |
| R1_1_RESERVE_NFE | PASS | Primeira NF-e HUMAN reservada |
| R1_1_STAGE_NFE | PASS | Chave trocada negada; chave correta preparada |
| R1_1_RESERVE_NFSE_NATIONAL | FAIL | Não executado após parada |
| R1_1_RESERVE_NFSE_MUNICIPAL | FAIL | Não executado após parada |
| R1_1_STAGE_NFSE_NATIONAL | FAIL | Não executado após parada |
| R1_1_STAGE_NFSE_MUNICIPAL | FAIL | Não executado após parada |
| R1_1_ASSERT_NFE | FAIL | Não alcançado |
| R1_1_ASSERT_NFSE_NATIONAL | FAIL | Não alcançado |
| R1_1_ASSERT_NFSE_MUNICIPAL | FAIL | Não alcançado |
| R1_1_HUMAN_MUNICIPAL | FAIL | Não alcançado |
| R1_1_SYSTEM_MUNICIPAL | FAIL | Não alcançado |
| R1_1_CROSS_CHANNEL_HUMAN_SYSTEM | FAIL | Não alcançado |
| R1_1_CROSS_CHANNEL_SYSTEM_HUMAN | FAIL | Não alcançado |
| R1_1_DEDUPE | FAIL | Não alcançado |
| R1_1_FENCING | FAIL | Não alcançado |
| R1_1_LEASE_OWNERSHIP | FAIL | Não alcançado |
| R1_1_REVIEW | FAIL | Não alcançado |
| R1_1_FROZEN_FACTS_REGRESSION | FAIL | Não alcançado |
| R1_1_NFSE_NET_REGRESSION | FAIL | Não alcançado |
| R1_1_STORAGE_COMPENSATION | FAIL | Não alcançado; harness inicial só cobre metadados |
| R1_1_DOCUMENT_RECONCILIATION | FAIL | Precondição documental ausente na fixture |
| R1_1_SQL_TESTS | FAIL | FISCAL_DOCUMENT_INVALID |
| R1_1_TYPESCRIPT_FOCUSED | FAIL | Não executado nesta etapa |
| R1_1_CLEAN_ROOM_FOCUSED | FAIL | Rehearsal interrompido |
| R1_1_PROD_UPGRADE_ORDER | FAIL | Cadeia aplicada localmente; certificação incompleta |
| R1_1_HOMOLOG_UPGRADE_ORDER | FAIL | Não executado |
| R1_1_SQL_COMPAT_READY | NO | Gates incompletos |
| DOCKER_TEST_ENV_CLEANUP | PASS | Somente container/volume/rede deste teste removidos |
| RECON_R1_READY_FOR_HOMOLOG_ROLLOUT | NO | R1 não retomado |
| PRODUCTION_CHANGED | NO | Sem chamadas remotas de escrita |
| HOMOLOG_CHANGED | NO | Sem chamadas remotas de escrita |
| PRODUCTION_DB_CHANGED | NO | Sem SQL remoto |
| HOMOLOG_DB_CHANGED | NO | Sem SQL remoto |

## Evidências locais

- `rehearsal/reports/R1_1_WORKTREE_BEFORE.json`: checkpoint anterior às adições.
- `rehearsal/reports/R1_1_FOCUSED_SQL.json`: hashes, lista executada, erro e cleanup.
- `rehearsal/reports/bw_email03_r11_1791318445758-resources.json`: inventários e
  ownership Docker antes/depois. Preservado `supabase_db_nfse-submit-20261005`
  e todos os demais recursos preexistentes; sem prune global.
- `scripts/qa/reconciliation/r1-1-focused-manifest.json`: lista explícita.
- `scripts/qa/reconciliation/r1-1-municipal-db.mjs`: harness real preparado;
  os cenários posteriores ao erro permanecem não certificados.

A pasta local `rehearsal/tmp/bw_email03_r11_1791318445758` foi preservada:
a tentativa de removê-la foi bloqueada pela política da ferramenta. Ela contém
somente configuração/cache do bootstrap descartável; o container, o volume e a
rede já foram removidos com ownership validado. Não houve tentativa alternativa
de contornar o bloqueio.

Os gates restantes do R1 (artefatos P16/SACADO, manifests finais, upgrade dos
dois baselines, full SQL/pgTAP, TypeScript completo, lint, Linux build e CI)
continuam pendentes. A6 original não foi executada nem marcada artificialmente.

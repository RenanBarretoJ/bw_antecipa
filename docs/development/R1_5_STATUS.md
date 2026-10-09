# R1.5 — fonte canônica corrigida; parada por cobertura incompleta do restore

Data: 07/10/2026. Worktree `bw_antecipa_reconcile_r1`.
Branch `reconcile/main-homolog-2026-10-06`.
HEAD preservado: `2e8146ebe7582c5bdc10ddee1f8862d806607ee2`.

## Resultado

O pipeline distingue snapshot remoto bruto, migration histórica do Git e
forward nova em LF. O guard de Notificações que bloqueou a R1.4 passou, assim
como a migration inteira, sem edição histórica ou enfraquecimento de guard.

Os dois upgrades foram executados novamente em instâncias Docker novas:

| Caminho | Migrations aplicadas | Checks concluídos | Resultado |
| --- | ---: | ---: | --- |
| Production-like | 22 | 207 pgTAP + 111 notificações + 34 municipal/Storage | PASS nos checks executados |
| Homolog-like | 11 | 207 pgTAP + 111 notificações + 12 municipal/Storage | FAIL no próximo cenário municipal/Storage |

O erro foi `Missing expected rejection.` no cenário que testa falha de commit,
compensação física e bloqueio de upload tardio. O relatório da falha não contém
a stack da asserção exata: não se pode afirmar somente com essa mensagem se a
rejeição ausente foi no commit, no settle-cleanup ou no reupload.

**A investigação comprovou uma lacuna independente e relevante no restore:**
homolog tem `storage.objects.fiscal_guard_storage_insert`, habilitado, mas a
captura original não incluiu esse trigger. O catálogo anterior também não
compara triggers da aplicação instalados no schema Storage.

Classificação: `HARNESS_SERIALIZATION`, subtipo
`SCHEMA_CAPTURE_RESTORE_OMITS_APPLICATION_STORAGE_TRIGGER`. Não é evidência de
erro de regra de negócio em produção; também não é motivo para relaxar o teste.

Foi respeitada a parada por falha SQL. Não foi iniciada a certificação do
clean-room, nem aplicado um reparo ao restore após a descoberta. R1 ainda não
está pronto para rollout.

## Contratos de leitura implementados

Em `scripts/qa/reconciliation/r1-5-migration-source.mjs`:

- `readSnapshotRaw`: preserva bytes UTF-8 e CRLF/LF; usa o gate bruto da R1.4.
- `readHistoricalMigrationCanonical`: resolve o path no commit auditado,
  confere o OID e lê os bytes via `git cat-file blob`. Nenhuma conversão de
  newline é usada como fonte de execução.
- `readNewForwardMigrationExact`: aceita somente as duas forwards R1
  autorizadas, exige LF e executa os bytes exatos do arquivo.
- Exceção `APPROVED_DB_ONLY_EXACT`: limitada ao SACADO `20261005173648`, path
  exato e hash fixo, com autorização explícita do usuário nesta execução.
  Não recebe commit/OID fictício e não é apresentada como fonte Git.

A documentação oficial de [git-cat-file](https://git-scm.com/docs/git-cat-file)
foi consultada para a leitura direta do objeto, sem `--filters` ou `--textconv`.

Inventário resolvido: 267 fontes Git, duas forwards novas e um artefato DB-only.
Os commits auditados são main-base, homolog-base, recuperação P16 e os commits
das PRs 87/96 já utilizados na reconciliação. Nenhuma migration histórica foi
editada; as duas forwards já estavam em LF e não precisaram de formatação.

O manifest R1.5 registra o hash canônico, além dos hashes anteriores para
rastreabilidade. Cada aplicação confere novamente hash dos bytes materializados
em UTF-8, procedência e igualdade com o manifest. Divergência local do checkout
é diagnosticada, nunca executada no lugar do blob auditado.

As migrations/catálogos/fontes não dependem de normalização silenciosa.
Normalização em campos de diagnóstico não é usada como gate de execução.

## Prova do guard anterior

Em homolog-like, antes da aplicação de `20261006124134`:

- Correspondências do literal CRLF do checkout: zero.
- Correspondências do literal do blob Git: uma.
- Aplicação da migration inteira: PASS (`PASS_FULL_MIGRATION`).

As quatro migrations de Notificações foram executadas integralmente no
upgrade homolog-like. No production-like já estavam na baseline, conforme
manifest; não foram reaplicadas. Os 111 checks focados de notificações passaram
em ambos, incluindo escopo, legado, dedupe e ausência de broadcast indevido.

## Lacuna Storage e limites dos gates anteriores

A captura schema-only foi limitada a `public,private`, com metadados separados
para policies Storage e triggers de `auth.users`. Não capturou os triggers em
`storage.objects`. O predicado de `schema-catalog.sql` também não inclui esse
caso. Portanto, igualdade dos objetos catalogados não provava cobertura total.

Consulta remota exclusivamente de catálogo, `BEGIN READ ONLY`, confirmou:

- Produção: nenhum trigger de função public/private em Storage neste contexto.
- Homolog: `fiscal_guard_storage_insert`, habilitado `O`, chamando
  `private.fiscal_guard_storage_insert()` antes de INSERT ou UPDATE de
  `bucket_id`, `name`, `metadata` em `storage.objects`.

A migration histórica `20260929221000` cria esse vínculo. No caminho de
produção ela é aplicada e cria o trigger; em homolog ela já consta no histórico,
portanto não é reaplicada. Restaurar apenas a função privada não restaura o
vínculo do trigger ao Storage. Essa assimetria explica a ausência local dessa
proteção, mas a stack exata da asserção ainda precisa ser coletada na retomada.

Os gates brutos anteriores continuam demonstrando fidelidade das 385/439
funções e das duas constraints testadas (72 casos por ambiente), não fidelidade
de objetos que estavam fora do inventário. O gate amplo de restore de homolog
fica invalidado pela omissão; não há allowlist para ignorá-la.

Comparação offline adicional dos catálogos finais disponíveis encontrou **40
diferenças brutas**. Elas foram preservadas para diagnóstico; não foram
classificadas automaticamente como diferenças semânticas nem ignoradas como
whitespace. O catálogo de três caminhos não está certificado.

## Qualidade, preservação e segurança

- Oito testes Node do pipeline/restore passaram, cobrindo os seis cenários
  exigidos e a exceção DB-only restrita.
- TypeScript global: PASS nesta execução.
- Vitest global: 3.031 PASS, 12 pendentes, zero falhas, reexecutado em R1.5.
- ESLint global e dos helpers finais: PASS. `git diff --check`: PASS.
- Os 266 arquivos do checkpoint foram conferidos; apenas o harness
  `r1-full-upgrades.mjs` foi alterado entre os preexistentes desse checkpoint.
  As adições R1.5 são novos arquivos. Históricos e forwards anteriores intactos.
- Os 28 relatórios preexistentes capturados no checkpoint mantêm seus hashes,
  incluindo o FAIL de homolog R1.4. As tentativas R1.5 também foram preservadas.
- Uma tentativa preliminar R1.5 foi barrada sem criar Docker porque o compilador
  de proveniência ainda não havia concluído e o manifest anterior tinha fontes
  pendentes. Depois da conclusão do compilador, o gate foi reexecutado; nenhum
  hash foi ignorado e nenhuma migration foi aplicada nessa tentativa preliminar.
- Docker: somente recursos sintéticos próprios removidos; todos os containers,
  volumes e redes preexistentes preservados. Sem prune global.
- Sem commit/push no repositório de trabalho, PR, merge ou deploy. O teste de
  fonte Git usa um repositório sintético temporário, removido ao terminar.
- Sem DDL/DML remoto, alteração de history, env, scheduler, Graph ou aliases.
  As consultas remotas foram exclusivamente de catálogo, sem dados de negócio.

As skills Supabase/Postgres orientaram isolamento, privilégios e investigação
do catálogo. O aviso atual de atualização PostgreSQL 17.11 foi revisado; não
houve atualização de engine/extensão nem intervenção remota neste trabalho.

## Gates e próxima retomada

O status completo está em `rehearsal/reports/R1_5_STATUS.json`.

```text
R1_5_HISTORICAL_MIGRATION_CANONICAL_PIPELINE = PASS
R1_5_NEW_FORWARD_CANONICAL = PASS
R1_5_SNAPSHOT_RAW_PIPELINE = PASS
R1_5_EXECUTED_BYTES_MATCH_MANIFEST = PASS
R1_5_NOTIF_GUARD_CANONICAL_SOURCE = PASS
RECON_UPGRADE_FROM_PROD = PASS (checks executados)
RECON_UPGRADE_FROM_HOMOLOG = FAIL
RECON_SQL = FAIL
R1_5_MANIFEST_C = NOT_CERTIFIED
RECON_CLEAN_ROOM = NOT_RUN
R1_5_TARGET_CATALOG_EQUIVALENT = NOT_CERTIFIED
RECON_R1_READY_FOR_HOMOLOG_ROLLOUT = NO
RECON_PRODUCTION_CHANGED = NO
RECON_HOMOLOG_CHANGED = NO
RECON_PRODUCTION_DB_CHANGED = NO
RECON_HOMOLOG_DB_CHANGED = NO
```

Types do schema combinado, package/sharp/PDF, build Linux e CI não foram
certificados após a parada. Os checks focados aprovados não substituem full SQL
nem os três caminhos canônicos.

Próxima retomada necessária: ampliar captura e comparação para triggers da
aplicação em Storage, preservar seus DDLs/estado, registrar a asserção exata e
recertificar a baseline em ambientes novos. Só depois repetir upgrades,
classificar as diferenças de catálogo, executar Manifest C e os gates finais.
Não reaplicar a cadeia histórica em homolog real nem editar history para isso.

## Evidências

Em `rehearsal/reports/`:

- `R1_5_CHECKPOINT.json`
- `R1_5_MIGRATION_SOURCE_PIPELINE.json`
- `R1_5_MIGRATION_PROVENANCE.json`
- `R1_5_MANIFESTS.json`
- `R1_5_PROD_UPGRADE.json`
- `R1_5_HOMOLOG_UPGRADE.json`
- `R1_5_STORAGE_TRIGGER_DIAGNOSIS.json`
- `R1_5_CLEANROOM.json` (não executado)
- `R1_5_TARGET_CATALOG.json` (diagnóstico, não certificação)
- `R1_5_FULL_VITEST.json`
- `R1_5_STATUS.json`

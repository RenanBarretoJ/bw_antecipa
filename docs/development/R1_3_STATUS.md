# R1.3 — compatibilidade C5/A6 aprovada; R1 completo bloqueado

Data: 06/10/2026. Branch `reconcile/main-homolog-2026-10-06`.
HEAD preservado: `2e8146ebe7582c5bdc10ddee1f8862d806607ee2`.

## Resultado focado

A forward `20261006210815_c5_reader_a6_compat.sql` introduz o efeito líquido
C5 de leitura sem substituir os wrappers A6 R2 nem reaplicar a história C5.
SHA256 bruto: `8f8ed3284e670ee4b559cccffcd0b323818c659a4f76e26547e40d48392ec7ef`.

O roteiro Supabase orientou a separação entre ambientes, as verificações
de privilégios/search_path e a execução somente em recursos Docker próprios.

Três caminhos focados passaram: production-like sem C5, história
C5 → A6 original → A6 R2, e homolog-like materializado dessa história.
O último **não é uma cópia integral de homolog**. A A6 original foi executada
somente no clean-room histórico local; não foi aplicada nem marcada em produção.

Por caminho: 207 verificações pgTAP + 111 de produtores/UI de notificações.
Total: **954 verificações SQL**, além de catálogo, reaplicação e preservação
dos dados sintéticos. Os catálogos críticos dos três caminhos convergiram.

Cobertura: comissão ON/OFF por fundo; OWNER/OPERADOR/LEITOR; leitura de
operações/NFs/documentos/timeline; negações de escrita/submissão/aprovação;
cross-fund; grants e SECURITY DEFINER; SACADO multi-CNPJ/short-circuit;
notificações por fundo, dedupe e legado preservado/oculto.

O inventário histórico de 49 produtores foi reconciliado explicitamente:
38 unidades de aplicação históricas e 11 assinaturas SQL. Os cinco produtores
antigos de cron foram mapeados aos delegates da PR95, já em main. Não se trata
de 49 escritores diretos: a aplicação atual tem zero inserts diretos e os
testes SQL exigem somente os dois escritores canônicos autorizados.

Durante o desenvolvimento, a regressão C1 demonstrou que a policy C5 antiga
ocultava eventos de NF pré-operação do OWNER. A composição final preserva
esse acesso apenas para quem pode operar o cedente e no fundo exato; o LEITOR
continua sem acesso a esse ramo. Fixtures foram corrigidas para respeitar
os guards existentes, sem desativar triggers nem enfraquecer testes.

## Gates R1.3

```text
R1_3_EXISTING_WORK_PRESERVED = PASS
R1_3_C5_OBJECTS_DIAGNOSIS = PASS
R1_3_FORWARD_MIGRATION = 20261006210815_c5_reader_a6_compat.sql
R1_3_FORWARD_MIGRATION_HASH = 8f8ed3284e670ee4b559cccffcd0b323818c659a4f76e26547e40d48392ec7ef
R1_3_OLD_C5_AFTER_A6_NEGATIVE = PASS
R1_3_PRODLIKE_FORWARD = PASS
R1_3_HOMOLOGLIKE_FORWARD = PASS
R1_3_CLEANROOM_FORWARD = PASS
R1_3_COMISSAO_FUNDO_ISOLATION = PASS
R1_3_LEITOR_READ_ONLY = PASS
R1_3_OWNER_OPERATOR = PASS
R1_3_ACL = PASS
R1_3_SQL_SECURITY = PASS
R1_3_FORWARD_IDEMPOTENT = PASS
R1_3_NOTIFICATIONS_REGRESSION = PASS
R1_3_SACADO_REGRESSION = PASS
R1_3_TARGET_CATALOG_EQUIVALENT = PASS
R1_3_PROD_MANIFEST = PASS
R1_3_HOMOLOG_MANIFEST = PASS
R1_3_CLEANROOM_MANIFEST = PASS
R1_3_C5_A6_COMPAT_READY = YES
DOCKER_TEST_ENV_CLEANUP = PASS
```

Os três manifests acima são **focados C5/A6**, não os manifests A–E completos.
Controle negativo: `r1-2-upgrade-preflight.mjs --local-only` permanece com
exit 1 esperado, identificando dois wrappers antigos e dois grants regressivos.

## Retomada do R1 e regra de parada

Capturas remotas exclusivamente de schema/catálogos, sem dados de negócio:
produção com 243 registros de history; homolog com 261. A6 original ausente
em produção e presente historicamente em homolog, sem alteração de history.
Os artefatos DB-only P16 e SACADO short-circuit foram recuperados com hashes
conferidos; nenhuma migration histórica existente foi editada.

Foram montados A/B (baselines) e D/E (listas explícitas de upgrade), com
classificação individual de 277 versões. Produção tem 22 aplicações previstas,
homolog 11; C5 histórico/A6 original/P14 ficam excluídos do upgrade produtivo.
O manifest C completo permanece **não certificado**.

O primeiro ensaio integral parou em `RESTORE_SCHEMA_ONLY`, **antes de aplicar
qualquer migration do upgrade**. O catálogo local divergiu em 163 objetos:

- 161 funções: o harness novo normalizou CRLF para LF dentro dos corpos SQL.
  Consulta somente leitura confirmou que todos os 161 hashes normalizados
  remotos correspondem exatamente aos hashes locais, incluindo ACL/owner.
  A restauração deve preservar o conteúdo bruto para uma certificação exata.
- Duas constraints: `comunicacoes_remetente_nome_check` e
  `documento_upload_intents_storage_path_check`. Definições remotas coletadas;
  equivalência da representação restaurada ainda **não certificada**.

Isso não demonstra regressão da forward C5/A6. Demonstra que a baseline do
ensaio integral não passou no gate de fidelidade. Não foi criada allowlist,
nem reduzida a comparação, nem repetido o upgrade após esse STOP.
O upgrade completo de homolog e o clean-room completo não foram executados.

Próximo trabalho: corrigir a preservação de bytes no restaurador, diagnosticar
as duas constraints, certificar novamente a baseline e então retomar os dois
upgrades, clean-room, tipos combinados, SQL completo, runtime PDF/sharp,
build Linux e CI. Não requer modificar banco remoto para investigar o harness.

## Qualidade da aplicação e estado geral

| Gate | Resultado |
| --- | --- |
| C5/A6 TypeScript focado | PASS: 25 testes |
| Suite completa Vitest | PASS: 3.031 aprovados; 12 pendentes/ignorados; zero falhas |
| TypeScript global | PASS |
| ESLint completo | PASS |
| git diff --check | PASS |
| Upgrade completo produção | FAIL no gate de restauração; zero migrations aplicadas |
| Upgrade completo homolog | NOT_RUN após STOP |
| Manifests A–E completos | NOT_CERTIFIED (C pendente) |
| Clean-room completo / SQL completo | NOT_RUN |
| Types combinados / package-lock-sharp-PDF / build Linux | NOT_CERTIFIED |
| CI Standard / Linux | NOT_RUN; sem commit/push |
| Pronto para rollout homolog | **NO** |

Preservados por hash: 227 arquivos originais, 11 adicionais R1.1/R1.2 e
267 migrations históricas do checkpoint. Nenhum commit, push, deploy, env,
job, scheduler, Graph ou escrita em main/homolog/produção. O container
preexistente `supabase_db_nfse-submit-20261005` permaneceu intacto; somente
os recursos descartáveis deste trabalho foram removidos.

## Evidências e reprodução local

Relatórios em `rehearsal/reports/` (artefatos locais, não publicar snapshots):
`R1_3_FOCUSED_SQL.json`, `R1_3_NOTIFICATION_PRODUCERS.json`,
`R1_SCHEMA_ONLY_BASELINES.json`, `R1_UPGRADE_MANIFESTS.json`,
`R1_FULL_UPGRADES.json`, `R1_RESTORE_DRIFT_DIAGNOSIS.json`,
`R1_FULL_VITEST.json` e `R1_3_WORKTREE_BEFORE.json`.

```sh
node scripts/qa/reconciliation/r1-3-focused.mjs --local-only
node scripts/qa/reconciliation/r1-notification-producer-inventory.mjs --local-only
node scripts/qa/reconciliation/r1-upgrade-manifests.mjs --local-only
# r1-full-upgrades.mjs ainda bloqueado no gate de restauração descrito acima.
```

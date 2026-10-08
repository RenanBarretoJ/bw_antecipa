# R1.4 — restore recertificado; upgrade de homolog interrompido

Data: 07/10/2026. Branch `reconcile/main-homolog-2026-10-06`.
HEAD preservado: `2e8146ebe7582c5bdc10ddee1f8862d806607ee2`.

## Resultado e limite

O restore schema-only passou em duas instâncias Docker novas, antes de qualquer
migration de upgrade. O caminho production-like aplicou as 22 migrations
previstas e passou em 352 verificações SQL/Storage focadas. Isso não certifica
o conjunto completo de SQL, o clean-room canônico ou um rollout remoto.

O caminho homolog-like passou no restore, aplicou sete migrations e parou na
oitava, `20261006124134_notificacoes_entity_producers.sql`, com SQLSTATE `P0001`:

```text
NOTIFICACAO_PRODUTOR_DIVERGENTE: private.notificar_cedente_ativos/6
```

Foi respeitada a stop rule de falha SQL. Não houve continuação do upgrade,
edição histórica, desativação do guard ou tentativa de marcar o gate como PASS.

## Preservação e segurança

- Os 227 arquivos originais e as 267 migrations históricas mantêm seus hashes.
- Snapshot de produção: SHA256 `2f9f3a8eac3e49286ac17c386d700cbe6c31d3156ee6810dc1c5e6e06a9b3b36`.
- Snapshot de homolog: SHA256 `189846c1cecff0457770c1bf449fe11a65d80b3c78f38cbb91e90278bde41481`.
- Snapshots não foram editados. A recaptura complementar foi somente leitura
  de catálogo, sem dados de negócio; conferiu também o catálogo anterior.
- A6 original, C5 histórica e P14 não foram executadas no caminho production-like.
  P16 e o short-circuit SACADO foram verificados após o upgrade.
- Nenhum commit, push, PR, deploy, migration remota, alteração de ambiente,
  scheduler, Graph ou migration history foi efetuado.
- Somente recursos Docker sintéticos próprios foram removidos. Containers,
  volumes e redes preexistentes foram preservados; não houve prune global.

Alterações intencionais em helpers anteriores: `r1-full-upgrades.mjs` recebeu
o novo gate de restore e a correção do teste P16 para a assinatura enum real;
`r1-2-storage.mjs` teve apenas o namespace local permitido estendido para os
projetos Docker destes upgrades, mantendo a origem loopback obrigatória.
As demais adições anteriores permaneceram intactas. O checkpoint também
registra a evolução do novo capturador R1.4 durante esta execução.

As skills Supabase e Postgres orientaram o isolamento dos ensaios, a revisão de
privilégios e a separação entre prova de catálogo, testes locais e rollout.

## Causa original do drift e prova do restore

O leitor compartilhado do harness convertia CRLF em LF antes de executar o
snapshot. Isso alterava o texto dos corpos das funções. A leitura de snapshot
agora preserva os bytes UTF-8 e confere o hash bruto antes da execução; o hash
normalizado existe apenas como diagnóstico.

- Produção: 385 funções comparadas por definição e corpo brutos; 161 com CRLF.
- Homolog: 439 funções comparadas por definição e corpo brutos; 177 com CRLF.
- Zero divergências funcionais ou de catálogo não explicadas após o restore.
- As duas diferenças brutas remanescentes são exclusivamente a representação
  da associação de expressões AND nas duas constraints investigadas.

Para `comunicacoes_remetente_nome_check` e
`documento_upload_intents_storage_path_check`, foram conferidos tabela/schema,
metadados de coluna, tipos, collation, nullability, estado de validação e flags
de deferrability. A expressão remota foi reparsed localmente com as mesmas
colunas e seu `conbin` comparado ao objeto restaurado. Os limites e regex não
foram alterados.

Cada ambiente executou 72 casos comportamentais: 12 casos por constraint em
três variantes (DDL remoto, snapshot e objeto restaurado). Além disso, uma
mutação de limite por constraint teve de gerar árvore diferente. A classificação
exige chave e hashes exatos, igualdade estrutural e comportamental; não é uma
allowlist ampla nem exclusão dessas constraints do gate.

## Diagnóstico do novo bloqueio: transporte das migrations

A alteração do leitor compartilhado para leitura bruta também atingiu o envio
das migrations pelo harness, não apenas o snapshot. No Windows, a migration
histórica está com CRLF no checkout, enquanto o blob original no Git usa LF.
A migration normaliza `pg_get_functiondef` para LF, mas compara esse resultado
com um literal `$old$` que preserva os CRLF do arquivo executado.

O diagnóstico offline comprovou para o primeiro guard que falhou:

| Evidência | Resultado |
| --- | --- |
| Correspondências do literal CRLF com o corpo LF | 0 |
| Correspondências do literal do blob Git com o corpo LF | 1 |
| Literal do blob Git versus corpo capturado | SHA256 bruto idêntico |
| Checkout normalizado apenas no diagnóstico versus blob Git inteiro | Idênticos |
| CRLF no literal do checkout | 31 |
| CRLF no corpo remoto desta função | 0 |

Hashes da migration:

- Checkout bruto: `56fe8ab6d4b7817256f0f6438b40a8f876cd1faa4229f958f1ef174a5a630c82`.
- Blob Git e checkout LF diagnóstico: `c0fda0f0893b7a8cd51d48a713ffdfd832f46f951a3f2ac8c32bcd5974ddf8f0`.
- Corpo capturado e literal Git: `0d629bfff1001164c77b09df6a694d3f54213fc5a14aa76829df7a568fa13106`.

Portanto, esta falha específica é de serialização do harness, introduzida ao
ampliar a leitura bruta para migrations, e não comprova divergência de regra de
negócio em homolog. A prova não cobre os demais guards nem garante que o upgrade
restante passará. Não foi implementado um contorno após a parada.

Próxima retomada proposta: separar explicitamente os dois pipelines. Snapshot
remoto deve permanecer bruto; migrations devem usar a fonte canônica revisada,
com procedência e hash dos bytes efetivamente executados, sem editar arquivos
históricos e sem substituir o raw gate do snapshot por hashes normalizados.
Recomeçar homolog do zero, preservar a tentativa falha e só então avançar para
Manifest C, convergência de catálogos e os gates restantes.

## Testes e gates

Nesta execução: 4 testes Node do restaurador/isolamento PASS; TypeScript global
PASS; 3.031 testes Vitest PASS, 12 pendentes e zero falhas; ESLint global PASS.
Produção-like: 207 pgTAP + 111 de notificações + 34 municipal/Storage = 352.
Os 954 checks focados R1.3 continuam como evidência anterior, não como execução
integral nova R1.4.

O Manifest C foi montado como candidato com hashes verificados: 264 entradas
aplicáveis e 13 exclusões explícitas. Não foi executado nem certificado. A6
original só é prevista nesse caminho histórico clean-room, nunca no de produção.

`NOT_RUN` significa não executado devido à parada; não equivale a PASS nem a
uma falha de teste observada. `NOT_CERTIFIED` indica ausência de prova integral.

```text
R1_4_EXISTING_WORK_PRESERVED = PASS
R1_4_RESTORER_ROOT_CAUSE = SHARED_READER_CRLF_TO_LF_CHANGED_SNAPSHOT_FUNCTION_BODIES
R1_4_RAW_LINE_ENDING_PRESERVATION = PASS
R1_4_FUNCTION_BODY_FIDELITY = PASS
R1_4_CONSTRAINT_COMUNICACOES = PASS
R1_4_CONSTRAINT_STORAGE_PATH = PASS
R1_4_CONSTRAINT_NEGATIVE_TESTS = PASS
R1_4_RESTORE_PROD = PASS
R1_4_RESTORE_HOMOLOG = PASS
R1_4_MANIFEST_C = NOT_CERTIFIED
RECON_UPGRADE_FROM_PROD = PASS
RECON_UPGRADE_FROM_HOMOLOG = FAIL
R1_4_TARGET_CATALOG_EQUIVALENT = NOT_RUN
RECON_DATABASE_TYPES = NOT_CERTIFIED
RECON_PACKAGE_LOCK = NOT_CERTIFIED
RECON_SHARP = NOT_CERTIFIED
RECON_PDF_RUNTIME = NOT_CERTIFIED
RECON_SQL = NOT_CERTIFIED
RECON_TYPESCRIPT = PASS
RECON_FULL_SUITE = PASS
RECON_LINT = PASS
RECON_BUILD_LINUX = NOT_RUN
RECON_CLEAN_ROOM = NOT_RUN
RECON_CI_STANDARD = NOT_RUN
RECON_CI_LINUX = NOT_RUN
DOCKER_TEST_ENV_CLEANUP = PASS
RECON_PRODUCTION_CHANGED = NO
RECON_HOMOLOG_CHANGED = NO
RECON_PRODUCTION_DB_CHANGED = NO
RECON_HOMOLOG_DB_CHANGED = NO
RECON_R1_READY_FOR_HOMOLOG_ROLLOUT = NO
```

## Artefatos locais

Relativos a `rehearsal/reports/`, fora do conjunto de dados de negócio:

- `R1_4_CHECKPOINT.json` e `R1_4_POSTFLIGHT.json`: preservação, hashes e Docker.
- `R1_4_PROD_REMOTE_FIDELITY.json`, `R1_4_HOMOLOG_REMOTE_FIDELITY.json`:
  metadados e hashes capturados em consultas read-only.
- `R1_4_CONSTRAINT_PROBE.json`: diagnóstico estrutural das constraints.
- `R1_4_RESTORE.json`: duas restaurações novas, sem migrations de upgrade.
- `R1_FULL_UPGRADES.json`: produção-like PASS e homolog-like FAIL;
  `R1_FULL_UPGRADES_attempt_*.json` preservam tentativas anteriores.
- `R1_4_UPGRADE_STOP_DIAGNOSIS.json`: prova offline do primeiro guard.
- `R1_4_MANIFEST_C_CANDIDATE.json`: candidato não certificado.
- `R1_4_FULL_VITEST.json`: resultado global da suíte da aplicação.

As tentativas anteriores incluem dois erros do harness corrigidos antes do
ensaio final: teste P16 chamando a assinatura `text` em vez do enum real e
namespace dos novos projetos recusado pelo adaptador local Storage. Não foram
falhas de regra de negócio e seus relatórios não foram apagados.

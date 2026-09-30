# RLX-EMAIL-03 — implementação local; gates finais pendentes

Este registro foi sucedido pela recertificação em
[RLX_EMAIL_03_R2_STATUS.md](RLX_EMAIL_03_R2_STATUS.md). As falhas de ambiente e
contagens abaixo são históricas; consultar o R2 para os gates atuais.

Data: 29/09/2026. Branch `feature/rlx-email-intake-graph`, HEAD `8a476029`.
**Plano incompleto; nenhuma promoção. RLX_EMAIL_03_HOMOLOG_READY = NO.**

## Estado atual

- `src/lib/fiscal-intake/` contém o serviço compartilhado, os adapters dos
  parsers oficiais, a preparação, a reserva e a persistência. `uploadNFs` e o
  worker de anexos chamam esse serviço; `criarNFManual` encaminha para `uploadNFs`.
- A decisão de bloquear documentos sem chave está implementada nos dois canais,
  incluindo a entrada legada, com orientação para enviar XML/PDF com chave.
- HUMAN usa usuário real e MFA; SYSTEM/EMAIL_INTAKE não recebe Auth user fake.
  O banco revalida vínculo, fundo, estabelecimento, integração, allowlist e claim.
- Commit transacional de NF, parcelas, requisitos, documentos, eventos/auditoria,
  reserva e anexo; valores fiscais preparados somente no servidor. Journal de
  Storage, compensação durável, retry de cleanup e reconciliação de leases/reviews.
- Review por e-mail usa a entidade e o formulário oficiais. O servidor busca o
  anexo original e reextrai os fatos; ingest_actor e review_actor são distintos.
- Recuperação de XML incompleto passa pela reserva e preserva o ID da NF. Recusa
  histórico operacional/documental e alteração concorrente do rascunho. Arquivo
  anterior existente é preservado; o XML novo fica ligado ao journal/documento.
- A resolução do original contempla o journal e o repositório documental; a
  exclusão de rascunho fiscal agenda limpeza durável dos seus objetos.
- A migration `20260929225000` preserva no anexo o ID histórico da NF excluída
  e mantém seu resultado de importação. A FK ativa deixa de bloquear a exclusão
  autorizada do rascunho; o ensaio de banco verifica esse histórico. Ainda sem
  execução sobre o diff final.

Isso descreve implementação, **não certificação de ponta a ponta**. As migrations
novas vão de `20260929214436` a `20260929225000`; as originais de transporte e
Guibor A3/A4 foram preservadas. Não houve ativação remota ou novo scheduler.

## Gates atuais e impedimento de execução

Vitest em forks terminou após 2480,88 segundos com 8 erros de inicialização:
`Timeout starting forks runner` / `Timeout waiting for worker to respond`.
**Nenhum teste foi executado nessa tentativa.** O Windows também registrou falha
do servidor WMI (`0x80080005`). A causa da lentidão não foi determinada. A leitura
de memória indicou 12,57 GB disponíveis em 31,55 GB; não foi diagnosticada falta
de memória física.

O typecheck intermediário foi interrompido após novos ajustes. Uma nova tentativa
dos testes afetados usou `--pool=threads --maxWorkers=1 --no-file-parallelism`, mas
foi interrompida sem conclusão. O clean-room de 238 migrations também foi
interrompido: só o início do projeto descartável `bw_email03_1790727809373` foi
observado. Foi solicitado `supabase stop --no-backup` exclusivamente para esse
projeto; a CLI confirmou `Stopped supabase local development setup.` e terminou
com exit code 0. Os dois ensaios precisam
ser repetidos sobre o diff final. A evidência de PASS anterior não vale para eles.

Uma tentativa adicional de `tsc --noEmit`, com Node 22 após a limpeza, também
ficou sem resultado e foi interrompida. Não há PASS de TypeScript para o diff
atual. A nova migration de histórico eleva o próximo clean-room a 239 migrations;
o ensaio interrompido continua registrado corretamente com 238.

`git diff --check` e `git diff --cached --check` passaram após os ajustes, com
avisos normais de LF/CRLF. Faltam os gates finais de TypeScript, suíte completa, lint, build,
clean-room, Storage HTTP real, revisão autenticada, Preview e homologação.
O trigger de fencing em `storage.objects` exige prova com a API real, inclusive
upload tardio; fixtures de metadados SQL não comprovam ausência de órfãos físicos.

## Registro histórico do primeiro estágio — anterior à implementação acima

- Integração controlada dos 51 arquivos do Guibor A3/A4 homologado no PR #72,
  sem A5/A6. Ver diagnóstico de commits, arquivos, migrations e conflito em
  [RLX_EMAIL_03_GUIBOR_BASELINE_DIAGNOSIS.md](RLX_EMAIL_03_GUIBOR_BASELINE_DIAGNOSIS.md).
- Migration local nova `20260929214436_fiscal_intake_identity_fencing.sql`:
  identidade única por tipo/chave canônica, reserva, geração/token, lease,
  contexto HUMAN/SYSTEM, validação de MFA humano e claim técnico, integração,
  fundo, vínculo, estabelecimento e allowlist. Journal de intenção de Storage
  anterior ao upload. Objetos internos privados, sem grants diretos, inclusive
  para service_role. As RPCs revalidam autorização e posse no banco.
- Validação real de concorrência na reserva: transações independentes, com
  espera observada em `pg_stat_activity`; cenários manual vencedor, e-mail
  vencedor e manual + duas integrações. O teste não insere NF nem faz upload.
- Rejeição de geração antiga após takeover; geração com intenção de Storage
  permanece CLEANUP_PENDING e não libera a identidade para outro canal.

Naquele estágio, a reserva ainda não estava ligada ao upload manual nem ao
worker. Aqueles testes provaram apenas a primitiva de reserva. O serviço,
persistência, worker, cleanup e review descritos no estado atual foram
implementados depois; continuam sem certificação do diff final.

## Decisão de negócio confirmada

O plano exige simultaneamente reserva pela chave fiscal (itens 13–19) e
preservação do upload manual (itens 32–33). O código atual
`src/lib/pdf-nf-parser.ts:521` (`validarDanfeParaPersistencia`) aceita alguns
PDFs textuais sem chave quando os demais campos críticos têm confiança
suficiente. `processarArquivo` em `src/lib/actions/nota-fiscal.ts` pode então
persistir `chave_acesso: null`.

Bloquear esse caso muda o comportamento manual. Inventar uma chave por nome,
arquivo, canal ou estratégia viola a identidade do plano. Foi solicitado ao
usuário definir se documentos sem chave devem ser bloqueados com orientação
para enviar XML/PDF com chave, ou se será definida outra identidade de negócio.
O usuário confirmou: **bloquear sem chave fiscal**. A regra já está implementada
nos dois canais. Os resultados históricos abaixo não certificam o diff atual.

## Validações anteriores — não certificam o diff atual

Node 22.23.2, no worktree isolado:

| Verificação | Resultado |
| --- | --- |
| `npx vitest run src/lib/nfse src/lib/storage-authorization-escopo9c.test.ts` | 118 testes PASS |
| `npx vitest run --reporter=dot` | 291 arquivos PASS, 3 skipped; 2518 testes PASS, 12 skipped |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS; warning preexistente de `notificarGestores` em `liquidacao.ts` |
| `npx next build --webpack` | PASS |
| `node scripts/email-intake/clean-room.mjs` | 232 migrations PASS; review oficial A3/A4 + 9 grupos de checks de reserva/concorrência PASS |
| Limpeza do Supabase descartável | PASS; projeto/volumes próprios removidos |
| `git diff --check` e `git diff --cached --check` | PASS |

O clean-room usa bootstrap real do Supabase, cadeia completa e fixtures QA
oficiais; não usa schema stub. Credenciais remotas e envs locais são excluídos
do subprocesso. Conexão SQL limitada a `127.0.0.1:57842` no projeto descartável.
Evidência detalhada e hashes: `rehearsal/reports/RLX_EMAIL_03_CLEAN_ROOM.json`.
Durante o desenvolvimento, duas execuções de harness precisaram de correção:
pré-condição da fixture oficial e tamanho de uma chave sintética (46 → 44).
A execução final integral passou; os guards de domínio não foram relaxados.

As evidências locais não substituem CI remoto, smokes autenticados nem provas
de Storage. Não houve commit, push, PR, migration remota, Preview ou homolog.

## Status exigidos pelo plano

`FAIL` abaixo significa gate ainda não cumprido por completo, incluindo não
implementado/não executado. PASS da primitiva isolada não promove gate de ponta a ponta.

```text
RLX_EMAIL_03_GUIBOR_BASELINE_ISOLATED = PASS
RLX_EMAIL_03_A5_A6_EXCLUDED = PASS
RLX_EMAIL_03_SHARED_FISCAL_SERVICE = FAIL
RLX_EMAIL_03_MANUAL_USES_SHARED_SERVICE = FAIL
RLX_EMAIL_03_EMAIL_USES_SHARED_SERVICE = FAIL
RLX_EMAIL_03_NO_PARALLEL_PARSER = PASS
RLX_EMAIL_03_TECHNICAL_ACTOR = FAIL
RLX_EMAIL_03_NO_FAKE_USER = PASS
RLX_EMAIL_03_SERVICE_ROLE_NOT_AUTHZ = FAIL
RLX_EMAIL_03_DOMAIN_GUARDS = FAIL
RLX_EMAIL_03_FISCAL_IDENTITY_RESERVATION = FAIL
RLX_EMAIL_03_CROSS_CHANNEL_FENCING = FAIL
RLX_EMAIL_03_FENCING_TOKEN = FAIL
RLX_EMAIL_03_LEASE_RECOVERY = FAIL
RLX_EMAIL_03_DUPLICATE_BEFORE_STORAGE = FAIL
RLX_EMAIL_03_STORAGE_COMPENSATION = FAIL
RLX_EMAIL_03_CLEANUP_PENDING = FAIL
RLX_EMAIL_03_CLEANUP_WORKER = FAIL
RLX_EMAIL_03_REVIEW_SHARED = FAIL
RLX_EMAIL_03_REVIEW_SYSTEM_TO_HUMAN_AUDIT = FAIL
RLX_EMAIL_03_REVIEW_DUPLICATION = FAIL
RLX_EMAIL_03_ROUTING_ALL = FAIL
RLX_EMAIL_03_ROUTING_ALLOWLIST = FAIL
RLX_EMAIL_03_UNKNOWN_CEDENTE = FAIL
RLX_EMAIL_03_MULTI_CEDENTE_MESSAGE = FAIL
RLX_EMAIL_03_SOURCE_CHANNEL = FAIL
RLX_EMAIL_03_EVENT_ACTOR = FAIL
RLX_EMAIL_03_AUDIT = FAIL
RLX_EMAIL_03_MANUAL_UPLOAD_REGRESSION = FAIL
RLX_EMAIL_03_NFSE_REGRESSION = FAIL
RLX_EMAIL_03_XML_REGRESSION = FAIL
RLX_EMAIL_03_P14_P16_REGRESSION = FAIL
RLX_EMAIL_03_CLEAN_ROOM = FAIL
RLX_EMAIL_03_FEATURE_TESTS = FAIL
RLX_EMAIL_03_CI = FAIL
RLX_EMAIL_03_PREVIEW = FAIL
RLX_EMAIL_03_PREVIEW_PDF = FAIL
RLX_EMAIL_03_PREVIEW_XML = FAIL
RLX_EMAIL_03_PREVIEW_REVIEW = FAIL
RLX_EMAIL_03_PREVIEW_CROSS_CHANNEL = FAIL
RLX_EMAIL_03_PREVIEW_STORAGE = FAIL
RLX_EMAIL_03_HOMOLOG_MIGRATIONS = FAIL
RLX_EMAIL_03_HOMOLOG_PIPELINE = FAIL
RLX_EMAIL_03_HOMOLOG_REVIEW = FAIL
RLX_EMAIL_03_HOMOLOG_CROSS_CHANNEL = FAIL
RLX_EMAIL_03_HOMOLOG_ROUTING = FAIL
RLX_EMAIL_03_HOMOLOG_STORAGE = FAIL
RLX_EMAIL_03_HOMOLOG_CLEANUP = FAIL
RLX_EMAIL_03_HOMOLOG_READY = NO
RLX_EMAIL_PRODUCTION_CHANGED = NO
GUIBOR_A5_A6_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
```

## Continuação autorizada

Concluir a validação do diff atual após estabilizar a execução local: testes de
concorrência, review, cleanup, recuperação de XML e rollback; gates de qualidade
e provas reais de Storage; somente então commit/push/PR e Preview.
Homolog depende dos smokes completos do Preview. Produção continua proibida.

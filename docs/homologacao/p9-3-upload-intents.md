# P9.3 — Upload intents documentais em homologação

O `documento_upload_intents` representa apenas o transporte do documento cadastral. A versão canônica continua em `documentos`. O browser recebe o UUID do intent e um token de upload do Storage, nunca service role; nenhum token ou URL assinada é persistido.

## Ciclo de vida

`PREPARED` é gravado antes de emitir a URL assinada. Após o PUT, `FINALIZE` verifica ownership, Storage, tamanho, MIME e estado documental; a RPC `finalizar_documento_upload_intent(uuid)` bloqueia a linha, chama o registro canônico e grava `FINALIZED` e a auditoria na mesma transação. Retry da mesma RPC retorna a versão existente sem novo registro. A action pode marcar `FAILED` quando o arquivo diverge, o estado documental muda ou a RPC falha. A falha não apaga o objeto imediatamente. Se a aba fechar antes da finalização, o intent permanece em `PREPARED` com objeto detectável pelo reconciliador.

O `cleanup_after` é fixado em aproximadamente três horas depois do PREPARE, sempre posterior às duas horas de validade da URL assinada e à janela mínima de 125 minutos. Isso inclui margem para atraso entre o INSERT e a assinatura. Nenhum timer do navegador executa a limpeza.

## Limpeza controlada

Somente em homologação. O reconciliador é read-only por padrão:

```bash
node scripts/homologacao/p9-3-upload-intents-reconciler.mjs
node scripts/homologacao/p9-3-upload-intents-reconciler.mjs --intent-id <UUID>
```

Para um intent **explicitamente identificado e classificado `ELIGIBLE`**, após revisão do preview:

```bash
node scripts/homologacao/p9-3-upload-intents-reconciler.mjs --intent-id <UUID> --execute --confirm LIMPAR_INTENT_HOMOLOG_fhgkmggthxikfpogrvaa
```

O job valida projeto, UUID, bucket/path, grace period, referência documental e limite de tentativas; reivindica `CLEANUP_PENDING`, verifica novamente, remove um único objeto via Storage API, confirma ausência e marca `CLEANED` com auditoria. Um trigger impede registro de documento depois da reivindicação. Se Storage ou banco ficarem inconclusivos, não há exclusão adicional; o intent fica pendente com backoff e tentativa limitada. O reconciliador antigo P9.2 continua como inventário read-only de objetos legados sem intent; a exclusão por path foi desabilitada.

Não há scheduler novo em produção neste escopo. A execução manual é necessária após a janela de proteção. Intents anteriores ao P9.3 não foram retroativamente inventados para objetos históricos.

## Verificação

As migrations são `20260916205302_p9_3_documento_upload_intents.sql` e `20260916210153_p9_3_intents_documento_fk_cascade.sql`, aplicadas somente em homologação. A segunda preserva o reset operacional ao remover o registro de transporte junto com sua versão documental; não altera o versionamento.

Para rehearsal, usar `P9_3_LOCAL_DATABASE_URL` apontando estritamente a Postgres local:

```bash
node scripts/homologacao/p9-3-migration-rehearsal.mjs
node scripts/homologacao/p9-3-homolog-migration-preflight.mjs
```

O primeiro script executa dois ciclos locais transacionais com rollback sobre um schema mínimo de dependências, não um clone integral; o segundo valida o schema real de homologação sem commit. `scripts/homologacao/p9-1-upload-e2e.mjs` cobre o browser com PDFs sintéticos. `scripts/homologacao/p9-3-cleanup-fixture.mjs` cria um único intent sintético já vencido, **sem gerar URL assinada**, para testar a limpeza sem encurtar artificialmente a validade de um token real.

O timeout intermitente de transporte observado no P9.2 não tem causa raiz confirmada. A persistência torna o estado rastreável e recuperável, mas não corrige a rede por si só. Não liberar deploy/commit sem a avaliação do hold point.

No benchmark de 16/09/2026, a matriz 100 KiB, 1 MiB, 4 MiB, 5 MiB, 10 MiB e 19 MiB foi concluída. Um PUT de 4 MiB respondeu HTTP 200 após aproximadamente 126 s, depois do timeout local de 120 s; o sistema reconciliou o objeto e concluiu o intent como `FINALIZED`, com versão documental existente. O atraso de transporte continua sem causa raiz comprovada. A falha real de FINALIZE foi induzida somente em fixture QA: o objeto ficou no Storage, o intent passou a `FAILED` e nenhuma versão foi criada. O cleanup foi executado em outro intent QA `FAILED` artificialmente antigo e sem URL assinada: passou de objeto presente/sem referência para `CLEANED`, objeto ausente e auditoria presente. O intent de aba fechada permaneceu em grace period; não foi removido antecipadamente.

### Hold point pendente

O ensaio de limpeza com fixture vencida comprova a lógica do reconciliador, mas **não substitui** a observação de um upload real com URL assinada após as três horas de proteção. Os intents reais de aba fechada e de FINALIZE falho continuam protegidos, sem exclusão prematura. Por isso, os gates estritos `P9_3_TAB_CLOSE_DURABILITY` e `P9_3_FAILED_FINALIZE_CLEANUP` ainda não podem ser declarados PASS de ponta a ponta. Antes de liberar commit, push ou deploy, reavaliar esses IDs após `cleanup_after`, executar o reconciliador somente para cada UUID explícito e confirmar objeto ausente, versão documental ausente, status `CLEANED` e auditoria. Não encurtar `cleanup_after` de um intent que tenha URL assinada ainda válida.

Consulta de encerramento em 16/09/2026: 39 intents `FINALIZED` com documento e objeto; 11 `PREPARED` (3 objetos presentes), 1 `FAILED` com objeto ainda em grace period e 1 `CLEANED` sem objeto/documento. As novas pendências são fixtures QA e não devem ser removidas antes do prazo. A auditoria inicial do P9.2 havia encontrado 1 objeto pendente em grace period; contagens antes/depois não são diretamente comparáveis porque a matriz E2E criou novos documentos e intents sintéticos.

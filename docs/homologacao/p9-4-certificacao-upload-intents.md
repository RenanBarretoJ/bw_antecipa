# P9.4 — certificação da janela real dos upload intents

Estado em 17/09/2026: **janela real encerrada e cleanup original certificado** no projeto de homologação `fhgkmggthxikfpogrvaa`. Produção não foi alterada. Não houve commit, push ou deploy neste escopo.

## Evidência antes da janela

Em 16/09/2026 às 21:28 UTC, o inventário read-only encontrou quatro objetos QA sem documento canônico: três intents `PREPARED` de aba fechada (`8e137e40-5f99-4fa7-9ddd-1423d703bcf6`, `26236cc5-d1df-4702-99eb-017852e4a48b`, `5ce03df8-63d8-4833-b399-4406f602396c`) e um `FAILED` após FINALIZE real (`2b0233f6-d5b4-4b8e-9eb7-5843eec40c11`). Os quatro objetos pertencem aos usuários dos intents, não têm versão documental nem referência por path. Todos estavam antes de `cleanup_after`; o reconciliador retornou `PENDING_GRACE_PERIOD` e nenhum foi removido. Havia 18 documentos históricos nos cedentes dessas fixtures antes de qualquer cleanup.

O intent tardio `0b6022c1-33bd-44d3-a6fa-f28e233fd862` está `FINALIZED`, com versão e objeto presentes; o reconciliador o classificou `REFERENCED`, inelegível para exclusão.

A reexecução E2E gerou mais um `FAILED` (`a2f18ceb-d258-4af9-8874-70582fbc9fd3`) e outro caso de aba fechada (`75f425c4-b621-4f85-b772-14eabe63b02b`). O prazo mais tardio desses casos é **17/09/2026 00:36:59 UTC (16/09/2026 21:36:59 BRT)**. Não encurtar timestamps nem limpar antes dele. Intents preparados sem objeto não contam como órfãos deletáveis (`NO_OBJECT`).

## Ensaios já concluídos

- E2E completo em homologação: matriz 100 KiB, 1 MiB, 4 MiB, 5 MiB, 10 MiB e 19 MiB; >20 MiB bloqueado antes do Storage; V1→V2 sintético de ~5,1 MiB, V1 preservada e gestor visualizando/aprovando; retry idempotente; RLS e isolamento entre cedentes; resposta de FINALIZE perdida e reconciliada; FINALIZE definitivamente falho sem versão; aba fechada sem versão fantasma. A primeira execução parou por espera frágil de um estado visual transitório após upload rápido; o teste foi tornado determinístico e a segunda execução terminou com exit code 0.
- O maior PUT da segunda execução, 19 MiB, levou aproximadamente 4,4 s; um PUT anterior de 4 MiB levou ~126 s e foi recuperado. A causa raiz da latência intermitente continua `NOT_PROVEN`.
- `npx tsc --noEmit`, 2.113 testes, `npx next build --webpack`, `git diff --check` e scan de segredos passaram. `npm run lint` terminou com zero erros e 43 avisos preexistentes em arquivos de rehearsal/legado.
- O reconciliador passou a exigir `storage.objects.owner_id = usuario_id` antes do claim e do delete. O preview read-only varre intents pendentes em vez de ser truncado por muitos `FINALIZED`. Seis testes de decisão de limpeza passaram, incluindo owner divergente, path indevido, janela e ausência de objeto.

## Fechamento após `cleanup_after` — 17/09/2026

Antes de cada exclusão, a consulta SQL e o reconciliador em modo read-only confirmaram `now() >= cleanup_after`, `ELIGIBLE`, status não `FINALIZED`, `documento_versao_id` nulo, ausência de referência em `documentos`, `documento_versoes` e `documentos_gerados`, path exato e owner do objeto igual ao usuário do intent. O reconciliador passou a verificar as três tabelas documentais também no claim e na conclusão. Cada execução usou `--intent-id` e confirmação explícita de homologação; nenhuma exclusão por prefixo foi feita. A revalidação dentro do script protegeu a transição `CLEANUP_PENDING` e a remoção de um único path.

| Cenário | Intent | `cleanup_after` UTC | `cleaned_at` UTC | Resultado |
| --- | --- | --- | --- | --- |
| Aba fechada 1 | `8e137e40-5f99-4fa7-9ddd-1423d703bcf6` | 17/09 00:05:38 | 17/09 12:36:49 | `CLEANED` |
| Aba fechada 2 | `26236cc5-d1df-4702-99eb-017852e4a48b` | 17/09 00:12:51 | 17/09 12:37:15 | `CLEANED` |
| Aba fechada 3 | `5ce03df8-63d8-4833-b399-4406f602396c` | 17/09 00:15:41 | 17/09 12:37:27 | `CLEANED` |
| Aba fechada 4 | `75f425c4-b621-4f85-b772-14eabe63b02b` | 17/09 00:36:59 | 17/09 12:38:04 | `CLEANED` |
| FINALIZE falho 1 | `2b0233f6-d5b4-4b8e-9eb7-5843eec40c11` | 17/09 00:15:21 | 17/09 12:37:41 | `CLEANED` |
| FINALIZE falho 2 | `a2f18ceb-d258-4af9-8874-70582fbc9fd3` | 17/09 00:36:35 | 17/09 12:37:52 | `CLEANED` |

Verificação agregada após cleanup: **6/6** intents `CLEANED`, `cleaned_at` preenchido, `documento_versao_id` nulo, `attempt_count=1`, objeto Storage ausente, nenhuma referência nas três tabelas documentais e exatamente uma auditoria `DOCUMENTO_UPLOAD_INTENT_CLEANED` por intent. Repetir a execução para um UUID já `CLEANED` retorna `ALREADY_CLEANED` com sucesso, sem exclusão adicional nem nova auditoria. Os documentos históricos dos quatro cedentes das seis fixtures permaneceram idênticos antes/depois: contagens **11, 6, 6, 6** e mesmos hashes MD5 dos IDs, status e versões, respectivamente `44735123c78a68dfc605f5b5f8c7923d`, `267ebdbbe91211193389bc6e4d3744b5`, `8aaeee32290f0187ba650a75697a4377` e `0b39243d94008917cb0fefc5652f53ba`. Os 18 documentos das quatro fixtures originais estão incluídos nesse conjunto maior de 29.

O FINALIZE tardio `0b6022c1-33bd-44d3-a6fa-f28e233fd862` permaneceu `FINALIZED`, com objeto presente e `documento_versao_id` apontando para `public.documentos.id`; `public.documentos.url_arquivo` corresponde exatamente ao path do intent. O reconciliador read-only o classificou `REFERENCED`, nunca `ELIGIBLE`.

**Escopo separado, não incluído nos seis UUIDs originais:** dois intents QA de execução anterior (`09778422-f410-421d-8477-a83536c38f25` e `06a65b2a-17e9-4d61-a7d2-233767e0f007`) estão `FAILED`, com objetos presentes, janela vencida e classificação read-only `ELIGIBLE`. Não foram removidos neste fechamento; demandam reconciliação controlada separada. Portanto, zero elegíveis vale **somente para as fixtures P9 originais**, não para todos os intents de homologação. Nenhum `UNKNOWN` apareceu entre as fixtures originais.

## Gates de certificação

Os testes E2E e de segurança da seção anterior não foram recriados; o cleanup não alterou o fluxo de upload. A causa da latência intermitente não foi comprovada. O bucket `documentos-cedentes` segue privado; RLS está ativo em `documento_upload_intents`, com política cadastrada e sem coluna de token/segredo. O E2E anterior cobriu Cedente A/B, anon, URL assinada, limites de arquivo, V1→V2, retry, preview e aprovação pelo Gestor.

- `P9_4_1_GRACE_PERIOD_EXPIRED = PASS`
- `P9_4_POST_GRACE_CLASSIFICATION = PASS`
- `P9_4_1_PRE_DELETE_GUARDS = PASS`
- `P9_4_CONTROLLED_CLEANUP = PASS`
- `P9_4_LATE_FINALIZE_SURVIVES_CLEANUP = PASS`
- `P9_3_TAB_CLOSE_DURABILITY = PASS`
- `P9_3_FAILED_FINALIZE_CLEANUP = PASS`
- `P9_4_ZERO_ELIGIBLE_ORPHANS = PASS` (apenas fixtures P9 originais)
- `P9_3_HOMOLOG_E2E = PASS`
- `TRANSPORT_LATENCY_ROOT_CAUSE = NOT_PROVEN`
- `TRANSPORT_RESILIENCE = PASS`
- `P9_4_DUCARDIO_EQUIVALENT = PASS`
- `P9_4_SECURITY = PASS`
- `P9_4_QUALITY = PASS`

Validações nesta retomada: `npx tsc --noEmit` passou; `npm test -- --run` passou (2.114 testes, 3 ignorados); teste direcionado de decisão do reconciliador passou (7); `npm run lint` passou com zero erros e 43 avisos preexistentes em `rehearsal/tmp` e legado; `npx eslint` dos dois arquivos do reconciliador passou; `npx next build --webpack` passou; `git diff --check` passou; scan local dos arquivos P9 relevantes não encontrou padrões de segredo ou credencial em claro. O teste E2E autenticado P9.4 anterior permanece a evidência de upload, isolamento A/B, anon e experiência do Gestor; não foi recriado neste fechamento porque a única mudança funcional aqui foi o reforço de guards e o skip idempotente no reconciliador.

- `P9_4_REAL_CLEANUP_CERTIFICATION = PASS`
- `P9_3_PERSISTENT_UPLOAD_INTENTS = PASS`
- `P9_DOCUMENT_UPLOAD_HOMOLOG = READY` (escopo original P9; dois QA extras pendem de reconciliação separada)
- `P9_READY_FOR_RELEASE_CERTIFICATION = YES` (não equivale a autorização de deploy)

## Retomada P9.4.2

Os dois intents sintéticos extras identificados acima foram reconciliados em escopo separado em 17/09/2026. O fechamento e a varredura global estão documentados em [P9.4.2 — reconciliação de intents extras](p9-4-2-reconciliacao-intents-extras.md). A ressalva de dois elegíveis nesta seção descreve o estado anterior ao P9.4.2.

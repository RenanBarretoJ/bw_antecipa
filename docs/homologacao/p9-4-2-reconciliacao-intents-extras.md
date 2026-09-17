# P9.4.2 — reconciliação separada de dois intents QA extras

Projeto: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção fora de escopo. Os seis intents originais permanecem certificados no relatório [P9.4](p9-4-certificacao-upload-intents.md). Não há commit, push ou deploy neste ticket.

## Inventário anterior à limpeza

Consulta read-only às 17/09/2026 12:52:25 UTC. Ambos pertencem ao cedente sintético `6d184bc1-d964-4f90-b6d6-c3329361956a`, têm `documento_versao_id = null`, objeto no bucket privado `documentos-cedentes`, `owner_id` igual ao `usuario_id` do intent, prefixo do path igual ao CNPJ cadastrado do cedente e UUID do intent presente no nome. Os dois paths têm marcador `qa-p91`, sem referência em `documentos.url_arquivo`, `documento_versoes.path` ou `documentos_gerados.storage_path`.

| Cenário | Intent | Status | Criado UTC | Expira UTC | `cleanup_after` UTC | Path sanitizado | Último erro |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FINALIZE falho de ensaio | `09778422-f410-421d-8477-a83536c38f25` | `FAILED` | 16/09 21:32:01 | 16/09 21:47:01 | 17/09 00:32:01 | `[CEDENTE_QA]/representante_comprovante_residencia/<intent>_qa-p91-finalize-fail.pdf` | `23514` |
| Navegação/aba interrompida após falha de FINALIZE | `06a65b2a-17e9-4d61-a7d2-233767e0f007` | `FAILED` | 16/09 21:32:10 | 16/09 21:47:10 | 17/09 00:32:10 | `[CEDENTE_QA]/representante_comprovante_residencia/<intent>_qa-p91-navigation.pdf` | `23514` |

`now() >= cleanup_after` foi verdadeiro nos dois casos. O reconciliador read-only com UUID explícito classificou ambos `ELIGIBLE`, sem `UNKNOWN`. A varredura read-only global encontrou 13 intents pendentes: dois `ELIGIBLE` acima e 11 `NO_OBJECT`; nenhuma outra exclusão foi autorizada.

Baseline documental antes do cleanup: os quatro cedentes das seis fixtures originais ainda têm **11 + 6 + 6 + 6 = 29** documentos. O cedente dos dois extras tem outros **11** documentos, incluindo versões V1/V2/V3; esses documentos não são alvos da limpeza. Os hashes de IDs, status, versões e paths foram capturados para comparação posterior.

## Cleanup individual e verificações posteriores

Antes de cada execução, uma nova consulta por UUID confirmou status `FAILED`, prazo expirado, bucket e path corretos, marcador QA, objeto e owner correspondentes e zero referências nas três tabelas documentais. O script aplicou o claim e sua revalidação interna e removeu apenas o path exato de cada intent, com confirmação explícita do projeto de homologação:

| Intent | `cleaned_at` UTC | Resultado |
| --- | --- | --- |
| `09778422-f410-421d-8477-a83536c38f25` | 17/09/2026 12:53:36 | `CLEANED`; objeto ausente; versão nula; auditoria única |
| `06a65b2a-17e9-4d61-a7d2-233767e0f007` | 17/09/2026 12:54:02 | `CLEANED`; objeto ausente; versão nula; auditoria única |

Ambos mantiveram `attempt_count = 1`, sem documento canônico ou referência de path. A repetição dos dois comandos com os mesmos UUIDs retornou `ALREADY_CLEANED` sem remoção ou auditoria duplicada; a consulta posterior confirmou exatamente um evento `DOCUMENTO_UPLOAD_INTENT_CLEANED` por UUID. O payload de cada auditoria contém somente `{"objeto_removido": true}`, sem token, senha ou path.

A varredura global read-only do reconciliador após o cleanup encontrou **11 `NO_OBJECT`, zero `ELIGIBLE` e zero `UNKNOWN`** entre todos os pendentes; eram exatamente 11 intents `PREPARED` sem objeto. O inventário completo do banco ficou em **61 `FINALIZED`**, todos com documento e objeto presentes, **9 `CLEANED`**, todos sem objeto ou versão vinculada, e **11 `PREPARED`** sem objeto. Os intents `NO_OBJECT` não são órfãos elegíveis para exclusão e não foram alterados neste ticket.

Os 29 documentos dos quatro cedentes originais conservaram as mesmas contagens e assinaturas MD5 de IDs/status/versões do P9.4. Os 11 documentos do cedente QA extra conservaram a mesma assinatura de IDs/status/versões/paths antes e depois (`0d140406fe6596d30a5ea87fbf364b39`). Em cada grupo permanecem versões V1, V2 e V3; nenhum objeto referenciado foi alvo dos dois deletes exatos.

## Gates

- `P9_4_2_EXTRA_INTENTS_IDENTIFIED = PASS`
- `P9_4_2_EXTRA_INTENTS_CLASSIFICATION = PASS`
- `P9_4_2_PRE_DELETE_GUARDS = PASS`
- `P9_4_2_CONTROLLED_CLEANUP = PASS`
- `P9_HOMOLOG_ZERO_ELIGIBLE_ORPHANS = PASS`
- `P9_4_2_HISTORICAL_DOCUMENTS_INTACT = PASS`
- `P9_4_2_AUDIT = PASS`
- `P9_4_2_QUALITY = PASS`
- `TRANSPORT_LATENCY_ROOT_CAUSE = NOT_PROVEN`
- `TRANSPORT_RESILIENCE = PASS` (evidência E2E durável anterior; transporte não foi alterado)

Validações desta retomada: `npx vitest run` nos três testes P9 pertinentes passou (18/18); `npm test -- --run` passou (2.114 testes, 3 ignorados); `npx tsc --noEmit` passou; `npm run lint` terminou sem erros e com 43 avisos preexistentes em rehearsal/legado; `npx next build --webpack` passou; `git diff --check` passou. A varredura local dos arquivos P9 por padrões de segredo, JWT e credenciais em claro não encontrou ocorrências. A matriz de tamanhos não foi recriada porque nenhum código de transporte foi alterado.

Resultado:

- `P9_4_2_EXTRA_INTENTS_RECONCILED = PASS`
- `P9_DOCUMENT_UPLOAD_HOMOLOG = READY`
- `P9_READY_FOR_RELEASE_CERTIFICATION = YES` (não equivale a autorização de deploy)

Produção permaneceu intacta; nenhuma migration, regra de versionamento ou código de transporte foi alterado. Os dois arquivos removidos eram sintéticos e podem ser recriados por novo upload QA, mas o reconciliador não oferece restauração direta do Storage.

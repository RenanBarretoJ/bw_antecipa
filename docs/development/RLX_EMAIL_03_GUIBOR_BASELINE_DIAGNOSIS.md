# RLX_EMAIL_03_GUIBOR_BASELINE_DIAGNOSIS

## Origem e isolamento

- Base Email: origin/main 8a476029.
- Baseline homologado: PR #72, merge c3523585372023f8d9836bf20251ea6166aeb546.
- Delta exato: primeiro pai 189aa0f → merge c3523585372023f8d9836bf20251ea6166aeb546; 51 arquivos,
  3424 inserções e 34 remoções na origem.
- Aplicação: git cherry-pick --no-commit -m 1 c3523585372023f8d9836bf20251ea6166aeb546.
- Nenhum commit criado; trabalho Email anterior preservado no mesmo worktree.
- Não usado o HEAD de feature/guibor-nfse-base-valor-comissao.
- Um conflito: src/lib/storage-authorization-escopo9c.test.ts. Preservada a
  autorização da main (requireNotaFiscalAccess); incorporado o select de
  tipo_documento_fiscal/fiscal_proveniencia do baseline.
- Nenhum delta A5/A6, comissão, base_valor_antecipacao, pricing, Vórtx ou CERC.
  Os campos bruto/líquido presentes no parser são fatos fiscais do A3/A4.

## Commits exatos da promoção

```text
257f54c feat(nfse): add isolated DANFSe v2 text strategy and baseline
dbdfc90 feat(nfse): add fail-closed visual DANFSe fallback
b492101 fix(nfse): preserve fiscal net and require audited manual due date
57c4141 fix(guibor): guard canonical migration history repair
b0cc532 fix(nfse): preserve absent values under recognized visual labels
ad0c0f9 fix(nfse): add safe field-level visual fiscal diagnostics
9d6691e fix(nfse): constrain visual access key transcription
98d51a8 fix(guibor): bind fiscal review and guard idempotent persistence
49edd4e test(guibor): certify review persistence and protect homolog QA cleanup
```

## Migrations preservadas

- supabase/migrations/20260929154656_guibor_nfse_fiscal_provenance.sql: SHA-256 7316dde05cb15aed21b0986acefc52b6697828bea11540341a3ebe9517b8cc35
- supabase/migrations/20260929174520_guibor_nfse_review_intents.sql: SHA-256 1bad4a89106a0ba9a80a338feaebaf799451fcc61ed1e234502eb57d98d307ad

A migration 20260929204430_email_intake_durable_transport.sql também permanece
inalterada nesta etapa. Qualquer evolução exigirá uma migration nova.

## Diagnóstico do pipeline

| Camada | Implementação atual | Evolução necessária |
| --- | --- | --- |
| Autenticação/UI | uploadNFs, resolverContextoUploadCedente, formulário de review na listagem | Continuar HUMAN, sessão/MFA/contexto reais |
| Autorização de domínio | resolverContextoOperacionalNotaFiscal, resolverEstabelecimentoOrigem, RLS/RPCs C4 | SYSTEM explícito com integração/fundo/routing/claim/fence |
| Parser e fatos | parseNFeXML/validação XML, extractDanfeFromPdf, probeNfsePdf, prepareNfsePersistence | Reutilizar sem fork; extrair orquestração da action |
| Persistência/Storage | processarArquivo/processarNfse, documentos-v2/upload, RPCs de parcelas e documentos | Reserva comum antes de upload, fencing em todas as escritas |
| Review | nfse_review_intents e open/read/claim/settleNfseReview | Recibo oficial compartilhado; reserva durante REVIEW; ingest SYSTEM e conclusão HUMAN |
| Auditoria/eventos | registrarLog e registrarEventoDominio, trigger de vencimento manual | Ator explícito sem usuário artificial; origem e IDs técnicos |

O índice nfse_review_active_identity protege PROCESSING/COMPLETED/CLEANUP_PENDING,
mas não REVIEW. actor_id é obrigatório e readNfseReview exige o mesmo usuário.
Isso precisa evoluir por migration nova, preservando reextração e proteção contra
alteração de fatos. A UI atual mantém o File em memória; o ingresso por e-mail
precisará recuperar o original de modo autorizado para usar o mesmo formulário.

recuperarDuplicidadeIncompleta remove uma NF parcial anterior sem reserva comum.
Esse caminho deve adquirir o mesmo fencing antes de recuperar ou remover dados.

## Validação

118 testes do baseline NFS-e e autorização Storage passaram após a resolução
do conflito. Suíte completa: 291 arquivos aprovados, 3 ignorados; 2518 testes
aprovados, 12 ignorados. TypeScript, lint (um warning preexistente) e build
webpack em Node 22.23.2 passaram. Clean-room da cadeia completa passou com
232 migrations, incluindo a nova reserva fiscal e 9 grupos de verificações
de concorrência, posse e autorização no PostgreSQL real. Nenhuma promoção remota.
O estado de implementação e os gates ainda pendentes estão em
[RLX_EMAIL_03_STATUS.md](RLX_EMAIL_03_STATUS.md).

## Arquivos do delta A3/A4

- docs/correcoes/guibor-01-a1-a2-parser-baseline.md
- docs/correcoes/guibor-01-a3-a4-r2.md
- docs/correcoes/guibor-01-a3-a4-r3.md
- docs/correcoes/guibor-01-a3-a4.md
- docs/correcoes/guibor-visual-fiscal-diagnostic.md
- docs/correcoes/guibor-visual-null-label.md
- scripts/qa/guibor/apply-homolog.mjs
- scripts/qa/guibor/database-smoke.mjs
- scripts/qa/guibor/history-envelope.mjs
- scripts/qa/guibor/history-envelope.test.mjs
- scripts/qa/guibor/parser-baseline.ts
- scripts/qa/guibor/review-certification.mjs
- scripts/qa/guibor/review-cleanup.mjs
- scripts/qa/guibor/review-medvale-cleanup.mjs
- scripts/qa/guibor/review-migration.mjs
- scripts/qa/guibor/review-rls.mjs
- scripts/qa/guibor/review-target.mjs
- scripts/qa/guibor/visual-real.ts
- src/app/cedente/notas-fiscais/[id]/page.tsx
- src/app/cedente/notas-fiscais/notas-fiscais-listagem.tsx
- src/app/gestor/notas-fiscais/[id]/page.tsx
- src/lib/actions/arquivo-nota-fiscal.ts
- src/lib/actions/nota-fiscal.ts
- src/lib/documentos-v2/base-documentos.ts
- src/lib/documentos-v2/upload.ts
- src/lib/nfse/contracts.ts
- src/lib/nfse/danfse-v2.test.ts
- src/lib/nfse/danfse-v2.ts
- src/lib/nfse/fixtures/danfse-v2.ts
- src/lib/nfse/fixtures/visual.ts
- src/lib/nfse/openai-visual.server.ts
- src/lib/nfse/pdf-dispatcher.server.ts
- src/lib/nfse/persistence.test.ts
- src/lib/nfse/persistence.ts
- src/lib/nfse/review-facts.ts
- src/lib/nfse/review-intents.server.ts
- src/lib/nfse/review-intents.test.ts
- src/lib/nfse/upload-persistence.test.ts
- src/lib/nfse/visual-contract.test.ts
- src/lib/nfse/visual-contract.ts
- src/lib/nfse/visual-diagnostics.test.ts
- src/lib/nfse/visual-diagnostics.ts
- src/lib/notas-fiscais/upload-batch.test.ts
- src/lib/notas-fiscais/upload-batch.ts
- src/lib/notas-fiscais/upload-observability.ts
- src/lib/storage-authorization-escopo9c.test.ts
- src/types/database.ts
- supabase/migrations/20260929154656_guibor_nfse_fiscal_provenance.sql
- supabase/migrations/20260929174520_guibor_nfse_review_intents.sql
- supabase/tests/guibor_nfse_review_intents.assert.sql
- vitest.config.ts

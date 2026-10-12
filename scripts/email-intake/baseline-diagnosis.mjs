import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const from = '189aa0f'
const to = 'c3523585372023f8d9836bf20251ea6166aeb546'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim()
const files = git('diff', '--name-only', from, to).split('\n')
const commits = git('log', '--reverse', '--format=%h %s', `${from}..49edd4e`)
const migrations = files.filter(path => path.startsWith('supabase/migrations/')).map(path => {
  const bytes = readFileSync(path)
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') }
})
const report = `# RLX_EMAIL_03_GUIBOR_BASELINE_DIAGNOSIS

## Origem e isolamento

- Base Email: origin/main 8a476029.
- Baseline homologado: PR #72, merge ${to}.
- Delta exato: primeiro pai ${from} → merge ${to}; 51 arquivos,
  3424 inserções e 34 remoções na origem.
- Aplicação: git cherry-pick --no-commit -m 1 ${to}.
- Nenhum commit criado; trabalho Email anterior preservado no mesmo worktree.
- Não usado o HEAD de feature/guibor-nfse-base-valor-comissao.
- Um conflito: src/lib/storage-authorization-escopo9c.test.ts. Preservada a
  autorização da main (requireNotaFiscalAccess); incorporado o select de
  tipo_documento_fiscal/fiscal_proveniencia do baseline.
- Nenhum delta A5/A6, comissão, base_valor_antecipacao, pricing, Vórtx ou CERC.
  Os campos bruto/líquido presentes no parser são fatos fiscais do A3/A4.

## Commits exatos da promoção

\`\`\`text
${commits}
\`\`\`

## Migrations preservadas

${migrations.map(row => `- ${row.path}: SHA-256 ${row.sha256}`).join('\n')}

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

${files.map(path => `- ${path}`).join('\n')}
`
writeFileSync('docs/development/RLX_EMAIL_03_GUIBOR_BASELINE_DIAGNOSIS.md', report, 'utf8')
console.log(JSON.stringify({ baseline: to, files: files.length, commits: commits.split('\n').length, migrations: migrations.length }))

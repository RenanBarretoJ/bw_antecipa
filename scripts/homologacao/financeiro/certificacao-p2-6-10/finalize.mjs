#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../../..')
const docs = resolve(root, 'docs/financeiro')
const now = new Date().toISOString()
const read = (name) => JSON.parse(readFileSync(resolve(docs, name), 'utf8'))
const write = (name, value) => writeFileSync(resolve(docs, name), `${JSON.stringify(value, null, 2)}\n`)

const projectRef = 'fhgkmggthxikfpogrvaa'
const common = { environment: 'homolog', project_ref: projectRef, production_touched: false, executed_at: now }

const login = read('authenticated-smoke-login-mfa-p2-6-10.json')
login.actor_cleanup = {
  status: 'PARTIAL',
  removed: ['super_admin_puro', 'super_admin_gestor_a'],
  retained: ['gestor_a', 'gestor_b'],
  reason: 'Supabase Auth recusou a exclusao dos gestores referenciados pelas fixtures QA (Database error deleting user).',
  credential_file_removed: true,
}
write('authenticated-smoke-login-mfa-p2-6-10.json', login)

const doubleApproval = {
  gate: 'DOUBLE_OPERATION_APPROVAL',
  ...common,
  status: 'PASS',
  operation_id: 'd19aa79d-60d9-9066-51c7-e19ea66f37ab',
  status_before: 'solicitada',
  status_after: 'aprovada',
  request_a: { authenticated: true, clicked: true },
  request_b: { authenticated: true, clicked: true, result: 'success_or_idempotent' },
  timing_epoch_ms: {
    request_b_start: 1787065917058,
    request_a_start: 1787065917067,
    request_a_end: 1787065927890,
    request_b_end: 1787065929245,
  },
  overlap_ms: 10823,
  effective_approval_events: 1,
  risk_executions: 1,
  audit_source: 'public.logs_auditoria',
  audit_event: 'OPERACAO_APROVADA',
  financial_duplication_detected: false,
  corruption_detected: false,
  verification: 'Browser real com duas sessoes AAL2; contagens finais confirmadas por consulta MCP read-only.',
}
write('double-operation-approval-p2-6-10.json', doubleApproval)

const toctou = {
  gate: 'TOCTOU_OPERATION',
  ...common,
  status: 'FAIL',
  execution: 'NOT_COMPLETED',
  operation_id: '36156774-ad52-d6a4-4803-9fbd205b7919',
  status_before: 'solicitada',
  status_after: 'solicitada',
  risk_executions: 0,
  approval_events: 0,
  stale_context_denied: null,
  blocker: 'Nao foi concluida uma corrida autenticada valida entre avaliacao e mutacao oficial de input.',
  related_runtime_defects: [
    'Server Actions globais falham ao contar notificacoes para os atores QA.',
    'A Central tenta modificar o cookie de fundo ativo durante renderizacao server-side.',
  ],
  evidence_integrity: 'Nenhuma aprovacao foi produzida e nenhum resultado positivo foi inferido sem execucao E2E.',
}
write('toctou-operation-p2-6-10.json', toctou)

const staleReview = {
  gate: 'STALE_REVIEW',
  ...common,
  status: 'FAIL',
  execution: 'NOT_COMPLETED',
  operation_id: '0280a33b-d3a3-0980-3924-935547a7a06e',
  status_before: 'solicitada',
  status_after: 'solicitada',
  risk_executions: 0,
  approval_events: 0,
  stale_review_denied: null,
  blocker: 'O fluxo autenticado de revisao nao abriu de forma confiavel por falhas 500 na Central e escrita de cookie em contexto server-side.',
  evidence_integrity: 'O gate permanece FAIL; a protecao nao foi promovida apenas com evidencia estatica ou baseline anterior.',
}
write('stale-review-p2-6-10.json', staleReview)

const readiness = read('production-readiness-p2-6-1.json')
const updates = new Map([
  ['AUTHENTICATED_SMOKE_LOGIN_MFA', ['PASS', 'authenticated-smoke-login-mfa-p2-6-10.json', false, 'Browser real: AAL1, TOTP, AAL2 e redirect do Gestor confirmados sem loop.']],
  ['CENTRAL_VISUAL_SMOKE', ['FAIL', 'central-visual-smoke-p2-6-10.json', true, 'Tabs renderizam, mas Server Actions de notificacoes retornam 500 e a troca de fundo tenta escrever cookie no render server-side.']],
  ['SMOKE_APTO_APPROVAL', ['PASS', 'smoke-apto-approval-p2-6-10.json', false, 'Gate JIT e aprovacao oficial executados com estado final aprovada.']],
  ['SMOKE_NO_LIMITE_40', ['PASS', 'smoke-no-limite-40-p2-6-10.json', false, '40% exatos foram APTO; margem deterministica acima de 40% foi BLOQUEADA.']],
  ['SMOKE_REVISAO_MANUAL', ['FAIL', 'smoke-revisao-manual-p2-6-10.json', true, 'Classificacao REVISAO_MANUAL foi criada, mas liberacao e recusa autenticadas nao concluíram pela regressao da Central.']],
  ['DOUBLE_OPERATION_APPROVAL', ['PASS', 'double-operation-approval-p2-6-10.json', false, 'Duas sessoes reais sobrepostas por 10823 ms resultaram em uma aprovacao e uma execucao de risco.']],
  ['TOCTOU_OPERATION', ['FAIL', 'toctou-operation-p2-6-10.json', true, 'Corrida autenticada com mutacao oficial nao foi concluida; nenhuma promocao por inferencia.']],
  ['STALE_REVIEW', ['FAIL', 'stale-review-p2-6-10.json', true, 'Revisao stale autenticada nao foi exercitada ponta a ponta.']],
])
for (const check of readiness.checks) {
  const update = updates.get(check.check_id)
  if (!update) continue
  const [status, evidence, blocker, note] = update
  check.status = status
  check.evidencia = evidence
  check.blocker = blocker
  check.observacao = note
}
readiness.generated_at = now
readiness.summary = { pass: 42, fail: 4, pending: 2, na: 1 }
readiness.recommendation = 'NO-GO'
readiness.p2_6_10 = {
  status: 'FAIL',
  artifact: 'operational-certification-p2-6-10.json',
  gates_pass: 4,
  gates_fail: 4,
  remaining_pending: ['LEGACY_ENV_RETIREMENT', 'SINQIA_EXTERNAL'],
  direct_postgres_connection_credential_updated: false,
  direct_postgres_connection_test: 'FAIL',
  direct_postgres_sqlstate: '28P01',
}
write('production-readiness-p2-6-1.json', readiness)

const certification = {
  schema: 'bw-antecipa-operational-certification-p2-6-10-v1',
  ...common,
  status: 'FAIL',
  migrations: { status: 'BASELINE_PRESERVED', local: 127, remote: 127, new_migrations: 0 },
  login_mfa: { status: 'PASS', evidence: 'authenticated-smoke-login-mfa-p2-6-10.json' },
  central_visual: { status: 'FAIL', evidence: 'central-visual-smoke-p2-6-10.json' },
  apto: { status: 'PASS', evidence: 'smoke-apto-approval-p2-6-10.json' },
  exact_40: { status: 'PASS', evidence: 'smoke-no-limite-40-p2-6-10.json' },
  manual_review: { status: 'FAIL', evidence: 'smoke-revisao-manual-p2-6-10.json' },
  double_approval: { status: 'PASS', overlap_ms: 10823, effective_approvals: 1, risk_executions: 1, evidence: 'double-operation-approval-p2-6-10.json' },
  toctou: { status: 'FAIL', evidence: 'toctou-operation-p2-6-10.json' },
  stale_review: { status: 'FAIL', evidence: 'stale-review-p2-6-10.json' },
  bypass: { status: 'BLOCKED_REEXECUTION', baseline: 'PASS', reason: 'Credencial PostgreSQL direta falhou com SQLSTATE 28P01.' },
  timeout: { status: 'BLOCKED_REEXECUTION', baseline: 'PASS', reason: 'Credencial PostgreSQL direta falhou com SQLSTATE 28P01.' },
  golden: { status: 'BLOCKED_REEXECUTION', baseline_v2: '384/384', baseline_security: '5/5', reason: 'Credencial PostgreSQL direta falhou com SQLSTATE 28P01.' },
  data_api: { status: 'BASELINE_PRESERVED', baseline: '118/118', code_or_schema_changed: false },
  cross_fund: { status: 'BASELINE_PRESERVED', baseline: '39/39', authenticated_negative_in_manual_review: 'INCONCLUSIVE_DUE_RUNTIME' },
  storage: { status: 'BASELINE_PRESERVED', baseline: '15/15', code_or_schema_changed: false },
  performance_sanity: { status: 'BASELINE_PRESERVED', p95_ms: 6839, formal_limit_ms: 7356 },
  quality: {
    node: '22.23.0',
    typescript: 'PASS',
    tests: { status: 'PASS', passed: 1033, skipped: 3 },
    lint: { status: 'PASS_WITH_WARNINGS', errors: 0, warnings: 6 },
    build: 'PASS',
    diff_check: 'PASS',
    npm_audit_production: { status: 'PASS', vulnerabilities: 0 },
  },
  secret_scan: { status: 'PASS', findings: 0, scanned_files: 1094, evidence: 'secret-scan-p2-6-1.json' },
  qa_cleanup: {
    status: 'PARTIAL',
    auth_users_removed: 2,
    auth_users_retained: 2,
    local_credential_file_removed: true,
    blocker: 'Database error deleting user para atores ainda referenciados pelas fixtures.',
  },
  readiness_before: { pass: 38, fail: 0, pending: 10, na: 1 },
  readiness_after: { pass: 42, fail: 4, pending: 2, na: 1 },
  remaining_pending: ['LEGACY_ENV_RETIREMENT', 'SINQIA_EXTERNAL'],
  direct_postgres_connection_credential_updated: false,
  direct_postgres_connection_test: 'FAIL',
  direct_postgres_sqlstate: '28P01',
  runtime_defects: [
    { severity: 'P0', location: 'src/lib/notificacoes/listagem.server.ts:28', symptom: 'Nao foi possivel contar as notificacoes; Server Actions retornam 500.' },
    { severity: 'P0', location: 'src/lib/actions/fundo-ativo.ts:190', symptom: 'Cookies can only be modified in a Server Action or Route Handler.' },
  ],
  git_status: 'DIRTY_ONLY_WITH_P2_6_10_QA_TOOLING_AND_ARTIFACTS',
  recommendation: 'NO-GO',
}
write('operational-certification-p2-6-10.json', certification)

const report = `# P2.6.10 — Certificação operacional autenticada, MFA e concorrência

## 1. Objetivo
Certificar em homologação os oito gates autenticados definidos no escopo, sem alterar regras de negócio e sem tocar produção.

## 2. Baseline
Entrada canônica: 127/127 migrations, Golden V2 384/384, Golden Security 5/5, Data API 118/118, cross-fund 39/39, Storage 15/15 e 1.033 testes.

## 3. Ambiente
Somente homologação, projeto \`${projectRef}\`. Produção não foi acessada nem alterada.

## 4. Atores QA
Foram usados Gestor A, Gestor B, Super Admin puro e Super Admin híbrido sintéticos. Nenhum usuário real foi alterado.

## 5. Credenciais e sanitização
Senhas, TOTP, JWTs, refresh tokens e connection strings não foram gravados. O arquivo local restrito de credenciais foi removido.

## 6. Login
PASS em browser real com senha válida.

## 7. AAL1
Confirmado após senha e antes do desafio TOTP.

## 8. TOTP
Código inválido foi negado; código válido foi aceito.

## 9. AAL2
Confirmado após o desafio TOTP.

## 10. Redirect
O Gestor foi redirecionado para \`/gestor/dashboard\`, sem loop.

## 11. Controles MFA negativos
TOTP inválido foi negado. A sessão AAL1 não foi considerada suficiente para concluir o fluxo.

## 12. Central visual
FAIL. A página e as tabs renderizam, porém chamadas de \`carregarSinoNotificacoes\` retornam 500 em \`src/lib/notificacoes/listagem.server.ts:28\`. A seleção de fundo também dispara escrita de cookie durante render server-side em \`src/lib/actions/fundo-ativo.ts:190\`.

## 13. APTO
PASS. O fluxo oficial avaliou APTO e aprovou atomicamente a operação.

## 14. Exatamente 40%
PASS. Exposição projetada exatamente igual ao limite inclusivo de 40% foi classificada APTO/NO_LIMITE.

## 15. Controle >40%
PASS. A margem mínima determinística acima de 40% foi BLOQUEADA e não aprovada.

## 16. REVISAO_MANUAL
FAIL. A classificação determinística foi criada, mas a decisão autenticada não pôde ser concluída pela regressão da Central.

## 17. Liberação
Não concluída; a revisão permaneceu PENDENTE e a operação solicitada.

## 18. Recusa
Não concluída; a revisão permaneceu PENDENTE e a operação solicitada.

## 19. Negativos de revisão
Super Admin puro foi negado. Os demais negativos ficaram inconclusivos porque a tela oficial de decisão não abriu de forma confiável.

## 20. Dupla aprovação
PASS. Duas sessões AAL2 reais acionaram a mesma operação.

## 21. Overlap
As requisições se sobrepuseram por 10.823 ms.

## 22. Idempotência
Resultado final único: uma aprovação efetiva, uma execução de risco e um evento \`OPERACAO_APROVADA\` em \`logs_auditoria\`.

## 23. TOCTOU
FAIL. A corrida autenticada com alteração oficial de input não foi concluída; nenhuma proteção foi promovida por inferência.

## 24. Assinatura/contexto
O baseline de assinatura e stale check foi preservado, mas não substitui a evidência E2E exigida neste gate.

## 25. Stale review
FAIL. A revisão antiga não foi exercitada ponta a ponta após mutação de contexto.

## 26. Bypass
O baseline permanece PASS; a reexecução dos runners SQL ficou BLOCKED por credencial PostgreSQL direta inválida (28P01).

## 27. Timeout
O baseline fail-closed permanece PASS; a reexecução ficou BLOCKED pelo mesmo 28P01.

## 28. Data API
Baseline preservado em 118/118; não houve mudança de código funcional ou schema.

## 29. Cross-fund
Baseline preservado em 39/39. O negativo autenticado específico da revisão foi inconclusivo devido ao runtime.

## 30. Storage
Baseline preservado em 15/15; não houve mudança de Storage.

## 31. Identidade
O fluxo autenticado usou Auth e JWT reais, sem service role como ator dos gates.

## 32. Super Admin
O Super Admin puro não obteve decisão operacional de revisão.

## 33. Híbrido
O ator híbrido foi criado com vínculo de gestor controlado, mas a decisão ficou bloqueada pelo runtime da Central.

## 34. Golden
Baseline V2 384/384 e Security 5/5 preservado. A reexecução SQL foi bloqueada por 28P01.

## 35. Performance sanity
Baseline preservado: p95 6.839 ms sob limite formal de 7.356 ms; otimização não foi reaberta.

## 36. Migrations
Nenhuma migration foi criada. Estado canônico preservado em 127/127.

## 37. Credencial PostgreSQL direta
\`direct_postgres_connection_credential_updated=false\`; teste FAIL com SQLSTATE 28P01. Nenhuma senha foi registrada.

## 38. Dependências
\`npm audit --omit=dev\`: PASS, zero vulnerabilidades de produção.

## 39. TypeScript
PASS com Node 22.23.0.

## 40. Testes
PASS: 1.033 testes; 3 skipped conhecidos.

## 41. Lint
PASS com zero erros e seis warnings preexistentes.

## 42. Build
PASS com Next.js 16.3.1 e webpack.

## 43. Secret scan
PASS: 1.089 arquivos textuais, zero findings.

## 44. Cleanup QA
PARCIAL. Dois atores Auth foram removidos; Gestor A e B permaneceram porque o Auth retornou \`Database error deleting user\` devido às referências das fixtures. O arquivo local de credenciais foi removido.

## 45. Readiness antes
38 PASS / 0 FAIL / 10 PENDENTE / 1 N/A.

## 46. Readiness depois
42 PASS / 4 FAIL / 2 PENDENTE / 1 N/A.

## 47. Pendências restantes
Fora do escopo: \`LEGACY_ENV_RETIREMENT\` e \`SINQIA_EXTERNAL\`.

## 48. Riscos
P0: contador de notificações com 500. P0: escrita de cookie durante render server-side. P1: credencial PostgreSQL direta local desatualizada. P1: cleanup parcial das fixtures/atores QA.

## 49. Parecer
**P2.6.10 = FAIL** e **recommendation = NO-GO**. Os gates APTO, 40%, MFA e concorrência passaram, mas Central, revisão manual, TOCTOU e stale review impedem certificação operacional final.

## 50. Git status
Somente tooling QA e artefatos da P2.6.10 foram criados/alterados, além da atualização do readiness e secret scan. Nenhum commit ou push foi executado.
`
writeFileSync(resolve(docs, 'relatorio-p2-6-10-certificacao-operacional.md'), report)

console.log(JSON.stringify({ status: certification.status, readiness: readiness.summary, recommendation: readiness.recommendation }))

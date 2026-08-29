import { existsSync, readFileSync } from 'node:fs'
import {
  BOLETO_DOCUMENT_CODE,
  assertHomologEnvironment,
  assertMutation,
  authSpecs,
  buildDataset,
  connectDb,
  createAdminClient,
  deterministicUuid,
  environmentSummary,
  listAllAuthUsers,
  loadHomologEnv,
  localManifestPath,
  mutationConfirmation,
  parseArgs,
} from './helpers.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const execute = assertMutation(args, 'CLEANUP', env.projectRef)
const dataset = buildDataset()
const client = await connectDb(env, execute ? 'cleanup' : 'cleanup_dry_run')

const exact = {
  funds: dataset.funds.map((item) => item.id),
  notes: dataset.notes.map((item) => item.id),
  operations: dataset.operations.map((item) => item.id),
  calculations: dataset.operations.map((item) => deterministicUuid(`operation-calculation-${item.id}`)),
  deliveries: dataset.operations.map((item) => deterministicUuid(`delivery-${item.note.id}`)),
  canhotos: dataset.operations.filter((item) => dataset.documentByNoteFamily.has(`${item.note.id}:comprovante_entrega`)).map((item) => deterministicUuid(`canhoto-${item.note.id}`)),
  documents: dataset.documents.map((item) => item.id),
  versions: dataset.documents.map((item) => item.versionId),
  analyses: dataset.documents.filter((item) => item.status === 'aprovado' || item.status === 'rejeitado').map((item) => deterministicUuid(`analysis-${item.id}`)),
  links: dataset.documents.map((item) => deterministicUuid(`document-link-${item.id}`)),
  ctes: dataset.documents.filter((item) => item.family === 'cte_xml').map((item) => deterministicUuid(`cte-${item.note.id}`)),
  requirementInstances: dataset.notes.flatMap((note) => ['xml', 'danfe', 'boleto'].map((key) => deterministicUuid(`requirement-instance-${note.id}-${key}`))),
  evidences: dataset.documents.filter((item) => ['cte_xml', 'comprovante_entrega'].includes(item.family)).map((item) => deterministicUuid(`evidence-${item.note.id}-${item.family}`)),
  evidenceVersions: dataset.documents.filter((item) => ['cte_xml', 'comprovante_entrega'].includes(item.family)).map((item) => deterministicUuid(`evidence-version-${item.note.id}-${item.family}-v1`)),
  cedents: dataset.cedents.map((item) => item.id),
  cedentFunds: dataset.cedents.map((item) => item.linkId),
  debtors: dataset.debtors.map((item) => item.id),
  assignments: dataset.cedents.map((item) => item.assignmentId),
  policies: dataset.funds.map((item) => item.policyId),
  policyVersions: dataset.funds.map((item) => item.policyVersionId),
  requirements: dataset.funds.flatMap((item) => Object.values(item.requirementIds)),
  events: dataset.operations.flatMap((item) => [deterministicUuid(`event-operation-created-${item.id}`), deterministicUuid(`event-operation-approved-${item.id}`)]),
}

function readRuntimeManifest() {
  const path = localManifestPath()
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

async function assertDedicatedFunds() {
  const { rows } = await client.query(`SELECT id,nome,cnpj FROM public.fundos WHERE id=ANY($1)`, [exact.funds])
  for (const row of rows) {
    const expected = dataset.funds.find((fund) => fund.id === row.id)
    if (!expected || row.nome !== expected.name || row.cnpj !== expected.cnpj) {
      throw new Error(`Cleanup bloqueado: fundo ${row.id} nao corresponde integralmente ao namespace sintetico.`)
    }
  }
  return rows.length
}

async function preview() {
  const fundCount = await assertDedicatedFunds()
  const result = await client.query(`
    SELECT
      (SELECT count(*) FROM public.notas_fiscais WHERE id=ANY($1))::integer notas,
      (SELECT count(*) FROM public.operacoes WHERE id=ANY($2))::integer operacoes,
      (SELECT count(*) FROM public.documentos_repositorio WHERE id=ANY($3))::integer documentos,
      (SELECT count(*) FROM public.cedentes WHERE id=ANY($4))::integer cedentes,
      (SELECT count(*) FROM public.sacados WHERE id=ANY($5))::integer sacados
  `, [exact.notes, exact.operations, exact.documents, exact.cedents, exact.debtors])
  console.log(`Fundos: ${fundCount}; registros exatos: ${JSON.stringify(result.rows[0])}`)
  console.log('Storage: nenhum objeto criado pelo P2.1; nenhuma exclusao de bucket sera feita.')
}

async function cleanupDatabase() {
  await assertDedicatedFunds()
  const runtimeManifest = readRuntimeManifest()
  const managerId = runtimeManifest?.manager?.id || null
  await client.query('BEGIN')
  try {
    await client.query("SET LOCAL session_replication_role='replica'")
    const statements = [
      ['DELETE FROM public.eventos_dominio WHERE id=ANY($1)', [exact.events]],
      ['DELETE FROM public.canhotos WHERE id=ANY($1)', [exact.canhotos]],
      ['DELETE FROM public.documento_requisito_instancias WHERE id=ANY($1)', [exact.requirementInstances]],
      ['DELETE FROM public.evidencia_logistica_versoes WHERE id=ANY($1)', [exact.evidenceVersions]],
      ['DELETE FROM public.evidencias_logisticas_antecipadas WHERE id=ANY($1)', [exact.evidences]],
      ['DELETE FROM public.cte_notas_fiscais WHERE cte_id=ANY($1) AND nota_fiscal_id=ANY($2)', [exact.ctes, exact.notes]],
      ['DELETE FROM public.canhotos WHERE nota_fiscal_entrega_id=ANY($1)', [exact.deliveries]],
      ['DELETE FROM public.nota_fiscal_entregas WHERE id=ANY($1)', [exact.deliveries]],
      ['DELETE FROM public.documento_analises WHERE id=ANY($1)', [exact.analyses]],
      ['DELETE FROM public.documento_vinculos WHERE id=ANY($1)', [exact.links]],
      ['DELETE FROM public.ctes WHERE id=ANY($1)', [exact.ctes]],
      ['DELETE FROM public.documento_versoes WHERE id=ANY($1)', [exact.versions]],
      ['DELETE FROM public.documentos_repositorio WHERE id=ANY($1)', [exact.documents]],
      ['DELETE FROM public.operacao_calculo_nfs WHERE id=ANY($1)', [exact.calculations]],
      ['DELETE FROM public.operacoes_nfs WHERE operacao_id=ANY($1) AND nota_fiscal_id=ANY($2)', [exact.operations, exact.notes]],
      ['DELETE FROM public.operacoes WHERE id=ANY($1)', [exact.operations]],
      ['DELETE FROM public.notas_fiscais WHERE id=ANY($1)', [exact.notes]],
      ['DELETE FROM public.cedente_fundo_politicas WHERE id=ANY($1)', [exact.assignments]],
      ['DELETE FROM public.politica_requisitos_documentais WHERE id=ANY($1)', [exact.requirements]],
      ['DELETE FROM public.politica_operacional_versoes WHERE id=ANY($1)', [exact.policyVersions]],
      ['DELETE FROM public.politicas_operacionais WHERE id=ANY($1)', [exact.policies]],
      ['DELETE FROM public.cedente_fundos WHERE id=ANY($1)', [exact.cedentFunds]],
      ['DELETE FROM public.cedentes WHERE id=ANY($1)', [exact.cedents]],
      ['DELETE FROM public.sacados WHERE id=ANY($1)', [exact.debtors]],
    ]
    if (managerId) statements.push(['DELETE FROM public.usuario_fundos WHERE usuario_id=$1 AND fundo_id=$2', [managerId, dataset.mainFund.id]])
    statements.push(['DELETE FROM public.fundos WHERE id=ANY($1)', [exact.funds]])
    statements.push(['DELETE FROM public.documento_tipos WHERE id=$1 AND codigo=$2', [deterministicUuid('document-type-boleto-duplicata-digital'), BOLETO_DOCUMENT_CODE]])
    for (const [sql, values] of statements) await client.query(sql, values)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function cleanupAuth() {
  const admin = createAdminClient(env)
  const expectedEmails = new Set(authSpecs().map((item) => item.email))
  const users = await listAllAuthUsers(admin)
  const targets = users.filter((user) => expectedEmails.has(String(user.email || '').toLowerCase()))
  for (const user of targets) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw new Error(`Banco limpo, mas falhou ao remover Auth sintetico ${user.email}: ${error.message}`)
  }
  return targets.length
}

try {
  console.log('\nBW Antecipa - cleanup P2.1 RLX')
  console.log(environmentSummary(env))
  console.log(`Modo: ${execute ? 'EXECUTE' : 'DRY-RUN (padrao seguro)'}`)
  if (!execute) {
    await client.query('BEGIN READ ONLY')
    await preview()
    await client.query('ROLLBACK')
    console.log(`Para remover: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation('CLEANUP', env.projectRef)}`)
  } else {
    await cleanupDatabase()
    const removed = await cleanupAuth()
    console.log(`Cleanup concluido. Auth sinteticos removidos: ${removed}; Storage: 0.`)
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(`Falha no cleanup P2.1: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}

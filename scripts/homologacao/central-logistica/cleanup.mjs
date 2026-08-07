import {
  CLEANUP_CONFIRMATION,
  FUND_NAME,
  QA_EMAIL_DOMAIN,
  SEED_VERSION,
  assertHomologEnvironment,
  assertMutation,
  buildDataset,
  connectDb,
  createAdminClient,
  environmentSummary,
  listAllAuthUsers,
  loadHomologEnv,
  parseArgs,
} from './helpers.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const apply = assertMutation(args, CLEANUP_CONFIRMATION)
const dataset = buildDataset()
const client = await connectDb(env, apply ? 'cleanup' : 'cleanup_dry_run')

const exactIds = {
  notes: dataset.notes.map((item) => item.id),
  operations: dataset.operations.map((item) => item.id),
  documents: dataset.documents.map((item) => item.id),
  versions: dataset.documents.flatMap((item) => item.versions.map((version) => version.id)),
  cedents: dataset.cedents.map((item) => item.id),
  debtors: dataset.debtors.map((item) => item.id),
  cedentFunds: dataset.cedents.map((item) => item.linkId),
  policyAssignments: dataset.cedents.map((item) => item.assignmentId),
  policies: dataset.policies.map((item) => item.id),
  policyVersions: dataset.policies.map((item) => item.versionId),
  policyRequirements: dataset.policies.flatMap((item) => [item.reqCteId, item.reqProofId]),
}

async function assertDedicatedFund() {
  const { rows } = await client.query('SELECT id, nome, cnpj FROM public.fundos WHERE id=$1', [dataset.fund.id])
  if (!rows.length) return false
  if (rows[0].nome !== FUND_NAME || rows[0].cnpj !== dataset.fund.cnpj) {
    throw new Error('Cleanup bloqueado: o UUID deterministico do fundo nao corresponde integralmente ao fundo sintetico esperado.')
  }
  return true
}

async function tablesWithFundId() {
  const { rows } = await client.query(`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name='fundo_id'
    ORDER BY table_name
  `)
  return rows.map((row) => row.table_name)
}

async function preview() {
  const exists = await assertDedicatedFund()
  if (!exists) {
    console.log('\nFundo sintetico ausente. Nada a remover.')
    return
  }
  console.log('\nRegistros diretamente vinculados ao fundo sintetico:')
  let total = 0
  for (const table of await tablesWithFundId()) {
    const { rows } = await client.query(`SELECT count(*)::integer AS total FROM public.${table} WHERE fundo_id=$1`, [dataset.fund.id])
    const count = Number(rows[0]?.total || 0)
    if (count > 0) {
      total += count
      console.log(`- ${table}: ${count}`)
    }
  }
  const indirect = await client.query(`
    SELECT
      (SELECT count(*) FROM public.documentos_repositorio WHERE id=ANY($1))::integer AS documentos,
      (SELECT count(*) FROM public.documento_versoes WHERE id=ANY($2))::integer AS versoes,
      (SELECT count(*) FROM public.operacoes_nfs WHERE operacao_id=ANY($3) OR nota_fiscal_id=ANY($4))::integer AS operacoes_nfs,
      (SELECT count(*) FROM public.documento_analises WHERE documento_versao_id=ANY($2))::integer AS analises
  `, [exactIds.documents, exactIds.versions, exactIds.operations, exactIds.notes])
  console.log(`Indiretos exatos: ${JSON.stringify(indirect.rows[0])}`)
  console.log(`Total com fundo_id: ${total}`)
  console.log('Storage: 0 objetos esperados; nenhuma remocao de bucket sera executada.')
}

async function cleanupDatabase() {
  const fundExists = await assertDedicatedFund()
  if (!fundExists) console.log('\nFundo sintetico ausente; verificando residuos pelos IDs deterministicos exatos.')

  await client.query('BEGIN')
  try {
    // Triggers append-only e FKs sao suspensos apenas nesta transacao, sob IDs exatos
    // da massa sintetica e depois da verificacao forte do fundo dedicado.
    await client.query("SET LOCAL session_replication_role = 'replica'")

    if (fundExists) {
      for (const table of await tablesWithFundId()) {
        if (table === 'fundos') continue
        await client.query(`DELETE FROM public.${table} WHERE fundo_id=$1`, [dataset.fund.id])
      }
    }

    const cleanupStatements = [
      ['DELETE FROM public.eventos_entrega WHERE nota_fiscal_entrega_id IN (SELECT id FROM public.nota_fiscal_entregas WHERE nota_fiscal_id=ANY($1))', [exactIds.notes]],
      ['DELETE FROM public.canhotos WHERE nota_fiscal_entrega_id IN (SELECT id FROM public.nota_fiscal_entregas WHERE nota_fiscal_id=ANY($1))', [exactIds.notes]],
      ['DELETE FROM public.documento_requisito_instancias WHERE nota_fiscal_id=ANY($1) OR operacao_id=ANY($2) OR nota_fiscal_entrega_id IN (SELECT id FROM public.nota_fiscal_entregas WHERE nota_fiscal_id=ANY($1))', [exactIds.notes, exactIds.operations]],
      ['DELETE FROM public.nota_fiscal_entregas WHERE nota_fiscal_id=ANY($1) OR operacao_id=ANY($2)', [exactIds.notes, exactIds.operations]],
      ['DELETE FROM public.evidencia_logistica_versoes WHERE evidencia_logistica_id IN (SELECT id FROM public.evidencias_logisticas_antecipadas WHERE nota_fiscal_id=ANY($1)) OR documento_versao_id=ANY($2)', [exactIds.notes, exactIds.versions]],
      ['DELETE FROM public.evidencias_logisticas_antecipadas WHERE nota_fiscal_id=ANY($1)', [exactIds.notes]],
      ['DELETE FROM public.cte_notas_fiscais WHERE nota_fiscal_id=ANY($1)', [exactIds.notes]],
      ['DELETE FROM public.documento_analises WHERE documento_versao_id=ANY($1)', [exactIds.versions]],
      ['DELETE FROM public.documento_vinculos WHERE documento_id=ANY($1)', [exactIds.documents]],
      ['DELETE FROM public.documento_versoes WHERE documento_id=ANY($1)', [exactIds.documents]],
      ['DELETE FROM public.documentos_repositorio WHERE id=ANY($1)', [exactIds.documents]],
      ['DELETE FROM public.operacoes_nfs WHERE operacao_id=ANY($1) OR nota_fiscal_id=ANY($2)', [exactIds.operations, exactIds.notes]],
      ['DELETE FROM public.operacoes WHERE id=ANY($1)', [exactIds.operations]],
      ['DELETE FROM public.notas_fiscais WHERE id=ANY($1)', [exactIds.notes]],
      ['DELETE FROM public.cedente_fundo_politicas WHERE id=ANY($1)', [exactIds.policyAssignments]],
      ['DELETE FROM public.politica_requisitos_documentais WHERE id=ANY($1)', [exactIds.policyRequirements]],
      ['DELETE FROM public.politica_operacional_versoes WHERE id=ANY($1)', [exactIds.policyVersions]],
      ['DELETE FROM public.politicas_operacionais WHERE id=ANY($1)', [exactIds.policies]],
      ['DELETE FROM public.cedente_fundos WHERE id=ANY($1)', [exactIds.cedentFunds]],
      ['DELETE FROM public.cedentes WHERE id=ANY($1)', [exactIds.cedents]],
      ['DELETE FROM public.sacados WHERE id=ANY($1)', [exactIds.debtors]],
      ['DELETE FROM public.fundos WHERE id=$1', [dataset.fund.id]],
    ]
    for (const [sql, parameters] of cleanupStatements) {
      try {
        await client.query(sql, parameters)
      } catch (error) {
        if (error?.code === '42P01' || error?.code === '42703') continue
        throw error
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}

async function cleanupAuthUsers() {
  const admin = createAdminClient(env)
  const users = await listAllAuthUsers(admin)
  const qaUsers = users.filter((user) => String(user.email || '').toLowerCase().endsWith(`@${QA_EMAIL_DOMAIN}`))
  for (const user of qaUsers) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) throw new Error(`Banco limpo, mas falhou ao remover Auth sintetico ${user.email}: ${error.message}`)
  }
  return qaUsers.length
}

try {
  console.log('\nBW Antecipa - cleanup da massa Central Logistica')
  console.log(environmentSummary(env))
  console.log(`Seed: ${SEED_VERSION}`)
  console.log(`Modo: ${apply ? 'APPLY' : 'DRY-RUN (padrao seguro)'}`)
  if (!apply) {
    await client.query('BEGIN READ ONLY')
    await preview()
    await client.query('ROLLBACK')
    console.log(`\nPara remover: --apply --confirm ${CLEANUP_CONFIRMATION} --expected-project-ref ${env.projectRef}`)
  } else {
    await cleanupDatabase()
    const authRemoved = await cleanupAuthUsers()
    console.log(`\nCleanup concluido. Usuarios Auth sinteticos removidos: ${authRemoved}. Storage removido: 0.`)
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  console.error(`\nFalha no cleanup: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}

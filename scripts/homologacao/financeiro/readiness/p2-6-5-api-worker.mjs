#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { buildGoldenV2 } from '../../rlx-golden-v2/scenario-definitions.mjs'

const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
const localHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const bootstrapOnly = process.argv.includes('--bootstrap-only')
const actorSeed = process.env.BW_P265_ACTOR_SEED
const artifactPhase = process.env.BW_READINESS_ARTIFACT_PHASE || 'p2-6-5'
const artifactTag = artifactPhase.toUpperCase().replaceAll('-', '.')
for (const [label, value] of [['api', apiUrl], ['database', dbUrl]]) {
  if (!value || !localHosts.has(new URL(value).hostname)) throw new Error(`${label} precisa apontar para o clean-room local.`)
}
if (!anonKey || !serviceKey) throw new Error('Chaves locais do Supabase ausentes.')

const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const db = new pg.Client({ connectionString: dbUrl, application_name: 'bw_p265_api_worker' })
// A matriz de API deve exercitar a mesma massa que alimenta P2.3-P2.6.
// O Golden V1 continua validado separadamente pelo runner, mas nao possui os
// resultados financeiros canônicos consumidos por estes gates.
const dataset = buildGoldenV2()
const fundA = dataset.mainFund
const fundB = dataset.adversarialFund
const operationA = dataset.operations.find((item) => item.note.fund.id === fundA.id)
if (!operationA) throw new Error('Operacao sintetica do fundo A nao encontrada.')
const cedentA = operationA.note.cedent
const cedentB = dataset.cedents.find((item) => item.fund.id === fundB.id)
const noteA = operationA.note
const noteB = dataset.notes.find((item) => item.fund.id === fundB.id)
const debtorA = dataset.debtors.find((item) => item.id === noteA.debtor.id)
const matrix = []
const crossFund = []
const storage = []
const actorSessions = []
const credentials = new Map()
const actors = {}
let criticalLeak = null
let jointDebtorA
let jointDebtorB

await db.connect()
try {
  await bootstrapActors()
  if (bootstrapOnly) {
    console.log(`${artifactTag}: atores sinteticos locais preparados para os gates de seguranca.`)
  } else {
    await authenticateActors()
    await executeDataMatrix()
    await executeStorageMatrix()
    assertNoCriticalFailures()
    writeArtifacts('PASS')
    console.log(`${artifactTag} API: ${matrix.length} checks; cross-fund: ${crossFund.length}; storage: ${storage.length}.`)
  }
} catch (error) {
  if (!bootstrapOnly) writeArtifacts('FAIL', error instanceof Error ? error.message : String(error))
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await db.end().catch(() => undefined)
}

async function bootstrapActors() {
  const specs = [
    ['GESTOR_A', 'gestor'], ['GESTOR_B', 'gestor'], ['CEDENTE_A', 'cedente'], ['CEDENTE_B', 'cedente'],
    ['CONSULTOR_A', 'consultor'], ['SACADO_A', 'sacado'], ['SUPER_ADMIN_PURO', 'gestor'], ['SUPER_ADMIN_GESTOR_A', 'gestor'],
  ]
  if (!actorSeed) throw new Error(`Seed efemero dos atores ${artifactTag} ausente.`)
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listed.error) throw new Error(`Listagem Auth local: ${listed.error.message}`)
  const byEmail = new Map(listed.data.users.map((user) => [user.email, user]))
  for (const [name, role] of specs) {
    const email = `qa+p265-${name.toLowerCase().replaceAll('_', '-')}@example.invalid`
    const password = `Qa!${createHash('sha256').update(`${actorSeed}:${name}`).digest('base64url').slice(0, 32)}9z`
    const existing = byEmail.get(email)
    const { data, error } = existing
      ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { role, nome_completo: name } })
      : await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role, nome_completo: name } })
    if (error || !data.user) throw new Error(`Auth bootstrap ${name}: ${error?.message || 'usuario ausente'}`)
    actors[name] = { id: data.user.id, email, role }
    credentials.set(name, password)
  }

  await db.query('BEGIN')
  try {
    await db.query(`UPDATE public.cedentes SET user_id=$1 WHERE id=$2`, [actors.CEDENTE_A.id, cedentA.id])
    await db.query(`UPDATE public.cedentes SET user_id=$1 WHERE id=$2`, [actors.CEDENTE_B.id, cedentB.id])
    await db.query(`UPDATE public.sacados SET user_id=$1 WHERE id=$2`, [actors.SACADO_A.id, debtorA.id])
    await db.query(`INSERT INTO public.consultor_cedente(consultor_id,cedente_id,comissao_percentual) VALUES($1,$2,0) ON CONFLICT(consultor_id,cedente_id) DO NOTHING`, [actors.CONSULTOR_A.id, cedentA.id])
    await db.query(`INSERT INTO public.usuario_fundos(usuario_id,fundo_id,perfil_no_fundo,status,principal) VALUES
      ($1,$2,'administrador','ativo',true),($3,$4,'administrador','ativo',true),($5,$2,'administrador','ativo',true)
      ON CONFLICT(usuario_id,fundo_id) DO UPDATE SET status='ativo'`, [actors.GESTOR_A.id, fundA.id, actors.GESTOR_B.id, fundB.id, actors.SUPER_ADMIN_GESTOR_A.id])
    await db.query(`UPDATE public.profiles SET role='super_admin'::public.user_role WHERE id=$1`, [actors.SUPER_ADMIN_PURO.id])
    await db.query(`INSERT INTO public.usuario_papeis(usuario_id,papel,ativo,origem) VALUES
      ($1,'super_admin'::public.user_role,true,'bootstrap_homolog'),($2,'super_admin'::public.user_role,true,'bootstrap_homolog')
      ON CONFLICT(usuario_id,papel) DO UPDATE SET ativo=true,revogado_em=NULL`, [actors.SUPER_ADMIN_PURO.id, actors.SUPER_ADMIN_GESTOR_A.id])
    const jointDebtors = await db.query(`INSERT INTO public.devedores_solidarios
      (id,cedente_id,nome,doc_numero,cpf,email,ordem)
      VALUES ($1,$2,'P265 DEVEDOR A','P265-A','10000000001','qa+p265-devedor-a@example.invalid',1),
             ($3,$4,'P265 DEVEDOR B','P265-B','20000000002','qa+p265-devedor-b@example.invalid',1)
      RETURNING id,cedente_id`, [randomUUID(), cedentA.id, randomUUID(), cedentB.id])
    jointDebtorA = jointDebtors.rows.find((item) => item.cedente_id === cedentA.id)
    jointDebtorB = jointDebtors.rows.find((item) => item.cedente_id === cedentB.id)
    await db.query('COMMIT')
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

async function authenticateActors() {
  for (const [name, actor] of Object.entries(actors)) {
    const client = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.signInWithPassword({ email: actor.email, password: credentials.get(name) })
    if (error || !data.session) throw new Error(`Login local ${name}: ${error?.message || 'sessao ausente'}`)
    actor.client = client
    actorSessions.push({ actor: name, token_received: true, expires_at: data.session.expires_at })
  }
  credentials.clear()
}

async function executeDataMatrix() {
  await expectSelect('GESTOR_A', 'notas_fiscais', fundA.id, 'ALLOW', matrix)
  await expectSelect('GESTOR_A', 'notas_fiscais', fundB.id, 'DENY', crossFund)
  await expectSelect('GESTOR_B', 'notas_fiscais', fundB.id, 'ALLOW', matrix)
  await expectSelect('GESTOR_B', 'notas_fiscais', fundA.id, 'DENY', crossFund)
  await expectSelect('CEDENTE_A', 'notas_fiscais', fundA.id, 'ALLOW', matrix)
  await expectSelect('CEDENTE_A', 'notas_fiscais', fundB.id, 'DENY', crossFund)
  await expectSelect('CEDENTE_B', 'notas_fiscais', fundB.id, 'ALLOW', matrix)
  await expectSelect('CEDENTE_B', 'notas_fiscais', fundA.id, 'DENY', crossFund)
  await expectCedent('CONSULTOR_A', cedentA.id, 'ALLOW', matrix)
  await expectCedent('CONSULTOR_A', cedentB.id, 'DENY', crossFund)
  await expectSelect('CONSULTOR_A', 'notas_fiscais', fundA.id, 'ALLOW', matrix, { id: noteA.id })
  await expectSelect('CONSULTOR_A', 'notas_fiscais', fundB.id, 'DENY', crossFund, { id: noteB.id })
  await expectSelect('SACADO_A', 'notas_fiscais', fundA.id, 'ALLOW', matrix, { id: noteA.id })
  await expectSelect('SACADO_A', 'notas_fiscais', fundB.id, 'DENY', crossFund, { id: noteB.id })
  await expectSelect('SUPER_ADMIN_PURO', 'notas_fiscais', fundA.id, 'DENY', matrix)
  await executeIdentityRegression()
  await expectSelect('SUPER_ADMIN_GESTOR_A', 'notas_fiscais', fundA.id, 'ALLOW', matrix)
  await expectSelect('SUPER_ADMIN_GESTOR_A', 'notas_fiscais', fundB.id, 'DENY', crossFund)

  await expectSelect('GESTOR_A', 'operacoes', fundA.id, 'ALLOW', matrix)
  await expectSelect('GESTOR_B', 'operacoes', fundA.id, 'DENY', crossFund)
  await expectSelect('CEDENTE_A', 'operacoes', fundA.id, 'ALLOW', matrix, { id: operationA.id })
  await expectSelect('CEDENTE_B', 'operacoes', fundA.id, 'DENY', crossFund)
  await expectSelect('SUPER_ADMIN_PURO', 'operacoes', fundA.id, 'DENY', matrix)
  await expectSelect('SUPER_ADMIN_GESTOR_A', 'operacoes', fundA.id, 'ALLOW', matrix)

  await expectByColumn('CEDENTE_A', 'devedores_solidarios', 'id', jointDebtorA.id, 'ALLOW', matrix)
  await expectByColumn('CEDENTE_A', 'devedores_solidarios', 'id', jointDebtorB.id, 'DENY', crossFund)
  await expectByColumn('GESTOR_A', 'devedores_solidarios', 'id', jointDebtorA.id, 'ALLOW', matrix)
  await expectByColumn('GESTOR_B', 'devedores_solidarios', 'id', jointDebtorA.id, 'DENY', crossFund)
  await expectDirectInsertDenied('CEDENTE_A', 'devedores_solidarios', {
    cedente_id: cedentA.id, nome: 'P265 WRITE DENIED', doc_numero: 'P265-X', cpf: '30000000003',
  }, matrix)

  for (const table of ['matching_resultados', 'conciliacao_resultados', 'exposicao_execucoes', 'risco_execucoes']) {
    await expectFinanceSelect('GESTOR_A', table, fundA.id, 'ALLOW', matrix)
    await expectFinanceSelect('GESTOR_B', table, fundA.id, 'DENY', crossFund)
  }
  for (const table of ['posicao_logistica_execucoes', 'posicao_logistica_resultados']) {
    await expectFinanceSelect('GESTOR_A', table, fundA.id, 'ALLOW', matrix)
    await expectFinanceSelect('GESTOR_B', table, fundA.id, 'DENY', crossFund)
  }

  await expectByColumn('CEDENTE_A', 'documento_requisito_instancias', 'nota_fiscal_id', noteA.id, 'ALLOW', matrix)
  await expectByColumn('CEDENTE_A', 'documento_requisito_instancias', 'nota_fiscal_id', noteB.id, 'DENY', crossFund)
  await expectByColumn('GESTOR_A', 'documento_requisito_instancias', 'nota_fiscal_id', noteA.id, 'ALLOW', matrix)
  await expectByColumn('GESTOR_B', 'documento_requisito_instancias', 'nota_fiscal_id', noteA.id, 'DENY', crossFund)

  await executeFinancialViewsMatrix()
  await executeEventAndAuditMatrix()
  await executeRawAndCrossWriteMatrix()

  const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false } })
  const anonSelect = await anon.from('fundos').select('id')
  record(matrix, { actor: 'ANON', resource: 'fundos', action: 'SELECT', expected: 'DENY', actual: !anonSelect.error && (anonSelect.data?.length || 0) > 0 ? 'ALLOW' : 'DENY', http_status: anonSelect.status, error_code: anonSelect.error?.code })
  const anonInsert = await anon.from('fundos').insert({ id: randomUUID(), nome: 'P265 ANON LEAK' })
  record(matrix, { actor: 'ANON', resource: 'fundos', action: 'INSERT', expected: 'DENY', actual: anonInsert.error ? 'DENY' : 'ALLOW', http_status: anonInsert.status, error_code: anonInsert.error?.code })

  await validateDirectApprovalBypass()

  const superAdminDirect = await actors.SUPER_ADMIN_PURO.client.from('operacoes').update({ status: 'aprovada' }).eq('id', dataset.riskCandidateOperation.id).select('id')
  record(matrix, { actor: 'SUPER_ADMIN_PURO', resource: 'operacoes', action: 'UPDATE_STATUS_DIRETO', expected: 'DENY', actual: superAdminDirect.error || !superAdminDirect.data?.length ? 'DENY' : 'ALLOW', http_status: superAdminDirect.status, error_code: superAdminDirect.error?.code })

  await expectRpcDenied('GESTOR_A', 'aprovar_operacao_atomica', { p_operacao_id: operationA.id, p_taxa_desconto: 3.99 }, matrix)
  await expectRpcDenied('GESTOR_A', 'aprovar_operacao_atomica_financeiro_v1', { p_operacao_id: operationA.id, p_taxa_desconto: 3.99 }, matrix)
  await expectRpcDenied('ANON', 'aprovar_operacao_atomica', { p_operacao_id: operationA.id, p_taxa_desconto: 3.99 }, matrix)
  await expectBlockedApprovalGate(operationA)

  await validateLogisticsDocumentsApi()

  const serviceRead = await admin.from('notas_fiscais').select('id').eq('fundo_id', fundA.id).limit(1)
  record(matrix, { actor: 'SERVICE_ROLE', resource: 'notas_fiscais', action: 'SELECT_SERVER_SIDE', expected: 'ALLOW', actual: !serviceRead.error && serviceRead.data?.length ? 'ALLOW' : 'DENY', http_status: serviceRead.status, error_code: serviceRead.error?.code })
}

async function executeRawAndCrossWriteMatrix() {
  for (const table of ['importacao_arquivos', 'importacao_linhas']) {
    const service = await admin.from(table).select('id').limit(1)
    record(matrix, { actor: 'SERVICE_ROLE', resource: table, action: 'SELECT_RAW_SERVER_SIDE', expected: 'ALLOW', actual: !service.error && service.data?.length ? 'ALLOW' : 'DENY', http_status: service.status, error_code: service.error?.code })
    const actor = await actors.GESTOR_A.client.from(table).select('id').limit(1)
    record(matrix, { actor: 'GESTOR_A', resource: table, action: 'SELECT_RAW_DIRETO', expected: 'DENY', actual: actor.error || !actor.data?.length ? 'DENY' : 'ALLOW', http_status: actor.status, error_code: actor.error?.code })
  }
  const noteBCurrent = await admin.from('notas_fiscais').select('status').eq('id', noteB.id).single()
  if (noteBCurrent.error) throw new Error(`Fixture da NF adversarial: ${noteBCurrent.error.message}`)
  const crossWrite = await actors.GESTOR_A.client.from('notas_fiscais').update({ status: noteBCurrent.data.status }).eq('id', noteB.id).select('id')
  record(crossFund, { actor: 'GESTOR_A', resource: 'notas_fiscais', action: 'UPDATE_FUNDO_B', expected: 'DENY', actual: crossWrite.error || !crossWrite.data?.length ? 'DENY' : 'ALLOW', http_status: crossWrite.status, error_code: crossWrite.error?.code })
  const operationA = dataset.operations.find((item) => item.note.fund.id === fundA.id)
  if (!operationA) throw new Error('Operacao do fundo A ausente no Golden V2.')
  const operationCurrent = await admin.from('operacoes').select('status').eq('id', operationA.id).single()
  if (operationCurrent.error) throw new Error(`Fixture da operacao principal: ${operationCurrent.error.message}`)
  const crossOperationWrite = await actors.GESTOR_B.client.from('operacoes').update({ status: operationCurrent.data.status }).eq('id', operationA.id).select('id')
  record(crossFund, { actor: 'GESTOR_B', resource: 'operacoes', action: 'UPDATE_FUNDO_A', expected: 'DENY', actual: crossOperationWrite.error || !crossOperationWrite.data?.length ? 'DENY' : 'ALLOW', http_status: crossOperationWrite.status, error_code: crossOperationWrite.error?.code })
}

async function validateDirectApprovalBypass() {
  const operationId = dataset.riskCandidateOperation.id
  const before = await admin.from('operacoes').select('status').eq('id', operationId).single()
  if (before.error) throw new Error(`Fixture descartavel do bypass: ${before.error.message}`)
  if (before.data.status === 'aprovada') throw new Error('Fixture descartavel do bypass ja esta aprovada.')

  const trigger = await db.query(`SELECT t.tgenabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='operacoes'
      AND t.tgname='operacoes_bloquear_aprovacao_financeira_direta'
      AND NOT t.tgisinternal`)
  record(matrix, {
    actor: 'DATABASE', resource: 'operacoes_bloquear_aprovacao_financeira_direta', action: 'TRIGGER_ATIVO',
    expected: 'ALLOW', actual: trigger.rows[0]?.tgenabled === 'O' ? 'ALLOW' : 'DENY',
    http_status: null, rows_visible: trigger.rowCount,
  })

  const direct = await actors.GESTOR_A.client.from('operacoes')
    .update({ status: 'aprovada' }).eq('id', operationId).select('id,status')
  const after = await admin.from('operacoes').select('status').eq('id', operationId).single()
  if (after.error) throw new Error(`Leitura posterior do bypass: ${after.error.message}`)

  const denied = Boolean(direct.error || !direct.data?.length) && after.data.status !== 'aprovada'
  record(matrix, {
    actor: 'GESTOR_A', resource: 'operacoes', action: 'UPDATE_STATUS_DIRETO', expected: 'DENY',
    actual: denied ? 'DENY' : 'ALLOW', http_status: direct.status, error_code: direct.error?.code,
    status_before: before.data.status, attempted_status: 'aprovada', status_after: after.data.status,
  })

  // Defesa de cleanup para o caso de regressao: o fixture descartavel nunca fica aprovado.
  if (after.data.status === 'aprovada') {
    await admin.from('operacoes').update({ status: before.data.status }).eq('id', operationId)
  }
}

async function executeFinancialViewsMatrix() {
  for (const table of ['estoque_atual', 'aquisicoes_atuais', 'liquidacoes_atuais', 'carteira_atual']) {
    await expectByColumn('GESTOR_A', table, 'fundo_id', fundA.id, 'ALLOW', matrix)
    await expectByColumn('GESTOR_B', table, 'fundo_id', fundA.id, 'DENY', crossFund)
    const update = await actors.GESTOR_A.client.from(table).update({ fundo_id: fundA.id }).eq('fundo_id', fundA.id).select('fundo_id')
    record(matrix, { actor: 'GESTOR_A', resource: table, action: 'UPDATE_VIEW', expected: 'DENY', actual: update.error || !update.data?.length ? 'DENY' : 'ALLOW', http_status: update.status, error_code: update.error?.code })
    const remove = await actors.GESTOR_A.client.from(table).delete().eq('fundo_id', fundA.id).select('fundo_id')
    record(matrix, { actor: 'GESTOR_A', resource: table, action: 'DELETE_VIEW', expected: 'DENY', actual: remove.error || !remove.data?.length ? 'DENY' : 'ALLOW', http_status: remove.status, error_code: remove.error?.code })
  }
}

async function executeEventAndAuditMatrix() {
  const eventBase = {
    fundo_id: fundA.id, cedente_id: cedentA.id, nota_fiscal_id: noteA.id,
    tipo_evento: 'P2_6_5_SACADO_EVENTO', categoria: 'sistema', ator_usuario_id: actors.SACADO_A.id,
    ator_nome_snapshot: 'SACADO_A', ator_perfil_snapshot: 'sacado', origem: 'p2_6_5',
    descricao: 'Evento sintetico local P2.6.5', metadata: { qa: 'P2.6.5' }, visibilidade: 'ambos',
  }
  const ownEvent = await actors.SACADO_A.client.from('eventos_dominio').insert(eventBase).select('id').maybeSingle()
  record(matrix, { actor: 'SACADO_A', resource: 'eventos_dominio', action: 'INSERT_PROPRIA_NF', expected: 'ALLOW', actual: !ownEvent.error && ownEvent.data ? 'ALLOW' : 'DENY', http_status: ownEvent.status, error_code: ownEvent.error?.code })
  const crossEvent = await actors.SACADO_A.client.from('eventos_dominio').insert({
    ...eventBase, fundo_id: fundB.id, cedente_id: cedentB.id, nota_fiscal_id: noteB.id,
  }).select('id').maybeSingle()
  record(crossFund, { actor: 'SACADO_A', resource: 'eventos_dominio', action: 'INSERT_NF_OUTRO_SACADO', expected: 'DENY', actual: crossEvent.error || !crossEvent.data ? 'DENY' : 'ALLOW', http_status: crossEvent.status, error_code: crossEvent.error?.code })

  const audit = await actors.GESTOR_A.client.from('logs_auditoria').insert({
    usuario_id: actors.GESTOR_A.id, ator_tipo: 'usuario', origem: 'p2_6_5', tipo_evento: 'P2_6_5_API',
    entidade_tipo: 'fundos', entidade_id: fundA.id, dados_depois: { qa: 'P2.6.5' },
  }).select('id').maybeSingle()
  record(matrix, { actor: 'GESTOR_A', resource: 'logs_auditoria', action: 'INSERT_PROPRIO', expected: 'ALLOW', actual: !audit.error && audit.data ? 'ALLOW' : 'DENY', http_status: audit.status, error_code: audit.error?.code })
  if (audit.data?.id) {
    const update = await actors.GESTOR_A.client.from('logs_auditoria').update({ origem: 'p2_6_5_mutated' }).eq('id', audit.data.id).select('id')
    record(matrix, { actor: 'GESTOR_A', resource: 'logs_auditoria', action: 'UPDATE', expected: 'DENY', actual: update.error || !update.data?.length ? 'DENY' : 'ALLOW', http_status: update.status, error_code: update.error?.code })
    const remove = await actors.GESTOR_A.client.from('logs_auditoria').delete().eq('id', audit.data.id).select('id')
    record(matrix, { actor: 'GESTOR_A', resource: 'logs_auditoria', action: 'DELETE', expected: 'DENY', actual: remove.error || !remove.data?.length ? 'DENY' : 'ALLOW', http_status: remove.status, error_code: remove.error?.code })
  }
}

async function expectBlockedApprovalGate(operation) {
  const { data: risk, error } = await admin.from('risco_execucoes')
    .select('id,operacao_id,assinatura_inputs,decisao,fundo_id')
    .eq('fundo_id', fundA.id).eq('decisao', 'BLOQUEADO').not('operacao_id', 'is', null).limit(1).maybeSingle()
  if (error) throw new Error(`Fixture do gate de risco: ${error.message}`)
  if (!risk) {
    record(matrix, { actor: 'GESTOR_A', resource: 'aprovar_operacao_com_risco_atomica', action: 'BLOQUEADO_SEM_CANDIDATO', expected: 'DENY', actual: 'DENY', http_status: null, error_code: 'FIXTURE_NOT_APPLICABLE' })
    return
  }
  const response = await actors.GESTOR_A.client.rpc('aprovar_operacao_com_risco_atomica', {
    p_operacao_id: risk.operacao_id || operation.id, p_taxa_desconto: 3.99,
    p_risco_execucao_id: risk.id, p_assinatura_inputs: risk.assinatura_inputs,
  })
  record(matrix, { actor: 'GESTOR_A', resource: 'aprovar_operacao_com_risco_atomica', action: 'APROVAR_RISCO_BLOQUEADO', expected: 'DENY', actual: response.error ? 'DENY' : 'ALLOW', http_status: response.status, error_code: response.error?.code })
}

async function validateLogisticsDocumentsApi() {
  const cte = await admin.from('ctes').select('id,fundo_id').eq('fundo_id', fundA.id).limit(1).maybeSingle()
  if (cte.error) throw new Error(`Fluxo logistico ctes: ${cte.error.message}`)
  if (!cte.data) throw new Error('Fixture CT-e do Golden V2 ausente.')
  await expectByColumn('GESTOR_A', 'ctes', 'id', cte.data.id, 'ALLOW', matrix)
  await expectByColumn('GESTOR_B', 'ctes', 'id', cte.data.id, 'DENY', crossFund)

  const proof = await db.query(`SELECT c.id,e.id AS entrega_id
    FROM public.canhotos c
    JOIN public.nota_fiscal_entregas e ON e.id=c.nota_fiscal_entrega_id
    JOIN public.notas_fiscais nf ON nf.id=e.nota_fiscal_id
    WHERE nf.fundo_id=$1 LIMIT 1`, [fundA.id])
  if (!proof.rows[0]) throw new Error('Fixture de comprovante de entrega do Golden V2 ausente.')
  await expectByColumn('GESTOR_A', 'canhotos', 'id', proof.rows[0].id, 'ALLOW', matrix)
  await expectByColumn('GESTOR_B', 'canhotos', 'id', proof.rows[0].id, 'DENY', crossFund)

  const cteLink = await admin.from('cte_notas_fiscais').select('cte_id,nota_fiscal_id').eq('cte_id', cte.data.id).limit(1).maybeSingle()
  record(matrix, { actor: 'SERVICE_ROLE', resource: 'cte_notas_fiscais', action: 'LINHAGEM_CTE_NF', expected: 'ALLOW', actual: !cteLink.error && cteLink.data ? 'ALLOW' : 'DENY', http_status: cteLink.status, error_code: cteLink.error?.code || (!cteLink.data ? 'FIXTURE_MISSING' : undefined) })
  if (cteLink.data) {
    await expectCteLink('GESTOR_A', cteLink.data.cte_id, cteLink.data.nota_fiscal_id, 'ALLOW', matrix)
    await expectCteLink('GESTOR_B', cteLink.data.cte_id, cteLink.data.nota_fiscal_id, 'DENY', crossFund)
    await expectCteLink('SUPER_ADMIN_PURO', cteLink.data.cte_id, cteLink.data.nota_fiscal_id, 'DENY', matrix)
    await expectCteLink('SUPER_ADMIN_GESTOR_A', cteLink.data.cte_id, cteLink.data.nota_fiscal_id, 'ALLOW', matrix)
  }
  const delivery = await admin.from('nota_fiscal_entregas').select('id,nota_fiscal_id').eq('id', proof.rows[0].entrega_id).limit(1).maybeSingle()
  record(matrix, { actor: 'SERVICE_ROLE', resource: 'nota_fiscal_entregas', action: 'LINHAGEM_LOGISTICA_NF', expected: 'ALLOW', actual: !delivery.error && delivery.data ? 'ALLOW' : 'DENY', http_status: delivery.status, error_code: delivery.error?.code || (!delivery.data ? 'FIXTURE_MISSING' : undefined) })

  const documental = await db.query(`SELECT
      vinculo.id AS vinculo_id,
      vinculo.documento_id,
      versao.id AS versao_id,
      requisito.id AS requisito_id
    FROM public.documento_vinculos vinculo
    LEFT JOIN public.documento_versoes versao ON versao.documento_id=vinculo.documento_id
    LEFT JOIN public.documento_requisito_instancias requisito ON requisito.nota_fiscal_id=vinculo.nota_fiscal_id
    WHERE vinculo.nota_fiscal_id=$1
    ORDER BY versao.numero_versao DESC NULLS LAST
    LIMIT 1`, [noteA.id])
  const doc = documental.rows[0]
  if (!doc?.documento_id || !doc?.versao_id || !doc?.vinculo_id || !doc?.requisito_id) {
    throw new Error('Fixtures documentais completas do fundo A ausentes.')
  }
  for (const [table, id] of [
    ['documentos_repositorio', doc.documento_id],
    ['documento_versoes', doc.versao_id],
    ['documento_vinculos', doc.vinculo_id],
    ['documento_requisito_instancias', doc.requisito_id],
    ['nota_fiscal_entregas', proof.rows[0].entrega_id],
  ]) {
    await expectScopedIdMatrix(table, id)
  }

  await db.query(`INSERT INTO public.eventos_entrega
    (id,nota_fiscal_entrega_id,tipo_evento,ator_tipo,dados)
    SELECT $1,$2,'cte_pendente','sistema',$3::jsonb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.eventos_entrega WHERE nota_fiscal_entrega_id=$2
    )`, [randomUUID(), proof.rows[0].entrega_id, JSON.stringify({ qa: artifactTag })])
  const event = await admin.from('eventos_entrega').select('id').eq('nota_fiscal_entrega_id', proof.rows[0].entrega_id).limit(1).maybeSingle()
  if (event.error) throw new Error(`Fixture eventos_entrega: ${event.error.message}`)
  if (!event.data?.id) throw new Error('Fixture eventos_entrega do fundo A ausente.')
  await expectScopedIdMatrix('eventos_entrega', event.data.id)

  await expectScopedIdMatrix('ctes', cte.data.id)
  await expectScopedIdMatrix('canhotos', proof.rows[0].id)
}

async function executeStorageMatrix() {
  const buckets = ['financeiro-importacoes', 'documentos-v2', 'notas-fiscais', 'contratos']
  const { data: listed, error: listError } = await admin.storage.listBuckets()
  for (const bucket of buckets) {
    const exists = !listError && listed?.some((item) => item.id === bucket)
    storage.push({ actor: 'SERVICE_ROLE', bucket, action: 'BUCKET_EXISTS', expected: 'ALLOW', actual: exists ? 'ALLOW' : 'DENY', status: exists ? 'PASS' : 'FAIL' })
  }

  const pathA = `${cedentA.cnpj}/p265-${noteA.id}.xml`
  const pathB = `${cedentB.cnpj}/p265-${noteB.id}.xml`
  await db.query(`UPDATE public.notas_fiscais SET arquivo_url=CASE id WHEN $1 THEN $2 WHEN $3 THEN $4 ELSE arquivo_url END WHERE id=ANY($5)`, [noteA.id, pathA, noteB.id, pathB, [noteA.id, noteB.id]])
  await storageUpload('CEDENTE_A', 'notas-fiscais', pathA, 'ALLOW')
  await storageUpload('SERVICE_ROLE', 'notas-fiscais', pathB, 'ALLOW')
  await storageDownload('CEDENTE_A', 'notas-fiscais', pathA, 'ALLOW')
  await storageDownload('CEDENTE_A', 'notas-fiscais', pathB, 'DENY', crossFund)

  for (const bucket of ['financeiro-importacoes', 'documentos-v2', 'contratos']) {
    const path = `p265/${fundB.id}/${randomUUID()}.txt`
    await storageUpload('SERVICE_ROLE', bucket, path, 'ALLOW')
    await storageDownload('ANON', bucket, path, 'DENY')
  }
  await storageUpload('GESTOR_A', 'contratos', `p265/${fundA.id}/${randomUUID()}.pdf`, 'DENY')
}

async function expectSelect(actorName, table, fundId, expected, target, extra = {}) {
  let query
  if (table === 'operacoes') {
    const source = await db.query(`SELECT o.id
      FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id=o.cedente_fundo_id
      WHERE cf.fundo_id=$1
      ORDER BY o.id
      LIMIT 2`, [fundId])
    const ids = extra.id ? [extra.id] : source.rows.map((item) => item.id)
    if (!ids.length) throw new Error(`Fixture de operacoes ausente para o fundo ${fundId}.`)
    query = actors[actorName].client.from(table).select('id').in('id', ids).limit(2)
  } else {
    query = actors[actorName].client.from(table).select('id,fundo_id').eq('fundo_id', fundId).limit(2)
    if (extra.id) query = query.eq('id', extra.id)
  }
  const response = await query
  const visible = !response.error && (response.data?.length || 0) > 0
  const actual = visible ? 'ALLOW' : 'DENY'
  record(target, { actor: actorName, resource: table, action: `SELECT_${fundId === fundA.id ? 'FUNDO_A' : 'FUNDO_B'}`, expected, actual, http_status: response.status, error_code: response.error?.code, rows_visible: response.data?.length || 0 })
}

async function expectFinanceSelect(actorName, table, fundId, expected, target) {
  const source = await admin.from(table).select('id,fundo_id').eq('fundo_id', fundId).limit(1).maybeSingle()
  if (source.error) throw new Error(`Fixture financeira ${table}/${fundId}: ${source.error.message}`)
  if (!source.data) throw new Error(`Fixture financeira ausente em ${table} para o fundo ${fundId}.`)
  await expectSelect(actorName, table, fundId, expected, target, { id: source.data.id })
}

async function expectByColumn(actorName, table, column, value, expected, target) {
  const response = await actors[actorName].client.from(table).select('id').eq(column, value).limit(2)
  const actual = !response.error && response.data?.length ? 'ALLOW' : 'DENY'
  record(target, {
    actor: actorName, resource: table, action: `SELECT_${column.toUpperCase()}`,
    expected, actual, http_status: response.status, error_code: response.error?.code,
    rows_visible: response.data?.length || 0,
  })
}

async function expectScopedIdMatrix(table, id) {
  await expectByColumn('GESTOR_A', table, 'id', id, 'ALLOW', matrix)
  await expectByColumn('GESTOR_B', table, 'id', id, 'DENY', crossFund)
  await expectByColumn('SUPER_ADMIN_PURO', table, 'id', id, 'DENY', matrix)
  await expectByColumn('SUPER_ADMIN_GESTOR_A', table, 'id', id, 'ALLOW', matrix)
}

async function expectCteLink(actorName, cteId, notaFiscalId, expected, target) {
  const response = await actors[actorName].client.from('cte_notas_fiscais')
    .select('cte_id,nota_fiscal_id')
    .eq('cte_id', cteId)
    .eq('nota_fiscal_id', notaFiscalId)
    .limit(1)
  record(target, {
    actor: actorName, resource: 'cte_notas_fiscais', action: 'SELECT_CTE_NOTA',
    expected, actual: !response.error && response.data?.length ? 'ALLOW' : 'DENY',
    http_status: response.status, error_code: response.error?.code,
    rows_visible: response.data?.length || 0,
  })
}

async function expectDirectInsertDenied(actorName, table, payload, target) {
  const response = await actors[actorName].client.from(table).insert(payload).select('id')
  record(target, {
    actor: actorName, resource: table, action: 'INSERT_DIRETO', expected: 'DENY',
    actual: response.error || !response.data?.length ? 'DENY' : 'ALLOW',
    http_status: response.status, error_code: response.error?.code,
  })
}

async function expectRpcDenied(actorName, routine, payload, target) {
  const client = actorName === 'ANON'
    ? createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : actors[actorName].client
  const response = await client.rpc(routine, payload)
  record(target, {
    actor: actorName, resource: routine, action: 'RPC_DIRECT', expected: 'DENY',
    actual: response.error ? 'DENY' : 'ALLOW', http_status: response.status, error_code: response.error?.code,
  })
}

async function expectCedent(actorName, cedenteId, expected, target) {
  const response = await actors[actorName].client.from('cedentes').select('id').eq('id', cedenteId)
  record(target, { actor: actorName, resource: 'cedentes', action: `SELECT_${cedenteId === cedentA.id ? 'CEDENTE_A' : 'CEDENTE_B'}`, expected, actual: !response.error && response.data?.length ? 'ALLOW' : 'DENY', http_status: response.status, error_code: response.error?.code })
}

async function expectOwnRole(actorName, expected) {
  const response = await actors[actorName].client.from('usuario_papeis').select('papel').eq('usuario_id', actors[actorName].id)
  record(matrix, { actor: actorName, resource: 'usuario_papeis', action: 'SELECT_OWN', expected, actual: !response.error && response.data?.length ? 'ALLOW' : 'DENY', http_status: response.status, error_code: response.error?.code })
}

async function executeIdentityRegression() {
  const identityActors = ['GESTOR_A', 'CEDENTE_A', 'CONSULTOR_A', 'SACADO_A', 'SUPER_ADMIN_PURO', 'SUPER_ADMIN_GESTOR_A']
  for (const actorName of identityActors) {
    const ownProfile = await actors[actorName].client.from('profiles').select('id').eq('id', actors[actorName].id)
    record(matrix, {
      actor: actorName, resource: 'profiles', action: 'SELECT_OWN', expected: 'ALLOW',
      actual: !ownProfile.error && ownProfile.data?.length ? 'ALLOW' : 'DENY',
      http_status: ownProfile.status, error_code: ownProfile.error?.code,
    })

    const otherProfile = await actors[actorName].client.from('profiles').select('id').eq('id', actors.GESTOR_B.id)
    record(matrix, {
      actor: actorName, resource: 'profiles', action: 'SELECT_OTHER', expected: actorName === 'GESTOR_B' ? 'ALLOW' : 'DENY',
      actual: !otherProfile.error && otherProfile.data?.length ? 'ALLOW' : 'DENY',
      http_status: otherProfile.status, error_code: otherProfile.error?.code,
    })

    await expectOwnRole(actorName, 'ALLOW')
    const otherRoles = await actors[actorName].client.from('usuario_papeis').select('papel').eq('usuario_id', actors.GESTOR_B.id)
    record(matrix, {
      actor: actorName, resource: 'usuario_papeis', action: 'SELECT_OTHER', expected: 'DENY',
      actual: !otherRoles.error && otherRoles.data?.length ? 'ALLOW' : 'DENY',
      http_status: otherRoles.status, error_code: otherRoles.error?.code,
    })
  }

  const insertedProfileId = randomUUID()
  const insertProfile = await actors.GESTOR_A.client.from('profiles').insert({
    id: insertedProfileId, role: 'cedente', nome_completo: 'P2.6.8.1 bloqueado',
    email: `p2681-${insertedProfileId}@invalid.example`, status: 'ativo',
  }).select('id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'profiles', action: 'INSERT_OTHER', expected: 'DENY',
    actual: insertProfile.error || !insertProfile.data?.length ? 'DENY' : 'ALLOW',
    http_status: insertProfile.status, error_code: insertProfile.error?.code,
  })

  const updateOtherProfile = await actors.GESTOR_A.client.from('profiles')
    .update({ nome_completo: 'P2.6.8.1 bloqueado' }).eq('id', actors.GESTOR_B.id).select('id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'profiles', action: 'UPDATE_OTHER', expected: 'DENY',
    actual: updateOtherProfile.error || !updateOtherProfile.data?.length ? 'DENY' : 'ALLOW',
    http_status: updateOtherProfile.status, error_code: updateOtherProfile.error?.code,
  })

  const updateOwnProfile = await actors.GESTOR_A.client.from('profiles')
    .update({ nome_completo: 'P2.6.8.1 bloqueado' }).eq('id', actors.GESTOR_A.id).select('id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'profiles', action: 'UPDATE_OWN', expected: 'DENY',
    actual: updateOwnProfile.error || !updateOwnProfile.data?.length ? 'DENY' : 'ALLOW',
    http_status: updateOwnProfile.status, error_code: updateOwnProfile.error?.code,
  })

  const deleteOtherProfile = await actors.GESTOR_A.client.from('profiles').delete().eq('id', actors.GESTOR_B.id).select('id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'profiles', action: 'DELETE_OTHER', expected: 'DENY',
    actual: deleteOtherProfile.error || !deleteOtherProfile.data?.length ? 'DENY' : 'ALLOW',
    http_status: deleteOtherProfile.status, error_code: deleteOtherProfile.error?.code,
  })

  const insertRole = await actors.GESTOR_A.client.from('usuario_papeis').insert({
    usuario_id: actors.GESTOR_A.id, papel: 'super_admin', ativo: true, origem: 'administracao',
  }).select('usuario_id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'usuario_papeis', action: 'INSERT_DIRECT', expected: 'DENY',
    actual: insertRole.error || !insertRole.data?.length ? 'DENY' : 'ALLOW',
    http_status: insertRole.status, error_code: insertRole.error?.code,
  })

  const updateRole = await actors.GESTOR_A.client.from('usuario_papeis')
    .update({ origem: 'administracao' }).eq('usuario_id', actors.GESTOR_A.id).select('usuario_id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'usuario_papeis', action: 'UPDATE_DIRECT', expected: 'DENY',
    actual: updateRole.error || !updateRole.data?.length ? 'DENY' : 'ALLOW',
    http_status: updateRole.status, error_code: updateRole.error?.code,
  })

  const deleteRole = await actors.GESTOR_A.client.from('usuario_papeis')
    .delete().eq('usuario_id', actors.GESTOR_A.id).select('usuario_id')
  record(matrix, {
    actor: 'GESTOR_A', resource: 'usuario_papeis', action: 'DELETE_DIRECT', expected: 'DENY',
    actual: deleteRole.error || !deleteRole.data?.length ? 'DENY' : 'ALLOW',
    http_status: deleteRole.status, error_code: deleteRole.error?.code,
  })

  const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const anonProfile = await anon.from('profiles').select('id').limit(1)
  record(matrix, {
    actor: 'ANON', resource: 'profiles', action: 'SELECT', expected: 'DENY',
    actual: !anonProfile.error && anonProfile.data?.length ? 'ALLOW' : 'DENY',
    http_status: anonProfile.status, error_code: anonProfile.error?.code,
  })
  const anonRoles = await anon.from('usuario_papeis').select('papel').limit(1)
  record(matrix, {
    actor: 'ANON', resource: 'usuario_papeis', action: 'SELECT', expected: 'DENY',
    actual: !anonRoles.error && anonRoles.data?.length ? 'ALLOW' : 'DENY',
    http_status: anonRoles.status, error_code: anonRoles.error?.code,
  })
}

async function storageUpload(actorName, bucket, path, expected) {
  const client = actorName === 'SERVICE_ROLE' ? admin : actors[actorName]?.client
  const response = await client.storage.from(bucket).upload(path, new Blob(['P2.6.5 local fixture'], { type: 'text/plain' }), { upsert: true })
  const actual = response.error ? 'DENY' : 'ALLOW'
  record(storage, { actor: actorName, bucket, action: 'UPLOAD', expected, actual, http_status: response.error ? 400 : 200, error_code: response.error?.name })
}

async function storageDownload(actorName, bucket, path, expected, also = null) {
  const client = actorName === 'ANON' ? createClient(apiUrl, anonKey, { auth: { persistSession: false } }) : actors[actorName]?.client
  const response = await client.storage.from(bucket).download(path)
  const entry = { actor: actorName, bucket, action: 'DOWNLOAD', expected, actual: response.error ? 'DENY' : 'ALLOW', http_status: response.error ? 400 : 200, error_code: response.error?.name }
  record(storage, entry)
  if (also) also.push({ ...entry, resource: `storage.${bucket}`, status: entry.expected === entry.actual ? 'PASS' : 'FAIL' })
}

function record(target, entry) {
  const complete = { ...entry, status: entry.expected === entry.actual ? 'PASS' : 'FAIL' }
  target.push(complete)
  if (complete.expected === 'DENY' && complete.actual === 'ALLOW') criticalLeak ||= `${complete.actor}:${complete.resource || complete.bucket}:${complete.action}`
}

function assertNoCriticalFailures() {
  if (criticalLeak) throw new Error(`FAIL CRITICO: acesso indevido ${criticalLeak}.`)
  const failures = [...matrix, ...crossFund, ...storage].filter((item) => item.status !== 'PASS')
  if (failures.length) throw new Error(`Matriz possui ${failures.length} divergencia(s): ${failures.map((item) => `${item.actor}/${item.resource || item.bucket}/${item.action}`).join(', ')}`)
}

function writeArtifacts(status, failure = null) {
  const matrixName = artifactPhase === 'p2-6-6' ? 'access-matrix-p2-6-6.json' : `api-auth-matrix-${artifactPhase}.json`
  writeJson(`docs/financeiro/${matrixName}`, { schema: `bw-antecipa-${artifactPhase}-api-auth-v1`, status, actors: actorSessions, checks: matrix, failure })
  writeJson(`docs/financeiro/cross-fund-api-${artifactPhase}.json`, { schema: `bw-antecipa-${artifactPhase}-cross-fund-v1`, status, checks: crossFund, zero_leak: !criticalLeak, failure })
  writeJson(`docs/financeiro/storage-api-${artifactPhase}.json`, { schema: `bw-antecipa-${artifactPhase}-storage-v1`, status, checks: storage, failure })
}

function writeJson(path, value) {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

#!/usr/bin/env node

import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import puppeteer from 'puppeteer-core'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const PREFIX = `QA_C2_${Date.now()}_`
const CHROME_PATH = process.env.QA_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const args = new Map(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.split('=')
  return [key, rest.join('=')]
}))
const envPath = args.get('--env')
if (!envPath) throw new Error('Informe --env=<caminho do .env.homolog>.')
if (args.get('--confirm') !== EXPECTED_PROJECT_REF) throw new Error('Confirmacao explicita de homologacao ausente.')
loadEnv(envPath)

const baseUrl = args.get('--base-url') || 'https://homolog.bw-antecipa.better-with.tech'
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
if (apiRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto de homologacao inesperado: ${apiRef}`)
if (apiRef === required('SUPABASE_PRODUCTION_PROJECT_REF')) throw new Error('Projeto de producao bloqueado.')

const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')
const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), clientOptions())
const checks = []
const users = []
const ids = {
  cedentes: [], cedenteFundos: [], assignments: [], links: [], rates: [], escrows: [],
  notes: [], operations: [], documents: [], versions: [], documentLinks: [], instances: [],
}
let browser = null
let baseline = null

await db.connect()
const cleanupOnlyPrefix = args.get('--cleanup-prefix')
if (cleanupOnlyPrefix) {
  if (!/^QA_C2_\d+_$/.test(cleanupOnlyPrefix)) throw new Error('Prefixo de cleanup invalido.')
  await hydrateIdsForCleanup(cleanupOnlyPrefix)
  const cleanup = await cleanupFixture(cleanupOnlyPrefix)
  console.log(JSON.stringify({ project_ref: apiRef, cleanup_prefix: cleanupOnlyPrefix, ...cleanup }, null, 2))
  await db.end()
  process.exit(cleanup.ok ? 0 : 1)
}
try {
  baseline = await snapshot()
  const template = await loadTemplate()
  const actors = await createActors()
  const fixture = await seedFixture(template, actors)
  ok('Massa C2 sintetica criada somente em homologacao', true, { prefix: PREFIX, project_ref: apiRef })

  const consultant = await authenticatedClient(actors.consultant)
  const cedenteAClient = await authenticatedClient(actors.cedenteA)
  const gestor = await authenticatedClient(actors.gestor)

  await verifySearch(consultant.client, fixture)
  await verifyBrowser(actors.consultant, fixture)
  await verifySecurityAndOperations(consultant.client, cedenteAClient.client, gestor.client, template, fixture, actors)
  await verifyAuditAndIsolation(fixture, actors)
} catch (error) {
  console.error(JSON.stringify({ project_ref: apiRef, prefix: PREFIX, error: safeError(error), checks }, null, 2))
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => undefined)
  const cleanup = await cleanupFixture().catch((error) => ({ ok: false, error: safeError(error) }))
  if (cleanup.ok) {
    checks.push({ name: 'Cleanup C2 sem residuo', status: 'PASS', evidence: cleanup })
  } else {
    checks.push({ name: 'Cleanup C2 sem residuo', status: 'FAIL', evidence: cleanup })
    process.exitCode = 1
  }
  const result = {
    project_ref: apiRef,
    production_changed: false,
    prefix: PREFIX,
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }
  console.log(JSON.stringify(result, null, 2))
  await db.end()
}

async function createActors() {
  const actors = {}
  for (const [key, role] of [
    ['consultant', 'consultor'], ['cedenteA', 'cedente'], ['cedenteB', 'cedente'],
    ['cedenteC', 'cedente'], ['cedenteD', 'cedente'], ['gestor', 'gestor'],
  ]) {
    const email = `${PREFIX.toLowerCase()}${key}@example.invalid`
    const password = `Qa!${randomUUID().replaceAll('-', '').slice(0, 24)}`
    const name = `${PREFIX}${key}`
    const created = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { role, nome_completo: name },
    })
    if (created.error || !created.data.user) throw new Error(`Falha ao criar ator ${key}: ${created.error?.message || 'retorno vazio'}`)
    const actor = { id: created.data.user.id, email, password, role, name, totpSecret: null }
    users.push(actor.id)
    actors[key] = actor
    await db.query(`update public.profiles set role=$2, nome_completo=$3, status='ativo' where id=$1`, [actor.id, role, name])
  }
  actors.consultant.totpSecret = await enrollTotp(actors.consultant)
  return actors
}

async function loadTemplate() {
  const row = (await db.query(`
    select f.id fundo_id, po.id politica_id, pov.id versao_id, pov.versao,
      pov.configuracao, pov.conteudo_hash, pov.aceite_sacado_obrigatorio,
      pov.metodo_calculo_financeiro
    from public.fundos f
    join public.politicas_operacionais po on po.fundo_id=f.id and po.status='ativa'
    join public.politica_operacional_versoes pov on pov.politica_operacional_id=po.id
      and pov.status='publicada' and pov.publicada_em is not null and pov.vigente_ate is null
    where coalesce(f.ativo,true)=true
    order by (select count(*) from public.politica_requisitos_documentais pr where pr.politica_operacional_versao_id=pov.id and pr.ativo=true and pr.escopo='nf_pre_cessao') asc,
      f.created_at asc
    limit 1
  `)).rows[0]
  if (!row) throw new Error('Nenhuma politica publicada ativa encontrada em homologacao.')
  row.snapshot = {
    ...row.configuracao,
    calculo_financeiro: {
      metodo: row.metodo_calculo_financeiro || 'LEGADO_MENSAL_DIAS_REAIS_30',
      versao_motor: 1,
    },
  }
  row.requirements = (await db.query(`
    select pr.id, pr.documento_tipo_id, pr.tipo_documento_codigo, pr.escopo,
      pr.obrigatorio, pr.formatos_aceitos, pr.nivel_validacao, pr.quantidade_minima,
      pr.responsavel_upload, pr.responsavel_aprovacao
    from public.politica_requisitos_documentais pr
    where pr.politica_operacional_versao_id=$1 and pr.ativo=true and pr.escopo='nf_pre_cessao'
      and (pr.obrigatorio=true or pr.bloqueia_fluxo=true)
    order by pr.ordem
  `, [row.versao_id])).rows
  return row
}

async function seedFixture(template, actors) {
  const seed = String(Date.now()).slice(-9)
  const configs = [
    { key: 'A', actor: actors.cedenteA, status: 'ativo', linked: true, name: `${PREFIX}Árvore Ágil Comercial` },
    { key: 'B', actor: actors.cedenteB, status: 'ativo', linked: true, name: `${PREFIX}Beta Saúde` },
    { key: 'C', actor: actors.cedenteC, status: 'ativo', linked: false, name: `${PREFIX}Cedente Oculto` },
    { key: 'D', actor: actors.cedenteD, status: 'pendente', linked: true, name: `${PREFIX}Cedente Pendente` },
  ]
  const cedentes = {}
  await db.query('begin')
  try {
    for (let index = 0; index < configs.length; index += 1) {
      const config = configs[index]
      const cnpj = makeCnpj(`8${seed}${index + 1}`)
      const cedente = (await db.query(`
        insert into public.cedentes (user_id,cnpj,razao_social,nome_fantasia,status,onboarding_concluido_em)
        values ($1,$2,$3,$4,$5::public.cedente_status,case when $5::text='ativo' then now() else null end) returning id,cnpj,razao_social,nome_fantasia,status
      `, [config.actor.id, cnpj, config.name, `${PREFIX}${config.key}`, config.status])).rows[0]
      ids.cedentes.push(cedente.id)
      const cedenteFundo = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status,observacoes) values ($1,$2,'ativo',$3) returning id`, [cedente.id, template.fundo_id, PREFIX])).rows[0]
      ids.cedenteFundos.push(cedenteFundo.id)
      const assignment = (await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id,politica_operacional_id,status,atribuido_por,motivo) values ($1,$2,'ativa',$3,$4) returning id`, [cedenteFundo.id, template.politica_id, actors.gestor.id, PREFIX])).rows[0]
      ids.assignments.push(assignment.id)
      const rate = (await db.query(`insert into public.taxas_cedente (cedente_id,prazo_min,prazo_max,taxa_percentual) values ($1,0,360,1.5) returning id`, [cedente.id])).rows[0]
      ids.rates.push(rate.id)
      const escrow = (await db.query(`insert into public.contas_escrow (cedente_id,identificador,saldo_disponivel,status) values ($1,$2,100000,'ativa') returning id`, [cedente.id, `${PREFIX}${config.key}`])).rows[0]
      ids.escrows.push(escrow.id)
      if (config.linked) {
        const link = (await db.query(`insert into public.consultor_cedente (consultor_id,cedente_id,comissao_percentual,status) values ($1,$2,0,'ativo') returning id`, [actors.consultant.id, cedente.id])).rows[0]
        ids.links.push(link.id)
      }
      cedentes[config.key] = { ...cedente, cedenteFundoId: cedenteFundo.id, assignmentId: assignment.id, escrowId: escrow.id }
    }
    await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true) on conflict do nothing`, [actors.gestor.id, template.fundo_id])

    const notes = {}
    for (const [key, cedenteKey, value] of [
      ['aNew', 'A', 1100], ['aReusable', 'A', 1200], ['aReserved', 'A', 1300], ['aConcurrent', 'A', 1400],
      ['aCedenteRegression', 'A', 1500], ['bNew', 'B', 2100], ['cUnauthorized', 'C', 3100],
    ]) {
      notes[key] = await insertNote(cedentes[cedenteKey], template, `${PREFIX}${key}`, value)
      await satisfyRequirements(notes[key], cedentes[cedenteKey], template, actors.gestor.id)
    }
    const rejected = await insertHistoricalOperation(cedentes.A, template, notes.aReusable.id, 'reprovada', `${PREFIX}REJECTED`)
    const reserved = await insertHistoricalOperation(cedentes.A, template, notes.aReserved.id, 'solicitada', `${PREFIX}RESERVED`)
    await db.query('commit')
    return { cedentes, notes, rejected, reserved, template }
  } catch (error) {
    await db.query('rollback')
    throw error
  }
}

async function insertNote(cedente, template, numero, value) {
  const row = (await db.query(`
    insert into public.notas_fiscais (
      cedente_id,cedente_fundo_id,fundo_id,numero_nf,serie,chave_acesso,data_emissao,data_vencimento,
      cnpj_emitente,razao_social_emitente,cnpj_destinatario,razao_social_destinatario,valor_bruto,valor_liquido,status
    ) values ($1,$2,$3,$4,'1',$5,current_date,current_date+60,$6,$7,$8,$9,$10,$10,'aprovada') returning id,numero_nf,valor_bruto
  `, [cedente.id, cedente.cedenteFundoId, template.fundo_id, numero, `${Date.now()}${randomUUID().replaceAll('-', '').replace(/\D/g, '').padEnd(30, '0')}`.slice(0, 44), cedente.cnpj, cedente.razao_social, makeCnpj(`7${String(Date.now()).slice(-9)}9`), `${PREFIX}Sacado`, value])).rows[0]
  ids.notes.push(row.id)
  return row
}

async function satisfyRequirements(note, cedente, template, actorId) {
  for (const requirement of template.requirements) {
    const documentId = randomUUID()
    const versionId = randomUUID()
    const documentLinkId = randomUUID()
    const instanceId = randomUUID()
    ids.documents.push(documentId)
    ids.versions.push(versionId)
    ids.documentLinks.push(documentLinkId)
    ids.instances.push(instanceId)
    await db.query(`insert into public.documentos_repositorio (id,documento_tipo_id,status,criado_por) values ($1,$2,'enviado',$3)`, [documentId, requirement.documento_tipo_id, actorId])
    await db.query(`insert into public.documento_versoes (id,documento_id,numero_versao,bucket,path,nome_original,mime_type,tamanho_bytes,sha256,status,enviado_por) values ($1,$2,1,'documentos-v2',$3,$4,'application/octet-stream',16,$5,'enviado',$6)`, [versionId, documentId, `qa/c2/${PREFIX}/${versionId}`, `${PREFIX}${requirement.tipo_documento_codigo}`, 'a'.repeat(64), actorId])
    await db.query(`insert into public.documento_vinculos (id,documento_id,nota_fiscal_id,cedente_id,principal) values ($1,$2,$3,$4,true)`, [documentLinkId, documentId, note.id, cedente.id])
    await db.query(`
      insert into public.documento_requisito_instancias (
        id,politica_requisito_id,politica_operacional_id,politica_operacional_versao_id,politica_versao,
        documento_tipo_id,tipo_documento_codigo_snapshot,escopo_snapshot,nota_fiscal_id,cedente_id,status,
        obrigatorio,formatos_aceitos_snapshot,nivel_validacao_snapshot,quantidade_minima_snapshot,
        responsavel_upload_snapshot,responsavel_aprovacao_snapshot,documento_id,versao_aprovada_id,satisfeito_em
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'satisfeito',$11,$12,$13,$14,$15,$16,$17,$18,now())
    `, [instanceId, requirement.id, template.politica_id, template.versao_id, template.versao,
      requirement.documento_tipo_id, requirement.tipo_documento_codigo, requirement.escopo, note.id, cedente.id,
      requirement.obrigatorio, requirement.formatos_aceitos || [], requirement.nivel_validacao,
      requirement.quantidade_minima || 1, requirement.responsavel_upload, requirement.responsavel_aprovacao,
      documentId, versionId])
  }
}

async function insertHistoricalOperation(cedente, template, noteId, status, key) {
  const operation = (await db.query(`
    insert into public.operacoes (
      cedente_id,conta_escrow_id,valor_bruto_total,taxa_desconto,prazo_dias,valor_liquido_desembolso,
      data_vencimento,status,cedente_fundo_id,politica_operacional_id,politica_operacional_versao_id,
      politica_atribuicao_id,politica_versao,politica_snapshot,politica_snapshot_hash,
      contexto_configuracao_status,contexto_capturado_em,aceite_sacado_exigido,aceite_sacado_status,
      aceite_sacado_em,solicitacao_idempotency_key
    ) values ($1,$2,1000,1,60,990,current_date+60,$3,$4,$5,$6,$7,$8,$9,$10,'completo',now(),false,'dispensado',now(),$11)
    returning id
  `, [cedente.id, cedente.escrowId, status, cedente.cedenteFundoId, template.politica_id, template.versao_id,
    cedente.assignmentId, template.versao, template.snapshot, template.conteudo_hash, key])).rows[0]
  ids.operations.push(operation.id)
  await db.query(`insert into public.operacoes_nfs (operacao_id,nota_fiscal_id) values ($1,$2)`, [operation.id, noteId])
  return operation.id
}

async function verifySearch(client, fixture) {
  const search = async (term, limit = 10) => {
    const { data, error } = await client.rpc('buscar_cedentes_elegiveis_consultor', { p_termo: term, p_limite: limit })
    if (error) throw error
    return data || []
  }
  const all = await search(null, 100)
  ok('Busca limita o retorno a no maximo 10 Cedentes', all.length <= 10)
  ok('Busca vazia inclui Cedentes A e B vinculados', all.some((row) => row.id === fixture.cedentes.A.id) && all.some((row) => row.id === fixture.cedentes.B.id))
  ok('Busca nao expoe Cedente sem vinculo nem Cedente pendente', !all.some((row) => row.id === fixture.cedentes.C.id) && !all.some((row) => row.id === fixture.cedentes.D.id))
  ok('Busca com menos de 4 caracteres retorna vazio', (await search('arv')).length === 0)
  ok('Busca ignora acento', (await search('arvore')).some((row) => row.id === fixture.cedentes.A.id))
  ok('Busca ignora caixa', (await search('BETA')).some((row) => row.id === fixture.cedentes.B.id))
  ok('Busca normaliza CNPJ', (await search(fixture.cedentes.A.cnpj.replace(/\D/g, '').slice(0, 8))).some((row) => row.id === fixture.cedentes.A.id))
  const anon = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), clientOptions())
  const denied = await anon.rpc('buscar_cedentes_elegiveis_consultor', { p_termo: null, p_limite: 10 })
  ok('Busca anonima e negada', Boolean(denied.error), denied.error?.message)
}

async function verifyBrowser(actor, fixture) {
  browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await loginWithTotp(page, actor)
  await page.goto(`${baseUrl}/consultor/operacoes/nova`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.waitForFunction(() => document.body.innerText.includes('Selecione um Cedente'), { timeout: 30_000 })
  ok('Seletor de Cedente e obrigatorio no fluxo do Consultor', (await page.evaluate(() => document.body.innerText)).includes('Cedente *'))

  await clickButtonByText(page, 'Selecione um Cedente')
  const input = await page.waitForSelector('input[aria-label="Pesquisar Cedente"]', { timeout: 15_000 })
  await input.type('arv')
  await page.waitForFunction(() => document.body.innerText.includes('Digite ao menos 4 caracteres'), { timeout: 10_000 })
  ok('UI orienta minimo de 4 caracteres', true)
  await input.type('ore')
  await page.waitForFunction((prefix) => document.body.innerText.includes(`${prefix}A`), { timeout: 20_000 }, PREFIX)
  const bodySearch = await page.evaluate(() => document.body.innerText)
  ok('UI encontra Cedente por termo sem acento', bodySearch.includes(`${PREFIX}A`))
  ok('UI nao mostra Cedente nao vinculado', !bodySearch.includes(`${PREFIX}C`))
  await input.press('ArrowDown')
  await input.press('Enter')
  await page.waitForFunction((cedenteId) => new URL(location.href).searchParams.get('cedente') === cedenteId, { timeout: 30_000 }, fixture.cedentes.A.id)
  await page.waitForFunction((number) => document.body.innerText.includes(number), { timeout: 30_000 }, fixture.notes.aNew.numero_nf)
  ok('Teclado seleciona Cedente A e carrega apenas suas NFs', !(await page.evaluate((number) => document.body.innerText.includes(number), fixture.notes.bNew.numero_nf)))

  await clickButtonByText(page, 'Selecionar elegiveis da pagina')
  await page.waitForFunction(() => document.body.innerText.includes('selecionada(s)') && !document.body.innerText.includes('0 selecionada(s)'), { timeout: 15_000 })
  await clickButtonContaining(page, `${PREFIX}A`)
  const switchInput = await page.waitForSelector('input[aria-label="Pesquisar Cedente"]', { timeout: 15_000 })
  await switchInput.type('BETA')
  await page.waitForFunction((prefix) => document.body.innerText.includes(`${prefix}B`), { timeout: 20_000 }, PREFIX)
  await switchInput.press('ArrowDown')
  await switchInput.press('Enter')
  await page.waitForFunction((cedenteId) => new URL(location.href).searchParams.get('cedente') === cedenteId, { timeout: 30_000 }, fixture.cedentes.B.id)
  await page.waitForFunction((number) => document.body.innerText.includes(number), { timeout: 30_000 }, fixture.notes.bNew.numero_nf)
  const switched = await page.evaluate((aNumber) => ({ text: document.body.innerText, hasA: document.body.innerText.includes(aNumber) }), fixture.notes.aNew.numero_nf)
  ok('Troca A para B limpa selecao e contexto anterior', switched.text.includes('0 selecionada(s)') && !switched.hasA)
  ok('UI exibe estado sem resultado', await verifyZeroResult(page))

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 })
  await page.reload({ waitUntil: 'networkidle2', timeout: 60_000 })
  const responsive = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ok('Seletor permanece responsivo em viewport mobile', responsive)
  ok('Nenhuma excecao JavaScript ocorreu no smoke visual', pageErrors.length === 0, pageErrors)
}

async function verifyZeroResult(page) {
  await clickButtonContaining(page, `${PREFIX}B`)
  const input = await page.waitForSelector('input[aria-label="Pesquisar Cedente"]', { timeout: 15_000 })
  await input.type('ZZZZ-NENHUM-C2')
  await page.waitForFunction(() => document.body.innerText.includes('Nenhum Cedente ativo encontrado'), { timeout: 20_000 })
  return true
}

async function verifySecurityAndOperations(consultant, cedenteAClient, gestor, template, fixture, actors) {
  const rpc = (client, cedente, noteIds, key) => client.rpc('solicitar_operacao_antecipacao_atomica', rpcArgs(template, cedente, noteIds, key))

  const cross = await rpc(consultant, fixture.cedentes.A, [fixture.notes.bNew.id], `${PREFIX}CROSS_TENANT_123456`)
  ok('Ataque Cedente A com NF B e negado', Boolean(cross.error), cross.error?.message)
  const unauthorized = await rpc(consultant, fixture.cedentes.C, [fixture.notes.cUnauthorized.id], `${PREFIX}UNLINKED_123456789`)
  ok('Ataque com UUID de Cedente sem vinculo e negado', Boolean(unauthorized.error) && /vinculo ativo/i.test(unauthorized.error.message), unauthorized.error?.message)
  const active = await rpc(consultant, fixture.cedentes.A, [fixture.notes.aReserved.id], `${PREFIX}ACTIVE_1234567890`)
  ok('NF reservada por operacao ativa e negada com P14', Boolean(active.error) && /NF_ALREADY_LINKED_TO_ACTIVE_OPERATION/.test(active.error.message), active.error?.message)

  const operationA = await rpc(consultant, fixture.cedentes.A, [fixture.notes.aNew.id, fixture.notes.aReusable.id], `${PREFIX}A_1234567890123456`)
  if (operationA.error) throw operationA.error
  ids.operations.push(operationA.data.operacao_id)
  ok('Consultor cria operacao A com NF nova e NF reutilizada de reprovada', operationA.data.status === 'solicitada')

  const operationB = await rpc(consultant, fixture.cedentes.B, [fixture.notes.bNew.id], `${PREFIX}B_1234567890123456`)
  if (operationB.error) throw operationB.error
  ids.operations.push(operationB.data.operacao_id)
  ok('Consultor cria operacao B apos troca de Cedente', operationB.data.status === 'solicitada')

  const concurrencyKeys = [`${PREFIX}CONCURRENCY_1_123456`, `${PREFIX}CONCURRENCY_2_123456`]
  const concurrent = await Promise.all(concurrencyKeys.map((key) => rpc(consultant, fixture.cedentes.A, [fixture.notes.aConcurrent.id], key)))
  for (const result of concurrent) if (!result.error && result.data?.operacao_id) ids.operations.push(result.data.operacao_id)
  ok('Concorrencia na mesma NF produz exatamente um vencedor', concurrent.filter((result) => !result.error).length === 1, concurrent.map((result) => result.error?.message || result.data?.operacao_id))

  const cedenteRegression = await rpc(cedenteAClient, fixture.cedentes.A, [fixture.notes.aCedenteRegression.id], `${PREFIX}CEDENTE_123456789012`)
  if (cedenteRegression.error) throw cedenteRegression.error
  ids.operations.push(cedenteRegression.data.operacao_id)
  ok('Regressao Cedente: criacao propria continua funcionando', cedenteRegression.data.status === 'solicitada')

  const operationIds = [operationA.data.operacao_id, operationB.data.operacao_id, cedenteRegression.data.operacao_id]
  const gestorRead = await gestor.from('operacoes').select('id,cedente_id').in('id', operationIds)
  ok('Regressao Gestor: operacoes C2 permanecem visiveis', !gestorRead.error && gestorRead.data?.length === operationIds.length, gestorRead.error?.message)
}

function rpcArgs(template, cedente, noteIds, key) {
  return {
    p_cedente_id: cedente.id,
    p_cedente_fundo_id: cedente.cedenteFundoId,
    p_politica_operacional_id: template.politica_id,
    p_politica_operacional_versao_id: template.versao_id,
    p_politica_versao: template.versao,
    p_politica_snapshot: template.snapshot,
    p_politica_snapshot_hash: template.conteudo_hash,
    p_aceite_sacado_exigido: false,
    p_aceite_sacado_status: 'dispensado',
    p_nota_fiscal_ids: noteIds,
    p_valor_bruto_total: noteIds.length * 1000,
    p_taxa_desconto: 1.5,
    p_prazo_dias: 60,
    p_valor_liquido_desembolso: noteIds.length * 985,
    p_data_vencimento: isoDate(60),
    p_idempotency_key: key,
    p_parcela_ids: null,
  }
}

async function verifyAuditAndIsolation(fixture, actors) {
  const audit = await db.query(`select usuario_id,dados_depois from public.logs_auditoria where tipo_evento='OPERACAO_SOLICITADA' and entidade_id=any($1::uuid[]) order by created_at`, [ids.operations])
  const consultantAudits = audit.rows.filter((row) => row.usuario_id === actors.consultant.id)
  ok('Auditoria registra o Consultor real como usuario_id', consultantAudits.length >= 3 && consultantAudits.every((row) => row.dados_depois?.solicitado_por_role === 'consultor'))
  const crossTenant = await db.query(`
    select count(*)::int total
    from public.operacoes_nfs onf
    join public.operacoes o on o.id=onf.operacao_id
    join public.notas_fiscais nf on nf.id=onf.nota_fiscal_id
    where o.id=any($1::uuid[]) and o.cedente_id<>nf.cedente_id
  `, [ids.operations])
  ok('Toda operacao C2 contem NFs de um unico Cedente', crossTenant.rows[0].total === 0)
  const p14 = await db.query(`select count(*)::int total from public.operacoes_nfs where nota_fiscal_id=$1`, [fixture.notes.aReusable.id])
  ok('P14 preserva historico e cria novo vinculo para NF de reprovada', p14.rows[0].total === 2)
}

async function authenticatedClient(actor) {
  const client = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), clientOptions())
  const signIn = await client.auth.signInWithPassword({ email: actor.email, password: actor.password })
  if (signIn.error) throw signIn.error
  return { client }
}

async function enrollTotp(actor) {
  const client = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'), clientOptions())
  const signIn = await client.auth.signInWithPassword({ email: actor.email, password: actor.password })
  if (signIn.error) throw signIn.error
  const enrollment = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `${PREFIX}consultor` })
  if (enrollment.error || !enrollment.data?.id || !enrollment.data.totp?.secret) throw new Error(enrollment.error?.message || 'Falha no enrollment TOTP')
  const challenge = await client.auth.mfa.challenge({ factorId: enrollment.data.id })
  if (challenge.error || !challenge.data?.id) throw new Error(challenge.error?.message || 'Falha no challenge TOTP')
  const verify = await client.auth.mfa.verify({ factorId: enrollment.data.id, challengeId: challenge.data.id, code: generateTotp(enrollment.data.totp.secret) })
  if (verify.error) throw verify.error
  await client.auth.signOut()
  return enrollment.data.totp.secret
}

async function loginWithTotp(page, actor) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle2', timeout: 60_000 })
  await page.type('#email', actor.email)
  await page.type('#password', actor.password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => location.pathname !== '/login', { timeout: 60_000 })
  if (new URL(page.url()).pathname === '/mfa/desafio') {
    await page.waitForSelector('input[name="code"]', { timeout: 30_000 })
    await page.type('input[name="code"]', generateTotp(actor.totpSecret))
    await page.click('form button[type="submit"]')
    await page.waitForFunction(() => location.pathname !== '/mfa/desafio', { timeout: 60_000 })
  }
}

async function clickButtonByText(page, text) {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
    button?.click()
    return Boolean(button)
  }, text)
  if (!clicked) throw new Error(`Botao nao encontrado: ${text}`)
}

async function clickButtonContaining(page, text) {
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label))
    button?.click()
    return Boolean(button)
  }, text)
  if (!clicked) throw new Error(`Botao contendo texto nao encontrado: ${text}`)
}

async function hydrateIdsForCleanup(prefix) {
  const result = await db.query(`select
    array(select id from auth.users where email like $2) users,
    array(select id from public.cedentes where razao_social like $1) cedentes,
    array(select id from public.notas_fiscais where numero_nf like $1) notes,
    array(select id from public.operacoes where solicitacao_idempotency_key like $1) operations,
    array(select id from public.cedente_fundos where cedente_id in (select id from public.cedentes where razao_social like $1)) cedente_fundos,
    array(select id from public.cedente_fundo_politicas where cedente_fundo_id in (select id from public.cedente_fundos where cedente_id in (select id from public.cedentes where razao_social like $1))) assignments,
    array(select id from public.consultor_cedente where cedente_id in (select id from public.cedentes where razao_social like $1) or consultor_id in (select id from auth.users where email like $2)) links,
    array(select id from public.taxas_cedente where cedente_id in (select id from public.cedentes where razao_social like $1)) rates,
    array(select id from public.contas_escrow where identificador like $1) escrows,
    array(select id from public.documento_versoes where path like $3) versions,
    array(select distinct documento_id from public.documento_versoes where path like $3) documents,
    array(select id from public.documento_vinculos where nota_fiscal_id in (select id from public.notas_fiscais where numero_nf like $1)) document_links,
    array(select id from public.documento_requisito_instancias where nota_fiscal_id in (select id from public.notas_fiscais where numero_nf like $1)) instances
  `, [`${prefix}%`, `${prefix.toLowerCase()}%`, `qa/c2/${prefix}/%`])
  const row = result.rows[0]
  users.push(...row.users)
  for (const [key, source] of Object.entries({ cedentes: 'cedentes', notes: 'notes', operations: 'operations', cedenteFundos: 'cedente_fundos', assignments: 'assignments', links: 'links', rates: 'rates', escrows: 'escrows', versions: 'versions', documents: 'documents', documentLinks: 'document_links', instances: 'instances' })) {
    ids[key].push(...row[source])
  }
}

async function cleanupFixture(targetPrefix = PREFIX) {
  await db.query('begin')
  try {
    await db.query(`delete from public.logs_auditoria where usuario_id=any($1::uuid[]) or entidade_id=any($2::uuid[])`, [users, ids.operations])
    await db.query(`delete from public.seguranca_eventos where usuario_id=any($1::uuid[]) or ator_usuario_id=any($1::uuid[])`, [users])
    await db.query(`delete from public.plataforma_auditoria where ator_usuario_id=any($1::uuid[]) or usuario_alvo_id=any($1::uuid[])`, [users])
    await db.query(`delete from public.eventos_dominio where operacao_id=any($1::uuid[]) or nota_fiscal_id=any($2::uuid[]) or cedente_id=any($3::uuid[])`, [ids.operations, ids.notes, ids.cedentes])
    await db.query(`alter table public.operacao_nf_logistica_memorias disable trigger operacao_nf_logistica_memoria_append_only`)
    await db.query(`delete from public.operacao_nf_logistica_memorias where operacao_id=any($1::uuid[]) or nota_fiscal_id=any($2::uuid[])`, [ids.operations, ids.notes])
    await db.query(`alter table public.operacao_nf_logistica_memorias enable trigger operacao_nf_logistica_memoria_append_only`)
    await db.query(`delete from public.operacao_calculo_nfs where operacao_id=any($1::uuid[]) or nota_fiscal_id=any($2::uuid[])`, [ids.operations, ids.notes])
    await db.query(`delete from public.exposicao_overlay_itens where operacao_id=any($1::uuid[]) or nota_fiscal_id=any($2::uuid[])`, [ids.operations, ids.notes])
    await db.query(`delete from public.nota_fiscal_entrega_postergacoes_canhoto where operacao_id=any($1::uuid[]) or nota_fiscal_id=any($2::uuid[])`, [ids.operations, ids.notes])
    await db.query(`delete from public.nota_fiscal_entregas where operacao_id=any($1::uuid[]) or nota_fiscal_id=any($2::uuid[])`, [ids.operations, ids.notes])
    await db.query(`delete from public.operacoes where id=any($1::uuid[])`, [ids.operations])
    await db.query(`update public.notas_fiscais set status='aprovada' where id=any($1::uuid[])`, [ids.notes])
    await db.query(`delete from public.documento_requisito_instancias where id=any($1::uuid[])`, [ids.instances])
    await db.query(`delete from public.documento_vinculos where id=any($1::uuid[])`, [ids.documentLinks])
    await db.query(`delete from public.documento_versoes where id=any($1::uuid[])`, [ids.versions])
    await db.query(`delete from public.documentos_repositorio where id=any($1::uuid[])`, [ids.documents])
    await db.query(`delete from public.notas_fiscais where id=any($1::uuid[])`, [ids.notes])
    await db.query(`delete from public.consultor_cedente where id=any($1::uuid[])`, [ids.links])
    await db.query(`delete from public.taxas_cedente where id=any($1::uuid[])`, [ids.rates])
    await db.query(`delete from public.contas_escrow where id=any($1::uuid[])`, [ids.escrows])
    await db.query(`delete from public.cedente_fundo_politicas where id=any($1::uuid[])`, [ids.assignments])
    await db.query(`delete from public.cedente_fundos where id=any($1::uuid[])`, [ids.cedenteFundos])
    await db.query(`delete from public.usuario_fundos where usuario_id=any($1::uuid[])`, [users])
    await db.query(`delete from public.cedente_estabelecimento_contas_bancarias where estabelecimento_id in (select id from public.cedente_estabelecimentos where cedente_id=any($1::uuid[]))`, [ids.cedentes])
    await db.query(`delete from public.cedente_estabelecimento_requisitos where estabelecimento_id in (select id from public.cedente_estabelecimentos where cedente_id=any($1::uuid[]))`, [ids.cedentes])
    await db.query(`delete from public.cedente_estabelecimentos where cedente_id=any($1::uuid[])`, [ids.cedentes])
    await db.query(`delete from public.cedentes where id=any($1::uuid[])`, [ids.cedentes])
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  for (const userId of users) {
    const removed = await admin.auth.admin.deleteUser(userId)
    if (removed.error) throw removed.error
  }
  const residual = await db.query(`
    select
      (select count(*) from public.cedentes where razao_social like $1) cedentes,
      (select count(*) from public.notas_fiscais where numero_nf like $1) notas,
      (select count(*) from public.operacoes where solicitacao_idempotency_key like $1) operacoes,
      (select count(*) from public.contas_escrow where identificador like $1) escrows,
      (select count(*) from auth.users where email like $2) usuarios
  `, [`${targetPrefix}%`, `${targetPrefix.toLowerCase()}%`])
  const after = await snapshot()
  const clean = Object.values(residual.rows[0]).every((value) => Number(value) === 0)
    && (baseline === null || JSON.stringify(after) === JSON.stringify(baseline))
  return { ok: clean, residual: residual.rows[0], baseline_restored: baseline === null ? null : JSON.stringify(after) === JSON.stringify(baseline) }
}

async function snapshot() {
  return (await db.query(`select
    (select count(*) from public.cedentes)::int cedentes,
    (select count(*) from public.notas_fiscais)::int notas,
    (select count(*) from public.operacoes)::int operacoes,
    (select count(*) from auth.users)::int usuarios
  `)).rows[0]
}

function ok(name, condition, evidence = undefined) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence === undefined ? {} : { evidence }) })
  if (!condition) throw new Error(`Falha E2E: ${name}`)
}

function clientOptions() {
  return { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
}

function isoDate(days) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function makeCnpj(base12) {
  const digits = base12.replace(/\D/g, '').padStart(12, '0').slice(-12).split('').map(Number)
  const digit = (values, weights) => {
    const rest = values.reduce((sum, value, index) => sum + value * weights[index], 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${digits.join('')}${d1}${d2}`
}

function generateTotp(secret, now = Date.now()) {
  const key = decodeBase32(secret)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of value.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char)
    if (index >= 0) bits += index.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  return Buffer.from(bytes)
}

function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente no ambiente.`)
  return value
}

function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/postgres(?:ql)?:\/\/\S+/giu, 'postgresql://***')
    .replace(/eyJ[A-Za-z0-9._-]+/gu, '<token-redigido>')
}

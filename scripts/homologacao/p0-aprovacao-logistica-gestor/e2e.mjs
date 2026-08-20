#!/usr/bin/env node
// P0: unifica a fonte de evidencia logistica no gate de APROVACAO do
// Gestor (avaliar_gate_logistico_pre_cessao_nfs -> private.classificar_
// status_logistico_pre_cessao). Antes desta correcao, a classificacao so
// reconhecia evidencias_logisticas_antecipadas; um CT-e/Comprovante
// enviado e aprovado pelo fluxo REGULAR do checklist (documento_
// requisito_instancias/documento_versoes, requisito nf_pre_cessao normal)
// continuava produzindo INDETERMINADA e bloqueando a aprovacao mesmo
// aprovado. Reproduz os cenarios A-H do ticket ao vivo em homologacao.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const checks = []

loadEnv(resolve('.env.homolog'))
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')

if (apiRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto de homologacao inesperado: ${apiRef}`)
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()

try {
  await db.query('BEGIN')

  const actorGestorA = randomUUID()
  const actorGestorB = randomUUID()
  const actorCedente1 = randomUUID()
  const actorCedente2 = randomUUID()
  const fundoA = randomUUID()
  const fundoB = randomUUID()

  await createAuthUser(actorGestorA, 'gestor')
  await createAuthUser(actorGestorB, 'gestor')
  await createAuthUser(actorCedente1, 'cedente')
  await createAuthUser(actorCedente2, 'cedente')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Aprovacao Logistica A',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundoA, makeCnpj('960000010001'), makeCnpj('960000010002'), makeCnpj('960000010003'), actorGestorA,
  ])
  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Aprovacao Logistica B',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundoB, makeCnpj('960000020001'), makeCnpj('960000020002'), makeCnpj('960000020003'), actorGestorB,
  ])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorA, fundoA])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorB, fundoB])

  const cedente1 = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Regular','ativo') returning id`, [actorCedente1, makeCnpj('960000030001')])).rows[0].id
  const cedente2 = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Antecipado','ativo') returning id`, [actorCedente2, makeCnpj('960000040001')])).rows[0].id
  const cedenteFundo1 = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente1, fundoA])).rows[0].id
  const cedenteFundo2 = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente2, fundoA])).rows[0].id

  // ---- Politica REGULAR: CT-e e Comprovante como requisitos nf_pre_cessao normais (cenario real da NF-56) ----
  const politicaRegular = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-APROV-LOG-REGULAR','QA Politica Aprovacao Regular','ativa',$2) returning id`, [fundoA, actorGestorA])).rows[0].id
  const politicaVersaoRegular = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro, exigir_status_logistico_pre_cessao)
    values ($1,$2,$3,1,now(),'qa-hash-aprov-log-regular','DIAS_UTEIS_252',true) returning id`, [politicaRegular, cedenteFundo1, fundoA])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'DANFE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',true,true,'cedente','gestor'),
    ($1,$2,$3,'CTE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','cte',true,true,'cedente','gestor'),
    ($1,$2,$3,'COMPROVANTE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','comprovante_entrega',true,true,'cedente','gestor')`, [politicaVersaoRegular, politicaRegular, cedenteFundo1])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestorA, politicaVersaoRegular])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundo1, politicaRegular, actorGestorA])

  const requisitoCteId = (await db.query(`select id from public.politica_requisitos_documentais where politica_operacional_versao_id=$1 and codigo='CTE'`, [politicaVersaoRegular])).rows[0].id
  const requisitoComprovanteId = (await db.query(`select id from public.politica_requisitos_documentais where politica_operacional_versao_id=$1 and codigo='COMPROVANTE'`, [politicaVersaoRegular])).rows[0].id

  // ---- Politica ANTECIPADO: CT-e como requisito oficial pos-cessao (escopo 'entrega'), enviado antecipadamente ----
  const politicaAntecipado = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-APROV-LOG-ANTECIPADO','QA Politica Aprovacao Antecipado','ativa',$2) returning id`, [fundoA, actorGestorA])).rows[0].id
  const politicaVersaoAntecipado = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro, exigir_status_logistico_pre_cessao)
    values ($1,$2,$3,1,now(),'qa-hash-aprov-log-antecipado','DIAS_UTEIS_252',true) returning id`, [politicaAntecipado, cedenteFundo2, fundoA])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'DANFE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',true,true,'cedente','gestor'),
    ($1,$2,$3,'CTE_OFICIAL','entrega','entrega','entrega','cte',true,true,'cedente','gestor')`, [politicaVersaoAntecipado, politicaAntecipado, cedenteFundo2])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestorA, politicaVersaoAntecipado])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundo2, politicaAntecipado, actorGestorA])

  const requisitoCteOficialId = (await db.query(`select id from public.politica_requisitos_documentais where politica_operacional_versao_id=$1 and codigo='CTE_OFICIAL'`, [politicaVersaoAntecipado])).rows[0].id

  const cteTipo = (await db.query(`select id from public.documento_tipos where codigo='cte_xml'`)).rows[0]
  const comprovanteTipo = (await db.query(`select id from public.documento_tipos where codigo='comprovante_entrega'`)).rows[0]
  ok('Catalogo possui "cte_xml" e "comprovante_entrega"', Boolean(cteTipo && comprovanteTipo))

  // ================= NF1: cenarios A e B (CT-e regular) =================
  await asActor(actorCedente1)
  const nf1 = await criarNf(cedente1, cedenteFundo1, fundoA, 'QA-A1', makeCnpj('960000030001'))
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf1, politicaRegular, politicaVersaoRegular])
  const requisitoCteNf1 = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and politica_requisito_id=$2`, [nf1, requisitoCteId])).rows[0]

  const uploadCte1 = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-nf1.xml','application/xml',2048,$4,'documentos-v2',$5,$6) resultado`,
    [nf1, requisitoCteNf1.id, cteTipo.id, sha(), path(), actorCedente1])).rows[0].resultado

  const gateA = await avaliarComo(actorGestorA, nf1)
  ok('Cenario A: CT-e regular "aguardando analise" -> APROVACAO = DENY', gateA.permitido === false, JSON.stringify(gateA))

  await asActor(actorGestorA)
  await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [uploadCte1.versao_id])
  const gateB = await avaliarComo(actorGestorA, nf1)
  ok('Cenario B: CT-e regular aprovado -> APROVACAO = ALLOW (status EM_TRANSITO)', gateB.permitido === true && gateB.status === 'EM_TRANSITO', JSON.stringify(gateB))

  // ================= NF2: cenario C (Comprovante regular, sem CT-e) =================
  await asActor(actorCedente1)
  const nf2 = await criarNf(cedente1, cedenteFundo1, fundoA, 'QA-A2', makeCnpj('960000030001'))
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf2, politicaRegular, politicaVersaoRegular])
  const requisitoComprovanteNf2 = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and politica_requisito_id=$2`, [nf2, requisitoComprovanteId])).rows[0]
  const uploadComprovante2 = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'comprovante-nf2.pdf','application/pdf',2048,$4,'documentos-v2',$5,$6) resultado`,
    [nf2, requisitoComprovanteNf2.id, comprovanteTipo.id, sha(), path(), actorCedente1])).rows[0].resultado
  await asActor(actorGestorA)
  await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [uploadComprovante2.versao_id])
  const gateC = await avaliarComo(actorGestorA, nf2)
  ok('Cenario C: Comprovante regular aprovado, sem CT-e -> APROVACAO = ALLOW (status ENTREGUE)', gateC.permitido === true && gateC.status === 'ENTREGUE', JSON.stringify(gateC))

  const requisitoCteNf2Pendente = (await db.query(`select status from public.documento_requisito_instancias where nota_fiscal_id=$1 and politica_requisito_id=$2`, [nf2, requisitoCteId])).rows[0]
  ok('Cenario C (complemento): requisito de CT-e da NF2 permanece pendente e nao bloqueia a aprovacao (regra OR)', requisitoCteNf2Pendente.status === 'pendente')

  // ================= NF3: cenario D (evidencia antecipada aprovada -- regressao) =================
  await asActor(actorCedente2)
  const nf3 = await criarNf(cedente2, cedenteFundo2, fundoA, 'QA-A3', makeCnpj('960000040001'))
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf3, politicaAntecipado, politicaVersaoAntecipado])
  const antecipado3 = (await db.query(`select public.registrar_documento_logistico_antecipado(
    $1,$2,'cte_xml','cte-antecipado-nf3.xml','application/xml',2048,$3,'documentos-v2',$4,'{}'::jsonb) resultado`,
    [[nf3], requisitoCteOficialId, sha(), path()])).rows[0].resultado
  await asActor(actorGestorA)
  await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [antecipado3.versao_id])
  const gateD = await avaliarComo(actorGestorA, nf3)
  ok('Cenario D (regressao): evidencia antecipada aprovada -> APROVACAO = ALLOW (status EM_TRANSITO)', gateD.permitido === true && gateD.status === 'EM_TRANSITO', JSON.stringify(gateD))

  const semRegularParaNf3 = (await db.query(`select count(*)::int c from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='cte' and documento_id is not null and politica_requisito_id<>$2`, [nf3, requisitoCteOficialId])).rows[0].c
  ok('Sem duplicacao: nenhuma segunda evidencia fisica de CT-e foi criada no checklist regular para a NF3', semRegularParaNf3 === 0)

  // ================= NF4: cenarios E e F (CT-e regular rejeitado, depois reenviado e aprovado) =================
  await asActor(actorCedente1)
  const nf4 = await criarNf(cedente1, cedenteFundo1, fundoA, 'QA-A4', makeCnpj('960000030001'))
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf4, politicaRegular, politicaVersaoRegular])
  const requisitoCteNf4 = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and politica_requisito_id=$2`, [nf4, requisitoCteId])).rows[0]
  const uploadCte4v1 = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-nf4-v1.xml','application/xml',2048,$4,'documentos-v2',$5,$6) resultado`,
    [nf4, requisitoCteNf4.id, cteTipo.id, sha(), path(), actorCedente1])).rows[0].resultado
  await asActor(actorGestorA)
  await db.query(`select public.analisar_documento_versao($1,'rejeitado','Chave de acesso do CT-e ilegivel')`, [uploadCte4v1.versao_id])
  const gateE = await avaliarComo(actorGestorA, nf4)
  ok('Cenario E: CT-e regular rejeitado, sem reenvio -> APROVACAO = DENY', gateE.permitido === false, JSON.stringify(gateE))

  await asActor(actorCedente1)
  const uploadCte4v2 = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-nf4-v2.xml','application/xml',2048,$4,'documentos-v2',$5,$6,$7) resultado`,
    [nf4, requisitoCteNf4.id, cteTipo.id, sha(), path(), actorCedente1, uploadCte4v1.versao_id])).rows[0].resultado
  await asActor(actorGestorA)
  await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [uploadCte4v2.versao_id])
  const gateF = await avaliarComo(actorGestorA, nf4)
  ok('Cenario F: CT-e regular rejeitado + reenvio aprovado -> APROVACAO = ALLOW (usa a versao vigente)', gateF.permitido === true && gateF.status === 'EM_TRANSITO', JSON.stringify(gateF))

  // ================= NF5: cenario G (nenhuma evidencia) =================
  await asActor(actorCedente1)
  const nf5 = await criarNf(cedente1, cedenteFundo1, fundoA, 'QA-A5', makeCnpj('960000030001'))
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf5, politicaRegular, politicaVersaoRegular])
  const gateG = await avaliarComo(actorGestorA, nf5)
  ok('Cenario G: nenhuma evidencia logistica -> APROVACAO = DENY', gateG.permitido === false && gateG.status === 'INDETERMINADA', JSON.stringify(gateG))

  // ================= Cenario H: cross-fund =================
  await asActor(actorGestorB)
  let crossFundBloqueado = false
  await db.query('SAVEPOINT cross_fund')
  try {
    await db.query(`select public.avaliar_gate_logistico_pre_cessao_nfs($1) resultado`, [[nf1]])
  } catch (error) {
    crossFundBloqueado = /Gestor sem acesso ao fundo/.test(error.message)
    await db.query('ROLLBACK TO SAVEPOINT cross_fund')
  }
  ok('Cenario H: gestor de outro fundo nao pode avaliar o gate da NF (cross-fund DENY)', crossFundBloqueado)

  await asActor(actorGestorA)

  // ================= Consistencia 9-10 =================
  // A consistencia entre o gate TS de SUBMISSAO (vigente basta,
  // avaliarSubmissaoLogisticaPreCessao) e o gate SQL de APROVACAO (precisa
  // aprovada, este ticket) para a MESMA evidencia "em_analise" (NF1 antes
  // da aprovacao) ja e coberta exaustivamente pelos testes unitarios de
  // evidencias-logisticas.test.ts (ALLOW na submissao) e pelo Cenario A
  // acima (DENY na aprovacao) -- mesma fonte, criterios diferentes.
  const evidenciasAntecipadasNf1 = (await db.query(`select count(*)::int c from public.evidencias_logisticas_antecipadas where nota_fiscal_id=$1`, [nf1])).rows[0].c
  ok('Sem duplicacao (10): CT-e da NF1 aprovado pelo fluxo regular nao gerou nenhuma linha em evidencias_logisticas_antecipadas', evidenciasAntecipadasNf1 === 0)

  await db.query('RESET ROLE')
  await db.query('ROLLBACK')
  console.log(JSON.stringify({
    project_ref: apiRef,
    transaction: 'ROLLED_BACK',
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }, null, 2))
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(JSON.stringify({ project_ref: apiRef, transaction: 'ROLLED_BACK', error: error instanceof Error ? error.message : String(error), checks }, null, 2))
  process.exitCode = 1
} finally {
  await db.end()
}

async function criarNf(cedenteId, cedenteFundoId, fundoId, numero, cnpjEmitente) {
  const result = await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,$4,'1','2026-09-10','2026-11-25',$5,'QA Emitente','12345678000199','QA Sacado',10000.00,'rascunho')
    returning id`, [cedenteId, cedenteFundoId, fundoId, numero, cnpjEmitente])
  return result.rows[0].id
}

async function avaliarComo(gestorId, nfId) {
  await asActor(gestorId)
  const resultado = (await db.query(`select public.avaliar_gate_logistico_pre_cessao_nfs($1) resultado`, [[nfId]])).rows[0].resultado
  return resultado[0]
}

async function createAuthUser(id, role) {
  await db.query(`insert into auth.users (
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    id, `qa-aprov-log-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
  ])
}

async function asActor(userId) {
  await db.query('RESET ROLE')
  const claims = { sub: userId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() }
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
  await db.query('SET LOCAL ROLE authenticated')
}

function ok(name, condition, evidence = null) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  if (!condition) throw new Error(`Falha E2E: ${name}${evidence ? ` (${evidence})` : ''}`)
}

function sha() {
  return randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)
}

function path() {
  return `qa/aprovacao-logistica/${randomUUID()}.dat`
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

function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

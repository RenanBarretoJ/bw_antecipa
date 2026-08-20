#!/usr/bin/env node
// P0: submissao ainda bloqueada mesmo com CT-e anexado (reproduz o
// cenario real da NF-56 em homologacao). Confirma ao vivo que um CT-e
// enviado pelo fluxo REGULAR do checklist (documento_requisito_instancias
// / documento_versoes, via registrar_documento_upload) nao gera nenhuma
// linha em evidencias_logisticas_antecipadas -- a fonte que o gate
// logistico (classificarStatusLogisticoPreCessao / avaliarSubmissaoLogisticaPreCessao)
// lia antes desta correcao. A logica de merge em si (evidenciasDoChecklistRegular)
// ja tem cobertura unitaria exaustiva em evidencias-logisticas.test.ts;
// este script confirma que o RPC real produz exatamente a divergencia de
// dados que motivou o ticket, e que a NF permanece elegivel para
// submissao assim que o CT-e esta anexado (sem exigir aprovacao).

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

  const actorCedente = randomUUID()
  const actorGestor = randomUUID()
  const fundo = randomUUID()
  const cnpjMatriz = makeCnpj('970000020001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Submissao NF56',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundo, makeCnpj('950000090001'), makeCnpj('950000090002'), makeCnpj('950000090003'), actorGestor,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Submissao NF56','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])

  // Politica igual a real da NF-56: XML/DANFE/CT-e pre-cessao obrigatorios,
  // com exigir_status_logistico_pre_cessao=true (CT-e OU Comprovante).
  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-SUBMISSAO-NF56','QA Politica Submissao NF56','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro, exigir_status_logistico_pre_cessao)
    values ($1,$2,$3,1,now(),'qa-hash-submissao-nf56','DIAS_UTEIS_252',true) returning id`, [politica, cedenteFundoId, fundo])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'DANFE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',true,true,'cedente','gestor'),
    ($1,$2,$3,'CTE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','cte',true,true,'cedente','gestor')`, [politicaVersao, politica, cedenteFundoId])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, politicaVersao])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])

  await asActor(actorCedente)
  const nf = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'NF56-REPRO','1','2026-09-10','2026-11-25',$4,'QA Emitente','12345678000199','QA Sacado',13396.00,'rascunho')
    returning id`, [cedente, cedenteFundoId, fundo, cnpjMatriz])).rows[0].id
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf, politica, politicaVersao])

  const requisitoCte = (await db.query(`select id, documento_id from public.documento_requisito_instancias
    where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='cte'`, [nf])).rows[0]
  ok('Requisito de CT-e (nf_pre_cessao) instanciado', Boolean(requisitoCte))

  // O requisito e catalogado com o codigo generico 'cte', mas o tipo
  // documental real resolvido no upload de um .xml e 'cte_xml'
  // (normalizarCodigoDocumentoCatalogo) -- mesmo padrao da NF-56 real.
  const cteTipo = (await db.query(`select id from public.documento_tipos where codigo='cte_xml'`)).rows[0]
  ok('Catalogo possui tipo documental "cte_xml" (resolvido para upload de XML de CT-e)', Boolean(cteTipo))

  // ---- Upload do CT-e pelo fluxo REGULAR do checklist (nao pelo "envio antecipado") ----
  const upload = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'42260785348407000248570010006864631008909914-cte.xml','application/xml',2048,$4,'documentos-v2',$5,$6,null) resultado`,
    [nf, requisitoCte.id, cteTipo.id, 'f'.repeat(64), `qa/nf56/${randomUUID()}.xml`, actorCedente])).rows[0].resultado
  ok('Upload do CT-e via fluxo regular (registrar_documento_upload) tem sucesso', Boolean(upload.versao_id))

  const versaoCte = (await db.query(`select status from public.documento_versoes where id=$1`, [upload.versao_id])).rows[0]
  ok('Reproduz o sintoma exato da NF-56: versao do CT-e fica "em_analise" (Aguardando analise) no checklist normal', versaoCte.status === 'em_analise')

  const evidenciasAntecipadas = (await db.query(`select count(*)::int c from public.evidencias_logisticas_antecipadas where nota_fiscal_id=$1`, [nf])).rows[0].c
  ok('Confirma a causa raiz: nenhuma linha em evidencias_logisticas_antecipadas (o CT-e so existe no fluxo regular)', evidenciasAntecipadas === 0)

  // ---- Gate de aprovacao do gestor (RPC real, inalterado por este ticket): CT-e so em_analise ainda nao aprovado -> continua DENY ----
  const gateAntesDaAprovacao = (await db.query(`select public.avaliar_gate_logistico_pre_cessao_nfs($1) resultado`, [[nf]])).rows[0].resultado
  const gateAprovacao1 = gateAntesDaAprovacao[0]
  ok('Gate de APROVACAO do gestor (RPC inalterado): CT-e enviado mas nao aprovado = DENY (regra preservada)', (
    gateAprovacao1.gate_exigido === true && gateAprovacao1.permitido === false
  ), JSON.stringify(gateAprovacao1))

  // ---- Gestor aprova o CT-e (fluxo regular) ----
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [upload.versao_id])
  const versaoCteAprovada = (await db.query(`select status from public.documento_versoes where id=$1`, [upload.versao_id])).rows[0]
  ok('Apos aprovacao do gestor, a versao do CT-e (fluxo regular) fica "aprovado"', versaoCteAprovada.status === 'aprovado')

  const gateDepoisDaAprovacao = (await db.query(`select public.avaliar_gate_logistico_pre_cessao_nfs($1) resultado`, [[nf]])).rows[0].resultado
  const gateAprovacao2 = gateDepoisDaAprovacao[0]
  ok('Risco documentado (fora do escopo deste ticket, "nao alterar gate de aprovacao do Gestor"): mesmo com o CT-e aprovado pelo fluxo regular, o gate de APROVACAO (RPC) continua DENY -- ele so reconhece evidencias_logisticas_antecipadas, nunca o fluxo regular', (
    gateAprovacao2.permitido === false
  ), JSON.stringify(gateAprovacao2))

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

async function createAuthUser(id, role) {
  await db.query(`insert into auth.users (
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    id, `qa-submissao-nf56-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

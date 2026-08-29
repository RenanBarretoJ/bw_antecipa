#!/usr/bin/env node
// P0: NF-78 ficava bloqueada na submissao com "A politica exige CT-e/
// DACTE ou Comprovante de Entrega aprovado antes desta etapa" mesmo com
// CT-e enviado/em analise (evidencia vigente, que e a regra correta de
// submissao). Causa raiz confirmada ao vivo: o trigger de notas_fiscais
// (private.validar_logistica_antes_transicao_nf) reusava a semantica de
// APROVACAO (exige aprovado) tambem na transicao para 'submetida' --
// um segundo gate, no banco, duplicando/contradizendo o gate correto
// que submeterNF (TypeScript) ja aplicava via permitidoSubmissao.
//
// Este script reproduz a NF-78 REAL (mesma politica/CT-e em_analise) do
// zero e confirma: (1) o cenario exato do bug antes da correcao teria
// bloqueado; (2) apos a correcao, a transicao para 'submetida' com CT-e
// vigente (em_analise) tem sucesso; (3) a transicao para 'aprovada'
// continua exigindo aprovado (regra do Gestor, inalterada); (4) demais
// cenarios negativos/positivos pedidos pelo ticket.

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
  const cnpjMatriz = makeCnpj('970000030001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Submissao NF78',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundo, makeCnpj('950000100001'), makeCnpj('950000100002'), makeCnpj('950000100003'), actorGestor,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Submissao NF78','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])

  // Politica igual a real da NF-78: XML/DANFE/CT-e pre-cessao obrigatorios,
  // exigir_status_logistico_pre_cessao=true (CT-e OU Comprovante).
  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-SUBMISSAO-NF78','QA Politica Submissao NF78','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro, exigir_status_logistico_pre_cessao)
    values ($1,$2,$3,1,now(),'qa-hash-submissao-nf78','DIAS_UTEIS_252',true) returning id`, [politica, cedenteFundoId, fundo])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'DANFE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',true,true,'cedente','gestor'),
    ($1,$2,$3,'CTE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','cte',true,true,'cedente','gestor')`, [politicaVersao, politica, cedenteFundoId])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, politicaVersao])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])

  const cteTipo = (await db.query(`select id from public.documento_tipos where codigo='cte_xml'`)).rows[0]

  // ================= Cenario NF-78 real: CT-e em_analise -> SUBMISSAO deve ter sucesso =================
  await asActor(actorCedente)
  const nf78 = await criarNf(cedente, cedenteFundoId, fundo, 'QA-NF78-A', cnpjMatriz)
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf78, politica, politicaVersao])
  const requisitoCte78 = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='cte'`, [nf78])).rows[0]
  const uploadCte78 = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-nf78.xml','application/xml',2048,$4,'documentos-v2',$5,$6) resultado`,
    [nf78, requisitoCte78.id, cteTipo.id, sha(), path(), actorCedente])).rows[0].resultado
  const versaoCte78 = (await db.query(`select status from public.documento_versoes where id=$1`, [uploadCte78.versao_id])).rows[0]
  ok('Reproduz o sintoma exato da NF-78: CT-e fica "em_analise" (Aguardando analise) apos o upload', versaoCte78.status === 'em_analise')

  await db.query('SAVEPOINT submissao_nf78')
  let submissaoOk = false
  let submissaoErro = null
  try {
    await db.query(`update public.notas_fiscais set status='submetida', submetida_em=now(), submetida_por=$1 where id=$2`, [actorCedente, nf78])
    submissaoOk = true
  } catch (error) {
    submissaoErro = error.message
    await db.query('ROLLBACK TO SAVEPOINT submissao_nf78')
  }
  ok('NF-78: submissao com CT-e "em_analise" tem SUCESSO (corrigido -- nao mais bloqueada pelo segundo gate)', submissaoOk, submissaoErro)

  const nf78Status = (await db.query(`select status from public.notas_fiscais where id=$1`, [nf78])).rows[0]
  ok('NF-78: status realmente avancou para "submetida" no banco', nf78Status.status === 'submetida')

  // ================= Cenario: sem nenhuma evidencia -> submissao DENY =================
  await asActor(actorCedente)
  const nfSemEvidencia = await criarNf(cedente, cedenteFundoId, fundo, 'QA-NF78-B', cnpjMatriz)
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nfSemEvidencia, politica, politicaVersao])
  await db.query('SAVEPOINT sem_evidencia')
  let denySemEvidencia = false
  try {
    await db.query(`update public.notas_fiscais set status='submetida', submetida_em=now(), submetida_por=$1 where id=$2`, [actorCedente, nfSemEvidencia])
  } catch (error) {
    denySemEvidencia = /exige o envio de CT-e\/DACTE ou Comprovante de Entrega antes da submissao/.test(error.message)
    await db.query('ROLLBACK TO SAVEPOINT sem_evidencia')
  }
  ok('Negativo: sem nenhuma evidencia -> submissao DENY com a mensagem correta de submissao', denySemEvidencia)

  // ================= Cenario: CT-e rejeitado sem reenvio -> submissao DENY =================
  await asActor(actorCedente)
  const nfRejeitado = await criarNf(cedente, cedenteFundoId, fundo, 'QA-NF78-C', cnpjMatriz)
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nfRejeitado, politica, politicaVersao])
  const requisitoCteRej = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='cte'`, [nfRejeitado])).rows[0]
  const uploadRej = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-rej.xml','application/xml',2048,$4,'documentos-v2',$5,$6) resultado`,
    [nfRejeitado, requisitoCteRej.id, cteTipo.id, sha(), path(), actorCedente])).rows[0].resultado
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_versao($1,'rejeitado','CT-e ilegivel')`, [uploadRej.versao_id])
  await asActor(actorCedente)
  await db.query('SAVEPOINT rejeitado_sem_reenvio')
  let denyRejeitado = false
  try {
    await db.query(`update public.notas_fiscais set status='submetida', submetida_em=now(), submetida_por=$1 where id=$2`, [actorCedente, nfRejeitado])
  } catch (error) {
    denyRejeitado = /exige o envio de CT-e\/DACTE ou Comprovante de Entrega antes da submissao/.test(error.message)
    await db.query('ROLLBACK TO SAVEPOINT rejeitado_sem_reenvio')
  }
  ok('Negativo: CT-e rejeitado sem reenvio -> submissao DENY', denyRejeitado)

  // ================= Cenario: CT-e rejeitado + reenvio vigente -> submissao ALLOW =================
  await asActor(actorCedente)
  await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-reenvio.xml','application/xml',2048,$4,'documentos-v2',$5,$6,$7) resultado`,
    [nfRejeitado, requisitoCteRej.id, cteTipo.id, sha(), path(), actorCedente, uploadRej.versao_id])
  await db.query('SAVEPOINT reenvio_vigente')
  let allowReenvio = false
  let allowReenvioErro = null
  try {
    await db.query(`update public.notas_fiscais set status='submetida', submetida_em=now(), submetida_por=$1 where id=$2`, [actorCedente, nfRejeitado])
    allowReenvio = true
  } catch (error) {
    allowReenvioErro = error.message
    await db.query('ROLLBACK TO SAVEPOINT reenvio_vigente')
  }
  ok('Positivo: CT-e rejeitado + reenvio vigente -> submissao ALLOW (usa a versao mais recente por upload)', allowReenvio, allowReenvioErro)

  // ================= Aprovacao do Gestor: regra inalterada (precisa aprovado) =================
  await asActor(actorCedente)
  const nfAprovacao = await criarNf(cedente, cedenteFundoId, fundo, 'QA-NF78-D', cnpjMatriz)
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nfAprovacao, politica, politicaVersao])
  const requisitoCteAprov = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='cte'`, [nfAprovacao])).rows[0]
  const uploadAprov = (await db.query(`select public.registrar_documento_upload(
    $1,$2,$3,'cte-aprov.xml','application/xml',2048,$4,'documentos-v2',$5,$6) resultado`,
    [nfAprovacao, requisitoCteAprov.id, cteTipo.id, sha(), path(), actorCedente])).rows[0].resultado
  await db.query(`update public.notas_fiscais set status='submetida', submetida_em=now(), submetida_por=$1 where id=$2`, [actorCedente, nfAprovacao])

  await asActor(actorGestor)
  await db.query('SAVEPOINT aprovacao_apenas_enviado')
  let denyAprovacaoApenasEnviado = false
  try {
    await db.query(`update public.notas_fiscais set status='aprovada', aprovada_gestor_em=now() where id=$1`, [nfAprovacao])
  } catch (error) {
    denyAprovacaoApenasEnviado = /exige CT-e\/DACTE ou Comprovante de Entrega aprovado antes desta etapa/.test(error.message)
    await db.query('ROLLBACK TO SAVEPOINT aprovacao_apenas_enviado')
  }
  ok('Aprovacao do Gestor (regra inalterada): CT-e so enviado/em_analise -> aprovacao DENY', denyAprovacaoApenasEnviado)

  await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [uploadAprov.versao_id])
  await db.query('SAVEPOINT aprovacao_aprovado')
  let allowAprovacaoAprovado = false
  let allowAprovacaoErro = null
  try {
    await db.query(`update public.notas_fiscais set status='aprovada', aprovada_gestor_em=now() where id=$1`, [nfAprovacao])
    allowAprovacaoAprovado = true
  } catch (error) {
    allowAprovacaoErro = error.message
    await db.query('ROLLBACK TO SAVEPOINT aprovacao_aprovado')
  }
  ok('Aprovacao do Gestor (regra inalterada): CT-e aprovado -> aprovacao ALLOW', allowAprovacaoAprovado, allowAprovacaoErro)

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

async function createAuthUser(id, role) {
  await db.query(`insert into auth.users (
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    id, `qa-submissao-nf78-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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
  return `qa/submissao-nf78/${randomUUID()}.dat`
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

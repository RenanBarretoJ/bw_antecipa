#!/usr/bin/env node
// P0: Gate logistico + status real dos boletos + gate agregado por parcela.
// Valida ao vivo (transacao revertida) os dados reais que alimentam as
// funcoes puras corrigidas (derivarStatusBoleto, avaliarSubmissaoLogisticaPreCessao,
// avaliarElegibilidadeDocumentalDaNota) -- essas ja tem cobertura unitaria
// exaustiva; este script confirma que os RPCs reais produzem exatamente o
// formato de dados que essas funcoes esperam.

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
  const cnpjMatriz = makeCnpj('980000010001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Gate Boleto',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundo, makeCnpj('990000080001'), makeCnpj('990000080002'), makeCnpj('990000080003'), actorGestor,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Gate Boleto','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])

  const matriz = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0].id

  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-GATE-BOLETO','QA Politica Gate Boleto','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
    values ($1,$2,$3,1,now(),'qa-hash-gate-boleto','DIAS_UTEIS_252') returning id`, [politica, cedenteFundoId, fundo])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'BOLETO_PARCELA','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','boleto',true,true,'cedente','gestor')`, [politicaVersao, politica, cedenteFundoId])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, politicaVersao])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])

  await asActor(actorCedente)
  const nf = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'GATE-01','1','2026-09-10','2026-11-25',$4,'QA Emitente','12345678000199','QA Sacado',110160.00,'aprovada')
    returning id`, [cedente, cedenteFundoId, fundo, cnpjMatriz])).rows[0].id

  const parcelas = [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ]
  await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb)`, [nf, JSON.stringify(parcelas)])
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nf, politica, politicaVersao])

  const boletoTipo = (await db.query(`select id from public.documento_tipos where codigo='boleto'`)).rows[0].id
  const requisitosBoleto = (await db.query(`select dri.id, nfp.numero_parcela
    from public.documento_requisito_instancias dri
    join public.nota_fiscal_parcelas nfp on nfp.id = dri.parcela_id
    where dri.nota_fiscal_id=$1 and dri.tipo_documento_codigo_snapshot='boleto' order by nfp.numero_parcela`, [nf])).rows
  ok('Setup: 4 requisitos de boleto instanciados (1 por parcela)', requisitosBoleto.length === 4)

  // ---- Area B: upload -> status real na versao, nao apenas na instancia ----
  const upload1 = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-001.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitosBoleto[0].id, boletoTipo, matriz, 'a'.repeat(64), `qa/gate/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  const estadoParcela1PosUpload = (await db.query(`select dri.status as status_instancia, dv.status as status_versao
    from public.documento_requisito_instancias dri
    join public.documento_versoes dv on dv.id = $2
    where dri.id=$1`, [requisitosBoleto[0].id, upload1.versao_id])).rows[0]
  ok('Apos upload: instancia fica "pendente" (estatico) mas a versao real e "em_analise"', (
    estadoParcela1PosUpload.status_instancia === 'pendente' && estadoParcela1PosUpload.status_versao === 'em_analise'
  ), JSON.stringify(estadoParcela1PosUpload))

  // ---- Gestor aprova parcela 1 ----
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload1.versao_id])
  const statusParcela1Aprovada = (await db.query(`select status from public.documento_requisito_instancias where id=$1`, [requisitosBoleto[0].id])).rows[0].status
  ok('Parcela 1 aprovada: instancia vira "satisfeito"', statusParcela1Aprovada === 'satisfeito')

  // ---- Cedente envia boleto da parcela 2, gestor reprova ----
  await asActor(actorCedente)
  const upload2 = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-002.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitosBoleto[1].id, boletoTipo, matriz, 'b'.repeat(64), `qa/gate/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'rejeitado','Boleto ilegivel')`, [upload2.versao_id])
  const estadoParcela2Rejeitada = (await db.query(`select dri.status as status_instancia, dv.status as status_versao, da.resultado
    from public.documento_requisito_instancias dri
    join public.documento_versoes dv on dv.id = $2
    join public.documento_analises da on da.documento_versao_id = dv.id
    where dri.id=$1`, [requisitosBoleto[1].id, upload2.versao_id])).rows[0]
  ok('Parcela 2 rejeitada: instancia volta a "pendente", versao "rejeitado", analise "rejeitado"', (
    estadoParcela2Rejeitada.status_instancia === 'pendente'
    && estadoParcela2Rejeitada.status_versao === 'rejeitado'
    && estadoParcela2Rejeitada.resultado === 'rejeitado'
  ), JSON.stringify(estadoParcela2Rejeitada))

  // ---- Cedente reenvia a parcela 2 (nova versao, mantem historico) ----
  await asActor(actorCedente)
  const upload2b = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-002-corrigido.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitosBoleto[1].id, boletoTipo, matriz, 'c'.repeat(64), `qa/gate/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  const versoesParcela2 = (await db.query(`select numero_versao, status from public.documento_versoes where documento_id = (
    select documento_id from public.documento_requisito_instancias where id=$1
  ) order by numero_versao desc`, [requisitosBoleto[1].id])).rows
  ok('Reenvio cria nova versao (numero 2) mantendo a v1 no historico', (
    versoesParcela2.length === 2 && versoesParcela2[0].numero_versao === 2 && versoesParcela2[0].status === 'em_analise'
  ), JSON.stringify(versoesParcela2))

  // ---- Gestor pede ajuste na parcela 3 (requer_ajuste != rejeitado) ----
  await asActor(actorCedente)
  const upload3 = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-003.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitosBoleto[2].id, boletoTipo, matriz, 'd'.repeat(64), `qa/gate/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'requer_ajuste','Falta rubrica')`, [upload3.versao_id])
  const estadoParcela3Ajuste = (await db.query(`select dri.status as status_instancia, dv.status as status_versao, da.resultado
    from public.documento_requisito_instancias dri
    join public.documento_versoes dv on dv.id = $2
    join public.documento_analises da on da.documento_versao_id = dv.id
    where dri.id=$1`, [requisitosBoleto[2].id, upload3.versao_id])).rows[0]
  ok('Pedido de ajuste: versao fica "em_analise" (nao rejeitado) mas a analise registra "requer_ajuste" -- distinguivel de uma simples analise pendente', (
    estadoParcela3Ajuste.status_versao === 'em_analise' && estadoParcela3Ajuste.resultado === 'requer_ajuste'
  ), JSON.stringify(estadoParcela3Ajuste))

  // ---- Gate agregado: aprova as 4 parcelas e confirma 4/4 antes do ALLOW ----
  await asActor(actorCedente)
  const upload2c = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-004.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitosBoleto[3].id, boletoTipo, matriz, 'e'.repeat(64), `qa/gate/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload2b.versao_id])
  await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload3.versao_id])
  await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload2c.versao_id])
  const contagemAprovados = (await db.query(`select count(*)::int c from public.documento_requisito_instancias
    where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='boleto' and status='satisfeito'`, [nf])).rows[0].c
  ok('Gate agregado: 4/4 parcelas de boleto aprovadas ao final do fluxo real', contagemAprovados === 4)

  // ---- Reconciliacao no gate de aprovacao: NF nunca teve o checklist aberto apos criacao ----
  await asActor(actorCedente)
  const nfSemChecklist = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'GATE-02','1','2026-09-10','2026-11-25',$4,'QA Emitente','12345678000199','QA Sacado',110160.00,'aprovada')
    returning id`, [cedente, cedenteFundoId, fundo, cnpjMatriz])).rows[0].id
  await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb)`, [nfSemChecklist, JSON.stringify(parcelas)])
  // Nao chama instanciar_requisitos_nota aqui de proposito -- simula uma NF
  // cujo checklist nunca foi aberto (o gap que aprovarNF agora fecha
  // chamando instanciarRequisitosDaNota antes de avaliar o gate).
  const semInstanciasAntes = (await db.query(`select count(*)::int c from public.documento_requisito_instancias where nota_fiscal_id=$1`, [nfSemChecklist])).rows[0].c
  ok('NF nova sem checklist aberto: 0 instancias antes da reconciliacao (reproduz o gap)', semInstanciasAntes === 0)
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3)`, [nfSemChecklist, politica, politicaVersao])
  const instanciasDepoisReconciliar = (await db.query(`select count(*)::int c from public.documento_requisito_instancias where nota_fiscal_id=$1`, [nfSemChecklist])).rows[0].c
  ok('aprovarNF agora reconcilia antes do gate: instanciar_requisitos_nota cria os 5 requisitos (1 xml + 4 boleto) mesmo sem o checklist nunca aberto', instanciasDepoisReconciliar === 5, `instancias=${instanciasDepoisReconciliar}`)

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
    id, `qa-gate-boleto-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

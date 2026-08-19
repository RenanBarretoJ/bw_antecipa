#!/usr/bin/env node

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
  const actorGestorOutroFundo = randomUUID()
  const fundo = randomUUID()
  const fundoOutro = randomUUID()
  const cnpjMatriz = makeCnpj('930000010001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')
  await createAuthUser(actorGestorOutroFundo, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Parcelas NF',$2,'QA Admin',$3,'QA Gestora',$4,true,$5),
           ($6,'QA Parcelas NF Outro',$7,'QA Admin B',$8,'QA Gestora B',$9,true,$5)`, [
    fundo, makeCnpj('940000030001'), makeCnpj('940000030002'), makeCnpj('940000030003'), actorGestor,
    fundoOutro, makeCnpj('940000040001'), makeCnpj('940000040002'), makeCnpj('940000040003'),
  ])

  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Parcelas NF','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorOutroFundo, fundoOutro])

  const matriz = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0].id
  const outroEstabelecimentoNaoAprovado = (await db.query(`insert into public.cedente_estabelecimentos
    (cedente_id, cnpj, razao_social, tipo, matriz_estabelecimento_id, status, ativo)
    values ($1,$2,'QA Filial Nao Aprovada','filial',$3,'pendente',true) returning id`, [cedente, makeCnpj('930000010002'), matriz])).rows[0].id

  // ---- NF-e 78: 4 parcelas de R$ 27.540,00, total R$ 110.160,00 (cenario real do ticket) ----
  const nf = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'78','1','2026-09-10','2026-11-25',$4,'QA Emitente','12345678000199','QA Sacado',110160.00,'rascunho')
    returning id`, [cedente, cedenteFundoId, fundo, cnpjMatriz])).rows[0].id

  await asActor(actorCedente)

  // 1) registrar as 4 parcelas reais da NF-78
  const parcelas = [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ]
  const registro = (await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nf, JSON.stringify(parcelas)])).rows[0].resultado
  ok('NF-78 cria exatamente 4 parcelas', registro.parcelas_inseridas === 4)
  ok('Soma das parcelas = R$ 110.160,00', Number(registro.soma) === 110160)

  const parcelasSalvas = (await db.query(`select numero_parcela, valor_nominal, data_vencimento from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela`, [nf])).rows
  ok('Datas e valores das 4 parcelas persistidos corretamente', JSON.stringify(parcelasSalvas.map((p) => ({ n: p.numero_parcela, v: Number(p.valor_nominal), d: p.data_vencimento.toISOString().slice(0, 10) }))) === JSON.stringify([
    { n: 1, v: 27540, d: '2026-10-11' }, { n: 2, v: 27540, d: '2026-10-26' }, { n: 3, v: 27540, d: '2026-11-10' }, { n: 4, v: 27540, d: '2026-11-25' },
  ]))

  // 2) idempotencia: NF ja tem parcelas = DENY
  await expectError('Registrar parcelas de novo na mesma NF = DENY (ja possui parcelas)', async () => {
    await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb)`, [nf, JSON.stringify(parcelas)])
  }, /ja possui parcelas/)

  // 3) tolerancia monetaria: soma incompativel com valor_bruto = DENY
  const nfSomaErrada = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'79','1','2026-09-10','2026-11-25',$4,'QA Emitente','12345678000199','QA Sacado',110160.00,'rascunho')
    returning id`, [cedente, cedenteFundoId, fundo, cnpjMatriz])).rows[0].id
  await expectError('Soma das parcelas fora da tolerancia = DENY', async () => {
    await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb)`, [nfSomaErrada, JSON.stringify([
      { numero_parcela: 1, valor_nominal: 50000.00, data_vencimento: '2026-10-11' },
      { numero_parcela: 2, valor_nominal: 50000.00, data_vencimento: '2026-11-25' },
    ])])
  }, /nao corresponde ao valor bruto/)

  // ---- Catalogo: boleto e cardinalidade por_parcela ----
  const boletoTipo = (await db.query(`select id, cardinalidade from public.documento_tipos where codigo='boleto'`)).rows[0]
  ok('documento_tipos possui boleto com cardinalidade por_parcela', Boolean(boletoTipo) && boletoTipo.cardinalidade === 'por_parcela')

  // ---- Politica com requisito boleto (nf_pre_cessao), publicada e atribuida
  // ao cedente_fundo (instanciar_requisitos_nota exige isso explicitamente) ----
  await db.query('RESET ROLE')
  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-BOLETO','QA Politica Boleto','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
    values ($1,$2,$3,1,now(),'qa-hash-boleto','DIAS_UTEIS_252') returning id`, [politica, cedenteFundoId, fundo])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao)
    values ($1,$2,$3,'BOLETO_PARCELA','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','boleto',true,true,'cedente','gestor')`, [politicaVersao, politica, cedenteFundoId])
  // Publica so depois de inserir os requisitos: versao publicada e imutavel
  // (trigger politica_requisito_publicado_immutavel bloquearia o INSERT acima).
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, politicaVersao])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])

  await asActor(actorCedente)
  const instanciacao = (await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nf, politica, politicaVersao])).rows[0].resultado
  ok('instanciar_requisitos_nota cria 1 requisito de boleto POR parcela (4 no total)', instanciacao.inseridos_ou_atualizados === 4)

  const requisitosBoleto = (await db.query(`select dri.id, dri.parcela_id, nfp.numero_parcela
    from public.documento_requisito_instancias dri
    join public.nota_fiscal_parcelas nfp on nfp.id = dri.parcela_id
    where dri.nota_fiscal_id=$1 and dri.tipo_documento_codigo_snapshot='boleto' order by nfp.numero_parcela`, [nf])).rows
  ok('Cada requisito de boleto aponta para uma parcela distinta (001-004)', requisitosBoleto.map((r) => r.numero_parcela).join(',') === '1,2,3,4')

  // ---- Upload do boleto da parcela 1 (beneficiario = Matriz) ----
  const requisitoParcela1 = requisitosBoleto[0].id
  const upload1 = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-001.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitoParcela1, boletoTipo.id, matriz, 'a'.repeat(64), `qa/parcelas/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  ok('Boleto da parcela 001 registrado com beneficiario = Matriz', Boolean(upload1.versao_id))

  // ---- Beneficiario invalido (estabelecimento nao aprovado) = DENY ----
  await expectError('Beneficiario nao aprovado = DENY', async () => {
    await db.query(`select public.registrar_documento_boleto_parcela(
      $1,$2,$3,$4,'boleto-002.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null)`,
      [nf, requisitosBoleto[1].id, boletoTipo.id, outroEstabelecimentoNaoAprovado, 'b'.repeat(64), `qa/parcelas/${randomUUID()}.pdf`, actorCedente])
  }, /Beneficiario deve ser a Matriz ou um Estabelecimento aprovado/)

  // ---- Analise (gestor autorizado) aprova o boleto da parcela 1 ----
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload1.versao_id])
  const statusParcela1 = (await db.query(`select status from public.documento_requisito_instancias where id=$1`, [requisitoParcela1])).rows[0].status
  ok('Boleto aprovado marca APENAS o requisito da parcela 001 como satisfeito', statusParcela1 === 'satisfeito')
  const statusOutrasParcelas = (await db.query(`select status from public.documento_requisito_instancias where id = ANY($1)`, [[requisitosBoleto[1].id, requisitosBoleto[2].id, requisitosBoleto[3].id]])).rows
  ok('As outras 3 parcelas permanecem pendentes (nao afetadas pela analise da parcela 001)', statusOutrasParcelas.every((r) => r.status === 'pendente'))

  // ---- Reprovar boleto de outra parcela ----
  await asActor(actorCedente)
  const upload2 = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-002.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nf, requisitosBoleto[1].id, boletoTipo.id, matriz, 'c'.repeat(64), `qa/parcelas/${randomUUID()}.pdf`, actorCedente])).rows[0].resultado
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'rejeitado','Boleto ilegivel')`, [upload2.versao_id])
  const statusParcela2 = (await db.query(`select status from public.documento_requisito_instancias where id=$1`, [requisitosBoleto[1].id])).rows[0].status
  ok('Boleto reprovado marca a parcela 002 como pendente novamente', statusParcela2 === 'pendente')

  // ---- Seguranca: gestor de outro fundo nao analisa boleto (fecha o gap de analisar_documento_versao) ----
  await expectError('Gestor de outro fundo nao analisa boleto (cross-fundo)', async () => {
    await asActor(actorGestorOutroFundo)
    await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload2.versao_id])
  }, /Gestor sem vinculo ativo com o fundo/)

  await expectError('Gestor de outro fundo nao registra parcelas (cross-fundo)', async () => {
    await asActor(actorGestorOutroFundo)
    await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb)`, [nfSomaErrada, JSON.stringify(parcelas)])
  }, /Gestor sem vinculo ativo com o fundo|ja possui parcelas/)

  await expectError('Anon nao le parcelas da NF', async () => {
    await db.query('RESET ROLE')
    await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ role: 'anon' })])
    await db.query('SET LOCAL ROLE anon')
    await db.query(`select * from public.nota_fiscal_parcelas where nota_fiscal_id=$1`, [nf])
  }, /permission denied/i)

  // ---- Regressao: NF sem parcelas continua funcionando (nao gera requisito por_parcela, sem erro) ----
  await db.query('RESET ROLE')
  const nfSemParcelas = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'80','1','2026-09-10','2026-11-25',$4,'QA Emitente','12345678000199','QA Sacado',5000.00,'rascunho')
    returning id`, [cedente, cedenteFundoId, fundo, cnpjMatriz])).rows[0].id
  await asActor(actorCedente)
  const instanciacaoSemParcelas = (await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nfSemParcelas, politica, politicaVersao])).rows[0].resultado
  ok('NF sem <dup>/parcelas nao recebe requisito por_parcela (0 inseridos, sem erro)', instanciacaoSemParcelas.inseridos_ou_atualizados === 0)

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
    id, `qa-parcelas-nf-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

async function expectError(name, callback, pattern) {
  const savepoint = `sp_${checks.length}`
  await db.query(`SAVEPOINT ${savepoint}`)
  try {
    await callback()
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, false, 'A operacao deveria ter sido bloqueada')
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, pattern.test(error instanceof Error ? error.message : String(error)), error instanceof Error ? error.message : String(error))
  }
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}

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
  const cnpjMatriz = makeCnpj('930000020001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')
  await createAuthUser(actorGestorOutroFundo, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Fase2 Parcelas',$2,'QA Admin',$3,'QA Gestora',$4,true,$5),
           ($6,'QA Fase2 Parcelas Outro',$7,'QA Admin B',$8,'QA Gestora B',$9,true,$5)`, [
    fundo, makeCnpj('950000050001'), makeCnpj('950000050002'), makeCnpj('950000050003'), actorGestor,
    fundoOutro, makeCnpj('950000060001'), makeCnpj('950000060002'), makeCnpj('950000060003'),
  ])

  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Fase2 Parcelas','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorOutroFundo, fundoOutro])

  await db.query(`insert into public.contas_escrow (cedente_id, identificador, status)
    values ($1,'QA-ESCROW-FASE2','ativa')`, [cedente])
  await db.query(`insert into public.taxas_cedente (cedente_id, prazo_min, prazo_max, taxa_percentual)
    values ($1, 1, 200, 2.5)`, [cedente])

  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-FASE2','QA Politica Fase2','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro, status, publicada_por, publicada_em)
    values ($1,$2,$3,1,now(),'qa-hash-fase2','DIAS_UTEIS_252','publicada',$4,now()) returning id`, [politica, cedenteFundoId, fundo, actorGestor])).rows[0].id
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])

  async function novaNfAprovada(numero, valorBruto, dataVencimento) {
    return (await db.query(`insert into public.notas_fiscais
      (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
       cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
      values ($1,$2,$3,$4,'1','2026-09-10',$5,$6,'QA Emitente','12345678000199','QA Sacado',$7,'aprovada')
      returning id`, [cedente, cedenteFundoId, fundo, numero, dataVencimento, cnpjMatriz, valorBruto])).rows[0].id
  }
  async function registrarParcelas(nfId, parcelas) {
    const resultado = (await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfId, JSON.stringify(parcelas)])).rows[0].resultado
    return resultado
  }
  async function parcelasDaNf(nfId) {
    return (await db.query(`select id, numero_parcela, valor_nominal, data_vencimento, status from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela`, [nfId])).rows
  }
  const PARCELAS_78 = [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ]

  await asActor(actorCedente)

  // ---- NF-78 (cenario real do ticket): 4 parcelas, todas selecionadas ----
  const nf78 = await novaNfAprovada('78', 110160.00, '2026-11-25')
  await registrarParcelas(nf78, PARCELAS_78)
  const parcelas78 = await parcelasDaNf(nf78)

  const solicitacaoA = await solicitar({
    nfIds: [nf78],
    parcelaIds: parcelas78.map((p) => p.id),
    valorBrutoTotal: 110160.00,
    dataVencimento: '2026-11-25',
  })
  ok('NF-78 (4 parcelas selecionadas) cria operacao com sucesso', Boolean(solicitacaoA.operacao_id))

  const parcelas78DepoisA = await parcelasDaNf(nf78)
  ok('As 4 parcelas da NF-78 ficam em_operacao', parcelas78DepoisA.every((p) => p.status === 'em_operacao'))
  const nf78StatusA = (await db.query(`select status from public.notas_fiscais where id=$1`, [nf78])).rows[0].status
  ok('NF-78 vira em_antecipacao (nenhuma parcela disponivel restante)', nf78StatusA === 'em_antecipacao')
  const opNfsA = (await db.query(`select count(*)::int c from public.operacoes_nfs where operacao_id=$1`, [solicitacaoA.operacao_id])).rows[0].c
  ok('operacoes_nfs recebe exatamente 1 linha para a NF-78', opNfsA === 1)
  const opParcelasA = (await db.query(`select count(*)::int c from public.operacoes_nf_parcelas where operacao_id=$1`, [solicitacaoA.operacao_id])).rows[0].c
  ok('operacoes_nf_parcelas recebe exatamente 4 linhas (uma por parcela)', opParcelasA === 4)

  // ---- Aprovacao financeira: VP somado por parcela, nao pelo ultimo vencimento ----
  await asActor(actorGestor)
  const aprovacaoA = await aprovar(solicitacaoA.operacao_id, 2.5)
  ok('Aprovacao da operacao A tem sucesso', aprovacaoA.status === 'aprovada')
  const calcA = (await db.query(`select parcela_id, valor_nominal, vencimento_contratual, valor_presente
    from public.operacao_calculo_nfs where operacao_id=$1 order by vencimento_contratual`, [solicitacaoA.operacao_id])).rows
  ok('4 linhas de memoria de calculo (uma por parcela, nao 1 para a NF inteira)', calcA.length === 4)
  ok('Cada linha de calculo aponta para uma parcela distinta', new Set(calcA.map((r) => r.parcela_id)).size === 4)
  const vencimentosCalcA = calcA.map((r) => r.vencimento_contratual.toISOString().slice(0, 10))
  ok('Os 4 vencimentos contratuais de calculo sao os 4 vencimentos reais das parcelas (nao o ultimo repetido para todas)', JSON.stringify(vencimentosCalcA) === JSON.stringify(['2026-10-11', '2026-10-26', '2026-11-10', '2026-11-25']))
  ok('Soma do valor_nominal das 4 linhas = R$ 110.160,00', calcA.reduce((sum, r) => sum + Number(r.valor_nominal), 0) === 110160)
  const somaVpA = calcA.reduce((sum, r) => sum + Number(r.valor_presente), 0)
  ok('Valor presente somado por parcela e menor que o nominal (desagio aplicado) e positivo', somaVpA > 0 && somaVpA < 110160)
  const nfAntecipado78 = (await db.query(`select valor_antecipado from public.notas_fiscais where id=$1`, [nf78])).rows[0].valor_antecipado
  ok('notas_fiscais.valor_antecipado agrega a soma correta das 4 parcelas', Math.abs(Number(nfAntecipado78) - somaVpA) < 0.01)

  // ---- NF-81: 4 parcelas, so 2 selecionadas (parcial) ----
  await asActor(actorCedente)
  const nf81 = await novaNfAprovada('81', 110160.00, '2026-11-25')
  await registrarParcelas(nf81, PARCELAS_78)
  const parcelas81 = await parcelasDaNf(nf81)
  const duasSelecionadas81 = parcelas81.slice(0, 2)

  const solicitacaoB = await solicitar({
    nfIds: [nf81],
    parcelaIds: duasSelecionadas81.map((p) => p.id),
    valorBrutoTotal: 55080.00,
    dataVencimento: '2026-10-26',
  })
  ok('NF-81 (2 de 4 parcelas selecionadas) cria operacao com sucesso', Boolean(solicitacaoB.operacao_id))
  const nf81StatusB = (await db.query(`select status from public.notas_fiscais where id=$1`, [nf81])).rows[0].status
  ok('NF-81 permanece aprovada (ainda ha parcelas disponiveis)', nf81StatusB === 'aprovada')
  const parcelas81DepoisB = await parcelasDaNf(nf81)
  ok('Parcelas 1-2 da NF-81 viram em_operacao; 3-4 continuam disponivel', (
    parcelas81DepoisB.find((p) => p.numero_parcela === 1).status === 'em_operacao'
    && parcelas81DepoisB.find((p) => p.numero_parcela === 2).status === 'em_operacao'
    && parcelas81DepoisB.find((p) => p.numero_parcela === 3).status === 'disponivel'
    && parcelas81DepoisB.find((p) => p.numero_parcela === 4).status === 'disponivel'
  ))

  await asActor(actorGestor)
  const aprovacaoB = await aprovar(solicitacaoB.operacao_id, 2.5)
  ok('Aprovacao da operacao B (parcial) tem sucesso', aprovacaoB.status === 'aprovada')
  const calcB = (await db.query(`select parcela_id from public.operacao_calculo_nfs where operacao_id=$1`, [solicitacaoB.operacao_id])).rows
  ok('Apenas 2 linhas de calculo para a NF-81 (so as parcelas cedidas, nao as 4 da NF)', calcB.length === 2)
  ok('Soma nominal da operacao B = R$ 55.080,00', calcB.length === 2 && (
    (await db.query(`select sum(valor_nominal) s from public.operacao_calculo_nfs where operacao_id=$1`, [solicitacaoB.operacao_id])).rows[0].s
  ) == 55080)

  // ---- DENY: parcela ja comprometida em outra operacao ----
  await asActor(actorCedente)
  // NF-81 continua 'aprovada' (parcelas 3-4 ainda disponiveis); usa-la aqui
  // isola o erro de disponibilidade da parcela do erro de status da NF.
  await expectError('Selecionar parcela ja comprometida (parcela 1 da NF-81, ja em outra operacao) = DENY', async () => {
    await solicitar({ nfIds: [nf81], parcelaIds: [duasSelecionadas81[0].id], valorBrutoTotal: 27540, dataVencimento: '2026-10-11' })
  }, /nao estao disponiveis/)

  // ---- DENY: NF com parcelas sem informar selecao ----
  await expectError('NF-81 (ainda com parcelas disponiveis) sem p_parcela_ids = DENY', async () => {
    await solicitar({ nfIds: [nf81], parcelaIds: null, valorBrutoTotal: 55080, dataVencimento: '2026-11-25' })
  }, /precisa informar quais parcelas/)

  // ---- DENY: lote com 2 NFs de parcela, uma delas sem nenhuma parcela selecionada ----
  const nf82 = await novaNfAprovada('82', 110160.00, '2026-11-25')
  await registrarParcelas(nf82, PARCELAS_78)
  const nf83 = await novaNfAprovada('83', 110160.00, '2026-11-25')
  await registrarParcelas(nf83, PARCELAS_78)
  const parcelas83 = await parcelasDaNf(nf83)
  await expectError('Lote com NF-82 e NF-83: selecionar so parcelas da 83 = DENY (NF-82 sem nenhuma selecionada)', async () => {
    await solicitar({
      nfIds: [nf82, nf83],
      parcelaIds: parcelas83.map((p) => p.id),
      valorBrutoTotal: 220320,
      dataVencimento: '2026-11-25',
    })
  }, /ao menos uma parcela selecionada/)

  // ---- Regressao: NF sem parcelas continua funcionando exatamente como antes ----
  const nfLegado = await novaNfAprovada('84', 5000.00, '2026-11-25')
  const solicitacaoLegado = await solicitar({ nfIds: [nfLegado], parcelaIds: null, valorBrutoTotal: 5000, dataVencimento: '2026-11-25' })
  ok('NF sem parcelas (legado) solicita normalmente sem p_parcela_ids', Boolean(solicitacaoLegado.operacao_id))
  const nfLegadoStatus = (await db.query(`select status from public.notas_fiscais where id=$1`, [nfLegado])).rows[0].status
  ok('NF sem parcelas vira em_antecipacao (comportamento legado inalterado)', nfLegadoStatus === 'em_antecipacao')

  // ---- Regressao: NF com exatamente 1 parcela ----
  const nfUnica = await novaNfAprovada('85', 27540.00, '2026-10-11')
  await registrarParcelas(nfUnica, [{ numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' }])
  const parcelaUnica = await parcelasDaNf(nfUnica)
  const solicitacaoUnica = await solicitar({ nfIds: [nfUnica], parcelaIds: [parcelaUnica[0].id], valorBrutoTotal: 27540, dataVencimento: '2026-10-11' })
  ok('NF com 1 unica parcela solicita e cede corretamente', Boolean(solicitacaoUnica.operacao_id))
  const nfUnicaStatus = (await db.query(`select status from public.notas_fiscais where id=$1`, [nfUnica])).rows[0].status
  ok('NF com 1 parcela vira em_antecipacao apos ceder a unica parcela', nfUnicaStatus === 'em_antecipacao')

  // ---- Seguranca: gestor de outro fundo nao ve operacoes_nf_parcelas (RLS) ----
  await asActor(actorGestorOutroFundo)
  const opParcelasCrossFundo = (await db.query(`select count(*)::int c from public.operacoes_nf_parcelas where operacao_id=$1`, [solicitacaoA.operacao_id])).rows[0].c
  ok('Gestor de outro fundo nao enxerga operacoes_nf_parcelas de operacao fora do seu fundo (RLS)', opParcelasCrossFundo === 0)

  // ---- Rejeicao libera parcelas para uma operacao FUTURA e DIFERENTE ----
  await asActor(actorCedente)
  const parcelas81Restantes = (await parcelasDaNf(nf81)).filter((p) => p.status === 'disponivel')
  const solicitacaoD = await solicitar({
    nfIds: [nf81],
    parcelaIds: parcelas81Restantes.map((p) => p.id),
    valorBrutoTotal: 55080,
    dataVencimento: '2026-11-25',
  })
  ok('Parcelas 3-4 da NF-81 (nao selecionadas na operacao B) podem entrar numa operacao D diferente', Boolean(solicitacaoD.operacao_id))
  const nf81StatusD = (await db.query(`select status from public.notas_fiscais where id=$1`, [nf81])).rows[0].status
  ok('NF-81 agora vira em_antecipacao (todas as 4 parcelas cedidas, em 2 operacoes distintas)', nf81StatusD === 'em_antecipacao')

  // Simula rejeicao da operacao D (mesma logica de reprovarOperacao: reverte NF, libera parcelas, remove vinculo).
  await db.query('RESET ROLE')
  const parcelasOpD = (await db.query(`select parcela_id from public.operacoes_nf_parcelas where operacao_id=$1`, [solicitacaoD.operacao_id])).rows.map((r) => r.parcela_id)
  await db.query(`update public.operacoes set status='reprovada', motivo_reprovacao='QA teste' where id=$1`, [solicitacaoD.operacao_id])
  await db.query(`update public.notas_fiscais set status='aprovada' where id=$1`, [nf81])
  await db.query(`update public.nota_fiscal_parcelas set status='disponivel' where id = ANY($1)`, [parcelasOpD])
  await db.query(`delete from public.operacoes_nf_parcelas where operacao_id=$1`, [solicitacaoD.operacao_id])

  await asActor(actorCedente)
  const solicitacaoE = await solicitar({
    nfIds: [nf81],
    parcelaIds: parcelasOpD,
    valorBrutoTotal: 55080,
    dataVencimento: '2026-11-25',
  })
  ok('Apos rejeicao, as mesmas parcelas podem ser selecionadas de novo numa operacao E (sem violar UNIQUE(parcela_id))', Boolean(solicitacaoE.operacao_id))

  await db.query('RESET ROLE')
  await db.query('ROLLBACK')
  console.log(JSON.stringify({
    project_ref: apiRef,
    transaction: 'ROLLED_BACK',
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }, null, 2))

  async function solicitar({ nfIds, parcelaIds, valorBrutoTotal, dataVencimento }) {
    const result = (await db.query(`select public.solicitar_operacao_antecipacao_atomica(
      $1,$2,$3,$4,1,'{"calculo_financeiro":{"metodo":"DIAS_UTEIS_252"}}'::jsonb,$5,false,'dispensado',$6,$7,2.5,30,$7,$8,$9,$10) resultado`, [
      cedente, cedenteFundoId, politica, politicaVersao, 'a'.repeat(64),
      nfIds, valorBrutoTotal, dataVencimento, randomUUID(),
      parcelaIds && parcelaIds.length ? parcelaIds : null,
    ])).rows[0].resultado
    return result
  }
  async function aprovar(operacaoId, taxa) {
    // Producao chama esta funcao via o wrapper aprovar_operacao_com_risco_atomica
    // (que exige o gate de risco completo, fora do escopo deste teste de
    // precificacao por parcela). RESET ROLE mantem as claims JWT do gestor
    // (auth.uid()/get_user_role() continuam resolvendo 'gestor') mas
    // remove a restricao de EXECUTE do role authenticated, exercitando a
    // funcao interna diretamente -- mesma logica de negocio, sem duplicar
    // o gate de risco aqui.
    await db.query('RESET ROLE')
    return (await db.query(`select public.aprovar_operacao_atomica_financeiro_v1($1,$2) resultado`, [operacaoId, taxa])).rows[0].resultado
  }
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
    id, `qa-fase2-parcelas-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

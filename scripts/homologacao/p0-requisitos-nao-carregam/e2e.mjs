#!/usr/bin/env node
// P0: "Requisitos documentais da NF nao carregam apesar da politica
// publicada". Confirma a causa raiz (ORDER_OF_OPERATIONS_BUG) e valida a
// correcao (registrar parcelas ANTES da primeira instanciacao de
// requisitos), alem dos cenarios obrigatorios do ticket. Tudo roda numa
// unica transacao revertida em homologacao -- nada persiste.

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
  const cnpjMatriz = makeCnpj('970000010001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Diag Requisitos',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundo, makeCnpj('960000070001'), makeCnpj('960000070002'), makeCnpj('960000070003'), actorGestor,
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Diag Requisitos','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])

  let politicaSeq = 0
  async function criarPoliticaComRequisitos(requisitos) {
    politicaSeq += 1
    await db.query('RESET ROLE')
    const codigo = `QA-DIAG-${politicaSeq}`
    const politica = (await db.query(`insert into public.politicas_operacionais
      (fundo_id, codigo, nome, status, created_by) values ($1,$2,$3,'ativa',$4) returning id`,
      [fundo, codigo, `QA Politica ${codigo}`, actorGestor])).rows[0].id
    const versao = (await db.query(`insert into public.politica_operacional_versoes
      (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
      values ($1,$2,$3,1,now(),$4,'DIAS_UTEIS_252') returning id`,
      [politica, cedenteFundoId, fundo, `qa-hash-${codigo}`])).rows[0].id
    for (const requisito of requisitos) {
      await db.query(`insert into public.politica_requisitos_documentais
        (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao)
        values ($1,$2,$3,$4,$5,$5,$5,$6,$7,$7,'cedente','gestor')`,
        [versao, politica, cedenteFundoId, requisito.codigo, requisito.escopo, requisito.tipo, requisito.obrigatorio])
    }
    // Publica so depois de inserir os requisitos: versao publicada e imutavel.
    await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, versao])
    // So um vinculo cedente-fundo pode ter uma politica vigente por vez --
    // encerra a atribuicao anterior antes de atribuir a proxima politica de
    // teste (cada cenario deste script usa uma politica diferente para o
    // mesmo cedente-fundo).
    // clock_timestamp() (nao now()) para garantir vigente_ate > vigente_desde
    // mesmo dentro da mesma transacao (now() fica congelado no inicio da tx).
    await db.query(`update public.cedente_fundo_politicas set status='encerrada', vigente_ate=clock_timestamp()
      where cedente_fundo_id=$1 and status='ativa'`, [cedenteFundoId])
    await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
      values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])
    return { politica, versao }
  }

  let nfSeq = 0
  async function criarNf() {
    nfSeq += 1
    const numero = `DIAG-${nfSeq}`
    return (await db.query(`insert into public.notas_fiscais
      (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
       cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
      values ($1,$2,$3,$4,'1','2026-09-10','2026-11-25',$5,'QA Emitente','12345678000199','QA Sacado',110160.00,'rascunho')
      returning id`, [cedente, cedenteFundoId, fundo, numero, cnpjMatriz])).rows[0].id
  }

  async function instanciar(nfId, politicaId, versaoId) {
    return (await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nfId, politicaId, versaoId])).rows[0].resultado
  }

  async function registrarParcelas(nfId, parcelas) {
    return (await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfId, JSON.stringify(parcelas)])).rows[0].resultado
  }

  async function snapshot(nfId) {
    const rows = (await db.query(`
      select tipo_documento_codigo_snapshot as tipo, count(*)::int n
      from public.documento_requisito_instancias where nota_fiscal_id = $1
      group by tipo_documento_codigo_snapshot
    `, [nfId])).rows
    const byTipo = { nf_xml: 0, nf_danfe_pdf: 0, cte: 0, boleto: 0 }
    for (const row of rows) byTipo[row.tipo] = row.n
    return byTipo
  }

  const PARCELAS = [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ]

  await asActor(actorCedente)

  // ---- Politica A: exatamente os requisitos do print do ticket (boleto obrigatorio) ----
  const politicaA = await criarPoliticaComRequisitos([
    { codigo: 'XML_NF', escopo: 'nf_pre_cessao', tipo: 'nf_xml', obrigatorio: true },
    { codigo: 'DANFE', escopo: 'nf_pre_cessao', tipo: 'nf_danfe_pdf', obrigatorio: true },
    { codigo: 'CTE', escopo: 'nf_pre_cessao', tipo: 'cte', obrigatorio: true },
    { codigo: 'COMPROVANTE_ENTREGA', escopo: 'pos_cessao', tipo: 'comprovante_entrega', obrigatorio: true },
    { codigo: 'BOLETO_PARCELA', escopo: 'nf_pre_cessao', tipo: 'boleto', obrigatorio: true },
  ])

  // ---- Causa raiz: ORDEM ANTIGA (instanciar ANTES de registrar parcelas) ----
  const nfOrdemAntiga = await criarNf()
  await instanciar(nfOrdemAntiga, politicaA.politica, politicaA.versao)
  const antesDeParcelas = await snapshot(nfOrdemAntiga)
  ok('Causa raiz confirmada: instanciar ANTES de registrar parcelas cria XML/DANFE/CT-e mas 0 boletos', (
    antesDeParcelas.boleto === 0 && antesDeParcelas.nf_xml === 1 && antesDeParcelas.nf_danfe_pdf === 1 && antesDeParcelas.cte === 1
  ), JSON.stringify(antesDeParcelas))
  await registrarParcelas(nfOrdemAntiga, PARCELAS)
  const depoisDeParcelasSemReconciliar = await snapshot(nfOrdemAntiga)
  ok('Sem reconciliacao, boleto continua ausente mesmo com as parcelas ja existindo (o gap real)', depoisDeParcelasSemReconciliar.boleto === 0, JSON.stringify(depoisDeParcelasSemReconciliar))
  await instanciar(nfOrdemAntiga, politicaA.politica, politicaA.versao)
  const depoisDeReconciliar = await snapshot(nfOrdemAntiga)
  ok('Reconciliacao (equivalente a abrir o checklist) recupera o boleto sem duplicar XML/DANFE/CT-e', (
    depoisDeReconciliar.boleto === 4 && depoisDeReconciliar.nf_xml === 1 && depoisDeReconciliar.nf_danfe_pdf === 1 && depoisDeReconciliar.cte === 1
  ), JSON.stringify(depoisDeReconciliar))

  // ---- Correcao: ORDEM NOVA (registrar parcelas ANTES da 1a instanciacao) ----
  const nfOrdemNova = await criarNf()
  await registrarParcelas(nfOrdemNova, PARCELAS)
  await instanciar(nfOrdemNova, politicaA.politica, politicaA.versao)
  const ordemNova = await snapshot(nfOrdemNova)
  ok('Cenario 1 (ordem corrigida): 1a instanciacao ja cria XML=1, DANFE=1, CT-e=1 e Boleto=4 de uma vez', (
    ordemNova.nf_xml === 1 && ordemNova.nf_danfe_pdf === 1 && ordemNova.cte === 1 && ordemNova.boleto === 4
  ), JSON.stringify(ordemNova))

  // ---- Cenario 5: reload -- requisitos permanecem e nao duplicam apos releitura ----
  await instanciar(nfOrdemNova, politicaA.politica, politicaA.versao)
  await instanciar(nfOrdemNova, politicaA.politica, politicaA.versao)
  const aposReload = await snapshot(nfOrdemNova)
  ok('Cenario 5 (reload): releituras repetidas nao duplicam nenhum requisito', (
    aposReload.nf_xml === 1 && aposReload.nf_danfe_pdf === 1 && aposReload.cte === 1 && aposReload.boleto === 4
  ), JSON.stringify(aposReload))

  // ---- Cenario 3: NF sem parcelas -- fluxo legado continua carregando os
  // requisitos por-NF (roda enquanto a politica A ainda esta vigente para
  // o vinculo -- so um vinculo cedente-fundo tem uma politica ativa por vez).
  const nfLegado = await criarNf()
  await instanciar(nfLegado, politicaA.politica, politicaA.versao)
  const legado = await snapshot(nfLegado)
  ok('Cenario 3: NF sem parcelas continua instanciando XML/DANFE/CT-e (boleto=0, nada para ancorar)', (
    legado.nf_xml === 1 && legado.nf_danfe_pdf === 1 && legado.cte === 1 && legado.boleto === 0
  ), JSON.stringify(legado))

  // ---- Cenario 2: politica SEM boleto + NF com parcelas ----
  const politicaB = await criarPoliticaComRequisitos([
    { codigo: 'XML_NF', escopo: 'nf_pre_cessao', tipo: 'nf_xml', obrigatorio: true },
    { codigo: 'DANFE', escopo: 'nf_pre_cessao', tipo: 'nf_danfe_pdf', obrigatorio: true },
    { codigo: 'CTE', escopo: 'nf_pre_cessao', tipo: 'cte', obrigatorio: true },
  ])
  const nfSemBoleto = await criarNf()
  await registrarParcelas(nfSemBoleto, PARCELAS)
  await instanciar(nfSemBoleto, politicaB.politica, politicaB.versao)
  const semBoleto = await snapshot(nfSemBoleto)
  ok('Cenario 2: politica sem boleto + NF com parcelas -> parcelas existem, boleto=0, XML/DANFE/CT-e presentes', (
    semBoleto.boleto === 0 && semBoleto.nf_xml === 1 && semBoleto.nf_danfe_pdf === 1 && semBoleto.cte === 1
  ), JSON.stringify(semBoleto))
  const parcelasNfSemBoleto = (await db.query(`select count(*)::int c from public.nota_fiscal_parcelas where nota_fiscal_id=$1`, [nfSemBoleto])).rows[0].c
  ok('Cenario 2: as 4 parcelas financeiras existem independente do requisito documental de boleto', parcelasNfSemBoleto === 4)

  // ---- Cenario 4: boleto opcional -- aparece mas nao bloqueia se ausente ----
  const politicaC = await criarPoliticaComRequisitos([
    { codigo: 'XML_NF', escopo: 'nf_pre_cessao', tipo: 'nf_xml', obrigatorio: true },
    { codigo: 'BOLETO_PARCELA', escopo: 'nf_pre_cessao', tipo: 'boleto', obrigatorio: false },
  ])
  const nfBoletoOpcional = await criarNf()
  await registrarParcelas(nfBoletoOpcional, PARCELAS)
  await instanciar(nfBoletoOpcional, politicaC.politica, politicaC.versao)
  const boletoOpcionalRows = (await db.query(`select obrigatorio from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='boleto'`, [nfBoletoOpcional])).rows
  ok('Cenario 4: boleto opcional gera as 4 instancias com obrigatorio=false (nao bloqueia elegibilidade)', (
    boletoOpcionalRows.length === 4 && boletoOpcionalRows.every((row) => row.obrigatorio === false)
  ), JSON.stringify(boletoOpcionalRows))

  // ---- Compensacao: com a nova ordem, parcelas sao persistidas ANTES do
  // documento XML -- removerNotaFiscalParcial precisa conseguir remover a
  // NF mesmo com parcelas ja existindo (nota_fiscal_parcelas e ON DELETE
  // RESTRICT). Replica a sequencia real de limpeza (documento_requisito_instancias
  // -> nota_fiscal_parcelas -> notas_fiscais) para confirmar que nao ha
  // violacao de FK.
  const nfParaCompensar = await criarNf()
  await registrarParcelas(nfParaCompensar, PARCELAS)
  await instanciar(nfParaCompensar, politicaC.politica, politicaC.versao)
  // removerNotaFiscalParcial usa createAdminClient() (service role, sem RLS) na producao.
  await db.query('RESET ROLE')
  await db.query(`delete from public.documento_requisito_instancias where nota_fiscal_id=$1`, [nfParaCompensar])
  await db.query(`delete from public.nota_fiscal_parcelas where nota_fiscal_id=$1`, [nfParaCompensar])
  const deleteNf = await db.query(`delete from public.notas_fiscais where id=$1 and cedente_id=$2`, [nfParaCompensar, cedente])
  ok('Compensacao: remocao de NF com parcelas ja persistidas nao viola FK (ON DELETE RESTRICT)', deleteNf.rowCount === 1)

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
    id, `qa-diag-requisitos-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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

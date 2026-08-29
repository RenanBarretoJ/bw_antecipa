#!/usr/bin/env node
// P0 Rejeicao/Relibera Parcelas: valida ao vivo em homolog que reprovar (gestor)
// ou cancelar (cedente) uma operacao com parcelas de fato libera as parcelas
// (nota_fiscal_parcelas.status volta a 'disponivel' e o vinculo em
// operacoes_nf_parcelas e removido), sem afetar operacoes paralelas nem apagar
// o historico. Reproduz e cobre o bug real: liberarParcelasDaOperacao fazia
// UPDATE/DELETE direto nessas duas tabelas, que so tem GRANT SELECT para
// authenticated -- a escrita falhava com "permission denied" silenciosamente
// (o codigo nao checava { error }), entao a NF reprovada voltava a aparecer em
// "Nova Solicitacao" com 0 parcelas disponiveis para expandir. Corrigido por
// uma RPC SECURITY DEFINER (liberar_parcelas_operacao_rejeitada) chamada tanto
// por reprovarOperacao (gestor) quanto por cancelarOperacao (cedente).
//
// Achado colateral tambem coberto aqui: cancelarOperacao nunca teve RLS de
// UPDATE para cedente em public.operacoes (so existia operacoes_gestor_update)
// -- o update ficava silenciosamente sem efeito (0 linhas, sem erro de RLS) e
// o botao "Cancelar" do cedente reportava sucesso sem cancelar nada. Corrigido
// pela policy operacoes_cedente_update.

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

let spCounter = 0
async function tryStep(label, callback) {
  const savepoint = `sp_step_${spCounter++}`
  await db.query(`SAVEPOINT ${savepoint}`)
  try {
    return await callback()
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    console.error(`[tryStep] ${label} falhou: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

try {
  await db.query('BEGIN')

  const actorCedente = randomUUID()
  const actorGestor = randomUUID()
  const actorGestorOutroFundo = randomUUID()
  const fundo = randomUUID()
  const fundoOutro = randomUUID()
  const cnpjMatriz = makeCnpj('930000100001')

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorGestor, 'gestor')
  await createAuthUser(actorGestorOutroFundo, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA Rejeicao Relibera',$2,'QA Admin',$3,'QA Gestora',$4,true,$5),
           ($6,'QA Rejeicao Relibera Outro',$7,'QA Admin B',$8,'QA Gestora B',$9,true,$5)`, [
    fundo, makeCnpj('950000100001'), makeCnpj('950000100002'), makeCnpj('950000100003'), actorGestor,
    fundoOutro, makeCnpj('950000110001'), makeCnpj('950000110002'), makeCnpj('950000110003'),
  ])
  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente Rejeicao Relibera','ativo') returning id`, [actorCedente, cnpjMatriz])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestorOutroFundo, fundoOutro])
  await db.query(`insert into public.contas_escrow (cedente_id, identificador, status) values ($1,'QA-ESCROW-REJEICAO','ativa')`, [cedente])
  await db.query(`insert into public.taxas_cedente (cedente_id, prazo_min, prazo_max, taxa_percentual) values ($1, 1, 200, 2.5)`, [cedente])

  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-REJEICAO','QA Politica Rejeicao','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro, status, publicada_por, publicada_em)
    values ($1,$2,$3,1,now(),'qa-hash-rejeicao','DIAS_UTEIS_252','publicada',$4,now()) returning id`, [politica, cedenteFundoId, fundo, actorGestor])).rows[0].id
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
    return (await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfId, JSON.stringify(parcelas)])).rows[0].resultado
  }
  async function parcelasDaNf(nfId) {
    return (await db.query(`select id, numero_parcela, valor_nominal, data_vencimento, status from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela`, [nfId])).rows
  }
  async function solicitar(nfIds, parcelaIds, valorBrutoTotal, dataVencimento) {
    return (await db.query(`select public.solicitar_operacao_antecipacao_atomica(
      $1,$2,$3,$4,1,'{"calculo_financeiro":{"metodo":"DIAS_UTEIS_252"}}'::jsonb,$5,false,'dispensado',$6,$7,2.5,30,$7,$8,$9,$10) resultado`, [
      cedente, cedenteFundoId, politica, politicaVersao, 'd'.repeat(64),
      nfIds, valorBrutoTotal, dataVencimento, randomUUID(),
      parcelaIds && parcelaIds.length ? parcelaIds : null,
    ])).rows[0].resultado
  }
  async function reprovar(operacaoId) {
    await tryStep('update operacoes reprovada', () =>
      db.query(`update public.operacoes set status='reprovada', motivo_reprovacao='QA teste' where id=$1`, [operacaoId]))
    const opNfs = (await db.query(`select nota_fiscal_id from public.operacoes_nfs where operacao_id=$1`, [operacaoId])).rows
    await tryStep('update notas_fiscais aprovada', () =>
      db.query(`update public.notas_fiscais set status='aprovada', aprovacao_sacado_em=null where id = ANY($1)`, [opNfs.map((r) => r.nota_fiscal_id)]))
    return tryStep('RPC liberar_parcelas_operacao_rejeitada', () =>
      db.query(`select public.liberar_parcelas_operacao_rejeitada($1) resultado`, [operacaoId]))
  }
  async function cancelar(operacaoId) {
    await tryStep('update operacoes cancelada (cedente)', () =>
      db.query(`update public.operacoes set status='cancelada' where id=$1`, [operacaoId]))
    const opNfs = (await db.query(`select nota_fiscal_id from public.operacoes_nfs where operacao_id=$1`, [operacaoId])).rows
    await tryStep('update notas_fiscais aprovada (cedente)', () =>
      db.query(`update public.notas_fiscais set status='aprovada', aprovacao_sacado_em=null where id = ANY($1)`, [opNfs.map((r) => r.nota_fiscal_id)]))
    return tryStep('RPC liberar_parcelas_operacao_rejeitada (cedente)', () =>
      db.query(`select public.liberar_parcelas_operacao_rejeitada($1) resultado`, [operacaoId]))
  }
  async function statusListagemNovaSolicitacao(nfId, dataBase = '2026-08-20') {
    return (await db.query(`
      select nf.status as nf_status,
        (select count(*)::int from public.nota_fiscal_parcelas p where p.nota_fiscal_id = nf.id and p.status='disponivel' and p.data_vencimento >= $2) as parcelas_disponiveis
      from public.notas_fiscais nf where nf.id = $1
    `, [nfId, dataBase])).rows[0]
  }

  const PARCELAS = [
    { numero_parcela: 1, valor_nominal: 5000.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 5000.00, data_vencimento: '2026-10-26' },
  ]

  // ============================================================
  // Cenario principal do ticket: NF-56 + NF-78 numa mesma operacao, rejeitada,
  // cedente volta pra Nova Solicitacao e as duas voltam a expandir parcelas.
  // ============================================================
  await asActor(actorCedente)
  const nf56 = await novaNfAprovada('56', 10000.00, '2026-10-26')
  await registrarParcelas(nf56, PARCELAS)
  const nf78 = await novaNfAprovada('78', 10000.00, '2026-10-26')
  await registrarParcelas(nf78, PARCELAS)
  const parcelas56 = await parcelasDaNf(nf56)
  const parcelas78 = await parcelasDaNf(nf78)

  const opPrincipal = await solicitar([nf56, nf78], [...parcelas56, ...parcelas78].map((p) => p.id), 20000.00, '2026-10-26')
  ok('1. Operacao criada com NF-56 + NF-78 (2 parcelas cada)', Boolean(opPrincipal.operacao_id))

  await asActor(actorGestor)
  const reprovacaoPrincipal = await reprovar(opPrincipal.operacao_id)
  ok('2. Gestor rejeita a operacao com sucesso (RPC sem permission denied)', reprovacaoPrincipal !== null)

  await asActor(actorCedente)
  const listagem56 = await statusListagemNovaSolicitacao(nf56)
  const listagem78 = await statusListagemNovaSolicitacao(nf78)
  ok('3-4. NF-56 volta para Nova Solicitacao com as 2 parcelas expandindo', listagem56.nf_status === 'aprovada' && listagem56.parcelas_disponiveis === 2, JSON.stringify(listagem56))
  ok('3-5. NF-78 volta para Nova Solicitacao com as 2 parcelas expandindo', listagem78.nf_status === 'aprovada' && listagem78.parcelas_disponiveis === 2, JSON.stringify(listagem78))

  const opNova = await solicitar([nf56, nf78], [...parcelas56, ...parcelas78].map((p) => p.id), 20000.00, '2026-10-26')
  ok('6. Nova operacao com as MESMAS parcelas apos rejeicao = ALLOW', Boolean(opNova.operacao_id))

  // Historico: a operacao rejeitada continua mostrando suas parcelas originais
  // via logs_auditoria (operacoes_nf_parcelas e um vinculo de exclusividade
  // ATIVA, corretamente removido; o registro historico e o log de auditoria).
  await db.query('RESET ROLE')
  const logOriginal = (await db.query(`select dados_depois from public.logs_auditoria where entidade_id=$1 and tipo_evento='OPERACAO_SOLICITADA' order by created_at asc limit 1`, [opPrincipal.operacao_id])).rows[0]
  const parcelaIdsLog = logOriginal?.dados_depois?.parcela_ids || []
  ok(
    'Operacao rejeitada preserva historicamente as parcelas originais (logs_auditoria)',
    new Set(parcelaIdsLog).size === 4 && [...parcelas56, ...parcelas78].every((p) => parcelaIdsLog.includes(p.id)),
    JSON.stringify(parcelaIdsLog),
  )
  const opNfsHistorico = (await db.query(`select count(*)::int c from public.operacoes_nfs where operacao_id=$1`, [opPrincipal.operacao_id])).rows[0].c
  ok('operacoes_nfs da operacao rejeitada nao e apagado (historico legado preservado)', opNfsHistorico === 2)

  // ============================================================
  // 7-8. Rejeicao PARCIAL: NF-90 com 4 parcelas, 2 numa operacao (rejeitada),
  // 2 numa operacao paralela ATIVA -- a rejeicao so libera as suas.
  // ============================================================
  await asActor(actorCedente)
  const nf90 = await novaNfAprovada('90', 20000.00, '2026-11-25')
  const PARCELAS_90 = [
    { numero_parcela: 1, valor_nominal: 5000.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 5000.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 5000.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 5000.00, data_vencimento: '2026-11-25' },
  ]
  await registrarParcelas(nf90, PARCELAS_90)
  const parcelas90 = await parcelasDaNf(nf90)
  const opParcial = await solicitar([nf90], [parcelas90[0].id, parcelas90[1].id], 10000.00, '2026-10-26')
  ok('7. Setup: operacao parcial (parcelas 1-2 da NF-90) criada', Boolean(opParcial.operacao_id))
  const opParalelaNf90 = await solicitar([nf90], [parcelas90[2].id, parcelas90[3].id], 10000.00, '2026-11-25')
  ok('8. Setup: operacao paralela ATIVA (parcelas 3-4 da mesma NF-90) criada', Boolean(opParalelaNf90.operacao_id))

  await asActor(actorGestor)
  await reprovar(opParcial.operacao_id)

  await db.query('RESET ROLE')
  const parcelas90Depois = await parcelasDaNf(nf90)
  ok(
    '7. Rejeicao parcial libera SO as parcelas 1-2 (as suas)',
    parcelas90Depois.find((p) => p.numero_parcela === 1).status === 'disponivel'
    && parcelas90Depois.find((p) => p.numero_parcela === 2).status === 'disponivel',
    JSON.stringify(parcelas90Depois.map((p) => ({ n: p.numero_parcela, s: p.status }))),
  )
  ok(
    '8. Operacao paralela ATIVA (parcelas 3-4) NAO e afetada pela rejeicao da operacao parcial',
    parcelas90Depois.find((p) => p.numero_parcela === 3).status === 'em_operacao'
    && parcelas90Depois.find((p) => p.numero_parcela === 4).status === 'em_operacao',
    JSON.stringify(parcelas90Depois.map((p) => ({ n: p.numero_parcela, s: p.status }))),
  )

  // ============================================================
  // 9. Regressao do ticket anterior: parcela com vencimento ja passado
  // continua excluida da listagem mesmo apos qualquer rejeicao.
  // ============================================================
  await asActor(actorCedente)
  const nfVencida = await novaNfAprovada('91', 10000.00, '2026-11-25')
  await registrarParcelas(nfVencida, [
    { numero_parcela: 1, valor_nominal: 5000.00, data_vencimento: '2026-08-19' }, // vencida (antes de 2026-08-20)
    { numero_parcela: 2, valor_nominal: 5000.00, data_vencimento: '2026-11-25' },
  ])
  const listagemVencida = await statusListagemNovaSolicitacao(nfVencida)
  ok('9. Parcela vencida continua excluida da listagem (so a parcela 2 disponivel)', listagemVencida.parcelas_disponiveis === 1, JSON.stringify(listagemVencida))

  // ============================================================
  // 10. Regressao legado: NF SEM parcelas continua bloqueada para sempre por
  // presenca em operacoes_nfs (mesmo apos rejeicao) -- comportamento
  // legado inalterado, nao faz parte do escopo deste ticket.
  // ============================================================
  const nfLegado = await novaNfAprovada('92', 5000.00, '2026-11-25')
  const opLegado = await solicitar([nfLegado], null, 5000.00, '2026-11-25')
  ok('10. Setup: NF sem parcelas (legado) solicitada normalmente', Boolean(opLegado.operacao_id))
  await asActor(actorGestor)
  await reprovar(opLegado.operacao_id)
  await asActor(actorCedente)
  await expectError('10. NF sem parcelas (legado): apos rejeicao, comportamento legado (bloqueio por operacoes_nfs) inalterado', async () => {
    await solicitar([nfLegado], null, 5000.00, '2026-11-25')
  }, /ja estao vinculadas/)

  // ============================================================
  // CANCELAMENTO pelo cedente (mesma RPC, achado colateral da policy nova)
  // ============================================================
  await asActor(actorCedente)
  const nf70 = await novaNfAprovada('70', 10000.00, '2026-10-26')
  await registrarParcelas(nf70, PARCELAS)
  const parcelas70 = await parcelasDaNf(nf70)
  const opCancelamento = await solicitar([nf70], parcelas70.map((p) => p.id), 10000.00, '2026-10-26')
  await cancelar(opCancelamento.operacao_id)
  await asActor(actorCedente)
  const listagem70 = await statusListagemNovaSolicitacao(nf70)
  ok('Cancelamento pelo cedente tambem libera as parcelas (mesma RPC)', listagem70.parcelas_disponiveis === 2, JSON.stringify(listagem70))

  // ============================================================
  // Seguranca: gestor de outro fundo nao pode chamar a RPC para operacao fora do seu fundo.
  // ============================================================
  await asActor(actorCedente)
  const nfSeguranca = await novaNfAprovada('93', 5000.00, '2026-10-11')
  await registrarParcelas(nfSeguranca, [{ numero_parcela: 1, valor_nominal: 5000.00, data_vencimento: '2026-10-11' }])
  const parcelasSeguranca = await parcelasDaNf(nfSeguranca)
  const opSeguranca = await solicitar([nfSeguranca], parcelasSeguranca.map((p) => p.id), 5000.00, '2026-10-11')
  await db.query('RESET ROLE')
  await db.query(`update public.operacoes set status='reprovada', motivo_reprovacao='QA seguranca' where id=$1`, [opSeguranca.operacao_id])
  await asActor(actorGestorOutroFundo)
  await expectError('Seguranca: gestor de OUTRO fundo nao pode chamar a RPC (DENY)', async () => {
    await db.query(`select public.liberar_parcelas_operacao_rejeitada($1) resultado`, [opSeguranca.operacao_id])
  }, /sem vinculo ativo/)

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
    id, `qa-rejeicao-relibera-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
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
  const savepoint = `sp_expect_${checks.length}`
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

#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { assertHomologEnvironment, createAdminClient, getPerf9aLocalDir, loadEnvFile, writeRestrictedJson } from './common.mjs'

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { await main() } catch (error) { console.error(`Golden Escopo 9A.2 falhou: ${safeError(error)}`); process.exitCode = 1 }
}

async function main() {
  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  const admin = createAdminClient(env)
  const credentials = JSON.parse(readFileSync(resolve(getPerf9aLocalDir('credentials'), `users-${env.projectRef}.json`), 'utf8'))
  const users = new Map(credentials.users.map((user) => [user.key, user]))
  const fixtures = await loadFixtureIds(admin)
  const links = await selectOrThrow(admin.from('cedente_fundos').select('id,cedente_id').in('fundo_id', [fixtures.fundA]).eq('status', 'ativo'), 'vinculos do fundo A')
  const linkIds = links.map((row) => row.id)
  const cedenteIds = [...new Set(links.map((row) => row.cedente_id))]
  const operations = await selectOrThrow(admin.from('operacoes').select('id,cedente_id,cedente_fundo_id,valor_bruto_total,valor_liquido_desembolso,taxa_desconto,status,created_at').in('cedente_fundo_id', linkIds), 'operacoes do fundo A')
  const invoices = await selectOrThrow(admin.from('notas_fiscais').select('id,cedente_fundo_id,fundo_id,status,valor_bruto,cnpj_destinatario,data_vencimento').eq('fundo_id', fixtures.fundA), 'NFs do fundo A')
  const documents = cedenteIds.length ? await selectOrThrow(admin.from('documentos').select('id,cedente_id,status').in('cedente_id', cedenteIds), 'documentos do fundo A') : []
  const accounts = cedenteIds.length ? await selectOrThrow(admin.from('contas_escrow').select('id,cedente_id,saldo_disponivel,saldo_bloqueado').in('cedente_id', cedenteIds), 'contas escrow do fundo A') : []
  const deliveries = invoices.length ? await selectInChunks(admin, 'nota_fiscal_entregas', 'nota_fiscal_id,status_entrega', 'nota_fiscal_id', invoices.map((row) => row.id), 'entregas do fundo A') : []

  const valid = operations.filter((row) => !['cancelada', 'reprovada'].includes(row.status))
  const month = operations.filter((row) => String(row.created_at).startsWith('2026-07-'))
  const validMonth = month.filter((row) => !['cancelada', 'reprovada'].includes(row.status))
  const expectedManager = {
    totalCedentes: cedenteIds.length,
    cedentesAtivos: cedenteIds.length,
    docsPendentes: documents.filter((row) => ['enviado', 'em_analise'].includes(row.status)).length,
    opsAtivas: operations.filter((row) => row.status === 'em_andamento').length,
    opsSolicitadas: operations.filter((row) => ['solicitada', 'em_analise'].includes(row.status)).length,
    opsInadimplentes: operations.filter((row) => row.status === 'inadimplente').length,
    volumeAtivo: sum(operations.filter((row) => row.status === 'em_andamento'), 'valor_liquido_desembolso'),
    volumeMes: sum(validMonth, 'valor_bruto_total'),
    saldoEscrowTotal: accounts.reduce((total, row) => total + number(row.saldo_disponivel) + number(row.saldo_bloqueado), 0),
    nfsPendentes: invoices.filter((row) => ['submetida', 'em_analise'].includes(row.status)).length,
    entregasEmTransito: deliveries.filter((row) => ['em_transito', 'aguardando_validacao'].includes(row.status_entrega)).length,
    entregasComPendencia: deliveries.filter((row) => row.status_entrega === 'entrega_com_pendencia').length,
    entregasEntregues: deliveries.filter((row) => row.status_entrega === 'entregue').length,
  }
  const expectedManagerReport = {
    volumeBrutoMes: sum(validMonth, 'valor_bruto_total'),
    receitaMes: sum(validMonth, 'valor_bruto_total') - sum(validMonth, 'valor_liquido_desembolso'),
    operacoesValidasMes: validMonth.length,
    volumeTotalGeral: sum(valid, 'valor_bruto_total'),
    operacoesTotalGeral: valid.length,
  }

  const obtained = {}
  obtained.gestor = await callRpc(env, users.get('gestor_a'), 'dashboard_gestor_resumo', { p_fundo_id: fixtures.fundA })
  obtained.cedente = await callRpc(env, users.get('cedente_a'), 'dashboard_cedente_resumo', { p_cedente_fundo_id: fixtures.linkA })
  obtained.consultor = await callRpc(env, users.get('consultor_a'), 'dashboard_consultor_resumo', {})
  obtained.sacado = await callRpc(env, users.get('sacado_a'), 'carregar_dashboard_sacado', {})
  obtained.gestorReport = await callRpc(env, users.get('gestor_a'), 'relatorio_gestor_analitico', { p_fundo_id: fixtures.fundA, p_mes: '2026-07', p_busca: null, p_status: null, p_cedente_id: null, p_data_inicial: null, p_data_final: null, p_offset: 0, p_page_size: 20, p_sort: 'volume_total', p_direction: 'desc' })
  obtained.consultorReport = await callRpc(env, users.get('consultor_a'), 'relatorio_consultor_analitico', { p_mes: '2026-07', p_busca: null, p_status: null, p_cedente_id: null, p_data_inicial: null, p_data_final: null, p_offset: 0, p_page_size: 20, p_sort: 'volume_total', p_direction: 'desc' })

  const checks = [
    compare('gestor.totalCedentes', expectedManager.totalCedentes, obtained.gestor?.totalCedentes),
    compare('gestor.opsAtivas', expectedManager.opsAtivas, obtained.gestor?.opsAtivas),
    compare('gestor.volumeAtivo', expectedManager.volumeAtivo, obtained.gestor?.volumeAtivo),
    compare('gestor.volumeMes', expectedManager.volumeMes, obtained.gestor?.volumeMes),
    compare('gestor.saldoEscrowTotal', expectedManager.saldoEscrowTotal, obtained.gestor?.saldoEscrowTotal),
    compare('gestor.nfsPendentes', expectedManager.nfsPendentes, obtained.gestor?.nfsPendentes),
    compare('gestor.entregasEmTransito', expectedManager.entregasEmTransito, obtained.gestor?.entregasEmTransito),
    compare('gestorReport.volumeBrutoMes', expectedManagerReport.volumeBrutoMes, obtained.gestorReport?.resumo?.volumeBrutoMes),
    compare('gestorReport.receitaMes', expectedManagerReport.receitaMes, obtained.gestorReport?.resumo?.receitaMes),
    compare('gestorReport.volumeTotalGeral', expectedManagerReport.volumeTotalGeral, obtained.gestorReport?.resumo?.volumeTotalGeral),
    compare('gestorReport.operacoesTotalGeral', expectedManagerReport.operacoesTotalGeral, obtained.gestorReport?.resumo?.operacoesTotalGeral),
  ]
  const result = { scope: '9A.2', gate: 'golden-financeiro', projectRef: env.projectRef, executedAt: new Date().toISOString(), period: '2026-07 UTC', expected: { manager: expectedManager, managerReport: expectedManagerReport }, obtained, checks, status: checks.every((check) => check.status === 'OK') ? 'APROVADO_NOS_INDICADORES_COBERTOS' : 'DIVERGENCIA' }
  const evidencePath = resolve(getPerf9aLocalDir('evidence'), `golden-escopo9a2-${env.projectRef}-${new Date().toISOString().replaceAll(':', '-')}.json`)
  writeRestrictedJson(evidencePath, result)
  console.log(`Golden financeiro concluido. Evidencia local restrita: ${evidencePath}`)
  console.log(`Indicadores cobertos: ${checks.filter((check) => check.status === 'OK').length}/${checks.length}; status ${result.status}`)
}

async function callRpc(env, user, functionName, params) {
  if (!user) throw new Error(`Credencial ausente para ${functionName}.`)
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const client = createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const signIn = await client.auth.signInWithPassword({ email: user.email, password: user.password })
  if (signIn.error) return { error: safeError(signIn.error) }
  const { data, error } = await client.rpc(functionName, params)
  await client.auth.signOut()
  return error ? { error: safeError(error) } : data
}

async function loadFixtureIds(admin) {
  const funds = await selectOrThrow(admin.from('fundos').select('id,nome').eq('nome', 'PERF9A_FUNDO A').single(), 'fundo A')
  const cedente = await selectOrThrow(admin.from('cedentes').select('id,user_id,razao_social').eq('razao_social', 'PERF9A_CEDENTE A 1').single(), 'cedente A')
  const link = await selectOrThrow(admin.from('cedente_fundos').select('id').eq('cedente_id', cedente.id).eq('fundo_id', funds.id).eq('status', 'ativo').single(), 'vinculo A')
  return { fundA: funds.id, linkA: link.id }
}

async function selectOrThrow(query, label) {
  const { data, error } = await query
  if (error) throw new Error(`Falha ao carregar ${label}: ${error.message}`)
  return data
}
async function selectInChunks(admin, table, fields, column, values, label) {
  const rows = []
  for (let index = 0; index < values.length; index += 100) {
    rows.push(...await selectOrThrow(admin.from(table).select(fields).in(column, values.slice(index, index + 100)), `${label} (${index + 1}-${Math.min(index + 100, values.length)})`))
  }
  return rows
}
function number(value) { return Number(value || 0) }
function sum(rows, field) { return round(rows.reduce((total, row) => total + number(row[field]), 0)) }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100 }
function compare(name, expected, obtained) { const equal = round(number(expected)) === round(number(obtained)); return { name, expected: round(number(expected)), obtained: round(number(obtained)), status: equal ? 'OK' : 'DIVERGENTE' } }
function safeError(error) { return (error instanceof Error ? error.message : String(error)).replace(/eyJ[A-Za-z0-9._-]+/g, '<token-redigido>') }

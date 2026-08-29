import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertHomologEnvironment, assertMutation, cnpjDigits, loadHomologEnv, mutationConfirmation, parseArgs } from '../rlx-golden/helpers.mjs'

// Fixture de homologacao exclusiva do E2E de SAIDA do bootstrap: cria uma
// operacao sintetica ja incorporada (status='em_andamento',
// cessao_efetivada_em preenchido) para o fundo QA de bootstrap -- o MESMO
// fato economico que resolveOverlay/financeiro_fundo_virgem ja usam como
// "operacao economicamente viva". Nao passa pelo fluxo de usuario real
// (termo assinado, comprovante, desembolso via UI) porque o objetivo deste
// fixture e exclusivamente provar que o PREDICADO deriva corretamente do
// fato historico -- o fluxo de desembolso real e codigo pre-existente,
// inalterado por este ticket.

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'SEED_FIXTURE_OPERACAO_INCORPORADA'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para criar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

const fundoId = String(args.fundo || '')
if (!/^[0-9a-f-]{36}$/i.test(fundoId)) throw new Error('Informe --fundo=<uuid> valido.')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const EMAIL = 'qa-bootstrap-cedente-incorporado@qa-rlx.invalid'

const { data: existing } = await client.from('cedentes').select('id').eq('cnpj', cnpjDigits('848100000030')).maybeSingle()
if (existing) {
  const op = await client.from('operacoes').select('id,status,cessao_efetivada_em')
    .eq('cedente_id', existing.id).maybeSingle()
  console.log(JSON.stringify({ cedenteId: existing.id, operacao: op.data, existente: true }))
  process.exit(0)
}

const { data: users } = await client.auth.admin.listUsers({ perPage: 1000 })
let userId = users.users.find((u) => u.email === EMAIL)?.id
if (!userId) {
  const created = await client.auth.admin.createUser({
    email: EMAIL, password: randomUUID(), email_confirm: true,
    user_metadata: { qa_dataset: 'BOOTSTRAP_FUNDO_VIRGEM', synthetic: true },
  })
  if (created.error || !created.data.user) throw new Error(`Falha ao criar usuario sintetico: ${created.error?.message}`)
  userId = created.data.user.id
}

const cedente = await client.from('cedentes').insert({
  user_id: userId, cnpj: cnpjDigits('848100000030'), razao_social: 'QA BOOTSTRAP CEDENTE INCORPORADO', status: 'ativo',
}).select('id').single()
if (cedente.error) throw new Error(`Falha ao criar cedente QA: ${cedente.error.message}`)

const cedenteFundo = await client.from('cedente_fundos').insert({
  cedente_id: cedente.data.id, fundo_id: fundoId, status: 'ativo',
}).select('id').single()
if (cedenteFundo.error) throw new Error(`Falha ao vincular cedente ao fundo QA: ${cedenteFundo.error.message}`)

const escrow = await client.from('contas_escrow').insert({
  cedente_id: cedente.data.id, identificador: 'QA-BOOTSTRAP-ESCROW-001',
}).select('id').single()
if (escrow.error) throw new Error(`Falha ao criar conta escrow QA: ${escrow.error.message}`)

const nowIso = new Date().toISOString()
const operacao = await client.from('operacoes').insert({
  cedente_id: cedente.data.id, cedente_fundo_id: cedenteFundo.data.id, conta_escrow_id: escrow.data.id,
  valor_bruto_total: 10000, taxa_desconto: 1.5, prazo_dias: 30,
  data_vencimento: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  valor_liquido_desembolso: 9800, status: 'em_andamento', cessao_efetivada_em: nowIso,
}).select('id,status,cessao_efetivada_em').single()
if (operacao.error) throw new Error(`Falha ao criar operacao QA incorporada: ${operacao.error.message}`)

console.log(JSON.stringify({ cedenteId: cedente.data.id, operacao: operacao.data, existente: false }))

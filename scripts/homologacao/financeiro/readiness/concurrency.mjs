import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertHomologEnvironment,
  assertMutation,
  connectDb,
  loadHomologEnv,
  mutationConfirmation,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'CONCURRENCY_P261'

if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para executar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

const evidencePath = resolve('docs/financeiro/concurrency-p2-6-1.json')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

async function prepare(client) {
  await client.query('SET ROLE service_role')
  await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })])
}

function payload({ fundId, actorId, signature, correlationId }) {
  return {
    fundo_id: fundId,
    operacao_id: null,
    escopo: 'FUNDO',
    origem: 'CENTRAL_RISCO',
    regra_versao: 'GATE_RISCO_V1',
    politica_operacional_versao_id: null,
    exposicao_execucao_id: null,
    data_operacional: new Date().toISOString().slice(0, 10),
    logistica_as_of: null,
    overlay_as_of: new Date().toISOString(),
    operacao_updated_at_snapshot: null,
    taxa_desconto_snapshot: null,
    aplicavel: false,
    status_tecnico: 'NAO_APLICAVEL',
    decisao: null,
    limite_pct: null,
    patrimonio_liquido_d2: null,
    exposicao_atual_valor: null,
    exposicao_atual_pct: null,
    operacao_valor_aquisicao: null,
    operacao_valor_em_transito: null,
    operacao_valor_indeterminado: null,
    exposicao_projetada_valor: null,
    exposicao_projetada_pct: null,
    quantidade_indeterminada: 0,
    quantidade_sem_match: 0,
    quantidade_valor_aquisicao_ausente: 0,
    quantidade_operacao_nao_incorporada: 0,
    liquidacao_parcial_presente: false,
    assinatura_inputs: signature,
    correlation_id: correlationId,
    criado_por: actorId,
    detalhes: { source: 'P2.6.1_CONCURRENCY_EVIDENCE' },
    motivos: [],
  }
}

async function call(client, body, callId) {
  const startedAt = new Date()
  const result = await client.query('select public.persistir_risco_execucao($1::jsonb)::text id', [JSON.stringify(body)])
  const finishedAt = new Date()
  return {
    callId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    resultId: result.rows[0].id,
  }
}

const control = await connectDb(env, 'p261_concurrency_control')
const clients = [
  await connectDb(env, 'p261_concurrency_a'),
  await connectDb(env, 'p261_concurrency_b'),
]

try {
  const context = await control.query(`select
    (select id::text from public.profiles where status::text='ativo' order by created_at,id limit 1) actor_id,
    array(select id::text from public.fundos where coalesce(ativo,true) order by created_at,id limit 2) fund_ids`)
  const actorId = context.rows[0]?.actor_id
  const fundIds = context.rows[0]?.fund_ids || []
  if (!actorId || fundIds.length < 2) throw new Error('A massa QA precisa de um perfil ativo e dois fundos ativos para o teste concorrente.')
  await Promise.all(clients.map(prepare))

  const runId = randomUUID()
  const sameSignature = sha256(`P2.6.1:GATE_DUPLO:${env.projectRef}:${runId}`)
  const samePayload = payload({ fundId: fundIds[0], actorId, signature: sameSignature, correlationId: randomUUID() })
  const sameFundCalls = await Promise.all([
    call(clients[0], samePayload, 'gate-same-fund-a'),
    call(clients[1], samePayload, 'gate-same-fund-b'),
  ])
  const count = await control.query(`select count(*)::int total from public.risco_execucoes
    where fundo_id=$1 and operacao_id is null and regra_versao='GATE_RISCO_V1' and assinatura_inputs=$2`, [fundIds[0], sameSignature])
  const gateDoublePassed = sameFundCalls[0].resultId === sameFundCalls[1].resultId && count.rows[0].total === 1

  const signatures = fundIds.map((fundId) => sha256(`P2.6.1:MULTIFUNDO:${env.projectRef}:${runId}:${fundId}`))
  const multifundCalls = await Promise.all(fundIds.map((fundId, index) => call(
    clients[index],
    payload({ fundId, actorId, signature: signatures[index], correlationId: randomUUID() }),
    `gate-fund-${index + 1}`,
  )))
  const multifundPassed = new Set(multifundCalls.map((item) => item.resultId)).size === 2

  const evidence = {
    format: 'bw-antecipa-p2-6-1-concurrency-v1',
    projectRef: env.projectRef,
    executedAt: new Date().toISOString(),
    productionTouched: false,
    persistentQaNamespace: 'P2.6.1_CONCURRENCY_EVIDENCE',
    checks: [
      {
        id: 'GATE_DUPLO_IDEMPOTENTE',
        status: gateDoublePassed ? 'PASS' : 'FAIL',
        calls: sameFundCalls,
        finalState: { rowsForSignature: count.rows[0].total, resultId: sameFundCalls[0].resultId },
      },
      {
        id: 'GATE_MULTIFUNDO_CONCORRENTE',
        status: multifundPassed ? 'PASS' : 'FAIL',
        calls: multifundCalls,
        finalState: { distinctResults: new Set(multifundCalls.map((item) => item.resultId)).size },
      },
    ],
  }
  mkdirSync(resolve('docs/financeiro'), { recursive: true })
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(evidence, null, 2))
  if (!gateDoublePassed || !multifundPassed) process.exitCode = 1
} finally {
  await Promise.allSettled([...clients, control].map((client) => client.end()))
}

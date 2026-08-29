import { executarGateRisco } from '../../../../src/lib/financeiro/risco/processor.server'
import { assertHomologEnvironment, loadEnvFile } from '../../../perf9a/common.mjs'

const PROJECT_REF = 'fhgkmggthxikfpogrvaa'

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

async function main() {
  const args = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1])
  }

  loadEnvFile('.env.homolog')
  const env = assertHomologEnvironment()
  if (env.projectRef !== PROJECT_REF) throw new Error(`Projeto bloqueado: ${env.projectRef}`)

  const fundoId = args.get('--fundo-id')
  const operacaoId = args.get('--operacao-id')
  const atorUsuarioId = args.get('--ator-id')
  const taxaDesconto = Number(args.get('--taxa-desconto'))
  const dataOperacional = args.get('--data-operacional') || new Date().toISOString().slice(0, 10)

  if (!fundoId || !operacaoId || !atorUsuarioId || !Number.isFinite(taxaDesconto)) {
    throw new Error('Argumentos obrigatorios ausentes para avaliacao de risco.')
  }

  const result = await executarGateRisco({
    fundoId,
    operacaoId,
    atorUsuarioId,
    taxaDesconto,
    dataOperacional,
    origem: 'APROVACAO_OPERACAO',
  })

  console.log(`P26101_RESULT=${JSON.stringify({
    risk_execution_id: result.execution.id,
    review_id: result.review?.id || null,
    review_status: result.review?.status || null,
    decision: result.classification.decision,
    signature: result.signature,
    correlation_id: result.correlationId,
    operation_updated_at_snapshot: result.execution.operacao_updated_at_snapshot,
    timings: result.timings,
  })}`)
}

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  assertHomologEnvironment,
  assertMutation,
  createAdminClient,
  loadHomologEnv,
  parseArgs,
} from '../../rlx-golden/helpers.mjs'

async function cleanup(client, fundId) {
  const { data: imports, error } = await client.from('importacoes_financeiras').select('id,storage_path').eq('fundo_id', fundId).eq('origem', 'GOLDEN_DATASET').eq('provedor', 'rlx_golden')
  if (error) throw error
  const ids = (imports || []).map((item) => item.id)
  if (!ids.length) return 0
  await client.from('estoque_posicoes').delete().in('importacao_id', ids)
  await client.from('aquisicao_movimentos').delete().in('importacao_id', ids)
  await client.from('liquidacao_movimentos').delete().in('importacao_id', ids)
  await client.from('carteira_snapshots').delete().in('importacao_id', ids)
  await client.from('importacao_linhas').delete().in('importacao_id', ids)
  await client.from('importacao_arquivos').delete().in('importacao_id', ids)
  await client.from('importacoes_financeiras').delete().in('id', ids)
  const paths = (imports || []).map((item) => item.storage_path).filter(Boolean)
  if (paths.length) await client.storage.from('financeiro-importacoes').remove(paths)
  return ids.length
}

async function main() {
  loadHomologEnv()
  const args = parseArgs()
  const env = assertHomologEnvironment(args)
  const fundId = String(args['fundo-id'] || '61f02178-58af-bbfa-9a33-f97ac5b3dd96')
  const action = args.cleanup === true ? 'CLEANUP_P22' : 'INGEST_P22'
  if (!assertMutation(args, action, env.projectRef)) {
    console.log(`Preview seguro. Para executar: --execute --confirm ${action}_RLX_GOLDEN_HOMOLOG_${env.projectRef}`)
    return
  }
  const client = createAdminClient(env)
  if (args.cleanup === true) {
    console.log(`Importacoes removidas: ${await cleanup(client, fundId)}`)
    return
  }

  const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
  const worker = resolve(process.cwd(), 'scripts/homologacao/financeiro/ingestao/ingest-golden-worker.ts')
  const child = spawnSync(process.execPath, [tsxCli, worker], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Worker golden encerrou com codigo ${child.status ?? 'desconhecido'}.`)
}

main().catch((error) => {
  console.error(`P2.2 golden falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { assertHomologEnvironment, assertMutation, loadHomologEnv, mutationConfirmation, parseArgs } from '../rlx-golden/helpers.mjs'

// Publica a primeira Carteira oficial (PL de bootstrap) de um fundo virgem
// em homologacao, usando o mesmo caminho canonico de uma Carteira real
// (ingerirArquivoFinanceiro + publicarImportacaoFinanceira -- ver
// seed-worker.ts). Nunca fabrica ESTOQUE/AQUISICOES/LIQUIDACOES. Trava dura
// de ambiente: so roda contra o projeto homolog informado explicitamente.
//
// Uso: node seed-carteira-bootstrap.mjs --fundo=<uuid> --pl=<numero>
//   --data-base=<YYYY-MM-DD> --expected-project-ref <ref> [--execute --confirm ...]

loadHomologEnv()
const args = parseArgs()
const env = assertHomologEnvironment(args)
const action = 'SEED_CARTEIRA_BOOTSTRAP'
if (!assertMutation(args, action, env.projectRef)) {
  console.log(`Preview seguro. Para publicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation(action, env.projectRef)}`)
  process.exit(0)
}

const fundoId = String(args.fundo || '')
const pl = String(args.pl || '')
const dataBase = String(args['data-base'] || '')
if (!/^[0-9a-f-]{36}$/i.test(fundoId)) throw new Error('Informe --fundo=<uuid> valido.')
if (!pl) throw new Error('Informe --pl=<numero>.')
if (!dataBase) throw new Error('Informe --data-base=<YYYY-MM-DD>.')

const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
const worker = resolve(process.cwd(), 'scripts/homologacao/bootstrap-fundo-virgem/seed-worker.ts')
const child = spawnSync(process.execPath, [tsx, worker, fundoId, pl, dataBase], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
if (child.error) throw child.error
if (child.status !== 0) throw new Error(`Seed da Carteira QA de bootstrap encerrou com codigo ${child.status ?? 'desconhecido'}.`)
console.log(`Carteira QA de bootstrap publicada em homologacao (${env.projectRef}) para o fundo ${fundoId}.`)

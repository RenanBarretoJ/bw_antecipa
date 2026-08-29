import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  withPgClient,
  writeJson,
} from './lib.mjs'
import { validateProductionManifest } from './production-manifest.mjs'

function classifyUnlinkedCedente(row) {
  if (row.status === 'pendente' && Number(row.operacoes) === 0 && Number(row.notas_fiscais) === 0) return 'onboarding_pendente'
  if (row.status === 'reprovado') return 'reprovado'
  if (row.status === 'ativo' && Number(row.operacoes) === 0) return 'legado_sem_operacao'
  if (row.status === 'ativo') return 'ativo'
  return 'outro'
}

export async function collectReleaseCandidateInventory() {
  const manifest = validateProductionManifest()
  const database = await withPgClient(localPgConfig(), async (client) => {
    const funds = await client.query(`
      select f.id::text, f.nome, f.cnpj, f.ativo,
        (select count(*)::integer from public.cedente_fundos cf where cf.fundo_id=f.id) as cedentes_vinculados,
        (select count(*)::integer from public.cedente_fundos cf where cf.fundo_id=f.id and cf.status='ativo') as cedentes_vinculados_ativos,
        (select count(*)::integer from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=f.id) as operacoes,
        (select count(*)::integer from public.notas_fiscais nf where nf.fundo_id=f.id) as notas_fiscais,
        (select count(*)::integer from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=f.id and (o.remessa_fromtis_id is not null or o.remessa_fromtis_retorno is not null)) as fromtis_historico,
        (select count(*)::integer from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=f.id and o.termo_url is not null) as termos_historicos,
        (select count(*)::integer from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=f.id and o.notificacao_url is not null) as notificacoes_historicas,
        (select count(*)::integer from public.politicas_operacionais po where po.fundo_id=f.id) as politicas,
        (select count(*)::integer from public.politica_operacional_versoes pv where pv.fundo_id=f.id and pv.status='publicada') as politicas_publicadas,
        (select count(*)::integer from public.templates_documentos td where td.fundo_id=f.id) as templates,
        (select count(*)::integer from public.template_versoes tv join public.templates_documentos td on td.id=tv.template_id where td.fundo_id=f.id and tv.status='publicada') as templates_publicados,
        (select count(*)::integer from public.configuracoes_cnab cc where cc.fundo_id=f.id) as cnab,
        (select count(*)::integer from public.configuracao_cnab_versoes cv join public.configuracoes_cnab cc on cc.id=cv.configuracao_cnab_id where cc.fundo_id=f.id and cv.status='publicada') as cnab_publicado,
        (select count(*)::integer from public.integracoes_fundo i where i.fundo_id=f.id) as integracoes,
        (select count(*)::integer from public.integracao_fundo_versoes iv join public.integracoes_fundo i on i.id=iv.integracao_fundo_id where i.fundo_id=f.id and iv.status='publicada') as integracoes_publicadas,
        (select count(*)::integer from public.importacoes_financeiras fi where fi.fundo_id=f.id) as importacoes_financeiras,
        (select count(*)::integer from public.exposicao_execucoes ee where ee.fundo_id=f.id) as exposicoes,
        (select count(*)::integer from public.risco_execucoes re where re.fundo_id=f.id) as risco_execucoes
      from public.fundos f order by f.nome
    `)
    const statuses = await client.query(`
      select cf.fundo_id::text, o.status::text, count(*)::integer as total
        from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id
       group by cf.fundo_id, o.status order by cf.fundo_id, o.status::text
    `)
    const unlinked = await client.query(`
      select c.id::text, c.razao_social, c.cnpj, c.status::text, c.created_at,
             c.fundo_id::text as fundo_legado_id,
             (select count(*)::integer from public.operacoes o where o.cedente_id=c.id) as operacoes,
             (select count(*)::integer from public.notas_fiscais nf where nf.cedente_id=c.id) as notas_fiscais,
             (select count(*)::integer from public.cedente_acessos ca where ca.cedente_id=c.id and ca.status='ATIVO' and ca.ativo is true) as acessos_ativos
        from public.cedentes c
       where not exists (select 1 from public.cedente_fundos cf where cf.cedente_id=c.id)
       order by c.created_at, c.id
    `)
    const migrationCount = await client.query(`select count(*)::integer as total from supabase_migrations.schema_migrations`)
    return { funds: funds.rows, statuses: statuses.rows, unlinked: unlinked.rows, migration_count: migrationCount.rows[0].total }
  })

  const statusesByFund = new Map()
  for (const row of database.statuses) {
    const current = statusesByFund.get(row.fundo_id) ?? []
    current.push({ status: row.status, total: row.total })
    statusesByFund.set(row.fundo_id, current)
  }
  return {
    generated_at: new Date().toISOString(),
    environment: 'rehearsal/local',
    production_access: 'none',
    production_manifest_hash: manifest.manifest_hash,
    migration_history_count: database.migration_count,
    funds: database.funds.map((fund) => ({ ...fund, operacoes_por_status: statusesByFund.get(fund.id) ?? [] })),
    cedentes_sem_fundo: database.unlinked.map((row) => {
      const classificacao = classifyUnlinkedCedente(row)
      const vinculo_inequivoco = Boolean(row.fundo_legado_id) && Number(row.operacoes) === 0
      return {
        ...row,
        classificacao,
        vinculo_inequivoco,
        decisao: vinculo_inequivoco ? 'PATCH_CONTROLADO_POSSIVEL' : 'DECISAO_OPERACIONAL_PENDENTE',
      }
    }),
  }
}

async function main() {
  ensureRuntimeDirectories()
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='))
  const output = path.join(REPORT_DIR, path.basename(outputArgument?.slice('--output='.length) || 'P3_INVENTORY.json'))
  const report = await collectReleaseCandidateInventory()
  writeJson(output, report)
  console.log(`Fundos inventariados: ${report.funds.length}`)
  console.log(`Cedentes sem fundo: ${report.cedentes_sem_fundo.length}`)
  console.log(`Decisoes operacionais pendentes: ${report.cedentes_sem_fundo.filter(({ decisao }) => decisao === 'DECISAO_OPERACIONAL_PENDENTE').length}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((error) => {
    console.error(`Inventario P3 falhou: ${formatError(error)}`)
    process.exitCode = 1
  })
}

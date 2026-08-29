import fs from 'node:fs'
import path from 'node:path'
import { REPOSITORY_ROOT, REPORT_DIR, ensureRuntimeDirectories, formatError, localPgConfig, withPgClient, writeJson } from './lib.mjs'

const DLZ_ID = '7a114257-7816-468e-adf4-d796b93364df'
const IMPULSE_ID = 'cb372689-65c8-43af-8a20-7438002a3b91'

async function main() {
  ensureRuntimeDirectories()
  const database = await withPgClient(localPgConfig(), async (client) => {
    const result = await client.query(`
      select jsonb_build_object(
        'fundos',(select count(*) from public.fundos),
        'cedentes',(select count(*) from public.cedentes),
        'cedentes_dlz',(select count(distinct cedente_id) from public.cedente_fundos where fundo_id=$1 and status='ativo'),
        'cedentes_impulse',(select count(distinct cedente_id) from public.cedente_fundos where fundo_id=$2 and status='ativo'),
        'operacoes',(select count(*) from public.operacoes),
        'operacoes_dlz',(select count(*) from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=$1),
        'operacoes_impulse',(select count(*) from public.operacoes o join public.cedente_fundos cf on cf.id=o.cedente_fundo_id where cf.fundo_id=$2),
        'nfs',(select count(*) from public.notas_fiscais),
        'nfs_dlz',(select count(*) from public.notas_fiscais where fundo_id=$1),
        'documentos',(select count(*) from public.documentos),
        'storage_objects',(select count(*) from storage.objects),
        'users',(select count(*) from auth.users),
        'profiles',(select count(*) from public.profiles),
        'fromtis_historico',(select count(*) from public.operacoes where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null),
        'historico_com_snapshot_inventado',(select count(*) from public.operacoes where politica_snapshot is not null or politica_operacional_versao_id is not null),
        'politica_dlz',(select count(*) from public.politica_operacional_versoes v join public.politicas_operacionais p on p.id=v.politica_operacional_id where p.fundo_id=$1 and v.status='publicada' and v.aceite_sacado_obrigatorio is true and v.gate_risco_ativo is false and v.controle_exposicao_logistica_ativo is false),
        'atribuicoes_dlz',(select count(*) from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where cf.fundo_id=$1 and a.status='ativa'),
        'cnab_dlz',(select count(*) from public.configuracao_cnab_versoes v join public.configuracoes_cnab c on c.id=v.configuracao_cnab_id where c.fundo_id=$1 and v.status='publicada' and v.codigo_originador='00000000000000500497'),
        'integracao_dlz',(select count(*) from public.integracao_fundo_versoes v join public.integracoes_fundo i on i.id=v.integracao_fundo_id where i.fundo_id=$1 and v.status='publicada' and v.adapter_key='sinqia_portal_fidc' and v.configuracao_nao_sensivel->>'runtime_mode'='legacy_env_sinqia_terra' and v.credencial_integracao_id is null),
        'capabilities_dlz',(select coalesce(array_agg(c.capability order by c.capability),'{}'::text[]) from public.integracao_fundo_versao_capacidades c join public.integracao_fundo_versoes v on v.id=c.integracao_fundo_versao_id join public.integracoes_fundo i on i.id=v.integracao_fundo_id where i.fundo_id=$1 and v.status='publicada'),
        'config_impulse',(select (select count(*) from public.politicas_operacionais where fundo_id=$2)+(select count(*) from public.configuracoes_cnab where fundo_id=$2)+(select count(*) from public.integracoes_fundo where fundo_id=$2))
      ) as value
    `, [DLZ_ID, IMPULSE_ID])
    return result.rows[0].value
  })
  const localTemplates = ['contrato-cessao.html', 'termo-cessao.html', 'notificacao-cessao-ao-sacado.html']
    .every((name) => fs.existsSync(path.join(REPOSITORY_ROOT, 'src', 'templates', 'contratos', name)))
  const checks = {
    dlz_unico_fundo_operacional: Number(database.operacoes_dlz) === 46 && Number(database.operacoes_impulse) === 0,
    cedentes_dlz: Number(database.cedentes_dlz) === 12 && Number(database.cedentes_impulse) === 0,
    politica_dlz: Number(database.politica_dlz) === 1 && Number(database.atribuicoes_dlz) === 12,
    gate_sacado_dlz: Number(database.politica_dlz) === 1,
    risco_financeiro_dlz_nao_aplicavel: Number(database.politica_dlz) === 1,
    cnab_dlz: Number(database.cnab_dlz) === 1,
    integracao_dlz_legacy_env: Number(database.integracao_dlz) === 1 && JSON.stringify(database.capabilities_dlz) === JSON.stringify(['CESSAO_ENVIO']),
    templates_compat_legado: localTemplates,
    impulse_not_configured: Number(database.config_impulse) === 0,
    historico_preservado: Number(database.operacoes) === 46 && Number(database.nfs) === 910 && Number(database.documentos) === 123 && Number(database.storage_objects) === 1644 && Number(database.users) === 23 && Number(database.profiles) === 23 && Number(database.fromtis_historico) === 26 && Number(database.historico_com_snapshot_inventado) === 0,
  }
  const passed = Object.values(checks).every(Boolean)
  const report = {
    generated_at: new Date().toISOString(), environment: 'rehearsal/local', production_access: 'none',
    operational_fund: DLZ_ID, non_blocking_funds: [{ id: IMPULSE_ID, status: 'NOT_CONFIGURED' }],
    database, templates: localTemplates ? 'COMPAT_LEGADO' : 'FAIL', checks, passed,
  }
  writeJson(path.join(REPORT_DIR, 'P3_1_DLZ_READINESS.json'), report)
  console.log(`P3.1 DLZ readiness: ${passed ? 'PASS' : 'FAIL'}`)
  if (!passed) process.exitCode = 2
}

main().catch((error) => {
  console.error(`Readiness P3.1 falhou: ${formatError(error)}`)
  process.exitCode = 1
})

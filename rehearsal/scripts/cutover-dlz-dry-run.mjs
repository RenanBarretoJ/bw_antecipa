import path from 'node:path'
import { REHEARSAL_ROOT, REPORT_DIR, formatError, localPgConfig, run, sha256, stableJson, withPgClient, writeJson } from './lib.mjs'

function runScript(file, args = []) {
  run(process.execPath, [path.join(REHEARSAL_ROOT, 'scripts', file), ...args], { capture: false })
}

async function fingerprint() {
  return withPgClient(localPgConfig(), async (client) => {
    const data = await client.query(`
      select jsonb_build_object(
        'core',jsonb_build_object(
          'fundos',(select count(*) from public.fundos),'cedentes',(select count(*) from public.cedentes),
          'operacoes',(select count(*) from public.operacoes),'nfs',(select count(*) from public.notas_fiscais),
          'documentos',(select count(*) from public.documentos),'storage',(select count(*) from storage.objects)),
        'links',(select jsonb_agg(jsonb_build_array(cedente_id,fundo_id,status) order by cedente_id) from public.cedente_fundos where fundo_id='7a114257-7816-468e-adf4-d796b93364df'),
        'policy',(select jsonb_agg(jsonb_build_array(id,politica_operacional_id,versao,status,aceite_sacado_obrigatorio,gate_risco_ativo,controle_exposicao_logistica_ativo) order by id) from public.politica_operacional_versoes where id='d1311000-0000-4000-8000-000000000002'),
        'assignments',(select jsonb_agg(jsonb_build_array(cf.cedente_id,a.politica_operacional_id,a.status) order by cf.cedente_id) from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where a.politica_operacional_id='d1311000-0000-4000-8000-000000000001'),
        'cnab',(select jsonb_agg(jsonb_build_array(id,codigo_originador,codigo_banco,banco,conteudo_hash,status) order by id) from public.configuracao_cnab_versoes where id='d1312000-0000-4000-8000-000000000002'),
        'integration',(select jsonb_agg(jsonb_build_array(id,adapter_key,configuracao_nao_sensivel,credential_ref,status) order by id) from public.integracao_fundo_versoes where id='d1313000-0000-4000-8000-000000000002'),
        'capabilities',(select jsonb_agg(jsonb_build_array(id,capability,ambiente) order by id) from public.integracao_fundo_versao_capacidades where integracao_fundo_versao_id='d1313000-0000-4000-8000-000000000002')
      ) as value
    `)
    return sha256(stableJson(data.rows[0].value))
  })
}

async function cycle(label) {
  console.log(`\nP3.1 dry-run ${label}`)
  runScript('rebuild-local.mjs')
  runScript('upgrade-local.mjs')
  runScript('post-upgrade-local.mjs', [`--output=P3_1_POST_UPGRADE_${label}.json`])
  runScript('configure-dlz-release-candidate-local.mjs')
  runScript('readiness-dlz-release-candidate.mjs')
  runScript('e2e-dlz-sacado-local.mjs')
  return { label, final_hash: await fingerprint(), synthetic_cleanup: 'ROLLBACK', passed: true }
}

try {
  const run1 = await cycle('RUN_1')
  const run2 = await cycle('RUN_2')
  const deterministic = run1.final_hash === run2.final_hash
  const report = {
    generated_at: new Date().toISOString(), environment: 'rehearsal/local', production_access: 'none',
    run_1: run1, run_2: run2, deterministic, result: deterministic ? 'DETERMINISTICO' : 'NAO_DETERMINISTICO',
  }
  writeJson(path.join(REPORT_DIR, 'P3_1_DLZ_CUTOVER_DRY_RUN.json'), report)
  console.log(`CUTOVER_DLZ_DRY_RUN = ${report.result}`)
  if (!deterministic) process.exitCode = 2
} catch (error) {
  console.error(`Dry-run P3.1 falhou: ${formatError(error)}`)
  process.exitCode = 1
}

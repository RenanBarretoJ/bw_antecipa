import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPOSITORY_ROOT, REPORT_DIR, ensureRuntimeDirectories, formatError, localPgConfig, withPgClient, writeJson } from './lib.mjs'
import { evaluateDlzPolicyReadiness } from './dlz-policy-readiness.mjs'
import { evaluateStorageExceptionGate, loadStorageExceptionsManifest } from './storage-known-exceptions.mjs'

const DLZ_ID = '7a114257-7816-468e-adf4-d796b93364df'
const IMPULSE_ID = 'cb372689-65c8-43af-8a20-7438002a3b91'

function loadExpectedPolicy() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, 'rehearsal', 'manifests', 'dlz-production-config.json'), 'utf8'))
  return manifest.policy
}

async function loadUnreferencedStorage(client, createdAfter) {
  const result = await client.query(`
    with candidates as (
      select o.id as object_id,o.bucket_id,o.name,o.owner,o.metadata,b.public as bucket_public,
        encode(extensions.digest(o.bucket_id || ':' || o.name,'sha256'),'hex') as fingerprint_sha256
      from storage.objects o
      join storage.buckets b on b.id=o.bucket_id
      where o.created_at >= $1::timestamptz
    ), classified as (
      select c.*,
        ((select count(*) from public.notas_fiscais n where n.arquivo_url=c.name or n.arquivo_url like '%' || c.name || '%')
        +(select count(*) from public.documento_versoes v where v.bucket=c.bucket_id and v.path=c.name)
        +(select count(*) from public.documentos d where d.url_arquivo=c.name or d.url_arquivo like '%' || c.name || '%')
        +(select count(*) from public.documentos_gerados g where g.bucket=c.bucket_id and g.storage_path=c.name)
        +(select count(*) from public.duplicata_versoes d where d.bucket=c.bucket_id and d.path=c.name)
        +(select count(*) from public.nota_fiscal_remessa_versoes r where r.bucket=c.bucket_id and r.path=c.name)
        +(select count(*) from public.nota_fiscal_remessas r where r.bucket=c.bucket_id and r.path=c.name)
        +(select count(*) from public.importacao_arquivos a where a.storage_bucket=c.bucket_id and a.storage_path=c.name)
        +(select count(*) from public.importacoes_financeiras a where a.storage_bucket=c.bucket_id and a.storage_path=c.name)
        +(select count(*) from public.integracao_logistica_webhook_eventos w where w.bucket=c.bucket_id and w.path=c.name)
        +(select count(*) from public.remessa_operacional_arquivos r where r.bucket=c.bucket_id and r.storage_path=c.name)
        +(select count(*) from public.remessas_cnab r where r.bucket=c.bucket_id and r.storage_path=c.name)
        +(select count(*) from public.remessas_operacionais r where r.excel_bucket=c.bucket_id and r.excel_storage_path=c.name)
        +(select count(*) from public.retornos_integracao r where r.bucket=c.bucket_id and r.storage_path=c.name)
        +(select count(*) from public.cedentes d where d.contrato_url=c.name or d.contrato_url like '%' || c.name || '%' or d.contrato_assinado_url=c.name or d.contrato_assinado_url like '%' || c.name || '%')
        +(select count(*) from public.operacoes o where concat_ws('|',o.termo_url,o.termo_assinado_url,o.comprovante_pagamento_url,o.notificacao_url,o.notificacao_assinada_url,o.remessa_url,o.quitacao_url,o.quitacao_assinada_url) like '%' || c.name || '%'))::integer as references
      from candidates c
    )
    select c.object_id,c.bucket_id,c.fingerprint_sha256,c.bucket_public,
      c.metadata->>'mimetype' as content_type,(c.metadata->>'size')::bigint as size_bytes,c.metadata->>'eTag' as content_etag,
      p.status::text as owner_profile_status,p.role::text as owner_profile_role,
      ced.status::text as cedente_status,
      regexp_replace(coalesce(ced.cnpj,''),'[^0-9]','','g')=split_part(c.name,'/',1) as path_matches_cedente,
      (select count(*) from public.cedente_fundos cf where cf.cedente_id=ced.id and cf.status='ativo' and cf.fundo_id=$2::uuid) as dlz_active_links,
      (select count(*) from public.cedente_fundos cf where cf.cedente_id=ced.id and cf.status='ativo' and cf.fundo_id<>$2::uuid) as other_fund_active_links,
      c.references
    from classified c
    left join public.profiles p on p.id=c.owner
    left join public.cedentes ced on ced.user_id=c.owner
    where c.references=0
    order by c.object_id
  `, [createdAfter, DLZ_ID])
  return result.rows
}

async function main() {
  ensureRuntimeDirectories()
  const storageManifest = loadStorageExceptionsManifest()
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
        'operacoes_sem_cedente',(select count(*) from public.operacoes where cedente_id is null),
        'nfs_sem_cedente',(select count(*) from public.notas_fiscais where cedente_id is null),
        'operacoes_nfs_orfas',(select count(*) from public.operacoes_nfs onf left join public.operacoes o on o.id=onf.operacao_id left join public.notas_fiscais nf on nf.id=onf.nota_fiscal_id where o.id is null or nf.id is null),
        'politicas_dlz',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',v.id,'fundo_id',p.fundo_id,'versao',v.versao,'status',v.status,
          'aceite_sacado_obrigatorio',v.aceite_sacado_obrigatorio,
          'cessao_no_desembolso',v.cessao_no_desembolso,
          'cria_acompanhamento_entrega',v.cria_acompanhamento_entrega,
          'permite_postergacao_upload_canhoto',v.permite_postergacao_upload_canhoto,
          'metodo_calculo_financeiro',v.metodo_calculo_financeiro,
          'exigir_status_logistico_pre_cessao',v.exigir_status_logistico_pre_cessao,
          'tipo_ativo_financeiro',v.tipo_ativo_financeiro,
          'controle_exposicao_logistica_ativo',v.controle_exposicao_logistica_ativo,
          'gate_risco_ativo',v.gate_risco_ativo,
          'requirements',coalesce((select jsonb_agg(jsonb_build_object(
            'codigo',r.codigo,'escopo',r.escopo,'tipo_documento_codigo',r.tipo_documento_codigo,
            'obrigatorio',r.obrigatorio,'quantidade_minima',r.quantidade_minima,
            'formatos_aceitos',r.formatos_aceitos,'nivel_validacao',r.nivel_validacao,
            'prazo_dias_corridos',r.prazo_dias_corridos,'responsavel_upload',r.responsavel_upload,
            'responsavel_aprovacao',r.responsavel_aprovacao,'momento_obrigatorio',r.momento_obrigatorio,
            'categoria',r.categoria,'bloqueia_fluxo',r.bloqueia_fluxo,'ativo',r.ativo
          ) order by r.codigo) from public.politica_requisitos_documentais r where r.politica_operacional_versao_id=v.id),'[]'::jsonb)
        ) order by v.versao),'[]'::jsonb) from public.politica_operacional_versoes v join public.politicas_operacionais p on p.id=v.politica_operacional_id where p.fundo_id=$1),
        'atribuicoes_dlz',(select count(*) from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where cf.fundo_id=$1 and a.status='ativa'),
        'cnab_dlz',(select count(*) from public.configuracao_cnab_versoes v join public.configuracoes_cnab c on c.id=v.configuracao_cnab_id where c.fundo_id=$1 and v.status='publicada' and v.codigo_originador='00000000000000500497'),
        'integracao_dlz',(select count(*) from public.integracao_fundo_versoes v join public.integracoes_fundo i on i.id=v.integracao_fundo_id where i.fundo_id=$1 and v.status='publicada' and v.adapter_key='sinqia_portal_fidc' and v.configuracao_nao_sensivel->>'runtime_mode'='legacy_env_sinqia_terra' and v.credencial_integracao_id is null),
        'capabilities_dlz',(select coalesce(array_agg(c.capability order by c.capability),'{}'::text[]) from public.integracao_fundo_versao_capacidades c join public.integracao_fundo_versoes v on v.id=c.integracao_fundo_versao_id join public.integracoes_fundo i on i.id=v.integracao_fundo_id where i.fundo_id=$1 and v.status='publicada'),
        'config_impulse',(select (select count(*) from public.politicas_operacionais where fundo_id=$2)+(select count(*) from public.configuracoes_cnab where fundo_id=$2)+(select count(*) from public.integracoes_fundo where fundo_id=$2))
      ) as value
    `, [DLZ_ID, IMPULSE_ID])
    return { ...result.rows[0].value, unreferenced_storage: await loadUnreferencedStorage(client, storageManifest.scope.created_after) }
  })
  const policyReadiness = evaluateDlzPolicyReadiness({
    versions: database.politicas_dlz,
    expectedPolicy: loadExpectedPolicy(),
    fundoId: DLZ_ID,
  })
  const localTemplates = ['contrato-cessao.html', 'termo-cessao.html', 'notificacao-cessao-ao-sacado.html']
    .every((name) => fs.existsSync(path.join(REPOSITORY_ROOT, 'src', 'templates', 'contratos', name)))
  const storageExceptionGate = evaluateStorageExceptionGate({
    unreferencedObjects: database.unreferenced_storage,
    manifest: storageManifest,
  })
  const baseline = storageManifest.scope.expected_baseline
  const checks = {
    dlz_unico_fundo_operacional: Number(database.operacoes_dlz) === baseline.operacoes && Number(database.operacoes_impulse) === 0,
    cedentes_dlz: Number(database.cedentes_dlz) === 12 && Number(database.cedentes_impulse) === 0,
    politica_dlz: policyReadiness.passed && Number(database.atribuicoes_dlz) === 12,
    gate_sacado_dlz: policyReadiness.passed,
    risco_financeiro_dlz_nao_aplicavel: policyReadiness.passed,
    cnab_dlz: Number(database.cnab_dlz) === 1,
    integracao_dlz_legacy_env: Number(database.integracao_dlz) === 1 && JSON.stringify(database.capabilities_dlz) === JSON.stringify(['CESSAO_ENVIO']),
    templates_compat_legado: localTemplates,
    impulse_not_configured: Number(database.config_impulse) === 0,
    baseline_atual: Number(database.fundos) === baseline.fundos
      && Number(database.cedentes) === baseline.cedentes
      && Number(database.operacoes) === baseline.operacoes
      && Number(database.nfs) === baseline.notas_fiscais
      && Number(database.documentos) === baseline.documentos
      && Number(database.storage_objects) === baseline.storage_objects
      && Number(database.users) === baseline.auth_users
      && Number(database.profiles) === baseline.profiles
      && Number(database.fromtis_historico) === baseline.operacoes_fromtis_legado,
    integridade_relacional: Number(database.operacoes_sem_cedente) === 0
      && Number(database.nfs_sem_cedente) === 0
      && Number(database.operacoes_nfs_orfas) === 0,
    storage_known_exceptions: storageExceptionGate.passed,
  }
  const passed = Object.values(checks).every(Boolean)
  const report = {
    generated_at: new Date().toISOString(), environment: 'rehearsal/local', production_access: 'none',
    operational_fund: DLZ_ID, non_blocking_funds: [{ id: IMPULSE_ID, status: 'NOT_CONFIGURED' }],
    database, policy_readiness: policyReadiness, storage_exception_gate: storageExceptionGate,
    templates: localTemplates ? 'COMPAT_LEGADO' : 'FAIL', checks, passed,
  }
  writeJson(path.join(REPORT_DIR, 'P3_1_DLZ_READINESS.json'), report)
  console.log(`P3.1 DLZ readiness: ${passed ? 'PASS' : 'FAIL'}`)
  if (!passed) process.exitCode = 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Readiness P3.1 falhou: ${formatError(error)}`)
    process.exitCode = 1
  })
}

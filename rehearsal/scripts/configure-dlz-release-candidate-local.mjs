import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPOSITORY_ROOT,
  REPORT_DIR,
  ensureRuntimeDirectories,
  formatError,
  localPgConfig,
  stableJson,
  withPgClient,
  writeJson,
} from './lib.mjs'

const DLZ_ID = '7a114257-7816-468e-adf4-d796b93364df'
const ACTOR_ID = '10690e0c-c1a9-4282-892a-f2ce803f95d7'
const APPLIED_AT = '2026-08-27T21:33:04.000Z'
const IDS = Object.freeze({
  policy: 'd1311000-0000-4000-8000-000000000001',
  policyVersion: 'd1311000-0000-4000-8000-000000000002',
  cnab: 'd1312000-0000-4000-8000-000000000001',
  cnabVersion: 'd1312000-0000-4000-8000-000000000002',
  integration: 'd1313000-0000-4000-8000-000000000001',
  integrationVersion: 'd1313000-0000-4000-8000-000000000002',
  capability: 'd1313000-0000-4000-8000-000000000003',
})

const cnab = Object.freeze({
  layout: 'cnab444', versaoLayout: 'H/D/T', codigoBanco: '001', banco: 'BANCO DO BRASIL SA',
  agencia: '00000', conta: '0000000000', digitoConta: '0', carteira: '000',
  convenio: '00000000000000000000', codigoOriginador: '00000000000000500497',
  codigoEmpresa: '00000000000000500497', tipoInscricao: '02', numeroInscricao: '62342629000177',
  especieTitulo: '61', tipoRecebivel: '01',
  configuracao: {
    literalRemessa: 'REMESSA', codigoServico: '01', literalServico: 'COBRANCA', identificacaoSistema: 'MX',
    sequencialHeaderInicial: 1, ocorrencia: '01', caracteristicaEspecial: '00', modalidadeOperacao: '0000',
    naturezaOperacao: '00', origemRecurso: '0000', numeroBancoCobranca: '000', agenciaDepositaria: '00000',
    condicaoPapeleta: '1', emitePapeletaDebAuto: 'N', tipoPessoaCedente: '02', tipoInscricaoSacado: '02',
    cepSacadoDefault: '00000000',
  },
})

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function main() {
  ensureRuntimeDirectories()
  const patchPath = path.join(REPOSITORY_ROOT, 'supabase', 'migrations', '20260827213304_p3_1_vincular_cedentes_dlz.sql')
  const patchSql = fs.readFileSync(patchPath, 'utf8')
  const result = await withPgClient(localPgConfig(), async (client) => {
    await client.query('begin')
    try {
      await client.query(patchSql)
      const precondition = await client.query(`
        select exists(select 1 from public.fundos where id=$1 and ativo is true) as fundo_ok,
               exists(select 1 from public.profiles where id=$2 and role='gestor' and status='ativo') as ator_ok
      `, [DLZ_ID, ACTOR_ID])
      if (!precondition.rows[0]?.fundo_ok || !precondition.rows[0]?.ator_ok) throw new Error('Pre-condicoes DLZ/ator nao atendidas no clone.')

      const policyHash = sha256(stableJson({
        fundo_id: DLZ_ID, aceite_sacado_obrigatorio: true, cessao_no_desembolso: true,
        cria_acompanhamento_entrega: false, gate_risco_ativo: false,
        controle_exposicao_logistica_ativo: false, requisitos: [],
      }))
      await client.query(`
        insert into public.politicas_operacionais
          (id,fundo_id,codigo,nome,descricao,status,created_by,padrao,created_at,updated_at)
        values ($1,$2,'dlz_health_cutover_v1','Politica operacional DLZ/HEALTH',
          'Preserva o fluxo produtivo: aceite do sacado obrigatorio e risco financeiro nao aplicavel.',
          'ativa',$3,true,$4,$4)
        on conflict (id) do nothing
      `, [IDS.policy, DLZ_ID, ACTOR_ID, APPLIED_AT])
      await client.query(`
        insert into public.politica_operacional_versoes (
          id,politica_operacional_id,cedente_fundo_id,versao,vigente_desde,
          aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,
          configuracao,conteudo_hash,publicada_por,publicada_em,fundo_id,status,regras,parametros,
          permite_postergacao_upload_canhoto,limite_postergacao_upload_canhoto_dias,
          metodo_calculo_financeiro,exigir_status_logistico_pre_cessao,tipo_ativo_financeiro,
          controle_exposicao_logistica_ativo,limite_exposicao_em_transito_pct,gate_risco_ativo,
          created_at,updated_at
        ) values ($1,$2,null,1,$4,true,true,false,
          '{"cutover":"DLZ_HEALTH","risco_financeiro":"NAO_APLICAVEL"}'::jsonb,$5,$3,$4,$6,'publicada','{}'::jsonb,'{}'::jsonb,
          false,null,'DIAS_CORRIDOS_365',false,'NOTA_FISCAL',false,null,false,$4,$4)
        on conflict (id) do nothing
      `, [IDS.policyVersion, IDS.policy, ACTOR_ID, APPLIED_AT, policyHash, DLZ_ID])
      await client.query(`
        insert into public.cedente_fundo_politicas
          (id,cedente_fundo_id,politica_operacional_id,status,vigente_desde,atribuido_por,motivo,created_at,updated_at)
        select (substr(md5('p3.1:'||cf.id::text),1,8)||'-'||substr(md5('p3.1:'||cf.id::text),9,4)||'-4'||substr(md5('p3.1:'||cf.id::text),14,3)||'-8'||substr(md5('p3.1:'||cf.id::text),18,3)||'-'||substr(md5('p3.1:'||cf.id::text),21,12))::uuid,
               cf.id,$1,'ativa',$3,$2,'P3.1 - politica DLZ para novas operacoes',$3,$3
          from public.cedente_fundos cf
         where cf.fundo_id=$4 and cf.status='ativo'
        on conflict (id) do nothing
      `, [IDS.policy, ACTOR_ID, APPLIED_AT, DLZ_ID])

      const cnabHash = sha256(stableJson(cnab))
      await client.query(`
        insert into public.configuracoes_cnab
          (id,fundo_id,codigo,nome,descricao,finalidade,status,created_by,created_at,updated_at)
        values ($1,$2,'dlz_health_legacy','CNAB DLZ/HEALTH legado','Read-model do layout produtivo legado.','remessa','ativa',$3,$4,$4)
        on conflict (id) do nothing
      `, [IDS.cnab, DLZ_ID, ACTOR_ID, APPLIED_AT])
      await client.query(`
        insert into public.configuracao_cnab_versoes (
          id,configuracao_cnab_id,versao,vigente_desde,layout,versao_layout,codigo_banco,banco,
          agencia,conta,digito_conta,carteira,convenio,codigo_originador,codigo_empresa,
          tipo_inscricao,numero_inscricao,especie_titulo,tipo_recebivel,configuracao,conteudo_hash,
          status,publicada_por,publicada_em,created_at,updated_at
        ) values ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,'publicada',$21,$3,$3,$3)
        on conflict (id) do nothing
      `, [IDS.cnabVersion, IDS.cnab, APPLIED_AT, cnab.layout, cnab.versaoLayout, cnab.codigoBanco, cnab.banco,
        cnab.agencia, cnab.conta, cnab.digitoConta, cnab.carteira, cnab.convenio, cnab.codigoOriginador,
        cnab.codigoEmpresa, cnab.tipoInscricao, cnab.numeroInscricao, cnab.especieTitulo, cnab.tipoRecebivel,
        JSON.stringify(cnab.configuracao), cnabHash, ACTOR_ID])

      await client.query(`
        insert into public.integracoes_fundo
          (id,fundo_id,provedor,nome,status,created_by,created_at,updated_at,provider_key,system_name)
        values ($1,$2,'fromtis','Sinqia/Terra legado','ativa',$3,$4,$4,'SINQIA_PORTAL_FIDC','Sinqia/Terra')
        on conflict (id) do nothing
      `, [IDS.integration, DLZ_ID, ACTOR_ID, APPLIED_AT])
      await client.query(`
        insert into public.integracao_fundo_versoes (
          id,integracao_fundo_id,versao,ambiente,status,identificador_cliente,codigo_originador,
          endpoint_base,configuracao_nao_sensivel,credential_ref,vigente_desde,publicada_por,publicada_em,
          created_at,updated_at,adapter_key
        ) values ($1,$2,1,'producao','publicada','DLZ_HEALTH_LEGACY',$3,
          'https://legacy-env.invalid','{"runtime_mode":"legacy_env_sinqia_terra"}'::jsonb,
          'legacy-env:FROMTIS',$4,$5,$4,$4,$4,'sinqia_portal_fidc')
        on conflict (id) do nothing
      `, [IDS.integrationVersion, IDS.integration, cnab.codigoOriginador, APPLIED_AT, ACTOR_ID])
      await client.query(`
        insert into public.integracao_fundo_versao_capacidades
          (id,integracao_fundo_versao_id,fundo_id,ambiente,capability,disponivel_desde,created_at)
        values ($1,$2,$3,'producao','CESSAO_ENVIO',$4,$4)
        on conflict (id) do nothing
      `, [IDS.capability, IDS.integrationVersion, DLZ_ID, APPLIED_AT])

      const summary = await client.query(`
        select jsonb_build_object(
          'cedentes_dlz',(select count(distinct cedente_id) from public.cedente_fundos where fundo_id=$1 and status='ativo'),
          'atribuicoes',(select count(*) from public.cedente_fundo_politicas where politica_operacional_id=$2 and status='ativa'),
          'politica_publicada',(select count(*) from public.politica_operacional_versoes where id=$3 and status='publicada'),
          'cnab_publicado',(select count(*) from public.configuracao_cnab_versoes where id=$4 and status='publicada'),
          'integracao_publicada',(select count(*) from public.integracao_fundo_versoes where id=$5 and status='publicada'),
          'capabilities',(select array_agg(capability order by capability) from public.integracao_fundo_versao_capacidades where integracao_fundo_versao_id=$5)
        ) as value
      `, [DLZ_ID, IDS.policy, IDS.policyVersion, IDS.cnabVersion, IDS.integrationVersion])
      const value = summary.rows[0].value
      if (Number(value.cedentes_dlz) !== 12 || Number(value.atribuicoes) !== 12) throw new Error('DLZ nao ficou configurado para os 12 Cedentes.')
      await client.query('commit')
      return { ...value, cnab_hash: cnabHash, policy_hash: policyHash }
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
  writeJson(path.join(REPORT_DIR, 'P3_1_DLZ_CONFIGURATION.json'), {
    generated_at: new Date().toISOString(), environment: 'rehearsal/local', production_access: 'none', result,
  })
  console.log('DLZ/HEALTH configurado no clone local para o P3.1.')
}

main().catch((error) => {
  console.error(`Configuracao P3.1 falhou: ${formatError(error)}`)
  process.exitCode = 1
})

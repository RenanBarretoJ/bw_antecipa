import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPORT_DIR, ensureRuntimeDirectories, formatError, loadRehearsalEnv, localPgConfig,
  remoteConnectionConfig, sanitizeText, sha256, stableJson, withPgClient, writeJson,
} from './lib.mjs'
import {
  DLZ_ID, IMPULSE_ID, assertProductionApplyGuards, equivalent, loadDlzConfigManifest, parseArgs,
} from './dlz-production-config.mjs'

const CORE_FIELDS = Object.freeze({
  policy: ['id', 'fundo_id', 'codigo', 'nome', 'descricao', 'status', 'created_by', 'padrao'],
  policyVersion: ['id', 'politica_operacional_id', 'cedente_fundo_id', 'versao', 'aceite_sacado_obrigatorio', 'cessao_no_desembolso', 'cria_acompanhamento_entrega', 'configuracao', 'conteudo_hash', 'fundo_id', 'status', 'regras', 'parametros', 'permite_postergacao_upload_canhoto', 'limite_postergacao_upload_canhoto_dias', 'metodo_calculo_financeiro', 'exigir_status_logistico_pre_cessao', 'tipo_ativo_financeiro', 'controle_exposicao_logistica_ativo', 'limite_exposicao_em_transito_pct', 'gate_risco_ativo'],
  cnab: ['id', 'fundo_id', 'codigo', 'nome', 'descricao', 'finalidade', 'status', 'created_by'],
  cnabVersion: ['id', 'configuracao_cnab_id', 'versao', 'layout', 'versao_layout', 'codigo_banco', 'banco', 'agencia', 'conta', 'digito_conta', 'carteira', 'convenio', 'codigo_originador', 'codigo_empresa', 'tipo_inscricao', 'numero_inscricao', 'especie_titulo', 'tipo_recebivel', 'configuracao', 'conteudo_hash', 'status'],
  integration: ['id', 'fundo_id', 'provedor', 'nome', 'status', 'created_by', 'provider_key', 'system_name'],
  integrationVersion: ['id', 'integracao_fundo_id', 'versao', 'ambiente', 'status', 'identificador_cliente', 'codigo_originador', 'endpoint_base', 'configuracao_nao_sensivel', 'credential_ref', 'credencial_integracao_id', 'adapter_key'],
  capability: ['id', 'integracao_fundo_versao_id', 'fundo_id', 'ambiente', 'capability'],
})

function expectedRows(m) {
  const policyHash = sha256(stableJson({ fundo_id: m.fundo_id, aceite_sacado_obrigatorio: true, cessao_no_desembolso: true, cria_acompanhamento_entrega: false, gate_risco_ativo: false, controle_exposicao_logistica_ativo: false, requisitos: [] }))
  const cnabHash = sha256(stableJson({
    layout: m.cnab.layout, versaoLayout: m.cnab.layout_version, codigoBanco: m.cnab.bank_code, banco: m.cnab.bank,
    agencia: m.cnab.agency, conta: m.cnab.account, digitoConta: m.cnab.account_digit, carteira: m.cnab.wallet,
    convenio: m.cnab.agreement, codigoOriginador: m.cnab.originator_code, codigoEmpresa: m.cnab.company_code,
    tipoInscricao: m.cnab.registration_type, numeroInscricao: m.cnab.registration_number,
    especieTitulo: m.cnab.title_species, tipoRecebivel: m.cnab.receivable_type, configuracao: m.cnab.configuration,
  }))
  return {
    policy: { id: m.ids.policy, fundo_id: m.fundo_id, codigo: m.policy.code, nome: m.policy.name, descricao: m.policy.description, status: 'ativa', created_by: m.actor_id, padrao: true },
    policyVersion: { id: m.ids.policy_version, politica_operacional_id: m.ids.policy, cedente_fundo_id: null, versao: 1, aceite_sacado_obrigatorio: true, cessao_no_desembolso: true, cria_acompanhamento_entrega: false, configuracao: m.policy.configuration, conteudo_hash: policyHash, fundo_id: m.fundo_id, status: 'publicada', regras: {}, parametros: {}, permite_postergacao_upload_canhoto: false, limite_postergacao_upload_canhoto_dias: null, metodo_calculo_financeiro: m.policy.financial_calculation_method, exigir_status_logistico_pre_cessao: false, tipo_ativo_financeiro: m.policy.financial_asset_type, controle_exposicao_logistica_ativo: false, limite_exposicao_em_transito_pct: null, gate_risco_ativo: false },
    cnab: { id: m.ids.cnab, fundo_id: m.fundo_id, codigo: m.cnab.code, nome: m.cnab.name, descricao: m.cnab.description, finalidade: 'remessa', status: 'ativa', created_by: m.actor_id },
    cnabVersion: { id: m.ids.cnab_version, configuracao_cnab_id: m.ids.cnab, versao: 1, layout: m.cnab.layout, versao_layout: m.cnab.layout_version, codigo_banco: m.cnab.bank_code, banco: m.cnab.bank, agencia: m.cnab.agency, conta: m.cnab.account, digito_conta: m.cnab.account_digit, carteira: m.cnab.wallet, convenio: m.cnab.agreement, codigo_originador: m.cnab.originator_code, codigo_empresa: m.cnab.company_code, tipo_inscricao: m.cnab.registration_type, numero_inscricao: m.cnab.registration_number, especie_titulo: m.cnab.title_species, tipo_recebivel: m.cnab.receivable_type, configuracao: m.cnab.configuration, conteudo_hash: cnabHash, status: 'publicada' },
    integration: { id: m.ids.integration, fundo_id: m.fundo_id, provedor: m.integration.provider, nome: m.integration.name, status: 'ativa', created_by: m.actor_id, provider_key: m.integration.provider_key, system_name: m.integration.system_name },
    integrationVersion: { id: m.ids.integration_version, integracao_fundo_id: m.ids.integration, versao: 1, ambiente: m.integration.environment, status: 'publicada', identificador_cliente: m.integration.client_identifier, codigo_originador: m.cnab.originator_code, endpoint_base: m.integration.endpoint_placeholder, configuracao_nao_sensivel: { runtime_mode: m.integration.runtime_mode }, credential_ref: m.integration.credential_reference, credencial_integracao_id: null, adapter_key: m.integration.adapter_key },
    capability: { id: m.ids.capability, integracao_fundo_versao_id: m.ids.integration_version, fundo_id: m.fundo_id, ambiente: m.integration.environment, capability: m.integration.capability },
  }
}

async function one(client, sql, params) {
  return (await client.query(sql, params)).rows[0] ?? null
}

async function assertPreconditions(client, manifest, production) {
  const counts = (await one(client, `select jsonb_build_object(
    'fundos',(select count(*) from public.fundos),'cedentes',(select count(*) from public.cedentes),
    'cedentes_dlz',(select count(distinct cedente_id) from public.cedente_fundos where fundo_id=$1 and status='ativo'),
    'cedentes_impulse',(select count(distinct cedente_id) from public.cedente_fundos where fundo_id=$2 and status='ativo'),
    'operacoes',(select count(*) from public.operacoes),'notas_fiscais',(select count(*) from public.notas_fiscais),
    'documentos',(select count(*) from public.documentos),'storage_objects',(select count(*) from storage.objects),
    'auth_users',(select count(*) from auth.users),'profiles',(select count(*) from public.profiles),
    'operacoes_fromtis_legado',(select count(*) from public.operacoes where remessa_fromtis_id is not null or remessa_fromtis_retorno is not null),
    'historico_snapshot',(select count(*) from public.operacoes where politica_snapshot is not null or politica_operacional_versao_id is not null),
    'dlz_ativo',(select count(*) from public.fundos where id=$1 and ativo is true),
    'ator_ativo',(select count(*) from public.profiles where id=$3 and role='gestor' and status='ativo')) as value`, [DLZ_ID, IMPULSE_ID, manifest.actor_id])).value
  for (const [key, expected] of Object.entries(manifest.expected_baseline)) {
    if (Number(counts[key]) !== expected) throw new Error(`Pre-condicao divergente: ${key}=${counts[key]}, esperado=${expected}.`)
  }
  if (Number(counts.historico_snapshot) !== 0 || Number(counts.dlz_ativo) !== 1 || Number(counts.ator_ativo) !== 1) throw new Error('Historico, fundo DLZ ou ator certificado divergem das pre-condicoes.')
  // O patch P3.1 e validado pelo estado final (12 vinculos DLZ). Ele e um patch
  // de dados pos-upgrade e, no rehearsal certificado, nao integra o ledger de DDL.
  const expectedVersions = [...production.manifest.pre_upgrade_bridges, ...production.manifest.upgrade_order].map(({ file }) => file.match(/^(\d+)_/u)?.[1])
  const applied = new Set((await client.query('select version from supabase_migrations.schema_migrations')).rows.map(({ version }) => version))
  const missing = expectedVersions.filter((version) => !applied.has(version))
  if (missing.length) throw new Error(`Migrations promoviveis ausentes: ${missing.join(', ')}.`)
  const blocked = production.manifest.blocked_homolog_only.map(({ file }) => file.match(/^(\d+)_/u)?.[1]).filter((version) => applied.has(version))
  if (blocked.length) throw new Error(`Migration exclusiva de homologacao presente: ${blocked.join(', ')}.`)
  return counts
}

async function inspectConfiguration(client, manifest, production) {
  const counts = await assertPreconditions(client, manifest, production)
  const expected = expectedRows(manifest)
  const actual = {
    policy: await one(client, 'select * from public.politicas_operacionais where id=$1 or (fundo_id=$2 and codigo=$3) limit 1', [manifest.ids.policy, DLZ_ID, manifest.policy.code]),
    policyVersion: await one(client, 'select * from public.politica_operacional_versoes where id=$1 or (politica_operacional_id=$2 and versao=1) limit 1', [manifest.ids.policy_version, manifest.ids.policy]),
    cnab: await one(client, 'select * from public.configuracoes_cnab where id=$1 or (fundo_id=$2 and codigo=$3) limit 1', [manifest.ids.cnab, DLZ_ID, manifest.cnab.code]),
    cnabVersion: await one(client, 'select * from public.configuracao_cnab_versoes where id=$1 or (configuracao_cnab_id=$2 and versao=1) limit 1', [manifest.ids.cnab_version, manifest.ids.cnab]),
    integration: await one(client, 'select * from public.integracoes_fundo where id=$1 or (fundo_id=$2 and provider_key=$3) limit 1', [manifest.ids.integration, DLZ_ID, manifest.integration.provider_key]),
    integrationVersion: await one(client, 'select * from public.integracao_fundo_versoes where id=$1 or (integracao_fundo_id=$2 and versao=1) limit 1', [manifest.ids.integration_version, manifest.ids.integration]),
    capability: await one(client, 'select * from public.integracao_fundo_versao_capacidades where id=$1 or (integracao_fundo_versao_id=$2 and capability=$3) limit 1', [manifest.ids.capability, manifest.ids.integration_version, manifest.integration.capability]),
  }
  const actions = []
  for (const key of Object.keys(expected)) {
    if (!actual[key]) actions.push({ object: key, action: 'create' })
    else if (!equivalent(actual[key], expected[key], CORE_FIELDS[key])) throw new Error(`Configuracao divergente detectada: ${key}. Nenhum overwrite foi realizado.`)
    else actions.push({ object: key, action: 'identify_equivalent' })
  }
  const activeLinks = await client.query(`select a.id,a.cedente_fundo_id,a.politica_operacional_id,a.status from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where cf.fundo_id=$1 and cf.status='ativo' and a.status='ativa' order by a.cedente_fundo_id`, [DLZ_ID])
  if (activeLinks.rows.some((row) => row.politica_operacional_id !== manifest.ids.policy)) throw new Error('Cedente DLZ possui politica ativa divergente.')
  const linked = new Set(activeLinks.rows.map(({ cedente_fundo_id }) => cedente_fundo_id))
  const cedenteLinks = (await client.query(`select id from public.cedente_fundos where fundo_id=$1 and status='ativo' order by id`, [DLZ_ID])).rows
  actions.push({ object: 'assignments', action: linked.size === 12 ? 'identify_equivalent' : 'create', missing: cedenteLinks.filter(({ id }) => !linked.has(id)).length })
  const impulse = await one(client, `select (select count(*) from public.politicas_operacionais where fundo_id=$1)+(select count(*) from public.configuracoes_cnab where fundo_id=$1)+(select count(*) from public.integracoes_fundo where fundo_id=$1) as count`, [IMPULSE_ID])
  if (Number(impulse.count) !== 0) throw new Error('IMPULSE possui configuracao operacional; invariantes P4.2 nao atendidas.')
  return { expected, actual, actions, cedenteLinks, counts, impulseBefore: Number(impulse.count) }
}

async function insertMissing(client, manifest, inspection) {
  const { expected: e, actual: a } = inspection
  const t = manifest.configured_at
  if (!a.policy) await client.query(`insert into public.politicas_operacionais(id,fundo_id,codigo,nome,descricao,status,created_by,padrao,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`, [e.policy.id,e.policy.fundo_id,e.policy.codigo,e.policy.nome,e.policy.descricao,e.policy.status,e.policy.created_by,e.policy.padrao,t])
  if (!a.policyVersion) await client.query(`insert into public.politica_operacional_versoes(id,politica_operacional_id,cedente_fundo_id,versao,vigente_desde,aceite_sacado_obrigatorio,cessao_no_desembolso,cria_acompanhamento_entrega,configuracao,conteudo_hash,publicada_por,publicada_em,fundo_id,status,regras,parametros,permite_postergacao_upload_canhoto,limite_postergacao_upload_canhoto_dias,metodo_calculo_financeiro,exigir_status_logistico_pre_cessao,tipo_ativo_financeiro,controle_exposicao_logistica_ativo,limite_exposicao_em_transito_pct,gate_risco_ativo,created_at,updated_at) values($1,$2,null,1,$3,true,true,false,$4,$5,$6,$3,$7,'publicada','{}','{}',false,null,$8,false,$9,false,null,false,$3,$3)`, [e.policyVersion.id,e.policyVersion.politica_operacional_id,t,e.policyVersion.configuracao,e.policyVersion.conteudo_hash,manifest.actor_id,DLZ_ID,e.policyVersion.metodo_calculo_financeiro,e.policyVersion.tipo_ativo_financeiro])
  const active = new Set((await client.query(`select a.cedente_fundo_id from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where cf.fundo_id=$1 and a.status='ativa'`, [DLZ_ID])).rows.map(({ cedente_fundo_id }) => cedente_fundo_id))
  for (const { id } of inspection.cedenteLinks.filter(({ id }) => !active.has(id))) {
    const digest = crypto.createHash('md5').update(`p3.1:${id}`).digest('hex')
    const assignmentId = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`
    await client.query(`insert into public.cedente_fundo_politicas(id,cedente_fundo_id,politica_operacional_id,status,vigente_desde,atribuido_por,motivo,created_at,updated_at) values($1,$2,$3,'ativa',$4,$5,'P4.2 - politica DLZ para novas operacoes',$4,$4)`, [assignmentId,id,manifest.ids.policy,t,manifest.actor_id])
  }
  if (!a.cnab) await client.query(`insert into public.configuracoes_cnab(id,fundo_id,codigo,nome,descricao,finalidade,status,created_by,created_at,updated_at) values($1,$2,$3,$4,$5,'remessa','ativa',$6,$7,$7)`, [e.cnab.id,DLZ_ID,e.cnab.codigo,e.cnab.nome,e.cnab.descricao,manifest.actor_id,t])
  if (!a.cnabVersion) await client.query(`insert into public.configuracao_cnab_versoes(id,configuracao_cnab_id,versao,vigente_desde,layout,versao_layout,codigo_banco,banco,agencia,conta,digito_conta,carteira,convenio,codigo_originador,codigo_empresa,tipo_inscricao,numero_inscricao,especie_titulo,tipo_recebivel,configuracao,conteudo_hash,status,publicada_por,publicada_em,created_at,updated_at) values($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'publicada',$21,$3,$3,$3)`, [e.cnabVersion.id,e.cnabVersion.configuracao_cnab_id,t,e.cnabVersion.layout,e.cnabVersion.versao_layout,e.cnabVersion.codigo_banco,e.cnabVersion.banco,e.cnabVersion.agencia,e.cnabVersion.conta,e.cnabVersion.digito_conta,e.cnabVersion.carteira,e.cnabVersion.convenio,e.cnabVersion.codigo_originador,e.cnabVersion.codigo_empresa,e.cnabVersion.tipo_inscricao,e.cnabVersion.numero_inscricao,e.cnabVersion.especie_titulo,e.cnabVersion.tipo_recebivel,e.cnabVersion.configuracao,e.cnabVersion.conteudo_hash,manifest.actor_id])
  if (!a.integration) await client.query(`insert into public.integracoes_fundo(id,fundo_id,provedor,nome,status,created_by,created_at,updated_at,provider_key,system_name) values($1,$2,$3,$4,'ativa',$5,$6,$6,$7,$8)`, [e.integration.id,DLZ_ID,e.integration.provedor,e.integration.nome,manifest.actor_id,t,e.integration.provider_key,e.integration.system_name])
  if (!a.integrationVersion) await client.query(`insert into public.integracao_fundo_versoes(id,integracao_fundo_id,versao,ambiente,status,identificador_cliente,codigo_originador,endpoint_base,configuracao_nao_sensivel,credential_ref,vigente_desde,publicada_por,publicada_em,created_at,updated_at,adapter_key,credencial_integracao_id) values($1,$2,1,$3,'publicada',$4,$5,$6,$7,$8,$9,$10,$9,$9,$9,$11,null)`, [e.integrationVersion.id,e.integrationVersion.integracao_fundo_id,e.integrationVersion.ambiente,e.integrationVersion.identificador_cliente,e.integrationVersion.codigo_originador,e.integrationVersion.endpoint_base,e.integrationVersion.configuracao_nao_sensivel,e.integrationVersion.credential_ref,t,manifest.actor_id,e.integrationVersion.adapter_key])
  if (!a.capability) await client.query(`insert into public.integracao_fundo_versao_capacidades(id,integracao_fundo_versao_id,fundo_id,ambiente,capability,disponivel_desde,created_at) values($1,$2,$3,$4,$5,$6,$6)`, [e.capability.id,e.capability.integracao_fundo_versao_id,DLZ_ID,e.capability.ambiente,e.capability.capability,t])
}

async function semanticState(client, manifest) {
  // cedente_fundos.id e surrogate historico e pode ser reconstruido no restore;
  // a identidade semantica do vinculo e Cedente + Fundo + politica.
  const assignments = (await client.query(`select cf.cedente_id,cf.fundo_id,a.politica_operacional_id,a.status from public.cedente_fundo_politicas a join public.cedente_fundos cf on cf.id=a.cedente_fundo_id where cf.fundo_id=$1 and cf.status='ativo' and a.status='ativa' order by cf.cedente_id`, [DLZ_ID])).rows
  // O fingerprint deliberadamente cobre apenas o contrato certificado. Colunas
  // auxiliares/defaults do schema (timestamps, campos futuros e metadados de
  // publicacao) nao podem tornar dois estados operacionais equivalentes distintos.
  const value = { certified_objects: expectedRows(manifest), assignments }
  return { value, hash: sha256(stableJson(value)) }
}

export async function runDatabaseMode(client, { mode, manifest, production, manifestHash, correlationId, target = 'local', injectFailure = false }) {
  if (mode !== 'apply') {
    const inspection = await inspectConfiguration(client, manifest, production)
    const state = await semanticState(client, manifest)
    if (mode === 'verify' && inspection.actions.some(({ action }) => action === 'create')) throw new Error('DLZ_READINESS incompleto.')
    return { mode, actions: inspection.actions, semantic_hash: state.hash, readiness: mode === 'verify' ? 'READY' : 'PLANNED' }
  }
  await client.query('begin')
  try {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1,0))`, [`P4.2:${DLZ_ID}`])
    const before = await inspectConfiguration(client, manifest, production)
    await insertMissing(client, manifest, before)
    if (injectFailure) throw new Error('Falha injetada para provar rollback atomico.')
    const after = await inspectConfiguration(client, manifest, production)
    if (after.actions.some(({ action }) => action !== 'identify_equivalent')) throw new Error('Configuracao nao convergiu para o estado esperado.')
    const state = await semanticState(client, manifest)
    const changed = before.actions.some(({ action }) => action === 'create')
    await client.query(`insert into public.logs_auditoria(usuario_id,ator_tipo,origem,ator_identificador,tipo_evento,entidade_tipo,entidade_id,dados_depois,created_at) values($1,'sistema','p4_2_dlz_configurator','P4.2','DLZ_CONFIGURADA','fundos',$2,$3,$4)`, [manifest.actor_id,DLZ_ID,{correlation_id: correlationId,environment:target === 'production'?'production':'rehearsal/local',project_ref:target === 'production'?manifest.project_ref:'local-clone',fundo_id:DLZ_ID,manifest_hash:manifestHash,operation:'apply',changed,objects:after.actions.map(({object,action})=>({object,action})),result:'PASS'},new Date().toISOString()])
    await client.query('commit')
    return { mode, changed, actions: before.actions, semantic_hash: state.hash, readiness: 'READY' }
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

async function main() {
  ensureRuntimeDirectories()
  const args = parseArgs(process.argv.slice(2))
  const { manifest, manifestHash, production } = loadDlzConfigManifest()
  const env = loadRehearsalEnv()
  let config
  if (args.target === 'local') {
    if (args.fundoId && args.fundoId !== DLZ_ID) throw new Error('Clone local tambem aceita somente o fundo DLZ certificado.')
    config = localPgConfig()
  } else {
    const databaseUrl = env.DLZ_PRODUCTION_DB_URL
    if (args.mode === 'apply') assertProductionApplyGuards({ env, args, manifestHash, productionManifestHash: production.manifest_hash, databaseUrl })
    else if (!databaseUrl || args.projectRef !== manifest.project_ref || args.fundoId !== DLZ_ID) throw new Error('Acesso remoto read-only exige URL, project ref e fundo certificados.')
    config = remoteConnectionConfig(new URL(databaseUrl))
  }
  const correlationId = args.correlationId || crypto.randomUUID()
  const result = await withPgClient(config, (client) => runDatabaseMode(client, { mode: args.mode, manifest, production, manifestHash, correlationId, target: args.target }), { readOnly: args.mode !== 'apply' })
  const report = { generated_at:new Date().toISOString(), environment:args.target === 'local'?'rehearsal/local':'production', project_ref:args.target === 'local'?'local-clone':manifest.project_ref, fundo_id:DLZ_ID, manifest_hash:manifestHash, correlation_id:correlationId, result }
  writeJson(path.join(REPORT_DIR, `P4_2_DLZ_${args.mode.toUpperCase()}.json`), report)
  console.log(sanitizeText(JSON.stringify(report, null, 2)))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => { console.error(`Configurador P4.2 abortado: ${formatError(error)}`); process.exitCode = 1 })

import {
  BASE_DATE,
  BOLETO_DOCUMENT_CODE,
  DATASET_VERSION,
  addDays,
  assertHomologEnvironment,
  assertMutation,
  authSpecs,
  buildDataset,
  connectDb,
  createAdminClient,
  cnpjDigits,
  cteKey,
  deterministicUuid,
  ensureAuthUsers,
  environmentSummary,
  insertRows,
  loadHomologEnv,
  localManifestPath,
  mutationConfirmation,
  parseArgs,
  removeCreatedAuthUsers,
  sha256,
  timestamp,
  writeRestrictedJson,
} from './helpers.mjs'
import { buildFixtureFiles, buildManifest, writeFixtures } from './manifest.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const execute = assertMutation(args, 'SEED', env.projectRef)
const dataset = buildDataset()
const typeCodes = ['nf_xml', 'nf_danfe_pdf', 'cte_xml', 'comprovante_entrega', BOLETO_DOCUMENT_CODE]

let client
let admin
let actor
let authCreated = []

async function schemaGate() {
  const required = [
    'fundos', 'profiles', 'usuario_fundos', 'cedentes', 'cedente_fundos', 'sacados',
    'politicas_operacionais', 'politica_operacional_versoes', 'politica_requisitos_documentais',
    'cedente_fundo_politicas', 'notas_fiscais', 'documento_tipos', 'documentos_repositorio',
    'documento_versoes', 'documento_analises', 'documento_vinculos', 'documento_requisito_instancias',
    'evidencias_logisticas_antecipadas', 'evidencia_logistica_versoes', 'ctes', 'cte_notas_fiscais',
    'operacoes', 'operacoes_nfs', 'operacao_calculo_nfs', 'nota_fiscal_entregas', 'canhotos', 'eventos_dominio',
  ]
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name=ANY($1)
  `, [required])
  const found = new Set(rows.map((row) => row.table_name))
  const missing = required.filter((table) => !found.has(table))
  if (missing.length) throw new Error(`Schema de homologacao incompleto: ${missing.join(', ')}`)
  const functions = await client.query(`
    SELECT to_regprocedure('private.calcular_memoria_financeira_nf(uuid,numeric,numeric,date,date,text)') IS NOT NULL AS calculadora
  `)
  if (!functions.rows[0].calculadora) throw new Error('Motor financeiro canonico ainda nao esta aplicado em homologacao.')
}

async function namespaceGate() {
  const conflicts = await client.query(`
    SELECT 'fundo' entidade, f.id::text id FROM public.fundos f
    WHERE f.id=ANY($1) AND NOT EXISTS (
      SELECT 1 FROM unnest($1::uuid[], $2::text[]) expected(id,nome)
      WHERE expected.id=f.id AND expected.nome=f.nome
    )
    UNION ALL
    SELECT 'nota_fiscal', nf.id::text FROM public.notas_fiscais nf
    WHERE (nf.id=ANY($3) OR nf.chave_acesso=ANY($4))
      AND NOT (nf.id=ANY($3) AND nf.fundo_id=ANY($1))
    UNION ALL
    SELECT 'operacao', o.id::text FROM public.operacoes o
    WHERE o.id=ANY($5) AND o.cedente_id<>ALL($6)
  `, [
    dataset.funds.map((item) => item.id), dataset.funds.map((item) => item.name),
    dataset.notes.map((item) => item.id), dataset.notes.map((item) => item.key),
    dataset.operations.map((item) => item.id), dataset.cedents.map((item) => item.id),
  ])
  if (conflicts.rows.length) {
    throw new Error(`Namespace ${DATASET_VERSION} colide com dados externos: ${conflicts.rows.map((row) => `${row.entidade}:${row.id}`).join(', ')}`)
  }
}

async function resolveDocumentTypes({ create = false } = {}) {
  const boletoId = deterministicUuid('document-type-boleto-duplicata-digital')
  if (create) {
    await client.query(`
      INSERT INTO public.documento_tipos (
        id, codigo, nome, dominio, mime_types_aceitos, extensoes_aceitas,
        tamanho_max_bytes, permite_multiplas_versoes, ativo
      ) VALUES ($1,$2,'Boleto / Duplicata Digital','nf',ARRAY['application/pdf'],ARRAY['pdf'],20971520,true,true)
      ON CONFLICT (codigo) DO NOTHING
    `, [boletoId, BOLETO_DOCUMENT_CODE])
  }
  const { rows } = await client.query(`SELECT id,codigo,nome,ativo FROM public.documento_tipos WHERE codigo=ANY($1)`, [typeCodes])
  const byCode = new Map(rows.map((row) => [row.codigo, row]))
  const missing = typeCodes.filter((code) => !byCode.get(code)?.ativo && code !== BOLETO_DOCUMENT_CODE)
  if (missing.length) throw new Error(`Catalogo documental incompleto: ${missing.join(', ')}`)
  if (create && !byCode.get(BOLETO_DOCUMENT_CODE)?.ativo) throw new Error('Nao foi possivel disponibilizar Boleto / Duplicata Digital no catalogo.')
  return new Map([...byCode].map(([code, row]) => [code, row.id]))
}

async function resolveManager() {
  const email = String(args['gestor-email'] || process.env.RLX_GOLDEN_GESTOR_EMAIL || '').trim().toLowerCase()
  if (!email) return null
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Falha ao localizar gestor opcional: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  const user = users.find((item) => String(item.email).toLowerCase() === email)
  if (!user) throw new Error('RLX_GOLDEN_GESTOR_EMAIL nao corresponde a usuario Auth de homologacao.')
  const profile = await client.query(`SELECT role::text,status::text FROM public.profiles WHERE id=$1`, [user.id])
  if (profile.rows[0]?.role !== 'gestor' || profile.rows[0]?.status !== 'ativo') {
    throw new Error('O gestor opcional precisa possuir profile gestor ativo.')
  }
  return { id: user.id, email }
}

function requirementRows(typeIds) {
  const specs = [
    { key: 'xml', code: 'RLX_NF_XML', typeCode: 'nf_xml', catalog: 'nf_xml', scope: 'nf_pre_cessao', formats: ['application/xml'], order: 1 },
    { key: 'danfe', code: 'RLX_NF_DANFE', typeCode: 'nf_danfe_pdf', catalog: 'nf_danfe_pdf', scope: 'nf_pre_cessao', formats: ['application/pdf'], order: 2 },
    { key: 'boleto', code: 'RLX_BOLETO_DUPLICATA_DIGITAL', typeCode: 'boleto', catalog: BOLETO_DOCUMENT_CODE, scope: 'nf_pre_cessao', formats: ['application/pdf'], order: 3 },
    { key: 'cte', code: 'RLX_CTE_DACTE', typeCode: 'cte', catalog: 'cte_xml', scope: 'pos_cessao', formats: ['application/xml', 'application/pdf'], order: 4, due: 10 },
    { key: 'proof', code: 'RLX_COMPROVANTE_ENTREGA', typeCode: 'comprovante_entrega', catalog: 'comprovante_entrega', scope: 'pos_cessao', formats: ['application/pdf'], order: 5, due: 20 },
  ]
  return dataset.funds.flatMap((fund) => specs.map((spec) => ({
    id: fund.requirementIds[spec.key], politica_operacional_versao_id: fund.policyVersionId,
    politica_operacional_id: fund.policyId, cedente_fundo_id: null, codigo: spec.code,
    escopo: spec.scope, tipo_documento_codigo: spec.typeCode, obrigatorio: true, quantidade_minima: 1,
    formatos_aceitos: spec.formats, nivel_validacao: spec.key === 'xml' || spec.key === 'cte' ? 'hibrido' : 'manual',
    prazo_dias_corridos: spec.due ?? null, responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor',
    ordem: spec.order, ativo: true, documento_tipo_id: typeIds.get(spec.catalog), fundo_id: fund.id,
    momento_obrigatorio: spec.scope, categoria: spec.scope, bloqueia_fluxo: true,
    observacoes: `Requisito sintetico ${DATASET_VERSION}`,
  })))
}

function policySnapshot(fund) {
  return {
    schema: 'politica_operacional_snapshot_v1', qa_dataset: DATASET_VERSION,
    tipo_ativo_financeiro: 'NOTA_FISCAL', aceite_sacado_obrigatorio: false,
    cessao_no_desembolso: false, cria_acompanhamento_entrega: true,
    exigir_status_logistico_pre_cessao: true,
    calculo_financeiro: { metodo: 'DIAS_UTEIS_252', versao_motor: 1 },
    requisitos: [
      ['xml', 'RLX_NF_XML', 'nf_xml', 'nf_pre_cessao'],
      ['danfe', 'RLX_NF_DANFE', 'nf_danfe_pdf', 'nf_pre_cessao'],
      ['boleto', 'RLX_BOLETO_DUPLICATA_DIGITAL', 'boleto', 'nf_pre_cessao'],
      ['cte', 'RLX_CTE_DACTE', 'cte', 'pos_cessao'],
      ['proof', 'RLX_COMPROVANTE_ENTREGA', 'comprovante_entrega', 'pos_cessao'],
    ].map(([key, codigo, tipo, escopo]) => ({
      id: fund.requirementIds[key], codigo, tipo_documento_codigo: tipo, escopo,
      momento_obrigatorio: escopo, obrigatorio: true, ativo: true, responsavel_upload: 'cedente',
    })),
  }
}

function documentTypeFor(document, typeIds) {
  const code = document.family === 'boleto' ? BOLETO_DOCUMENT_CODE : document.family
  return typeIds.get(code)
}

function documentMime(document) {
  return document.family.endsWith('_xml') ? 'application/xml' : 'application/pdf'
}

function currentAnalysis(document) {
  if (document.status === 'aprovado') return 'aprovado'
  if (document.status === 'rejeitado') return 'rejeitado'
  return null
}

async function seedTransactional(users, manager) {
  await client.query('BEGIN')
  await client.query(`SELECT set_config('app.qa_dataset',$1,true)`, [DATASET_VERSION])
  const typeIds = await resolveDocumentTypes({ create: true })

  await insertRows(client, 'profiles', ['id', 'role', 'nome_completo', 'email', 'status'], authSpecs().map((spec) => {
    const user = users.get(spec.key)
    return { id: user.id, role: spec.role, nome_completo: spec.name, email: spec.email, status: 'ativo' }
  }), {
    conflict: `ON CONFLICT (id) DO UPDATE SET
      role=EXCLUDED.role,
      nome_completo=EXCLUDED.nome_completo,
      email=EXCLUDED.email,
      status=EXCLUDED.status`,
  })
  await client.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [actor.id])
  await client.query(`SELECT set_config('request.jwt.claim.role','authenticated',true)`)
  await insertRows(client, 'fundos', [
    'id', 'nome', 'cnpj', 'administradora_nome', 'administradora_cnpj',
    'gestora_nome', 'gestora_cnpj', 'custodiante_nome', 'custodiante_cnpj', 'ativo',
  ], dataset.funds.map((fund, index) => ({
    id: fund.id, nome: fund.name, cnpj: fund.cnpj,
    administradora_nome: 'QA RLX ADMINISTRADORA SINTETICA', administradora_cnpj: cnpjDigits('839400000001'),
    gestora_nome: 'QA RLX GESTORA SINTETICA', gestora_cnpj: cnpjDigits('839400000002'),
    custodiante_nome: 'QA RLX CUSTODIANTE SINTETICO', custodiante_cnpj: cnpjDigits(`83940000000${index + 3}`), ativo: true,
  })))
  if (manager) {
    await insertRows(client, 'usuario_fundos', ['id', 'usuario_id', 'fundo_id', 'perfil_no_fundo', 'status', 'principal'], [{
      id: deterministicUuid(`manager-main-fund-${manager.id}`), usuario_id: manager.id,
      fundo_id: dataset.mainFund.id, perfil_no_fundo: 'gestor', status: 'ativo', principal: false,
    }])
  }
  await insertRows(client, 'cedentes', ['id', 'user_id', 'cnpj', 'razao_social', 'nome_fantasia', 'email_comercial', 'status'], dataset.cedents.map((cedent) => ({
    id: cedent.id, user_id: users.get(cedent.userKey).id, cnpj: cedent.cnpj, razao_social: cedent.name,
    nome_fantasia: cedent.name, email_comercial: users.get(cedent.userKey).email, status: 'ativo',
  })))
  await insertRows(client, 'cedente_fundos', ['id', 'cedente_id', 'fundo_id', 'codigo_externo', 'status', 'observacoes'], dataset.cedents.map((cedent) => ({
    id: cedent.linkId, cedente_id: cedent.id, fundo_id: cedent.fund.id,
    codigo_externo: `RLX-${cedent.fund.key}-${cedent.id.slice(0, 8)}`, status: 'ativo', observacoes: DATASET_VERSION,
  })))
  await insertRows(client, 'sacados', ['id', 'user_id', 'cnpj', 'razao_social', 'email'], dataset.debtors.map((debtor) => ({
    id: debtor.id, user_id: users.get(debtor.userKey).id, cnpj: debtor.cnpj,
    razao_social: debtor.name, email: users.get(debtor.userKey).email,
  })))

  await insertRows(client, 'politicas_operacionais', ['id', 'codigo', 'nome', 'descricao', 'status', 'created_by', 'fundo_id', 'padrao'], dataset.funds.map((fund) => ({
    id: fund.policyId, codigo: fund.policyCode, nome: `Politica RLX NF - ${fund.name}`,
    descricao: `Politica sintetica ${DATASET_VERSION}; Boleto/Duplicata Digital obrigatorio pre-cessao.`,
    status: 'rascunho', created_by: actor.id, fundo_id: fund.id, padrao: true,
  })))
  await insertRows(client, 'politica_operacional_versoes', [
    'id', 'politica_operacional_id', 'cedente_fundo_id', 'fundo_id', 'versao', 'vigente_desde',
    'aceite_sacado_obrigatorio', 'cessao_no_desembolso', 'cria_acompanhamento_entrega',
    'configuracao', 'conteudo_hash', 'status', 'regras', 'parametros',
    'permite_postergacao_upload_canhoto', 'limite_postergacao_upload_canhoto_dias',
    'metodo_calculo_financeiro', 'exigir_status_logistico_pre_cessao', 'tipo_ativo_financeiro',
  ], dataset.funds.map((fund) => ({
    id: fund.policyVersionId, politica_operacional_id: fund.policyId, cedente_fundo_id: null, fundo_id: fund.id,
    versao: 1, vigente_desde: timestamp(addDays(BASE_DATE, -90), 0), aceite_sacado_obrigatorio: false,
    cessao_no_desembolso: false, cria_acompanhamento_entrega: true,
    configuracao: { qa_dataset: DATASET_VERSION, lastro: 'NOTA_FISCAL' },
    conteudo_hash: sha256(`policy-${fund.key}-v1`), status: 'rascunho', regras: {}, parametros: {},
    permite_postergacao_upload_canhoto: true, limite_postergacao_upload_canhoto_dias: 30,
    metodo_calculo_financeiro: 'DIAS_UTEIS_252', exigir_status_logistico_pre_cessao: true,
    tipo_ativo_financeiro: 'NOTA_FISCAL',
  })))
  const requirements = requirementRows(typeIds)
  const existingRequirementIds = new Set((await client.query(`SELECT id FROM public.politica_requisitos_documentais WHERE id=ANY($1)`, [requirements.map((item) => item.id)])).rows.map((row) => row.id))
  await insertRows(client, 'politica_requisitos_documentais', Object.keys(requirements[0]), requirements.filter((item) => !existingRequirementIds.has(item.id)))
  await client.query(`
    UPDATE public.politica_operacional_versoes
    SET status='publicada', publicada_por=$1, publicada_em=COALESCE(publicada_em,$2)
    WHERE id=ANY($3) AND status='rascunho'
  `, [actor.id, timestamp(addDays(BASE_DATE, -89), 10), dataset.funds.map((item) => item.policyVersionId)])
  await client.query(`UPDATE public.politicas_operacionais SET status='ativa' WHERE id=ANY($1) AND status='rascunho'`, [dataset.funds.map((item) => item.policyId)])
  await insertRows(client, 'cedente_fundo_politicas', ['id', 'cedente_fundo_id', 'politica_operacional_id', 'status', 'vigente_desde', 'atribuido_por', 'motivo'], dataset.cedents.map((cedent) => ({
    id: cedent.assignmentId, cedente_fundo_id: cedent.linkId, politica_operacional_id: cedent.fund.policyId,
    status: 'ativa', vigente_desde: timestamp(addDays(BASE_DATE, -88), 0), atribuido_por: actor.id, motivo: DATASET_VERSION,
  })))

  await insertRows(client, 'notas_fiscais', [
    'id', 'cedente_id', 'cedente_fundo_id', 'fundo_id', 'numero_nf', 'serie', 'chave_acesso',
    'data_emissao', 'data_vencimento', 'cnpj_emitente', 'razao_social_emitente',
    'cnpj_destinatario', 'razao_social_destinatario', 'valor_bruto', 'valor_liquido',
    'descricao_itens', 'condicao_pagamento', 'status', 'created_at', 'updated_at',
  ], dataset.notes.map((note) => ({
    id: note.id, cedente_id: note.cedent.id, cedente_fundo_id: note.cedent.linkId, fundo_id: note.fund.id,
    numero_nf: note.number, serie: 'RLX', chave_acesso: note.key, data_emissao: note.issueDate,
    data_vencimento: note.dueDate, cnpj_emitente: note.cedent.cnpj, razao_social_emitente: note.cedent.name,
    cnpj_destinatario: note.debtor.cnpj, razao_social_destinatario: note.debtor.name,
    valor_bruto: note.value, valor_liquido: note.value, descricao_itens: `Mercadoria sintetica ${DATASET_VERSION}`,
    condicao_pagamento: 'Fixture QA sem validade fiscal', status: note.operation ? 'em_antecipacao' : 'aprovada',
    created_at: timestamp(addDays(note.issueDate, 1), 10), updated_at: timestamp(BASE_DATE, 8),
  })), { batchSize: 50 })

  const actorContext = await client.query(`
    SELECT auth.uid() AS auth_uid, public.get_user_role() AS user_role,
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=$1 AND p.role::text='gestor') AS profile_ok,
      (SELECT count(*)::integer FROM public.notas_fiscais nf WHERE nf.id=ANY($2)) AS note_count
  `, [actor.id, dataset.notes.map((note) => note.id)])
  const context = actorContext.rows[0]
  if (context.auth_uid !== actor.id || context.user_role !== 'gestor' || !context.profile_ok || Number(context.note_count) !== dataset.notes.length) {
    throw new Error(`Contexto tecnico invalido antes da reconciliacao: auth=${context.auth_uid || 'null'}, role=${context.user_role || 'null'}, profile=${context.profile_ok}, notas=${context.note_count}`)
  }

  await insertRows(client, 'documentos_repositorio', ['id', 'documento_tipo_id', 'status', 'criado_por', 'created_at', 'updated_at'], dataset.documents.map((document) => ({
    id: document.id, documento_tipo_id: documentTypeFor(document, typeIds), status: document.status,
    criado_por: users.get(document.note.cedent.userKey).id, created_at: document.uploadedAt, updated_at: document.uploadedAt,
  })), { batchSize: 60 })
  await insertRows(client, 'documento_versoes', [
    'id', 'documento_id', 'numero_versao', 'bucket', 'path', 'nome_original', 'mime_type',
    'tamanho_bytes', 'sha256', 'status', 'substitui_versao_id', 'enviado_por', 'enviado_em', 'created_at',
  ], dataset.documents.map((document) => ({
    id: document.versionId, documento_id: document.id, numero_versao: 1, bucket: 'documentos-v2',
    path: `qa-rlx-golden/${document.fund?.key || document.note.fund.key}/${document.note.id}/${document.family}/v1`,
    nome_original: `QA_RLX_${document.note.number}_${document.family}.${documentMime(document) === 'application/xml' ? 'xml' : 'pdf'}`,
    mime_type: documentMime(document), tamanho_bytes: 512 + document.note.index,
    sha256: sha256(`document-${document.id}-v1`), status: document.status, substitui_versao_id: null,
    enviado_por: users.get(document.note.cedent.userKey).id, enviado_em: document.uploadedAt, created_at: document.uploadedAt,
  })), { batchSize: 60 })
  const analyses = dataset.documents.filter((document) => currentAnalysis(document)).map((document) => ({
    id: deterministicUuid(`analysis-${document.id}`), documento_versao_id: document.versionId,
    resultado: currentAnalysis(document), analisado_por: actor.id, ator_tipo: 'usuario',
    observacoes: document.status === 'rejeitado' ? `Rejeicao sintetica ${DATASET_VERSION}` : `Aprovacao sintetica ${DATASET_VERSION}`,
    dados_estruturados: { qa_dataset: DATASET_VERSION, boleto: document.evidence || null },
    analisado_em: timestamp(addDays(document.uploadedAt.slice(0, 10), 1), 15),
    created_at: timestamp(addDays(document.uploadedAt.slice(0, 10), 1), 15),
  }))
  const existingAnalysisIds = new Set((await client.query(`SELECT id FROM public.documento_analises WHERE id=ANY($1)`, [analyses.map((item) => item.id)])).rows.map((row) => row.id))
  await insertRows(client, 'documento_analises', Object.keys(analyses[0]), analyses.filter((item) => !existingAnalysisIds.has(item.id)), { batchSize: 60 })

  const cteDocuments = dataset.documents.filter((document) => document.family === 'cte_xml')
  const transporterCnpj = cnpjDigits('839500000001')
  await insertRows(client, 'ctes', [
    'id', 'cedente_id', 'fundo_id', 'cedente_fundo_id', 'chave_cte', 'numero', 'serie', 'data_emissao',
    'cnpj_transportadora', 'cnpj_remetente', 'cnpj_destinatario', 'valor_frete', 'formato_origem',
    'nivel_validacao', 'status', 'analisado_por', 'analisado_em', 'motivo_rejeicao',
    'documento_id', 'documento_versao_atual_id', 'documento_versao_aprovada_id',
    'dados_extraidos', 'resultado_validacao', 'created_at', 'updated_at',
  ], cteDocuments.map((document) => ({
    id: deterministicUuid(`cte-${document.note.id}`), cedente_id: document.note.cedent.id,
    fundo_id: document.note.fund.id, cedente_fundo_id: document.note.cedent.linkId,
    chave_cte: cteKey({ cnpj: transporterCnpj, number: document.note.index, seed: document.note.index }),
    numero: `RLX-${document.note.number}`, serie: 'RLX', data_emissao: addDays(BASE_DATE, -3),
    cnpj_transportadora: transporterCnpj, cnpj_remetente: document.note.cedent.cnpj,
    cnpj_destinatario: document.note.debtor.cnpj, valor_frete: Number((300 + document.note.index * 7.13).toFixed(2)),
    formato_origem: 'xml', nivel_validacao: 'hibrido', status: document.status,
    analisado_por: currentAnalysis(document) ? actor.id : null,
    analisado_em: currentAnalysis(document) ? timestamp(addDays(document.uploadedAt.slice(0, 10), 1), 15) : null,
    motivo_rejeicao: document.status === 'rejeitado' ? `Divergencia sintetica ${DATASET_VERSION}` : null,
    documento_id: document.id, documento_versao_atual_id: document.versionId,
    documento_versao_aprovada_id: document.status === 'aprovado' ? document.versionId : null,
    dados_extraidos: { qa_dataset: DATASET_VERSION, synthetic: true },
    resultado_validacao: { qa_dataset: DATASET_VERSION, status: document.status },
    created_at: document.uploadedAt, updated_at: document.uploadedAt,
  })), { batchSize: 50 })
  await insertRows(client, 'cte_notas_fiscais', ['cte_id', 'nota_fiscal_id', 'chave_nfe_referenciada', 'status_validacao', 'resultado_validacao', 'divergencias', 'validado_em'], cteDocuments.map((document) => ({
    cte_id: deterministicUuid(`cte-${document.note.id}`), nota_fiscal_id: document.note.id,
    chave_nfe_referenciada: document.note.key,
    status_validacao: document.status === 'rejeitado' ? 'rejeitado' : document.status === 'aprovado' ? 'aprovado' : 'validacao_parcial',
    resultado_validacao: { qa_dataset: DATASET_VERSION },
    divergencias: JSON.stringify(document.status === 'rejeitado' ? [{ code: 'QA_DIVERGENCIA' }] : []),
    validado_em: document.uploadedAt,
  })), { batchSize: 60 })

  await insertRows(client, 'documento_vinculos', ['id', 'documento_id', 'nota_fiscal_id', 'operacao_id', 'nota_fiscal_entrega_id', 'cte_id', 'cedente_id', 'principal'], dataset.documents.map((document) => ({
    id: deterministicUuid(`document-link-${document.id}`), documento_id: document.id,
    nota_fiscal_id: document.family === 'cte_xml' ? null : document.note.id,
    operacao_id: null, nota_fiscal_entrega_id: null,
    cte_id: document.family === 'cte_xml' ? deterministicUuid(`cte-${document.note.id}`) : null,
    cedente_id: document.note.cedent.id, principal: true,
  })), { batchSize: 60 })

  const preSpecs = [
    { key: 'xml', family: 'nf_xml', type: 'nf_xml', catalog: 'nf_xml' },
    { key: 'danfe', family: 'nf_danfe_pdf', type: 'nf_danfe_pdf', catalog: 'nf_danfe_pdf' },
    { key: 'boleto', family: 'boleto', type: 'boleto', catalog: BOLETO_DOCUMENT_CODE },
  ]
  const preInstances = dataset.notes.flatMap((note) => preSpecs.map((spec) => {
    const document = dataset.documentByNoteFamily.get(`${note.id}:${spec.family}`)
    const approved = document?.status === 'aprovado'
    return {
      id: deterministicUuid(`requirement-instance-${note.id}-${spec.key}`),
      politica_requisito_id: note.fund.requirementIds[spec.key], politica_operacional_id: note.fund.policyId,
      politica_operacional_versao_id: note.fund.policyVersionId, politica_versao: 1,
      documento_tipo_id: typeIds.get(spec.catalog), tipo_documento_codigo_snapshot: spec.type,
      escopo_snapshot: 'nf_pre_cessao', nota_fiscal_id: note.id, operacao_id: null,
      nota_fiscal_entrega_id: null, cedente_id: note.cedent.id, status: approved ? 'satisfeito' : 'pendente',
      obrigatorio: true, prazo_limite: null,
      formatos_aceitos_snapshot: spec.family === 'nf_xml' ? ['application/xml'] : ['application/pdf'],
      nivel_validacao_snapshot: spec.family === 'nf_xml' ? 'hibrido' : 'manual', quantidade_minima_snapshot: 1,
      responsavel_upload_snapshot: 'cedente', responsavel_aprovacao_snapshot: 'gestor',
      documento_id: document?.id || null, versao_aprovada_id: approved ? document.versionId : null,
      satisfeito_em: approved ? document.uploadedAt : null, origem_snapshot: spec.key === 'xml' || spec.key === 'danfe' ? 'documento_base_nf' : 'upload_requisito',
      created_at: timestamp(addDays(BASE_DATE, -4), 8), updated_at: timestamp(BASE_DATE, 8),
    }
  }))
  await insertRows(client, 'documento_requisito_instancias', Object.keys(preInstances[0]), preInstances, { batchSize: 45 })

  const evidenceDocuments = dataset.documents.filter((document) => ['cte_xml', 'comprovante_entrega'].includes(document.family))
  await insertRows(client, 'evidencias_logisticas_antecipadas', [
    'id', 'nota_fiscal_id', 'fundo_id', 'cedente_id', 'cedente_fundo_id', 'politica_operacional_versao_id',
    'politica_requisito_id', 'familia_documental', 'documento_id', 'documento_versao_atual_id',
    'primeiro_upload_em', 'ultimo_upload_em', 'criado_por', 'created_at', 'updated_at',
  ], evidenceDocuments.map((document) => ({
    id: deterministicUuid(`evidence-${document.note.id}-${document.family}`), nota_fiscal_id: document.note.id,
    fundo_id: document.note.fund.id, cedente_id: document.note.cedent.id, cedente_fundo_id: document.note.cedent.linkId,
    politica_operacional_versao_id: document.note.fund.policyVersionId,
    politica_requisito_id: document.note.fund.requirementIds[document.family === 'cte_xml' ? 'cte' : 'proof'],
    familia_documental: document.family === 'cte_xml' ? 'cte' : 'comprovante_entrega',
    documento_id: document.id, documento_versao_atual_id: document.versionId,
    primeiro_upload_em: document.uploadedAt, ultimo_upload_em: document.uploadedAt,
    criado_por: users.get(document.note.cedent.userKey).id, created_at: document.uploadedAt, updated_at: document.uploadedAt,
  })), { batchSize: 60 })
  await insertRows(client, 'evidencia_logistica_versoes', ['id', 'evidencia_logistica_id', 'documento_id', 'documento_versao_id', 'created_at'], evidenceDocuments.map((document) => ({
    id: deterministicUuid(`evidence-version-${document.note.id}-${document.family}-v1`),
    evidencia_logistica_id: deterministicUuid(`evidence-${document.note.id}-${document.family}`),
    documento_id: document.id, documento_versao_id: document.versionId, created_at: document.uploadedAt,
  })), { batchSize: 60 })

  const operationRows = dataset.operations.map((operation) => {
    const snapshot = policySnapshot(operation.note.fund)
    return {
      id: operation.id, cedente_id: operation.note.cedent.id, cedente_fundo_id: operation.note.cedent.linkId,
      valor_bruto_total: operation.note.value, taxa_desconto: operation.rate, prazo_dias: 30,
      valor_liquido_desembolso: null, data_vencimento: operation.note.dueDate, status: 'solicitada',
      valor_face_total: operation.note.value, preco_aquisicao: null, created_at: operation.createdAt, updated_at: operation.createdAt,
      politica_operacional_id: operation.note.fund.policyId, politica_operacional_versao_id: operation.note.fund.policyVersionId,
      politica_versao: 1, politica_snapshot: snapshot, politica_snapshot_hash: sha256(JSON.stringify(snapshot)),
      contexto_configuracao_status: 'completo', contexto_capturado_em: operation.createdAt,
      aceite_sacado_exigido: false, aceite_sacado_status: 'dispensado',
      politica_atribuicao_id: operation.note.cedent.assignmentId,
      metodo_calculo_financeiro: 'DIAS_UTEIS_252', calculo_data_base: BASE_DATE, calculo_versao_motor: 1,
    }
  })
  await insertRows(client, 'operacoes', Object.keys(operationRows[0]), operationRows)
  await insertRows(client, 'operacoes_nfs', ['operacao_id', 'nota_fiscal_id'], dataset.operations.map((operation) => ({
    operacao_id: operation.id, nota_fiscal_id: operation.note.id,
  })))

  await client.query(`SELECT set_config('app.calculo_aprovacao','true',true)`)
  for (const operation of dataset.operations) {
    const result = await client.query(`
      SELECT private.calcular_memoria_financeira_nf($1,$2,$3,$4,$5,'DIAS_UTEIS_252') memoria
    `, [operation.note.id, operation.note.value, operation.rate, BASE_DATE, operation.note.dueDate])
    const memory = result.rows[0].memoria
    await insertRows(client, 'operacao_calculo_nfs', [
      'id', 'operacao_id', 'nota_fiscal_id', 'fundo_id', 'cedente_id', 'metodo_calculo_financeiro',
      'valor_nominal', 'taxa_mensal', 'data_base', 'vencimento_contratual', 'vencimento_calculo',
      'base_calculo', 'calendario', 'dias_corridos_reais', 'dias_uteis', 'dias_financeiros',
      'dias_aplicados', 'expoente', 'fator', 'valor_presente', 'desconto', 'regra_arredondamento', 'versao_motor', 'created_at',
    ], [{
      id: deterministicUuid(`operation-calculation-${operation.id}`), operacao_id: operation.id,
      nota_fiscal_id: operation.note.id, fundo_id: operation.note.fund.id, cedente_id: operation.note.cedent.id,
      metodo_calculo_financeiro: 'DIAS_UTEIS_252', valor_nominal: memory.valor_nominal,
      taxa_mensal: operation.rate, data_base: BASE_DATE, vencimento_contratual: memory.vencimento_contratual,
      vencimento_calculo: memory.vencimento_calculo, base_calculo: memory.base, calendario: memory.calendario,
      dias_corridos_reais: memory.dias_corridos_reais, dias_uteis: memory.dias_uteis,
      dias_financeiros: memory.dias_financeiros, dias_aplicados: memory.dias, expoente: memory.expoente,
      fator: memory.fator, valor_presente: memory.valor_presente, desconto: memory.desconto,
      regra_arredondamento: memory.arredondamento, versao_motor: memory.versao_motor, created_at: operation.approvedAt,
    }])
    await client.query(`
      UPDATE public.operacoes SET status='aprovada', aprovado_por=$2, aprovado_em=$3,
        valor_liquido_desembolso=$4, preco_aquisicao=$4, prazo_dias=$5,
        calculo_memoria=$6, updated_at=$3
      WHERE id=$1 AND status='solicitada'
    `, [operation.id, actor.id, operation.approvedAt, memory.valor_presente, memory.dias, {
      qa_dataset: DATASET_VERSION, ...memory,
    }])
    await client.query(`UPDATE public.notas_fiscais SET taxa_desagio=$2,valor_antecipado=$3 WHERE id=$1`, [operation.note.id, operation.rate, memory.valor_presente])
  }

  const deliveries = dataset.operations.map((operation) => ({
    id: deterministicUuid(`delivery-${operation.note.id}`), operacao_id: operation.id, nota_fiscal_id: operation.note.id,
    status_entrega: operation.note.logistics === 'ENTREGUE' ? 'entregue' : operation.note.logistics === 'EM_TRANSITO' ? 'em_transito' : 'aguardando_validacao',
    cessao_efetivada_em: operation.approvedAt, data_limite_cte: addDays(BASE_DATE, 10), data_limite_canhoto: addDays(BASE_DATE, 20),
    data_entrega: operation.note.logistics === 'ENTREGUE' ? addDays(BASE_DATE, -1) : null,
    entrega_confirmada_em: operation.note.logistics === 'ENTREGUE' ? timestamp(addDays(BASE_DATE, -1), 17) : null,
    motivo_pendencia: operation.note.logistics === 'INDETERMINADA' ? 'Evidencia sintetica insuficiente' : null,
    created_at: operation.approvedAt, updated_at: operation.approvedAt,
  }))
  await insertRows(client, 'nota_fiscal_entregas', Object.keys(deliveries[0]), deliveries)
  const deliveryByNote = new Map(deliveries.map((delivery) => [delivery.nota_fiscal_id, delivery]))
  const proofForOperation = dataset.operations.map((operation) => dataset.documentByNoteFamily.get(`${operation.note.id}:comprovante_entrega`)).filter(Boolean)
  await insertRows(client, 'canhotos', [
    'id', 'nota_fiscal_entrega_id', 'status', 'data_assinatura', 'nome_recebedor', 'documento_recebedor',
    'possui_assinatura', 'possui_ressalva', 'descricao_ressalva', 'recebido_em', 'analisado_por',
    'analisado_em', 'motivo_rejeicao', 'documento_id', 'documento_versao_atual_id',
    'documento_versao_aprovada_id', 'created_at', 'updated_at',
  ], proofForOperation.map((document) => ({
    id: deterministicUuid(`canhoto-${document.note.id}`), nota_fiscal_entrega_id: deliveryByNote.get(document.note.id).id,
    status: document.status, data_assinatura: addDays(BASE_DATE, -1), nome_recebedor: 'RECEBEDOR QA RLX',
    documento_recebedor: '00000000000', possui_assinatura: true, possui_ressalva: false, descricao_ressalva: null,
    recebido_em: document.uploadedAt, analisado_por: currentAnalysis(document) ? actor.id : null,
    analisado_em: currentAnalysis(document) ? timestamp(addDays(document.uploadedAt.slice(0, 10), 1), 15) : null,
    motivo_rejeicao: document.status === 'rejeitado' ? `Rejeicao sintetica ${DATASET_VERSION}` : null,
    documento_id: document.id, documento_versao_atual_id: document.versionId,
    documento_versao_aprovada_id: document.status === 'aprovado' ? document.versionId : null,
    created_at: document.uploadedAt, updated_at: document.uploadedAt,
  })))

  await insertRows(client, 'eventos_dominio', [
    'id', 'fundo_id', 'cedente_id', 'cedente_fundo_id', 'nota_fiscal_id', 'operacao_id',
    'tipo_evento', 'categoria', 'ator_usuario_id', 'ator_nome_snapshot', 'ator_perfil_snapshot',
    'origem', 'descricao', 'metadata', 'visibilidade', 'correlation_id', 'origem_evento', 'origem_registro_id', 'created_at',
  ], dataset.operations.flatMap((operation) => ([
    {
      id: deterministicUuid(`event-operation-created-${operation.id}`), fundo_id: operation.note.fund.id,
      cedente_id: operation.note.cedent.id, cedente_fundo_id: operation.note.cedent.linkId,
      nota_fiscal_id: operation.note.id, operacao_id: operation.id, tipo_evento: 'OPERACAO_SOLICITADA_QA_RLX', categoria: 'operacao',
      ator_usuario_id: users.get(operation.note.cedent.userKey).id, ator_nome_snapshot: operation.note.cedent.name,
      ator_perfil_snapshot: 'cedente', origem: 'seed_homologacao', descricao: 'Operacao sintetica solicitada.',
      metadata: { qa_dataset: DATASET_VERSION }, visibilidade: 'ambos', correlation_id: `rlx-${operation.id}`,
      origem_evento: DATASET_VERSION, origem_registro_id: operation.id, created_at: operation.createdAt,
    },
    {
      id: deterministicUuid(`event-operation-approved-${operation.id}`), fundo_id: operation.note.fund.id,
      cedente_id: operation.note.cedent.id, cedente_fundo_id: operation.note.cedent.linkId,
      nota_fiscal_id: operation.note.id, operacao_id: operation.id, tipo_evento: 'OPERACAO_APROVADA_QA_RLX', categoria: 'aprovacao',
      ator_usuario_id: actor.id, ator_nome_snapshot: actor.name, ator_perfil_snapshot: 'gestor',
      origem: 'seed_homologacao', descricao: 'Operacao sintetica aprovada com memoria financeira canonica.',
      metadata: { qa_dataset: DATASET_VERSION }, visibilidade: 'ambos', correlation_id: `rlx-${operation.id}`,
      origem_evento: DATASET_VERSION, origem_registro_id: operation.id, created_at: operation.approvedAt,
    },
  ])))

  await client.query('COMMIT')
}

try {
  console.log('\nBW Antecipa - P2.1 Golden Dataset Temporal RLX')
  console.log(environmentSummary(env))
  console.log(`Modo: ${execute ? 'EXECUTE' : 'DRY-RUN (padrao seguro)'}`)
  console.log(`Base temporal: ${BASE_DATE}; fundos: ${dataset.funds.map((item) => item.name).join(' | ')}`)
  console.log(`Plano: ${dataset.notes.length} NFs, ${dataset.operations.length} operacoes D0, ${dataset.documents.filter((item) => item.family === 'boleto').length} boletos documentais.`)

  client = await connectDb(env, execute ? 'seed' : 'dry_run')
  await client.query('BEGIN READ ONLY')
  await schemaGate()
  await namespaceGate()
  await resolveDocumentTypes({ create: false })
  await client.query('ROLLBACK')
  writeFixtures()

  if (!execute) {
    console.log('\nDry-run concluido: ambiente, schema, namespace e fixtures validados; banco e Storage nao foram alterados.')
    console.log(`Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${mutationConfirmation('SEED', env.projectRef)}`)
  } else {
    admin = createAdminClient(env)
    const ensured = await ensureAuthUsers(admin)
    authCreated = ensured.createdIds
    actor = ensured.users.get('actor')
    const manager = await resolveManager()
    await seedTransactional(ensured.users, manager)

    const fixtureFiles = buildFixtureFiles(dataset)
    const manifest = {
      ...buildManifest(dataset, fixtureFiles), projectRef: env.projectRef,
      seededAt: new Date().toISOString(), actorId: actor.id,
      manager: manager ? { id: manager.id, email: manager.email } : null,
      authUserIds: authSpecs().map((spec) => ensured.users.get(spec.key).id), storageObjects: [],
    }
    writeRestrictedJson(localManifestPath(), manifest)
    console.log('\nSeed transacional concluido; Storage permaneceu vazio por desenho.')
    console.log(`Manifesto operacional restrito: ${localManifestPath()}`)
    console.log(manager ? `Gestor opcional vinculado somente ao fundo principal: ${manager.email}` : 'Nenhum gestor acessivel foi vinculado; use RLX_GOLDEN_GESTOR_EMAIL se necessario.')
  }
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => undefined)
  if (admin && authCreated.length) await removeCreatedAuthUsers(admin, authCreated)
  console.error(`\nFalha no P2.1 RLX: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (client) await client.end().catch(() => undefined)
}

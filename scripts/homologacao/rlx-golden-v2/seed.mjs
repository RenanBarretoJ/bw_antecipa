import { randomBytes } from 'node:crypto'
import {
  BOLETO_DOCUMENT_CODE,
  addDays,
  cnpjDigits,
  deterministicUuid,
  insertRows,
  sha256,
} from '../rlx-golden/helpers.mjs'
import { buildManifest, writeFixtures } from './fixtures.mjs'
import { BASE_DATE, BUSINESS_DATES, DATASET_VERSION, PROVIDER, authSpecsV2, buildGoldenV2 } from './scenario-definitions.mjs'
import { connectDb, createAdminClient, initializeMutation, writeRuntimeManifest } from './runtime.mjs'

const { args, env, execute, confirmation } = initializeMutation('SEED_V2')
const dataset = buildGoldenV2()
let db

async function ensureUsers(admin) {
  const all = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Nao foi possivel listar usuarios QA: ${error.message}`)
    all.push(...data.users)
    if (data.users.length < 1000) break
  }
  const byEmail = new Map(all.map((user) => [String(user.email).toLowerCase(), user]))
  const result = new Map()
  const createdIds = []
  for (const spec of authSpecsV2()) {
    let user = byEmail.get(spec.email)
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: spec.email,
        password: randomBytes(24).toString('base64url'),
        email_confirm: true,
        user_metadata: { qa_dataset: DATASET_VERSION, nome_completo: spec.name },
      })
      if (error || !data.user) throw new Error(`Nao foi possivel criar usuario ${spec.key}: ${error?.message || 'retorno vazio'}`)
      user = data.user
      createdIds.push(user.id)
    }
    result.set(spec.key, { ...user, spec })
  }
  return { users: result, createdIds }
}

async function resolveManager(admin) {
  const email = String(args['gestor-email'] || process.env.RLX_GOLDEN_V2_GESTOR_EMAIL || '').trim().toLowerCase()
  if (!email) return null
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`Nao foi possivel localizar gestor QA: ${error.message}`)
  const user = data.users.find((item) => String(item.email).toLowerCase() === email)
  if (!user) throw new Error('RLX_GOLDEN_V2_GESTOR_EMAIL nao corresponde a usuario Auth de homologacao.')
  const profile = await db.query(`SELECT role::text,status::text FROM public.profiles WHERE id=$1`, [user.id])
  if (profile.rows[0]?.role !== 'gestor' || profile.rows[0]?.status !== 'ativo') throw new Error('Gestor QA precisa estar ativo.')
  return { id: user.id, email }
}

async function schemaGate() {
  const required = [
    'fundos', 'profiles', 'usuario_fundos', 'cedentes', 'cedente_fundos', 'sacados', 'notas_fiscais',
    'politicas_operacionais', 'politica_operacional_versoes', 'politica_requisitos_documentais',
    'cedente_fundo_politicas', 'documento_tipos', 'documentos_repositorio', 'documento_versoes',
    'documento_analises', 'documento_vinculos', 'documento_requisito_instancias',
    'operacoes', 'operacoes_nfs', 'operacao_calculo_nfs', 'nota_fiscal_entregas',
    'ctes', 'cte_notas_fiscais', 'canhotos',
    'titulo_nf_vinculos', 'titulo_nf_vinculo_chaves',
  ]
  const result = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)`, [required])
  const found = new Set(result.rows.map((row) => row.table_name))
  const missing = required.filter((table) => !found.has(table))
  if (missing.length) throw new Error(`Schema P2.3 incompleto: ${missing.join(', ')}`)
  const functions = await db.query(`SELECT to_regprocedure('private.calcular_memoria_financeira_nf(uuid,numeric,numeric,date,date,text)') IS NOT NULL AS calculadora`)
  if (!functions.rows[0].calculadora) throw new Error('Motor financeiro canonico ainda nao esta aplicado em homologacao.')
}

async function namespaceGate() {
  const result = await db.query(`
    WITH expected_funds AS (
      SELECT * FROM unnest($1::uuid[], $2::text[]) AS value(id, nome)
    )
    SELECT f.id::text, f.nome
    FROM public.fundos f
    JOIN expected_funds e ON e.id=f.id
    WHERE f.nome<>e.nome
    UNION ALL
    SELECT nf.id::text, nf.numero_nf
    FROM public.notas_fiscais nf
    JOIN (SELECT * FROM unnest($3::uuid[], $4::uuid[]) AS value(id, fundo_id)) e ON e.id=nf.id
    WHERE nf.fundo_id<>e.fundo_id
  `, [dataset.funds.map((item) => item.id), dataset.funds.map((item) => item.name), dataset.notes.map((item) => item.id), dataset.notes.map((item) => item.fund.id)])
  if (result.rows.length) throw new Error(`Namespace ${DATASET_VERSION} colide com dados externos.`)
}

function crosswalkSeeds() {
  const seeds = []
  for (const item of dataset.matching.filter((entry) => entry.seedCrosswalk)) {
    seeds.push({ scenario: item.scenarioId, item, type: item.seedCrosswalk.type, target: item.seedCrosswalk.note, value: item.seuNumero })
  }
  for (const item of dataset.reconciliation.filter((entry) => entry.liquidations.length)) {
    seeds.push({ scenario: item.scenarioId, item, type: 'ID_RECEBIVEL', target: item.note, value: item.identity })
  }
  return seeds
}

async function resolveDocumentTypes() {
  const id = deterministicUuid('document-type-boleto-duplicata-digital')
  await db.query(`
    INSERT INTO public.documento_tipos (
      id,codigo,nome,dominio,mime_types_aceitos,extensoes_aceitas,
      tamanho_max_bytes,permite_multiplas_versoes,ativo
    ) VALUES ($1,$2,'Boleto / Duplicata Digital','nf',ARRAY['application/pdf'],ARRAY['pdf'],20971520,true,true)
    ON CONFLICT (codigo) DO NOTHING
  `, [id, BOLETO_DOCUMENT_CODE])
  const codes = [BOLETO_DOCUMENT_CODE, 'cte_xml', 'comprovante_entrega']
  const result = await db.query(`SELECT id,codigo FROM public.documento_tipos WHERE codigo=ANY($1) AND ativo=true`, [codes])
  const types = new Map(result.rows.map((row) => [row.codigo, row.id]))
  const missing = codes.filter((code) => !types.has(code))
  if (missing.length) throw new Error(`Catalogo documental incompleto: ${missing.join(', ')}`)
  return types
}

function policySnapshot(fund) {
  return {
    schema: 'politica_operacional_snapshot_v1',
    qa_dataset: DATASET_VERSION,
    tipo_ativo_financeiro: 'NOTA_FISCAL',
    aceite_sacado_obrigatorio: false,
    cessao_no_desembolso: false,
    cria_acompanhamento_entrega: true,
    exigir_status_logistico_pre_cessao: false,
    calculo_financeiro: { metodo: 'DIAS_UTEIS_252', versao_motor: 1 },
    requisitos: [
      { id: fund.requirementIds.boleto, codigo: 'RLX_V2_BOLETO', tipo_documento_codigo: 'boleto', escopo: 'nf_pre_cessao', obrigatorio: true },
      { id: fund.requirementIds.cte, codigo: 'RLX_V2_CTE', tipo_documento_codigo: 'cte', escopo: 'pos_cessao', obrigatorio: true },
      { id: fund.requirementIds.proof, codigo: 'RLX_V2_COMPROVANTE', tipo_documento_codigo: 'comprovante_entrega', escopo: 'pos_cessao', obrigatorio: true },
    ],
  }
}

function policyRequirementRows(typeIds) {
  const specs = [
    { key: 'boleto', code: 'RLX_V2_BOLETO', type: 'boleto', scope: 'nf_pre_cessao', typeId: typeIds.get(BOLETO_DOCUMENT_CODE), formats: ['application/pdf'], order: 1, due: null },
    { key: 'cte', code: 'RLX_V2_CTE', type: 'cte', scope: 'pos_cessao', typeId: typeIds.get('cte_xml'), formats: ['application/xml', 'application/pdf'], order: 2, due: 10 },
    { key: 'proof', code: 'RLX_V2_COMPROVANTE', type: 'comprovante_entrega', scope: 'pos_cessao', typeId: typeIds.get('comprovante_entrega'), formats: ['application/pdf'], order: 3, due: 20 },
  ]
  return dataset.funds.flatMap((fund) => specs.map((spec) => ({
    id: fund.requirementIds[spec.key], politica_operacional_versao_id: fund.policyVersionId,
    politica_operacional_id: fund.policyId, cedente_fundo_id: null, codigo: spec.code,
    escopo: spec.scope, tipo_documento_codigo: spec.type, obrigatorio: true, quantidade_minima: 1,
    formatos_aceitos: spec.formats, nivel_validacao: spec.key === 'cte' ? 'hibrido' : 'manual',
    prazo_dias_corridos: spec.due, responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor',
    ordem: spec.order, ativo: true, documento_tipo_id: spec.typeId, fundo_id: fund.id,
    momento_obrigatorio: spec.scope, categoria: spec.scope, bloqueia_fluxo: true,
    observacoes: `Requisito sintetico ${DATASET_VERSION}`,
  })))
}

async function seedDatabase(users, manager) {
  await db.query('BEGIN')
  await db.query(`SELECT set_config('app.qa_dataset',$1,true)`, [DATASET_VERSION])
  const typeIds = await resolveDocumentTypes()
  await insertRows(db, 'profiles', ['id', 'role', 'nome_completo', 'email', 'status'], authSpecsV2().map((spec) => ({
    id: users.get(spec.key).id, role: spec.role, nome_completo: spec.name, email: spec.email, status: 'ativo',
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET nome_completo=EXCLUDED.nome_completo,email=EXCLUDED.email,status=EXCLUDED.status' })
  const actor = users.get('actor')
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,true)`, [actor.id])
  await db.query(`SELECT set_config('request.jwt.claim.role','authenticated',true)`)

  await insertRows(db, 'fundos', ['id', 'nome', 'cnpj', 'administradora_nome', 'administradora_cnpj', 'gestora_nome', 'gestora_cnpj', 'custodiante_nome', 'custodiante_cnpj', 'ativo'], dataset.funds.map((fund, index) => ({
    id: fund.id, nome: fund.name, cnpj: fund.cnpj,
    administradora_nome: 'QA RLX V2 ADMINISTRADORA', administradora_cnpj: cnpjDigits('848400000001'),
    gestora_nome: 'QA RLX V2 GESTORA', gestora_cnpj: cnpjDigits('848400000002'),
    custodiante_nome: 'QA RLX V2 CUSTODIANTE', custodiante_cnpj: cnpjDigits(`84840000000${index + 3}`), ativo: true,
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,ativo=EXCLUDED.ativo' })
  if (manager) {
    await insertRows(db, 'usuario_fundos', ['id', 'usuario_id', 'fundo_id', 'perfil_no_fundo', 'status', 'principal'], [{
      id: deterministicUuid(`${DATASET_VERSION}:manager:${manager.id}`), usuario_id: manager.id,
      fundo_id: dataset.mainFund.id, perfil_no_fundo: 'gestor', status: 'ativo', principal: false,
    }], { conflict: 'ON CONFLICT DO NOTHING' })
  }
  await insertRows(db, 'cedentes', ['id', 'user_id', 'cnpj', 'razao_social', 'nome_fantasia', 'email_comercial', 'status'], dataset.cedents.map((item) => ({
    id: item.id, user_id: users.get(item.userKey).id, cnpj: item.cnpj, razao_social: item.name,
    nome_fantasia: item.name, email_comercial: users.get(item.userKey).email, status: 'ativo',
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET razao_social=EXCLUDED.razao_social,nome_fantasia=EXCLUDED.nome_fantasia,status=EXCLUDED.status' })
  await insertRows(db, 'cedente_fundos', ['id', 'cedente_id', 'fundo_id', 'codigo_externo', 'status', 'observacoes'], dataset.cedents.map((item) => ({
    id: item.linkId, cedente_id: item.id, fundo_id: item.fund.id, codigo_externo: `RLX-V2-${item.id.slice(0, 8)}`, status: 'ativo', observacoes: DATASET_VERSION,
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,observacoes=EXCLUDED.observacoes' })
  await insertRows(db, 'sacados', ['id', 'user_id', 'cnpj', 'razao_social', 'email'], dataset.debtors.map((item) => ({
    id: item.id, user_id: users.get(item.userKey).id, cnpj: item.cnpj, razao_social: item.name, email: users.get(item.userKey).email,
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET razao_social=EXCLUDED.razao_social,email=EXCLUDED.email' })

  await insertRows(db, 'politicas_operacionais', ['id', 'codigo', 'nome', 'descricao', 'status', 'created_by', 'fundo_id', 'padrao'], dataset.funds.map((fund) => ({
    id: fund.policyId, codigo: fund.policyCode, nome: `Politica operacional ${fund.name}`,
    descricao: `Politica sintetica ${DATASET_VERSION}; NF como ativo e boleto como lastro.`,
    status: 'rascunho', created_by: actor.id, fundo_id: fund.id, padrao: true,
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,descricao=EXCLUDED.descricao' })
  await insertRows(db, 'politica_operacional_versoes', [
    'id', 'politica_operacional_id', 'cedente_fundo_id', 'fundo_id', 'versao', 'vigente_desde',
    'aceite_sacado_obrigatorio', 'cessao_no_desembolso', 'cria_acompanhamento_entrega',
    'configuracao', 'conteudo_hash', 'status', 'regras', 'parametros',
    'permite_postergacao_upload_canhoto', 'limite_postergacao_upload_canhoto_dias',
    'metodo_calculo_financeiro', 'exigir_status_logistico_pre_cessao', 'tipo_ativo_financeiro',
    'controle_exposicao_logistica_ativo', 'limite_exposicao_em_transito_pct',
  ], dataset.funds.map((fund) => ({
    id: fund.policyVersionId, politica_operacional_id: fund.policyId, cedente_fundo_id: null, fundo_id: fund.id,
    versao: 1, vigente_desde: `${BUSINESS_DATES['D-4']}T09:00:00-03:00`,
    aceite_sacado_obrigatorio: false, cessao_no_desembolso: false, cria_acompanhamento_entrega: true,
    configuracao: { qa_dataset: DATASET_VERSION, lastro: 'BOLETO_DUPLICATA_DIGITAL' },
    conteudo_hash: sha256(`${DATASET_VERSION}:policy:${fund.key}:1`), status: 'rascunho', regras: {}, parametros: {},
    permite_postergacao_upload_canhoto: true, limite_postergacao_upload_canhoto_dias: 30,
    metodo_calculo_financeiro: 'DIAS_UTEIS_252', exigir_status_logistico_pre_cessao: false,
    tipo_ativo_financeiro: 'NOTA_FISCAL',
    controle_exposicao_logistica_ativo: true, limite_exposicao_em_transito_pct: 40,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })
  const requirements = policyRequirementRows(typeIds)
  const requirementExisting = await db.query(`SELECT id FROM public.politica_requisitos_documentais WHERE id=ANY($1)`, [requirements.map((item) => item.id)])
  const existingRequirementIds = new Set(requirementExisting.rows.map((row) => row.id))
  await insertRows(db, 'politica_requisitos_documentais', Object.keys(requirements[0]), requirements.filter((item) => !existingRequirementIds.has(item.id)))
  await db.query(`UPDATE public.politica_operacional_versoes SET status='publicada',publicada_por=$1,publicada_em=COALESCE(publicada_em,$2) WHERE id=ANY($3) AND status='rascunho'`, [actor.id, `${BUSINESS_DATES['D-4']}T10:00:00-03:00`, dataset.funds.map((fund) => fund.policyVersionId)])
  await db.query(`UPDATE public.politicas_operacionais SET status='ativa' WHERE id=ANY($1) AND status='rascunho'`, [dataset.funds.map((fund) => fund.policyId)])
  await insertRows(db, 'cedente_fundo_politicas', ['id', 'cedente_fundo_id', 'politica_operacional_id', 'status', 'vigente_desde', 'atribuido_por', 'motivo'], dataset.cedents.map((item) => ({
    id: item.assignmentId, cedente_fundo_id: item.linkId, politica_operacional_id: item.fund.policyId,
    status: 'ativa', vigente_desde: `${BUSINESS_DATES['D-4']}T11:00:00-03:00`, atribuido_por: actor.id, motivo: DATASET_VERSION,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })
  await insertRows(db, 'notas_fiscais', [
    'id', 'cedente_id', 'cedente_fundo_id', 'fundo_id', 'numero_nf', 'serie', 'chave_acesso', 'data_emissao', 'data_vencimento',
    'cnpj_emitente', 'razao_social_emitente', 'cnpj_destinatario', 'razao_social_destinatario', 'valor_bruto', 'valor_liquido',
    'descricao_itens', 'condicao_pagamento', 'status',
  ], dataset.notes.map((note) => ({
    id: note.id, cedente_id: note.cedent.id, cedente_fundo_id: note.cedent.linkId, fundo_id: note.fund.id,
    numero_nf: note.number, serie: 'V2', chave_acesso: note.key, data_emissao: note.issueDate, data_vencimento: note.dueDate,
    cnpj_emitente: note.cedent.cnpj, razao_social_emitente: note.cedent.name,
    cnpj_destinatario: note.debtor.cnpj, razao_social_destinatario: note.debtor.name,
    valor_bruto: note.value, valor_liquido: note.value, descricao_itens: DATASET_VERSION,
    condicao_pagamento: 'Fixture sintetica sem validade fiscal', status: note.operation ? 'em_antecipacao' : 'aprovada',
  })), { conflict: 'ON CONFLICT (id) DO UPDATE SET descricao_itens=EXCLUDED.descricao_itens,status=EXCLUDED.status' })

  await insertRows(db, 'documentos_repositorio', ['id', 'documento_tipo_id', 'status', 'criado_por', 'created_at', 'updated_at'], dataset.boletoDocuments.map((document) => ({
    id: document.id, documento_tipo_id: typeIds.get(BOLETO_DOCUMENT_CODE), status: document.status,
    criado_por: users.get(document.note.cedent.userKey).id, created_at: document.uploadedAt, updated_at: document.uploadedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING', batchSize: 50 })
  await insertRows(db, 'documento_versoes', [
    'id', 'documento_id', 'numero_versao', 'bucket', 'path', 'nome_original', 'mime_type',
    'tamanho_bytes', 'sha256', 'status', 'substitui_versao_id', 'enviado_por', 'enviado_em', 'created_at',
  ], dataset.boletoDocuments.map((document) => ({
    id: document.versionId, documento_id: document.id, numero_versao: 1, bucket: 'documentos-v2',
    path: `qa-rlx-golden-v2/${document.note.fund.key}/${document.note.id}/boleto/v1`,
    nome_original: `QA_RLX_V2_${document.note.number}_boleto.pdf`, mime_type: 'application/pdf',
    tamanho_bytes: 1024 + document.note.index, sha256: sha256(`${DATASET_VERSION}:document:${document.id}:1`),
    status: document.status, substitui_versao_id: null, enviado_por: users.get(document.note.cedent.userKey).id,
    enviado_em: document.uploadedAt, created_at: document.uploadedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING', batchSize: 50 })
  await insertRows(db, 'documento_analises', ['id', 'documento_versao_id', 'resultado', 'analisado_por', 'ator_tipo', 'observacoes', 'dados_estruturados', 'analisado_em', 'created_at'], dataset.boletoDocuments.map((document) => ({
    id: document.analysisId, documento_versao_id: document.versionId, resultado: 'aprovado', analisado_por: actor.id,
    ator_tipo: 'usuario', observacoes: `Aprovacao sintetica ${DATASET_VERSION}`,
    dados_estruturados: { qa_dataset: DATASET_VERSION, numero: `BOL-${document.note.number}`, valor: document.note.value, vencimento: document.note.dueDate },
    analisado_em: `${BASE_DATE}T08:00:00-03:00`, created_at: `${BASE_DATE}T08:00:00-03:00`,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING', batchSize: 50 })
  await insertRows(db, 'documento_vinculos', ['id', 'documento_id', 'nota_fiscal_id', 'operacao_id', 'nota_fiscal_entrega_id', 'cte_id', 'cedente_id', 'principal'], dataset.boletoDocuments.map((document) => ({
    id: document.linkId, documento_id: document.id, nota_fiscal_id: document.note.id, operacao_id: null,
    nota_fiscal_entrega_id: null, cte_id: null, cedente_id: document.note.cedent.id, principal: true,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING', batchSize: 50 })
  // O trigger de reconciliacao de documentos-base trata apenas XML/DANFE e exige
  // contexto de sessao interativo. O boleto sintetico ja nasce reconciliado pelo
  // proprio contrato do seed, por isso o trigger e suspenso somente neste insert.
  await db.query(`SET LOCAL session_replication_role='replica'`)
  await insertRows(db, 'documento_requisito_instancias', [
    'id', 'politica_requisito_id', 'politica_operacional_id', 'politica_operacional_versao_id', 'politica_versao',
    'documento_tipo_id', 'tipo_documento_codigo_snapshot', 'escopo_snapshot', 'nota_fiscal_id', 'operacao_id',
    'nota_fiscal_entrega_id', 'cedente_id', 'status', 'obrigatorio', 'prazo_limite', 'formatos_aceitos_snapshot',
    'nivel_validacao_snapshot', 'quantidade_minima_snapshot', 'responsavel_upload_snapshot',
    'responsavel_aprovacao_snapshot', 'documento_id', 'versao_aprovada_id', 'satisfeito_em', 'origem_snapshot',
  ], dataset.boletoDocuments.map((document) => ({
    id: document.requirementInstanceId, politica_requisito_id: document.note.fund.requirementIds.boleto,
    politica_operacional_id: document.note.fund.policyId, politica_operacional_versao_id: document.note.fund.policyVersionId,
    politica_versao: 1, documento_tipo_id: typeIds.get(BOLETO_DOCUMENT_CODE), tipo_documento_codigo_snapshot: 'boleto',
    escopo_snapshot: 'nf_pre_cessao', nota_fiscal_id: document.note.id, operacao_id: null,
    nota_fiscal_entrega_id: null, cedente_id: document.note.cedent.id, status: 'satisfeito', obrigatorio: true,
    prazo_limite: null, formatos_aceitos_snapshot: ['application/pdf'], nivel_validacao_snapshot: 'manual',
    quantidade_minima_snapshot: 1, responsavel_upload_snapshot: 'cedente', responsavel_aprovacao_snapshot: 'gestor',
    documento_id: document.id, versao_aprovada_id: document.versionId, satisfeito_em: document.uploadedAt,
    origem_snapshot: 'upload_requisito',
  })), { conflict: 'ON CONFLICT (id) DO NOTHING', batchSize: 50 })
  await db.query(`SET LOCAL session_replication_role='origin'`)

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
      aceite_sacado_exigido: false, aceite_sacado_status: 'dispensado', politica_atribuicao_id: operation.note.cedent.assignmentId,
      metodo_calculo_financeiro: 'DIAS_UTEIS_252', calculo_data_base: BASE_DATE, calculo_versao_motor: 1,
    }
  })
  await insertRows(db, 'operacoes', Object.keys(operationRows[0]), operationRows, { conflict: 'ON CONFLICT (id) DO NOTHING' })
  await insertRows(db, 'operacoes_nfs', ['operacao_id', 'nota_fiscal_id'], dataset.operations.map((operation) => ({ operacao_id: operation.id, nota_fiscal_id: operation.note.id })), { conflict: 'ON CONFLICT DO NOTHING' })
  await db.query(`SELECT set_config('app.calculo_aprovacao','true',true)`)
  for (const operation of dataset.operations) {
    const result = await db.query(`SELECT private.calcular_memoria_financeira_nf($1,$2,$3,$4,$5,'DIAS_UTEIS_252') memoria`, [operation.note.id, operation.note.value, operation.rate, BASE_DATE, operation.note.dueDate])
    const memory = result.rows[0].memoria
    await insertRows(db, 'operacao_calculo_nfs', [
      'id', 'operacao_id', 'nota_fiscal_id', 'fundo_id', 'cedente_id', 'metodo_calculo_financeiro',
      'valor_nominal', 'taxa_mensal', 'data_base', 'vencimento_contratual', 'vencimento_calculo',
      'base_calculo', 'calendario', 'dias_corridos_reais', 'dias_uteis', 'dias_financeiros',
      'dias_aplicados', 'expoente', 'fator', 'valor_presente', 'desconto', 'regra_arredondamento', 'versao_motor', 'created_at',
    ], [{
      id: deterministicUuid(`${DATASET_VERSION}:operation-calculation:${operation.id}`), operacao_id: operation.id,
      nota_fiscal_id: operation.note.id, fundo_id: operation.note.fund.id, cedente_id: operation.note.cedent.id,
      metodo_calculo_financeiro: 'DIAS_UTEIS_252', valor_nominal: memory.valor_nominal, taxa_mensal: operation.rate,
      data_base: BASE_DATE, vencimento_contratual: memory.vencimento_contratual, vencimento_calculo: memory.vencimento_calculo,
      base_calculo: memory.base, calendario: memory.calendario, dias_corridos_reais: memory.dias_corridos_reais,
      dias_uteis: memory.dias_uteis, dias_financeiros: memory.dias_financeiros, dias_aplicados: memory.dias,
      expoente: memory.expoente, fator: memory.fator, valor_presente: memory.valor_presente, desconto: memory.desconto,
      regra_arredondamento: memory.arredondamento, versao_motor: memory.versao_motor, created_at: operation.approvedAt,
    }], { conflict: 'ON CONFLICT (id) DO NOTHING' })
    await db.query(`UPDATE public.operacoes SET status='aprovada',aprovado_por=$2,aprovado_em=$3,valor_liquido_desembolso=$4,preco_aquisicao=$4,prazo_dias=$5,calculo_memoria=$6,updated_at=$3 WHERE id=$1`, [operation.id, actor.id, operation.approvedAt, memory.valor_presente, memory.dias, { qa_dataset: DATASET_VERSION, ...memory }])
    await db.query(`UPDATE public.notas_fiscais SET taxa_desagio=$2,valor_antecipado=$3,status='em_antecipacao' WHERE id=$1`, [operation.note.id, operation.rate, memory.valor_presente])
  }
  await insertRows(db, 'nota_fiscal_entregas', ['id', 'operacao_id', 'nota_fiscal_id', 'status_entrega', 'cessao_efetivada_em', 'data_limite_cte', 'data_limite_canhoto', 'data_entrega', 'entrega_confirmada_em', 'motivo_pendencia', 'created_at', 'updated_at'], dataset.operations.map((operation) => ({
    id: deterministicUuid(`${DATASET_VERSION}:delivery:${operation.note.id}`), operacao_id: operation.id,
    nota_fiscal_id: operation.note.id,
    status_entrega: operation.logistics === 'ENTREGUE' ? 'entregue' : operation.logistics === 'EM_TRANSITO' ? 'em_transito' : 'aguardando_validacao',
    cessao_efetivada_em: operation.approvedAt, data_limite_cte: addDays(BASE_DATE, 10), data_limite_canhoto: addDays(BASE_DATE, 20),
    data_entrega: operation.logistics === 'ENTREGUE' ? BASE_DATE : null,
    entrega_confirmada_em: operation.logistics === 'ENTREGUE' ? `${BASE_DATE}T17:00:00-03:00` : null,
    motivo_pendencia: operation.logistics === 'INDETERMINADA' ? `Cenario logistico futuro ${DATASET_VERSION}` : null,
    created_at: operation.approvedAt, updated_at: operation.approvedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })

  // expected-logistics valida a ponte canonica de evidencias. O status da entrega
  // nao e usado como atalho: cada caso possui a mesma evidencia que existiria no fluxo real.
  const logisticsFixtures = dataset.operations
    .filter((operation) => operation.logistics !== 'INDETERMINADA')
    .map((operation) => {
      const family = operation.logistics === 'ENTREGUE' ? 'comprovante_entrega' : 'cte'
      const documentCode = family === 'cte' ? 'cte_xml' : 'comprovante_entrega'
      return {
        operation,
        family,
        documentCode,
        documentId: deterministicUuid(`${DATASET_VERSION}:logistics-document:${family}:${operation.note.id}`),
        versionId: deterministicUuid(`${DATASET_VERSION}:logistics-version:${family}:${operation.note.id}:1`),
        analysisId: deterministicUuid(`${DATASET_VERSION}:logistics-analysis:${family}:${operation.note.id}:1`),
        entityId: deterministicUuid(`${DATASET_VERSION}:${family}:${operation.note.id}`),
      }
    })
  await insertRows(db, 'documentos_repositorio', ['id', 'documento_tipo_id', 'status', 'criado_por', 'created_at', 'updated_at'], logisticsFixtures.map((item) => ({
    id: item.documentId, documento_tipo_id: typeIds.get(item.documentCode), status: 'aprovado',
    criado_por: users.get(item.operation.note.cedent.userKey).id, created_at: item.operation.approvedAt, updated_at: item.operation.approvedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })
  await insertRows(db, 'documento_versoes', [
    'id', 'documento_id', 'numero_versao', 'bucket', 'path', 'nome_original', 'mime_type',
    'tamanho_bytes', 'sha256', 'status', 'substitui_versao_id', 'enviado_por', 'enviado_em', 'created_at',
  ], logisticsFixtures.map((item) => ({
    id: item.versionId, documento_id: item.documentId, numero_versao: 1, bucket: 'documentos-v2',
    path: `qa/${DATASET_VERSION}/${item.family}/${item.operation.note.id}.pdf`,
    nome_original: `${item.family}-${item.operation.note.number}.pdf`, mime_type: 'application/pdf',
    tamanho_bytes: 2048, sha256: sha256(`${DATASET_VERSION}:${item.family}:${item.operation.note.id}:1`),
    status: 'aprovado', substitui_versao_id: null, enviado_por: users.get(item.operation.note.cedent.userKey).id,
    enviado_em: item.operation.approvedAt, created_at: item.operation.approvedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })
  await insertRows(db, 'documento_analises', ['id', 'documento_versao_id', 'resultado', 'analisado_por', 'ator_tipo', 'observacoes', 'dados_estruturados', 'analisado_em', 'created_at'], logisticsFixtures.map((item) => ({
    id: item.analysisId, documento_versao_id: item.versionId, resultado: 'aprovado', analisado_por: actor.id,
    ator_tipo: 'usuario', observacoes: `Evidencia logistica sintetica ${DATASET_VERSION}`,
    dados_estruturados: { qa_dataset: DATASET_VERSION, familia: item.family, nota_fiscal_id: item.operation.note.id },
    analisado_em: item.operation.approvedAt, created_at: item.operation.approvedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })
  const cteFixtures = logisticsFixtures.filter((item) => item.family === 'cte')
  await insertRows(db, 'ctes', [
    'id', 'cedente_id', 'fundo_id', 'cedente_fundo_id', 'chave_cte', 'numero', 'serie', 'data_emissao',
    'formato_origem', 'nivel_validacao', 'status', 'analisado_por', 'analisado_em', 'documento_id',
    'documento_versao_atual_id', 'documento_versao_aprovada_id', 'dados_extraidos', 'created_at', 'updated_at',
  ], cteFixtures.map((item) => ({
    id: item.entityId, cedente_id: item.operation.note.cedent.id, fundo_id: item.operation.note.fund.id,
    cedente_fundo_id: item.operation.note.cedent.linkId, chave_cte: item.operation.note.key,
    numero: item.operation.note.number, serie: '1', data_emissao: BASE_DATE,
    formato_origem: 'xml', nivel_validacao: 'estrutural', status: 'aprovado', analisado_por: actor.id,
    analisado_em: item.operation.approvedAt, documento_id: item.documentId,
    documento_versao_atual_id: item.versionId, documento_versao_aprovada_id: item.versionId,
    dados_extraidos: { qa_dataset: DATASET_VERSION }, created_at: item.operation.approvedAt, updated_at: item.operation.approvedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })
  await insertRows(db, 'cte_notas_fiscais', ['cte_id', 'nota_fiscal_id', 'chave_nfe_referenciada', 'status_validacao', 'resultado_validacao', 'divergencias', 'validado_em', 'created_at'], cteFixtures.map((item) => ({
    cte_id: item.entityId, nota_fiscal_id: item.operation.note.id,
    chave_nfe_referenciada: item.operation.note.key, status_validacao: 'aprovado',
    resultado_validacao: { qa_dataset: DATASET_VERSION }, divergencias: [],
    validado_em: item.operation.approvedAt, created_at: item.operation.approvedAt,
  })), { conflict: 'ON CONFLICT DO NOTHING' })
  const proofFixtures = logisticsFixtures.filter((item) => item.family === 'comprovante_entrega')
  await insertRows(db, 'canhotos', [
    'id', 'nota_fiscal_entrega_id', 'status', 'data_assinatura', 'nome_recebedor', 'possui_assinatura',
    'possui_ressalva', 'recebido_em', 'analisado_por', 'analisado_em', 'documento_id',
    'documento_versao_atual_id', 'documento_versao_aprovada_id', 'created_at', 'updated_at',
  ], proofFixtures.map((item) => ({
    id: item.entityId, nota_fiscal_entrega_id: deterministicUuid(`${DATASET_VERSION}:delivery:${item.operation.note.id}`),
    status: 'aprovado', data_assinatura: BASE_DATE, nome_recebedor: 'QA RLX V2 RECEBEDOR',
    possui_assinatura: true, possui_ressalva: false, recebido_em: item.operation.approvedAt,
    analisado_por: actor.id, analisado_em: item.operation.approvedAt, documento_id: item.documentId,
    documento_versao_atual_id: item.versionId, documento_versao_aprovada_id: item.versionId,
    created_at: item.operation.approvedAt, updated_at: item.operation.approvedAt,
  })), { conflict: 'ON CONFLICT (id) DO NOTHING' })

  // O seed e idempotente inclusive quando as entregas ja existiam antes da
  // materializacao das evidencias canonicas adicionada pelo P2.4. Reafirma o
  // estado descritivo declarado pelo Golden somente depois de criar CT-es e
  // comprovantes, pois triggers logisticos podem ter reavaliado a entrega.
  for (const operation of dataset.operations) {
    const deliveryStatus = operation.logistics === 'ENTREGUE'
      ? 'entregue'
      : operation.logistics === 'EM_TRANSITO'
        ? 'em_transito'
        : 'aguardando_validacao'
    await db.query(`UPDATE public.nota_fiscal_entregas
      SET status_entrega=$2, updated_at=$3
      WHERE id=$1`, [
      deterministicUuid(`${DATASET_VERSION}:delivery:${operation.note.id}`),
      deliveryStatus,
      operation.approvedAt,
    ])
  }

  const seeds = crosswalkSeeds()
  await insertRows(db, 'titulo_nf_vinculos', [
    'id', 'fundo_id', 'provedor', 'identidade_externa', 'nota_fiscal_id', 'status', 'origem', 'metodo', 'regra_versao', 'evidencias', 'candidate_count',
  ], seeds.map((seed) => ({
    id: deterministicUuid(`${DATASET_VERSION}:crosswalk:${seed.scenario}`), fundo_id: dataset.mainFund.id,
    provedor: PROVIDER, identidade_externa: `SEED:${seed.scenario}`, nota_fiscal_id: seed.target.id,
    status: 'ATIVO', origem: 'AUTOMATICO', metodo: seed.type, regra_versao: 'RLX_MATCH_V1',
    evidencias: { qa_dataset: DATASET_VERSION, scenario_id: seed.scenario }, candidate_count: 1,
  })), { conflict: 'ON CONFLICT DO NOTHING' })
  await insertRows(db, 'titulo_nf_vinculo_chaves', ['id', 'vinculo_id', 'fundo_id', 'provedor', 'tipo_chave', 'valor_normalizado', 'fonte'], seeds.map((seed) => ({
    id: deterministicUuid(`${DATASET_VERSION}:crosswalk-key:${seed.scenario}`),
    vinculo_id: deterministicUuid(`${DATASET_VERSION}:crosswalk:${seed.scenario}`), fundo_id: dataset.mainFund.id,
    provedor: PROVIDER, tipo_chave: seed.type, valor_normalizado: String(seed.value).toUpperCase(), fonte: 'SEED_GOLDEN_V2',
  })), { conflict: 'ON CONFLICT DO NOTHING' })
  await db.query('COMMIT')
}

try {
  writeFixtures()
  db = await connectDb(env, execute ? 'rlx_v2_seed' : 'rlx_v2_seed_preview')
  await db.query('BEGIN READ ONLY')
  await schemaGate()
  await namespaceGate()
  await db.query('ROLLBACK')
  console.log(`Golden V2: ${dataset.notes.length} NFs em fundos exclusivos; projeto ${env.projectRef}.`)
  if (!execute) {
    console.log(`Dry-run concluido. Para aplicar: --execute --expected-project-ref ${env.projectRef} --confirm ${confirmation}`)
  } else {
    const admin = createAdminClient(env)
    const ensured = await ensureUsers(admin)
    try {
      const manager = await resolveManager(admin)
      await seedDatabase(ensured.users, manager)
      writeRuntimeManifest({ ...buildManifest(dataset), project_ref: env.projectRef, auth_user_ids: [...ensured.users.values()].map((item) => item.id), created_auth_user_ids: ensured.createdIds, manager })
      console.log(`Seed ${DATASET_VERSION} aplicado sem tocar no namespace V1.`)
    } catch (error) {
      for (const id of ensured.createdIds) await admin.auth.admin.deleteUser(id).catch(() => undefined)
      throw error
    }
  }
} catch (error) {
  if (db) await db.query('ROLLBACK').catch(() => undefined)
  console.error(`Seed Golden V2 falhou: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (db) await db.end().catch(() => undefined)
}

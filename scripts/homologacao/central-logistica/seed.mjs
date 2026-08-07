import {
  SEED_CONFIRMATION,
  SEED_VERSION,
  addDays,
  assertHomologEnvironment,
  assertMutation,
  authSpecs,
  brl,
  buildDataset,
  connectDb,
  createAdminClient,
  deterministicUuid,
  ensureAuthUsers,
  environmentSummary,
  insertRows,
  loadHomologEnv,
  localManifestPath,
  parseArgs,
  removeCreatedAuthUsers,
  sha256,
  timestamp,
  writeRestrictedJson,
} from './helpers.mjs'

const args = parseArgs()
loadHomologEnv()
const env = assertHomologEnvironment(args)
const apply = assertMutation(args, SEED_CONFIRMATION)
const dataset = buildDataset()

function phaseForApprovedEvidence(note, family, operation) {
  if (!operation) return 2
  if (family === 'cte') {
    if (note.creation === 'EM_TRANSITO') return 0
    if (note.approval === 'EM_TRANSITO' && operation.status !== 'solicitada') return 1
    return 2
  }
  if (note.creation === 'ENTREGUE') return 0
  if (note.approval === 'ENTREGUE' && operation.status !== 'solicitada') return 1
  return 2
}

function versionPhase(document, note, version) {
  const operation = note.operationId ? dataset.operations.find((item) => item.id === note.operationId) : null
  const approvedVersion = document.versions.find((item) => item.status === 'aprovado')
  const base = approvedVersion
    ? phaseForApprovedEvidence(note, document.family, operation)
    : (operation && note.number % 2 === 0 ? 0 : 2)
  if (document.pattern === 'approved_pending' && version.number === 2) return 2
  return base
}

async function schemaGate(client) {
  const requiredTables = [
    'fundos', 'usuario_fundos', 'cedentes', 'cedente_fundos', 'sacados',
    'politicas_operacionais', 'politica_operacional_versoes', 'politica_requisitos_documentais',
    'notas_fiscais', 'operacoes', 'operacoes_nfs', 'nota_fiscal_entregas',
    'documentos_repositorio', 'documento_versoes', 'documento_analises',
    'documento_requisito_instancias', 'evidencias_logisticas_antecipadas',
    'evidencia_logistica_versoes', 'operacao_nf_logistica_memorias',
    'ctes', 'cte_notas_fiscais', 'canhotos', 'nota_fiscal_entrega_postergacoes_canhoto',
  ]
  const { rows } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY($1)
  `, [requiredTables])
  const found = new Set(rows.map((row) => row.table_name))
  const missing = requiredTables.filter((table) => !found.has(table))
  if (missing.length) throw new Error(`Schema de homologacao incompleto: ${missing.join(', ')}`)
  const functions = await client.query(`
    SELECT
      to_regprocedure('private.classificar_status_logistico_pre_cessao(uuid,uuid)') IS NOT NULL AS classificador,
      to_regprocedure('private.reconciliar_evidencia_logistica_nf(uuid,text,text)') IS NOT NULL AS reconciliador
  `)
  if (!functions.rows[0].classificador || !functions.rows[0].reconciliador) {
    throw new Error('Funcoes canonicas de classificacao/reconciliacao logistica nao estao aplicadas em homologacao.')
  }
}

async function resolveDocumentTypes(client) {
  const { rows } = await client.query(`
    SELECT id, codigo FROM public.documento_tipos
    WHERE ativo = true AND codigo = ANY($1)
  `, [['cte_xml', 'comprovante_entrega']])
  const byCode = new Map(rows.map((row) => [row.codigo, row.id]))
  if (!byCode.has('cte_xml') || !byCode.has('comprovante_entrega')) {
    throw new Error('Catalogo documental precisa conter cte_xml e comprovante_entrega ativos.')
  }
  return byCode
}

async function namespaceGate(client) {
  const conflicts = await client.query(`
    SELECT 'fundo' AS entidade, id::text AS id
    FROM public.fundos
    WHERE id=$1 AND (nome<>$2 OR cnpj<>$3)
    UNION ALL
    SELECT 'nota_fiscal', nf.id::text
    FROM public.notas_fiscais nf
    WHERE (nf.id=ANY($4) OR nf.chave_acesso=ANY($5))
      AND NOT (nf.id=ANY($4) AND nf.fundo_id=$1)
    UNION ALL
    SELECT 'cte', c.id::text
    FROM public.ctes c
    WHERE (c.id=ANY($6) OR c.chave_cte=ANY($7))
      AND NOT (c.id=ANY($6) AND c.fundo_id=$1)
  `, [
    dataset.fund.id, dataset.fund.name, dataset.fund.cnpj,
    dataset.notes.map((item) => item.id), dataset.notes.map((item) => item.key),
    dataset.documents.filter((item) => item.family === 'cte').map((item) => deterministicUuid(`cte-${item.key}`)),
    dataset.documents.filter((item) => item.family === 'cte').map((_, index) => String(60_000_000_000_000_000_000_000_000_000_000_000_000_000_000n + BigInt(index + 1))),
  ])
  if (conflicts.rows.length) {
    throw new Error(`Namespace sintetico colide com dados existentes: ${conflicts.rows.map((row) => `${row.entidade}:${row.id}`).join(', ')}`)
  }
}

async function validateManager(client, admin) {
  const email = String(args['gestor-email'] || process.env.LOGISTICA_SEED_GESTOR_EMAIL || '').trim().toLowerCase()
  if (!email) return null
  const users = []
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`Falha ao localizar gestor informado: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 1000) break
  }
  const user = users.find((item) => String(item.email).toLowerCase() === email)
  if (!user) throw new Error('LOGISTICA_SEED_GESTOR_EMAIL nao corresponde a um usuario Auth de homologacao.')
  const result = await client.query('SELECT role::text, status::text FROM public.profiles WHERE id = $1', [user.id])
  if (result.rows[0]?.role !== 'gestor' || result.rows[0]?.status !== 'ativo') {
    throw new Error('O usuario informado precisa possuir perfil gestor ativo.')
  }
  return { id: user.id, email }
}

async function insertEvidencePhase(client, phase) {
  for (const document of dataset.documents) {
    for (const note of document.notes) {
      const versions = document.versions.filter((version) => versionPhase(document, note, version) === phase)
      if (!versions.length) continue
      for (const version of versions) {
        const evidenceId = deterministicUuid(`evidence-${note.number}-${document.family}`)
        const requirementId = document.family === 'cte' ? note.cedent.policy.reqCteId : note.cedent.policy.reqProofId
        await client.query(`
          INSERT INTO public.evidencias_logisticas_antecipadas (
            id, nota_fiscal_id, fundo_id, cedente_id, cedente_fundo_id,
            politica_operacional_versao_id, politica_requisito_id, familia_documental,
            documento_id, documento_versao_atual_id, primeiro_upload_em, ultimo_upload_em,
            criado_por, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$11,$12)
          ON CONFLICT (nota_fiscal_id, politica_operacional_versao_id, familia_documental)
          DO UPDATE SET documento_id = EXCLUDED.documento_id,
            documento_versao_atual_id = EXCLUDED.documento_versao_atual_id,
            ultimo_upload_em = EXCLUDED.ultimo_upload_em,
            updated_at = EXCLUDED.updated_at
        `, [
          evidenceId, note.id, dataset.fund.id, note.cedent.id, note.cedent.linkId,
          note.cedent.policy.versionId, requirementId, document.family,
          document.id, version.id, document.versions[0].uploadedAt, version.uploadedAt,
          actor.id,
        ])
        await insertRows(client, 'evidencia_logistica_versoes',
          ['id', 'evidencia_logistica_id', 'documento_id', 'documento_versao_id', 'created_at'], [{
            id: deterministicUuid(`evidence-version-${note.number}-${document.family}-${version.number}`),
            evidencia_logistica_id: evidenceId, documento_id: document.id,
            documento_versao_id: version.id, created_at: version.uploadedAt,
          }])
      }
    }
  }
}

let actor
let authCreated = []
let admin
let client

try {
  console.log('\nBW Antecipa - massa da Central Logistica')
  console.log(environmentSummary(env))
  console.log(`Modo: ${apply ? 'APPLY' : 'DRY-RUN (padrao seguro)'}`)
  console.log(`Data operacional: ${dataset.today} (America/Sao_Paulo)`)
  console.log(`Fundo sintetico: ${dataset.fund.name}`)
  console.log(`Plano: ${dataset.notes.length} NFs, ${dataset.operations.length} operacoes, ${dataset.documents.filter((d) => d.family === 'cte').length} CT-es logicos, ${dataset.documents.filter((d) => d.family === 'comprovante_entrega').length} comprovantes.`)

  client = await connectDb(env, apply ? 'seed' : 'dry_run')
  await client.query('BEGIN READ ONLY')
  await schemaGate(client)
  await resolveDocumentTypes(client)
  await namespaceGate(client)
  await client.query('ROLLBACK')

  if (!apply) {
    console.log('\nDry-run concluido: schema e protecoes validados; nenhuma escrita executada.')
    console.log(`Para aplicar: --apply --confirm ${SEED_CONFIRMATION} --expected-project-ref ${env.projectRef}`)
    process.exitCode = 0
  } else {
    admin = createAdminClient(env)
    const ensured = await ensureAuthUsers(admin)
    authCreated = ensured.createdIds
    actor = ensured.users.get('actor')
    const typeIds = await resolveDocumentTypes(client)
    const manager = await validateManager(client, admin)

    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.qa_dataset', $1, true)`, [SEED_VERSION])

    await insertRows(client, 'profiles', ['id', 'role', 'nome_completo', 'email', 'status'], authSpecs().map((spec) => {
      const user = ensured.users.get(spec.key)
      return { id: user.id, role: spec.role, nome_completo: spec.name, email: spec.email, status: 'ativo' }
    }))
    await insertRows(client, 'fundos', ['id', 'nome', 'cnpj', 'administradora_nome', 'administradora_cnpj', 'gestora_nome', 'gestora_cnpj', 'custodiante_nome', 'custodiante_cnpj', 'ativo'], [{
      id: dataset.fund.id, nome: dataset.fund.name, cnpj: dataset.fund.cnpj,
      administradora_nome: 'QA ADMINISTRADORA SINTETICA', administradora_cnpj: '99.900.000/0002-84',
      gestora_nome: 'QA GESTORA SINTETICA', gestora_cnpj: '99.900.000/0003-65',
      custodiante_nome: 'QA CUSTODIANTE SINTETICO', custodiante_cnpj: '99.900.000/0004-46', ativo: true,
    }])
    if (manager) await insertRows(client, 'usuario_fundos', ['id', 'usuario_id', 'fundo_id', 'perfil_no_fundo', 'status', 'principal'], [{
      id: deterministicUuid(`manager-fund-${manager.id}`), usuario_id: manager.id, fundo_id: dataset.fund.id,
      perfil_no_fundo: 'gestor', status: 'ativo', principal: false,
    }])

    await insertRows(client, 'cedentes', ['id', 'user_id', 'cnpj', 'razao_social', 'nome_fantasia', 'email_comercial', 'status'], dataset.cedents.map((cedent, index) => ({
      id: cedent.id, user_id: ensured.users.get(`cedente-${index + 1}`).id, cnpj: cedent.cnpj,
      razao_social: cedent.name, nome_fantasia: cedent.name, email_comercial: ensured.users.get(`cedente-${index + 1}`).email, status: 'ativo',
    })))
    await insertRows(client, 'cedente_fundos', ['id', 'cedente_id', 'fundo_id', 'codigo_externo', 'status', 'observacoes'], dataset.cedents.map((cedent) => ({
      id: cedent.linkId, cedente_id: cedent.id, fundo_id: dataset.fund.id,
      codigo_externo: `QA-LOG-${cedent.name.at(-1)}`, status: 'ativo', observacoes: `Massa sintetica ${SEED_VERSION}`,
    })))
    await insertRows(client, 'sacados', ['id', 'user_id', 'cnpj', 'razao_social', 'email'], dataset.debtors.map((debtor, index) => ({
      id: debtor.id, user_id: ensured.users.get(`sacado-${index + 1}`).id, cnpj: debtor.cnpj,
      razao_social: debtor.name, email: ensured.users.get(`sacado-${index + 1}`).email,
    })))

    await insertRows(client, 'politicas_operacionais', ['id', 'codigo', 'nome', 'descricao', 'status', 'created_by', 'fundo_id', 'padrao'], dataset.policies.map((policy, index) => ({
      id: policy.id, codigo: policy.code, nome: policy.name, descricao: `Politica sintetica ${SEED_VERSION}`,
      status: 'rascunho', created_by: actor.id, fundo_id: dataset.fund.id, padrao: index === 0,
    })))
    await insertRows(client, 'politica_operacional_versoes', [
      'id', 'politica_operacional_id', 'cedente_fundo_id', 'fundo_id', 'versao', 'vigente_desde',
      'aceite_sacado_obrigatorio', 'cessao_no_desembolso', 'cria_acompanhamento_entrega',
      'configuracao', 'conteudo_hash', 'status', 'regras', 'parametros',
      'permite_postergacao_upload_canhoto', 'limite_postergacao_upload_canhoto_dias',
      'metodo_calculo_financeiro', 'exigir_status_logistico_pre_cessao',
    ], dataset.policies.map((policy) => ({
      id: policy.versionId, politica_operacional_id: policy.id, cedente_fundo_id: null,
      fundo_id: dataset.fund.id, versao: 1, vigente_desde: timestamp(addDays(dataset.today, -90), 0),
      aceite_sacado_obrigatorio: false, cessao_no_desembolso: false, cria_acompanhamento_entrega: true,
      configuracao: { qa_dataset: SEED_VERSION }, conteudo_hash: sha256(`policy-${policy.id}`), status: 'rascunho',
      regras: {}, parametros: {}, permite_postergacao_upload_canhoto: true,
      limite_postergacao_upload_canhoto_dias: 30, metodo_calculo_financeiro: 'DIAS_UTEIS_252',
      exigir_status_logistico_pre_cessao: policy.gate,
    })))
    const requirements = dataset.policies.flatMap((policy) => ([
      {
        id: policy.reqCteId, politica_operacional_versao_id: policy.versionId,
        politica_operacional_id: policy.id, cedente_fundo_id: null, codigo: 'QA_CTE_POS',
        escopo: 'pos_cessao', tipo_documento_codigo: 'cte', obrigatorio: true,
        quantidade_minima: 1, formatos_aceitos: ['application/xml', 'application/pdf'], nivel_validacao: 'manual',
        prazo_dias_corridos: 10, responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor', ordem: 1,
        ativo: true, documento_tipo_id: typeIds.get('cte_xml'), fundo_id: dataset.fund.id,
        momento_obrigatorio: 'pos_cessao', categoria: 'pos_cessao', bloqueia_fluxo: true,
        observacoes: `Requisito sintetico ${SEED_VERSION}`,
      },
      {
        id: policy.reqProofId, politica_operacional_versao_id: policy.versionId,
        politica_operacional_id: policy.id, cedente_fundo_id: null, codigo: 'QA_COMPROVANTE_POS',
        escopo: 'pos_cessao', tipo_documento_codigo: 'comprovante_entrega', obrigatorio: true,
        quantidade_minima: 1, formatos_aceitos: ['application/pdf'], nivel_validacao: 'manual',
        prazo_dias_corridos: 20, responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor', ordem: 2,
        ativo: true, documento_tipo_id: typeIds.get('comprovante_entrega'), fundo_id: dataset.fund.id,
        momento_obrigatorio: 'pos_cessao', categoria: 'pos_cessao', bloqueia_fluxo: true,
        observacoes: `Requisito sintetico ${SEED_VERSION}`,
      },
    ]))
    const existingRequirementIds = new Set((await client.query(
      'SELECT id FROM public.politica_requisitos_documentais WHERE id=ANY($1)',
      [requirements.map((item) => item.id)],
    )).rows.map((row) => row.id))
    const missingRequirements = requirements.filter((item) => !existingRequirementIds.has(item.id))
    await insertRows(client, 'politica_requisitos_documentais', Object.keys(requirements[0]), missingRequirements)
    await client.query(`
      UPDATE public.politica_operacional_versoes
      SET status = 'publicada', publicada_por = $1, publicada_em = COALESCE(publicada_em, $2)
      WHERE id = ANY($3) AND publicada_em IS NULL
    `, [actor.id, timestamp(addDays(dataset.today, -89), 10), dataset.policies.map((item) => item.versionId)])
    await client.query(`UPDATE public.politicas_operacionais SET status = 'ativa' WHERE id = ANY($1) AND status = 'rascunho'`, [dataset.policies.map((item) => item.id)])
    await insertRows(client, 'cedente_fundo_politicas', ['id', 'cedente_fundo_id', 'politica_operacional_id', 'status', 'vigente_desde', 'atribuido_por', 'motivo'], dataset.cedents.map((cedent) => ({
      id: cedent.assignmentId, cedente_fundo_id: cedent.linkId, politica_operacional_id: cedent.policy.id,
      status: 'ativa', vigente_desde: timestamp(addDays(dataset.today, -88), 0), atribuido_por: actor.id,
      motivo: `Vinculo sintetico ${SEED_VERSION}`,
    })))

    await insertRows(client, 'notas_fiscais', [
      'id', 'cedente_id', 'cedente_fundo_id', 'fundo_id', 'numero_nf', 'serie', 'chave_acesso',
      'data_emissao', 'data_vencimento', 'cnpj_emitente', 'razao_social_emitente',
      'cnpj_destinatario', 'razao_social_destinatario', 'valor_bruto', 'valor_liquido',
      'descricao_itens', 'condicao_pagamento', 'status', 'created_at', 'updated_at',
    ], dataset.notes.map((note) => ({
      id: note.id, cedente_id: note.cedent.id, cedente_fundo_id: note.cedent.linkId,
      fundo_id: dataset.fund.id, numero_nf: note.numberText, serie: 'QA', chave_acesso: note.key,
      data_emissao: note.issueDate, data_vencimento: note.dueDate,
      cnpj_emitente: note.cedent.cnpj, razao_social_emitente: note.cedent.name,
      cnpj_destinatario: note.debtor.cnpj, razao_social_destinatario: note.debtor.name,
      valor_bruto: note.value, valor_liquido: note.value, descricao_itens: `Mercadoria sintetica ${note.number}`,
      condicao_pagamento: 'QA - dados sem validade fiscal',
      status: note.cedent.policy.gate && note.target === 'INDETERMINADA' ? 'rascunho' : 'aprovada',
      created_at: timestamp(addDays(note.issueDate, 1), 10), updated_at: timestamp(addDays(dataset.today, -(note.number % 7)), 10),
    })))

    await insertRows(client, 'documentos_repositorio', ['id', 'documento_tipo_id', 'status', 'criado_por', 'created_at', 'updated_at'], dataset.documents.map((document) => ({
      id: document.id, documento_tipo_id: typeIds.get(document.family === 'cte' ? 'cte_xml' : 'comprovante_entrega'),
      status: document.currentVersion.status, criado_por: actor.id,
      created_at: document.versions[0].uploadedAt, updated_at: document.currentVersion.uploadedAt,
    })))
    const versionRows = dataset.documents.flatMap((document) => document.versions.map((version) => ({
      id: version.id, documento_id: document.id, numero_versao: version.number,
      bucket: 'documentos-v2', path: `qa-central-logistica/${document.family}/${document.key}/v${version.number}`,
      nome_original: `QA_${document.family}_${document.key}_v${version.number}.${document.family === 'cte' ? 'xml' : 'pdf'}`,
      mime_type: document.family === 'cte' ? 'application/xml' : 'application/pdf', tamanho_bytes: 256 + version.number,
      sha256: sha256(`${document.id}-${version.number}`), status: version.status,
      substitui_versao_id: version.number > 1 ? document.versions[version.number - 2].id : null,
      enviado_por: actor.id, enviado_em: version.uploadedAt, created_at: version.uploadedAt,
    })))
    await insertRows(client, 'documento_versoes', Object.keys(versionRows[0]), versionRows)
    const analyses = dataset.documents.flatMap((document) => document.versions.flatMap((version) => version.analysis ? [{
      id: deterministicUuid(`analysis-${document.family}-${document.key}-${version.number}`),
      documento_versao_id: version.id, resultado: version.analysis, analisado_por: actor.id,
      ator_tipo: 'usuario', observacoes: version.analysis === 'rejeitado' ? 'Rejeicao sintetica para homologacao.' : 'Aprovacao sintetica para homologacao.',
      dados_estruturados: { qa_dataset: SEED_VERSION }, analisado_em: timestamp(addDays(version.uploadedAt.slice(0, 10), 1), 15),
      created_at: timestamp(addDays(version.uploadedAt.slice(0, 10), 1), 15),
    }] : []))
    const existingAnalysisIds = new Set((await client.query(
      'SELECT id FROM public.documento_analises WHERE id=ANY($1)',
      [analyses.map((item) => item.id)],
    )).rows.map((row) => row.id))
    const missingAnalyses = analyses.filter((item) => !existingAnalysisIds.has(item.id))
    await insertRows(client, 'documento_analises', Object.keys(analyses[0]), missingAnalyses)

    const cteDocuments = dataset.documents.filter((document) => document.family === 'cte')
    await insertRows(client, 'ctes', [
      'id', 'cedente_id', 'fundo_id', 'cedente_fundo_id', 'chave_cte', 'numero', 'serie',
      'data_emissao', 'cnpj_transportadora', 'cnpj_remetente', 'cnpj_destinatario',
      'valor_frete', 'formato_origem', 'nivel_validacao', 'status', 'analisado_por', 'analisado_em',
      'motivo_rejeicao', 'documento_id', 'documento_versao_atual_id', 'documento_versao_aprovada_id',
      'dados_extraidos', 'resultado_validacao', 'created_at', 'updated_at',
    ], cteDocuments.map((document, index) => {
      const approved = document.versions.find((version) => version.status === 'aprovado')
      return {
        id: deterministicUuid(`cte-${document.key}`), cedente_id: document.notes[0].cedent.id,
        fundo_id: dataset.fund.id, cedente_fundo_id: document.notes[0].cedent.linkId,
        chave_cte: String(60_000_000_000_000_000_000_000_000_000_000_000_000_000_000n + BigInt(index + 1)),
        numero: `QA-CTE-${String(index + 1).padStart(4, '0')}`,
        serie: 'QA', data_emissao: document.uploadDate, cnpj_transportadora: '99700000000001',
        cnpj_remetente: document.notes[0].cedent.cnpj, cnpj_destinatario: document.notes[0].debtor.cnpj,
        valor_frete: 500 + index * 37, formato_origem: 'xml', nivel_validacao: 'hibrido',
        status: document.currentVersion.status === 'em_analise' ? 'em_analise' : document.currentVersion.status,
        analisado_por: document.currentVersion.analysis ? actor.id : null,
        analisado_em: document.currentVersion.analysis ? timestamp(addDays(document.currentVersion.uploadedAt.slice(0, 10), 1), 15) : null,
        motivo_rejeicao: document.currentVersion.status === 'rejeitado' ? 'Rejeicao sintetica para homologacao.' : null,
        documento_id: document.id, documento_versao_atual_id: document.currentVersion.id,
        documento_versao_aprovada_id: approved?.id || null,
        dados_extraidos: { qa_dataset: SEED_VERSION, synthetic: true },
        resultado_validacao: { status: 'aprovado', qa_dataset: SEED_VERSION },
        created_at: document.versions[0].uploadedAt, updated_at: document.currentVersion.uploadedAt,
      }
    }))
    await insertRows(client, 'cte_notas_fiscais', ['cte_id', 'nota_fiscal_id', 'chave_nfe_referenciada', 'status_validacao', 'resultado_validacao', 'divergencias', 'validado_em'], cteDocuments.flatMap((document) => document.notes.map((note) => ({
      cte_id: deterministicUuid(`cte-${document.key}`), nota_fiscal_id: note.id, chave_nfe_referenciada: note.key,
      status_validacao: document.currentVersion.status === 'rejeitado' ? 'rejeitado' : 'aprovado',
      resultado_validacao: { qa_dataset: SEED_VERSION, synthetic: true }, divergencias: [],
      validado_em: document.currentVersion.uploadedAt,
    }))))
    await insertRows(client, 'documento_vinculos', ['id', 'documento_id', 'nota_fiscal_id', 'operacao_id', 'nota_fiscal_entrega_id', 'cte_id', 'cedente_id', 'principal'], [
      ...cteDocuments.map((document) => ({
        id: deterministicUuid(`document-link-cte-${document.key}`), documento_id: document.id,
        nota_fiscal_id: null, operacao_id: null, nota_fiscal_entrega_id: null,
        cte_id: deterministicUuid(`cte-${document.key}`), cedente_id: document.notes[0].cedent.id, principal: true,
      })),
      ...dataset.documents.filter((document) => document.family === 'comprovante_entrega').map((document) => ({
        id: deterministicUuid(`document-link-proof-${document.key}`), documento_id: document.id,
        nota_fiscal_id: document.notes[0].id, operacao_id: null, nota_fiscal_entrega_id: null,
        cte_id: null, cedente_id: document.notes[0].cedent.id, principal: true,
      })),
    ])

    await insertEvidencePhase(client, 0)

    const operationRows = dataset.operations.map((operation) => {
      const snapshot = {
        schema: 'politica_operacional_snapshot_v1', qa_dataset: SEED_VERSION,
        aceite_sacado_obrigatorio: false, cessao_no_desembolso: false,
        cria_acompanhamento_entrega: true,
        exigir_status_logistico_pre_cessao: operation.policy.gate,
        calculo_financeiro: { metodo: 'DIAS_UTEIS_252', versao_motor: 1 },
        requisitos: [
          { id: operation.policy.reqCteId, codigo: 'QA_CTE_POS', tipo_documento_codigo: 'cte', escopo: 'pos_cessao', momento_obrigatorio: 'pos_cessao', obrigatorio: true, ativo: true, responsavel_upload: 'cedente' },
          { id: operation.policy.reqProofId, codigo: 'QA_COMPROVANTE_POS', tipo_documento_codigo: 'comprovante_entrega', escopo: 'pos_cessao', momento_obrigatorio: 'pos_cessao', obrigatorio: true, ativo: true, responsavel_upload: 'cedente' },
        ],
      }
      return {
        id: operation.id, cedente_id: operation.cedent.id, cedente_fundo_id: operation.cedent.linkId,
        valor_bruto_total: operation.gross, taxa_desconto: 3.99, prazo_dias: 45,
        valor_liquido_desembolso: null, data_vencimento: operation.dueDate, status: 'solicitada',
        valor_face_total: operation.gross, preco_aquisicao: null, created_at: operation.createdAt, updated_at: operation.createdAt,
        politica_operacional_id: operation.policy.id, politica_operacional_versao_id: operation.policy.versionId,
        politica_versao: 1, politica_snapshot: snapshot, politica_snapshot_hash: sha256(JSON.stringify(snapshot)),
        contexto_configuracao_status: 'completo', contexto_capturado_em: operation.createdAt,
        aceite_sacado_exigido: false, aceite_sacado_status: 'dispensado',
        politica_atribuicao_id: operation.cedent.assignmentId,
      }
    })
    const operationSnapshotHashById = new Map(operationRows.map((row) => [row.id, row.politica_snapshot_hash]))
    await insertRows(client, 'operacoes', Object.keys(operationRows[0]), operationRows)
    await insertRows(client, 'operacoes_nfs', ['operacao_id', 'nota_fiscal_id'], dataset.notes.filter((note) => note.operationId).map((note) => ({
      operacao_id: note.operationId, nota_fiscal_id: note.id,
    })))

    await insertEvidencePhase(client, 1)
    await client.query(`SELECT set_config('app.calculo_aprovacao', 'true', true)`)
    for (const operation of dataset.operations.filter((item) => item.status !== 'solicitada')) {
      try {
        await client.query(`
          UPDATE public.operacoes SET status = 'aprovada', aprovado_por = $2,
            aprovado_em = $3, taxa_desconto = 3.99,
            valor_liquido_desembolso = round(valor_bruto_total * 0.96, 2),
            preco_aquisicao = round(valor_bruto_total * 0.96, 2),
            calculo_memoria = $4, updated_at = $3
          WHERE id = $1 AND status IN ('solicitada', 'em_analise')
        `, [operation.id, actor.id, operation.approvedAt, { qa_dataset: SEED_VERSION, metodo: 'DIAS_UTEIS_252' }])
        if (operation.status !== 'aprovada') {
          await client.query(`
            UPDATE public.operacoes SET status = $2::public.operacao_status,
              cessao_efetivada_em = $3,
              liquidada_em = CASE WHEN $2::text = 'liquidada' THEN $3::timestamptz + interval '5 days' ELSE liquidada_em END,
              updated_at = COALESCE($3, updated_at)
            WHERE id = $1 AND status = 'aprovada'
          `, [operation.id, operation.status, operation.cessionDate ? timestamp(operation.cessionDate, 16) : null])
        }
      } catch (error) {
        throw new Error(`Operacao QA ${operation.number} (${operation.notes.map((note) => note.numberText).join(', ')}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    await insertEvidencePhase(client, 2)

    const deliveryOperations = dataset.operations.filter((operation) => operation.cessionDate)
    const deliveries = deliveryOperations.flatMap((operation) => operation.notes.map((note) => {
      const proof = dataset.proofByNote.get(note.number)
      const proofApproved = proof?.versions.some((version) => version.status === 'aprovado')
      const cte = dataset.cteByNote.get(note.number)
      const cteApproved = cte?.versions.some((version) => version.status === 'aprovado')
      const status = proofApproved || cteApproved ? 'aguardando_validacao' : 'em_transito'
      return {
        id: deterministicUuid(`delivery-${note.number}`), operacao_id: operation.id, nota_fiscal_id: note.id,
        status_entrega: status, cessao_efetivada_em: timestamp(operation.cessionDate, 16),
        data_limite_cte: addDays(operation.cessionDate, 10), data_limite_canhoto: addDays(operation.cessionDate, 20),
        data_entrega: proofApproved ? addDays(operation.cessionDate, Math.max(-1, note.number % 8)) : null,
        entrega_confirmada_em: proofApproved ? timestamp(addDays(operation.cessionDate, Math.max(-1, note.number % 8)), 17) : null,
        motivo_pendencia: proofApproved ? null : 'Aguardando comprovante sintetico',
        created_at: timestamp(operation.cessionDate, 16), updated_at: timestamp(addDays(operation.cessionDate, 1), 9),
      }
    }))
    await insertRows(client, 'nota_fiscal_entregas', Object.keys(deliveries[0]), deliveries)
    const deliveryByNote = new Map(deliveries.map((item) => [dataset.notes.find((note) => note.id === item.nota_fiscal_id).number, item]))
    const instances = deliveryOperations.flatMap((operation) => operation.notes.flatMap((note) => {
      const delivery = deliveryByNote.get(note.number)
      const cte = dataset.cteByNote.get(note.number)
      const proof = dataset.proofByNote.get(note.number)
      return [
        { family: 'cte', reqId: operation.policy.reqCteId, typeId: typeIds.get('cte_xml'), code: 'cte', due: delivery.data_limite_cte, currentApproved: cte?.currentVersion.status === 'aprovado' },
        { family: 'comprovante_entrega', reqId: operation.policy.reqProofId, typeId: typeIds.get('comprovante_entrega'), code: 'comprovante_entrega', due: delivery.data_limite_canhoto, currentApproved: proof?.currentVersion.status === 'aprovado' },
      ].sort((left, right) => Number(left.currentApproved) - Number(right.currentApproved)).map((item) => ({
        id: deterministicUuid(`requirement-instance-${note.number}-${item.family}`),
        politica_requisito_id: item.reqId, politica_operacional_id: operation.policy.id,
        politica_operacional_versao_id: operation.policy.versionId, politica_versao: 1,
        documento_tipo_id: item.typeId, tipo_documento_codigo_snapshot: item.code,
        escopo_snapshot: 'pos_cessao', nota_fiscal_id: null, operacao_id: null,
        nota_fiscal_entrega_id: delivery.id, cedente_id: note.cedent.id, status: 'pendente',
        obrigatorio: true, prazo_limite: item.due, formatos_aceitos_snapshot: item.family === 'cte' ? ['application/xml', 'application/pdf'] : ['application/pdf'],
        nivel_validacao_snapshot: 'manual', quantidade_minima_snapshot: 1,
        responsavel_upload_snapshot: 'cedente', responsavel_aprovacao_snapshot: 'gestor',
        origem_snapshot: 'upload_requisito', created_at: delivery.created_at, updated_at: delivery.updated_at,
      }))
    }))
    await insertRows(client, 'documento_requisito_instancias', Object.keys(instances[0]), instances)

    for (const note of dataset.notes.filter((item) => deliveryByNote.has(item.number))) {
      for (const family of ['cte', 'comprovante_entrega']) {
        await client.query('SELECT private.reconciliar_evidencia_logistica_nf($1,$2,NULL)', [note.id, family])
      }
    }
    // Segunda reconciliacao deliberada em amostra para provar idempotencia no verify.
    for (const note of dataset.notes.filter((item) => deliveryByNote.has(item.number)).slice(0, 8)) {
      await client.query('SELECT private.reconciliar_evidencia_logistica_nf($1,$2,NULL)', [note.id, 'cte'])
      await client.query('SELECT private.reconciliar_evidencia_logistica_nf($1,$2,NULL)', [note.id, 'comprovante_entrega'])
    }

    const postponable = dataset.notes.filter((note) => deliveryByNote.has(note.number) && !dataset.proofByNote.has(note.number)).slice(0, 8)
    const postponements = postponable.map((note, index) => {
      const delivery = deliveryByNote.get(note.number)
      const operation = dataset.operations.find((item) => item.id === note.operationId)
      return {
        id: deterministicUuid(`postponement-${note.number}`), nota_fiscal_entrega_id: delivery.id,
        nota_fiscal_id: note.id, operacao_id: operation.id, fundo_id: dataset.fund.id,
        cedente_id: note.cedent.id, cedente_fundo_id: note.cedent.linkId,
        politica_operacional_versao_id: note.cedent.policy.versionId,
        politica_snapshot_hash: operationSnapshotHashById.get(operation.id),
        prazo_original_upload_canhoto: delivery.data_limite_canhoto,
        nova_previsao_upload_canhoto: addDays(delivery.data_limite_canhoto, index % 2 === 0 ? 5 : 12),
        motivo_postergacao: `Nova previsao sintetica ${SEED_VERSION}`,
        limite_postergacao_dias_aplicado: 30,
        postergacao_comunicada_em: timestamp(addDays(delivery.data_limite_canhoto, -2), 10),
        postergacao_comunicada_por: ensured.users.get(`cedente-${dataset.cedents.indexOf(note.cedent) + 1}`).id,
        utilizada: true, created_at: timestamp(addDays(delivery.data_limite_canhoto, -2), 10),
      }
    })
    await insertRows(client, 'nota_fiscal_entrega_postergacoes_canhoto', Object.keys(postponements[0]), postponements)

    await client.query('COMMIT')

    const manifest = {
      seedVersion: SEED_VERSION, projectRef: env.projectRef, generatedAt: new Date().toISOString(),
      fund: { id: dataset.fund.id, name: dataset.fund.name }, manager: manager ? { id: manager.id, email: manager.email } : null,
      counts: {
        cedents: dataset.cedents.length, debtors: dataset.debtors.length, notes: dataset.notes.length,
        operations: dataset.operations.length, ctes: cteDocuments.length,
        sharedCtes: cteDocuments.filter((item) => item.notes.length > 1).length,
        proofDocuments: dataset.documents.filter((item) => item.family === 'comprovante_entrega').length,
        postponements: postponements.length, storageObjects: 0,
      },
      ids: {
        fund: dataset.fund.id, cedents: dataset.cedents.map((item) => item.id),
        debtors: dataset.debtors.map((item) => item.id), notes: dataset.notes.map((item) => item.id),
        operations: dataset.operations.map((item) => item.id), documents: dataset.documents.map((item) => item.id),
        ctes: cteDocuments.map((item) => deterministicUuid(`cte-${item.key}`)),
      },
    }
    writeRestrictedJson(localManifestPath(), manifest)
    console.log('\nSeed transacional concluido.')
    console.log(`Manifest local: ${localManifestPath()}`)
    console.log(`Valor bruto sintetico: ${brl(dataset.notes.reduce((sum, note) => sum + note.value, 0))}`)
    console.log(manager ? `Gestor vinculado: ${manager.email}` : 'Gestor acessivel nao vinculado: informe LOGISTICA_SEED_GESTOR_EMAIL e execute novamente.')
    console.log('Storage: 0 objetos; a Central usa metadados documentais e nao requer preview/download para esta massa.')
  }
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => undefined)
  if (admin && authCreated.length) await removeCreatedAuthUsers(admin, authCreated)
  console.error(`\nFalha no seed da Central Logistica: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (client) await client.end().catch(() => undefined)
}

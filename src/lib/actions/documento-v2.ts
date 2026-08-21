'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireGestor, requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { registrarLog } from './auditoria'
import { instanciarRequisitosDaNota } from '@/lib/documentos-v2/requisitos'
import { gerarUrlDocumento } from '@/lib/documentos-v2/storage'
import { uploadDocumentoDaEntrega, uploadDocumentoDaNota } from '@/lib/documentos-v2/upload'
import { uploadDocumentoLogisticoAntecipado } from '@/lib/logistica/upload-antecipado.server'
import { normalizarCodigoDocumentoCatalogo } from '@/lib/documentos-v2/tipos'
import { calcularPrazoDocumento, type StatusPrazoDocumento } from '@/lib/documentos-v2/prazos'
import { calcularStatusLogisticoDocumental, type StatusLogisticoResumo } from '@/lib/documentos-v2/resumo-operacional'
import { faseDocumentalPorEscopo } from '@/lib/documentos-v2/requisitos-pos-cessao'
import { resolverEstadoChecklistDocumental, type RequisitoChecklistAplicavel } from '@/lib/documentos-v2/checklist-state'
import {
  resolverSatisfacaoRequisitoParaAprovacao,
  resolverSatisfacaoRequisitoParaSubmissao,
  type SatisfacaoRequisitoAprovacao,
  type SatisfacaoRequisitoSubmissao,
} from '@/lib/documentos-v2/satisfacao-requisito'
import { carregarContextoEventoDocumentoVersao, registrarEventoDominio } from '@/lib/eventos-dominio/registrar'
import type { DocumentoAnaliseResultado, PoliticaNivelValidacao } from '@/lib/types/domain'
import { revalidatePath } from 'next/cache'
import {
  avaliarPossibilidadePostergacaoCanhoto,
  calcularStatusPrazoUploadCanhoto,
  snapshotExigeCanhoto,
  type AvaliacaoPostergacaoCanhoto,
  type StatusPrazoUploadCanhoto,
} from '@/lib/logistica/postergacao-canhoto'
import {
  avaliarSubmissaoLogisticaPreCessao,
  classificarStatusLogisticoPreCessao,
  evidenciasDoChecklistRegular,
  resolverFamiliaDocumentalLogistica,
  type FamiliaDocumentalLogistica,
  type StatusLogisticoPreCessao,
} from '@/lib/logistica/evidencias-logisticas'
import {
  carregarNfsCandidatasCteSeAplicavel,
  possuiRequisitoCteAntecipavel,
} from '@/lib/logistica/candidatas-cte.server'
import { documentLabel } from '@/lib/politicas/ui'

const TIPO_DOCUMENTO_NF_REMESSA = 'nf_remessa'

const DOCUMENTOS_COM_VALIDACAO_ESTRUTURAL_NO_UPLOAD = new Set([
  'nf_xml',
  'nf_danfe_pdf',
  'cte_xml',
])

export interface ChecklistDocumentoItem {
  id: string
  politicaRequisitoId: string
  codigo: string
  nome: string
  descricao: string
  fase: 'pre_cessao' | 'pos_cessao'
  escopo: string
  obrigatorio: boolean
  status: string
  nivelValidacao: PoliticaNivelValidacao
  momentoObrigatorio: string
  statusPrazo: StatusPrazoDocumento
  prazoDias: number | null
  marcoPrazo: string | null
  dataInicioPrazo: string | null
  dataLimite: string | null
  prazoTexto: string | null
  prazoDetalhe: string | null
  bloqueiaFluxo: boolean
  formatosAceitos: string[]
  uploadPermitido: boolean
  documentoId: string | null
  versaoAprovadaId: string | null
  entregaId: string | null
  envioAntecipado: boolean
  familiaDocumental: FamiliaDocumentalLogistica | null
  nfsCompartilhamento: Array<{ id: string; numero: string; chaveAcesso: string | null }>
  erroNfsCompartilhamento: string | null
  satisfacaoSubmissao: SatisfacaoRequisitoSubmissao
  satisfacaoAprovacao: SatisfacaoRequisitoAprovacao
  versoes: Array<{
    id: string
    numero: number
    status: string
    nome: string
    sha256: string
    enviadoPorId: string
    enviadoPorNome: string | null
    enviadoEm: string
    criadoEm: string
    ultimaAnalise: { resultado: string; observacoes: string | null; analisadoPorId: string | null; analisadoPorNome: string | null; analisadoEm: string } | null
  }>
}

export interface ChecklistDocumento {
  notaFiscalId: string
  items: ChecklistDocumentoItem[]
  estadoChecklist: ReturnType<typeof resolverEstadoChecklistDocumental>
  preCessao: ChecklistDocumentoItem[]
  logisticaAntecipada: ChecklistDocumentoItem[]
  posCessao: ChecklistDocumentoItem[]
  gateLogisticoPreCessao: {
    exigido: boolean
    status: StatusLogisticoPreCessao
    /** Gate de submissao (cedente): exige apenas evidencia vigente (enviada/em analise/aprovada), nao aprovada. */
    permitidoSubmissao: boolean
  }
  entrega: { id: string; status: string; dataInicioPrazo: string | null; motivoPendencia: string | null; dataEntrega: string | null; entregaConfirmadaEm: string | null } | null
  postergacaoCanhoto: {
    dataReferencia: string
    prazoOriginal: string
    statusPrazoOriginal: StatusPrazoUploadCanhoto
    novaPrevisao: string | null
    statusNovaPrevisao: StatusPrazoUploadCanhoto | null
    motivo: string | null
    comunicadaEm: string | null
    comunicadaPorId: string | null
    comunicadaPorNome: string | null
    limiteDiasAplicado: number | null
    primeiroUploadEm: string | null
    avaliacao: AvaliacaoPostergacaoCanhoto
  } | null
  elegibilidade: ElegibilidadeDocumental
  elegibilidadeAprovacao: ElegibilidadeDocumental
  posCessaoResumo: {
    existe: boolean
    obrigatoriosPendentes: number
    status: 'nao_iniciado' | 'pendente' | 'em_analise' | 'vencido' | 'concluido'
  }
  resumoOperacional: {
    statusAntecipacao: string
    statusLogistico: StatusLogisticoResumo
    pendenciasPreCessao: number
    pendenciasPosCessao: number
    pendenciasTotal: number
    proximoPrazo: {
      nome: string
      dataLimite: string | null
      statusPrazo: StatusPrazoDocumento
      prazoDetalhe: string | null
      fase: 'pre_cessao' | 'pos_cessao'
    } | null
  }
}

export interface ElegibilidadeDocumental {
  elegivel: boolean
  requisitosPendentes: string[]
  requisitosRejeitados: string[]
  requisitosEmAnalise: string[]
  motivos: string[]
  totalObrigatorios: number
  concluidosObrigatorios: number
  pendentesObrigatorios: number
}

async function carregarChecklist(notaFiscalId: string): Promise<ChecklistDocumento> {
  const supabase = await createClient()
  const context = await requireNotaFiscalAccess(notaFiscalId, supabase)

  // A partir daqui o acesso à NF já foi validado com a sessão real do usuário.
  // As leituras do checklist usam service role de forma estritamente escopada à NF
  // para evitar divergência entre policies auxiliares de gestor e cedente.
  const dataClient = createAdminClient()

  const [{ data: nfData }, { data: entregaData }, { data: postergacaoData, error: postergacaoError }] = await Promise.all([
    dataClient
      .from('notas_fiscais')
      .select('id, status, cedente_id, cedente_fundo_id, fundo_id')
      .eq('id', notaFiscalId)
      .maybeSingle(),
    dataClient
    .from('nota_fiscal_entregas')
    .select('id, operacao_id, status_entrega, cessao_efetivada_em, data_limite_canhoto, data_entrega, entrega_confirmada_em, motivo_pendencia, created_at')
    .eq('nota_fiscal_id', notaFiscalId)
    .not('status_entrega', 'eq', 'nao_aplicavel')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
    dataClient
      .from('nota_fiscal_entrega_postergacoes_canhoto')
      .select('id, nota_fiscal_entrega_id, prazo_original_upload_canhoto, nova_previsao_upload_canhoto, motivo_postergacao, limite_postergacao_dias_aplicado, postergacao_comunicada_em, postergacao_comunicada_por')
      .eq('nota_fiscal_id', notaFiscalId)
      .maybeSingle(),
  ])
  if (postergacaoError) throw new Error(`Erro ao carregar postergação do canhoto: ${postergacaoError.message}`)
  const notaFiscal = nfData as { id: string; status: string; cedente_id: string; cedente_fundo_id: string | null; fundo_id: string | null } | null
  const entrega = entregaData as { id: string; operacao_id: string; status_entrega: string; cessao_efetivada_em: string | null; data_limite_canhoto: string | null; data_entrega: string | null; entrega_confirmada_em: string | null; motivo_pendencia: string | null; created_at: string } | null
  const postergacao = postergacaoData as {
    id: string
    nota_fiscal_entrega_id: string
    prazo_original_upload_canhoto: string
    nova_previsao_upload_canhoto: string
    motivo_postergacao: string
    limite_postergacao_dias_aplicado: number
    postergacao_comunicada_em: string
    postergacao_comunicada_por: string
  } | null

  const { data: operationLinks, error: operationLinksError } = await dataClient
    .from('operacoes_nfs')
    .select('operacao_id')
    .eq('nota_fiscal_id', notaFiscalId)
  if (operationLinksError) throw new Error(`Erro ao carregar vinculo operacional da NF: ${operationLinksError.message}`)

  const operationIds = Array.from(new Set((operationLinks || []).map((link) => link.operacao_id as string)))
  const { data: operationsData, error: operationsError } = operationIds.length
    ? await dataClient
      .from('operacoes')
      .select('id, status, politica_snapshot, politica_snapshot_hash, politica_operacional_versao_id, cessao_efetivada_em, created_at')
      .in('id', operationIds)
      .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (operationsError) throw new Error(`Erro ao carregar operacao da NF: ${operationsError.message}`)
  const operations = (operationsData || []) as Array<{ id: string; status: string; politica_snapshot: Record<string, unknown> | null; politica_snapshot_hash: string | null; politica_operacional_versao_id: string | null; cessao_efetivada_em: string | null; created_at: string }>
  const operation = (entrega
    ? operations.find((item) => item.id === entrega.operacao_id)
    : operations.find((item) => !['cancelada', 'reprovada'].includes(item.status)) || operations[0]) || null

  // Fora de uma operacao, o checklist acompanha a versao publicada atual. Dentro
  // da operacao, a versao congelada e a unica fonte de verdade permitida.
  const instanciacao = !operation && (context.profile.role === 'cedente' || context.profile.role === 'gestor')
    ? await instanciarRequisitosDaNota(notaFiscalId, supabase)
    : null
  const politicaVersaoId = operation?.politica_operacional_versao_id || instanciacao?.politica.versao.id || null

  const { data: legacyCanhotos } = entrega
    ? await dataClient
      .from('canhotos')
      .select('created_at')
      .eq('nota_fiscal_entrega_id', entrega.id)
      .order('created_at', { ascending: true })
      .limit(1)
    : { data: [] }

  // Requisitos por parcela (ex.: boleto) ficam fora deste checklist geral --
  // tem sua propria secao "Parcelas / Boletos" (listarParcelasBoletosDaNota),
  // que sabe a qual parcela cada um pertence. Sem esse filtro apareceriam
  // aqui como itens genericos sem rotulo de parcela.
  const instancesQuery = dataClient
    .from('documento_requisito_instancias')
    .select('id, politica_requisito_id, politica_operacional_versao_id, politica_operacional_id, politica_versao, documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, obrigatorio, status, documento_id, versao_aprovada_id, nota_fiscal_id, nota_fiscal_entrega_id, prazo_limite, quantidade_minima_snapshot, formatos_aceitos_snapshot, nivel_validacao_snapshot')
    .is('parcela_id', null)

  const { data: instances, error } = await (entrega?.id
    ? instancesQuery.or([
      `nota_fiscal_id.eq.${notaFiscalId}`,
      `nota_fiscal_entrega_id.eq.${entrega.id}`,
    ].filter(Boolean).join(','))
    : instancesQuery.eq('nota_fiscal_id', notaFiscalId))
    .order('id')
  if (error) throw new Error(`Erro ao carregar checklist: ${error.message}`)

  const rows = (instances || []) as Array<{
    id: string; politica_requisito_id: string; politica_operacional_versao_id: string | null; politica_operacional_id: string | null; politica_versao: number | null; documento_tipo_id: string | null; tipo_documento_codigo_snapshot: string; escopo_snapshot: string; obrigatorio: boolean; status: string; documento_id: string | null; versao_aprovada_id: string | null; nota_fiscal_id: string | null; nota_fiscal_entrega_id: string | null; prazo_limite: string | null; quantidade_minima_snapshot: number; formatos_aceitos_snapshot: string[]; nivel_validacao_snapshot: string
  }>
  const { data: policyRequirementRows, error: policyRequirementsError } = politicaVersaoId
    ? await dataClient
      .from('politica_requisitos_documentais')
      .select('id, codigo, tipo_documento_codigo, escopo, obrigatorio, ativo, nivel_validacao, momento_obrigatorio, bloqueia_fluxo, formatos_aceitos, familia_documental')
      .eq('politica_operacional_versao_id', politicaVersaoId)
      .in('escopo', ['nf_pre_cessao', 'pos_cessao', 'entrega'])
    : { data: [], error: null }
  if (policyRequirementsError) throw new Error(`Erro ao carregar requisitos da politica: ${policyRequirementsError.message}`)

  const policyRequirements = (policyRequirementRows || []) as Array<{
    id: string
    codigo: string
    tipo_documento_codigo: string
    escopo: string
    obrigatorio: boolean
    ativo: boolean
    nivel_validacao: PoliticaNivelValidacao
    momento_obrigatorio: string | null
    bloqueia_fluxo: boolean
    formatos_aceitos: string[] | null
    familia_documental: FamiliaDocumentalLogistica | null
  }>

  // Requisitos por_parcela (ex.: boleto) tem suas instancias deliberadamente
  // fora de `rows` (filtro .is('parcela_id', null) acima -- tem secao propria,
  // ParcelasBoletosNota). Sem isso, resolverEstadoChecklistDocumental veria
  // o requisito como "aplicavel" sem nenhuma instancia correspondente e
  // marcaria a NF inteira como nao_instanciado, escondendo o checklist
  // completo mesmo com XML/DANFE/CT-e e o proprio boleto ja instanciados.
  const policyRequirementCodes = Array.from(new Set(policyRequirements.map((row) => row.tipo_documento_codigo)))
  const { data: cardinalidadeRows, error: cardinalidadeError } = policyRequirementCodes.length
    ? await dataClient.from('documento_tipos').select('codigo, cardinalidade').in('codigo', policyRequirementCodes)
    : { data: [], error: null }
  if (cardinalidadeError) throw new Error(`Erro ao carregar cardinalidade dos tipos documentais: ${cardinalidadeError.message}`)
  const codigosPorParcela = new Set(
    (cardinalidadeRows || []).filter((row) => row.cardinalidade === 'por_parcela').map((row) => row.codigo),
  )

  const [{ data: policyVersionData, error: policyVersionError }, { data: evidenceData, error: evidenceError }] = await Promise.all([
    politicaVersaoId
      ? dataClient
        .from('politica_operacional_versoes')
        .select('id, exigir_status_logistico_pre_cessao')
        .eq('id', politicaVersaoId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    politicaVersaoId
      ? dataClient
        .from('evidencias_logisticas_antecipadas')
        .select('id, nota_fiscal_id, politica_requisito_id, familia_documental, documento_id, documento_versao_atual_id, created_at, updated_at')
        .eq('nota_fiscal_id', notaFiscalId)
        .eq('politica_operacional_versao_id', politicaVersaoId)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (policyVersionError) throw new Error(`Erro ao carregar configuracao logistica da politica: ${policyVersionError.message}`)
  if (evidenceError) throw new Error(`Erro ao carregar evidencias logisticas antecipadas: ${evidenceError.message}`)

  const evidences = (evidenceData || []) as Array<{
    id: string
    nota_fiscal_id: string
    politica_requisito_id: string
    familia_documental: FamiliaDocumentalLogistica
    documento_id: string
    documento_versao_atual_id: string
    created_at: string
    updated_at: string
  }>
  const evidenceIds = evidences.map((evidence) => evidence.id)
  const { data: evidenceHistoryData, error: evidenceHistoryError } = evidenceIds.length
    ? await dataClient
      .from('evidencia_logistica_versoes')
      .select('id, evidencia_logistica_id, documento_id, documento_versao_id, created_at')
      .in('evidencia_logistica_id', evidenceIds)
      .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (evidenceHistoryError) throw new Error(`Erro ao carregar historico das evidencias logisticas: ${evidenceHistoryError.message}`)
  const evidenceHistory = (evidenceHistoryData || []) as Array<{ id: string; evidencia_logistica_id: string; documento_id: string; documento_versao_id: string; created_at: string }>
  const evidenceDocumentIds = Array.from(new Set(evidenceHistory.map((item) => item.documento_id)))
  const { data: evidenceDocumentsData, error: evidenceDocumentsError } = evidenceDocumentIds.length
    ? await dataClient.from('documentos_repositorio').select('id, documento_tipo_id').in('id', evidenceDocumentIds)
    : { data: [], error: null }
  if (evidenceDocumentsError) throw new Error(`Erro ao carregar documentos das evidencias logisticas: ${evidenceDocumentsError.message}`)
  const evidenceDocuments = (evidenceDocumentsData || []) as Array<{ id: string; documento_tipo_id: string }>

  const cteAntecipavel = !entrega && possuiRequisitoCteAntecipavel(policyRequirements)
  if (cteAntecipavel && (!notaFiscal?.cedente_fundo_id || !notaFiscal.fundo_id || !notaFiscal.cedente_id)) {
    throw new Error('A NF nao possui contexto completo de cedente e fundo para o compartilhamento de CT-e.')
  }
  const sharingNfsResult = notaFiscal?.cedente_fundo_id && notaFiscal.fundo_id
    ? await carregarNfsCandidatasCteSeAplicavel({
      client: dataClient,
      contexto: {
        notaFiscalId,
        cedenteId: notaFiscal.cedente_id,
        cedenteFundoId: notaFiscal.cedente_fundo_id,
        fundoId: notaFiscal.fundo_id,
      },
      requisitos: entrega ? [] : policyRequirements,
    })
    : { aplicavel: false, candidatas: [], erro: null }
  if (sharingNfsResult.erro) {
    console.warn('[checklist-documental][candidatas-cte]', {
      nota_fiscal_id: notaFiscalId,
      erro: sharingNfsResult.erro,
    })
  }
  const sharingNfs = sharingNfsResult.candidatas.map((nf) => ({
    id: nf.id,
    numero: nf.numero,
    chaveAcesso: nf.chaveAcesso,
  }))

  const typeIds = [
    ...rows.map((row) => row.documento_tipo_id).filter(Boolean),
    ...evidenceDocuments.map((document) => document.documento_tipo_id).filter(Boolean),
  ] as string[]
  const typeCodes = Array.from(new Set(rows.map((row) => normalizarCodigoDocumentoCatalogo(row.tipo_documento_codigo_snapshot))))
  const docIds = Array.from(new Set([
    ...rows.map((row) => row.documento_id).filter(Boolean) as string[],
    ...evidenceDocumentIds,
  ]))
  const [typesResult, versionsResult] = await Promise.all([
    typeIds.length || typeCodes.length
      ? dataClient.from('documento_tipos').select('id, codigo, nome').or([
        typeIds.length ? `id.in.(${typeIds.join(',')})` : '',
        typeCodes.length ? `codigo.in.(${typeCodes.join(',')})` : '',
      ].filter(Boolean).join(','))
      : Promise.resolve({ data: [], error: null }),
    docIds.length ? dataClient.from('documento_versoes').select('id, documento_id, numero_versao, status, nome_original, sha256, enviado_por, enviado_em, created_at').in('documento_id', docIds).order('numero_versao', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  if (typesResult.error || versionsResult.error) throw new Error('Erro ao carregar tipos ou versoes documentais.')
  const types = new Map((typesResult.data || []).map((type) => [type.id, type]))
  const typesByCode = new Map((typesResult.data || []).map((type) => [type.codigo, type]))
  const versions = (versionsResult.data || []) as Array<{ id: string; documento_id: string; numero_versao: number; status: string; nome_original: string; sha256: string; enviado_por: string; enviado_em: string; created_at: string }>
  const versionIds = versions.map((version) => version.id)
  const { data: analyses } = versionIds.length
    ? await dataClient.from('documento_analises').select('documento_versao_id, resultado, observacoes, analisado_por, analisado_em').in('documento_versao_id', versionIds).order('analisado_em', { ascending: false })
    : { data: [] }
  const analysisRows = (analyses || []) as Array<{ documento_versao_id: string; resultado: string; observacoes: string | null; analisado_por: string | null; analisado_em: string }>

  // NF de Remessa nunca gera documento_versoes -- sua fonte real e
  // nota_fiscal_remessas.status_validacao (o requisito ja chega aqui com
  // status 'satisfeito'/'pendente' resolvido pelo trigger de
  // reconciliacao). So buscamos aqui para enriquecer nome/descricao do
  // item no checklist (qual remessa validou), sem duplicar o card
  // RemessaDaNota nem criar upload generico para este tipo.
  const temRequisitoNfRemessa = rows.some((row) => row.tipo_documento_codigo_snapshot === TIPO_DOCUMENTO_NF_REMESSA)
  const { data: remessasData } = temRequisitoNfRemessa
    ? await dataClient.from('nota_fiscal_remessas').select('numero, chave_acesso, status_validacao').eq('nota_fiscal_venda_id', notaFiscalId).order('created_at', { ascending: false })
    : { data: [] }
  const remessaValidada = (remessasData || []).find((remessa) => remessa.status_validacao === 'VALIDADA') || null

  const profileIds = Array.from(new Set([
    ...versions.map((version) => version.enviado_por).filter(Boolean),
    ...analysisRows.map((analysis) => analysis.analisado_por).filter(Boolean),
    ...(postergacao?.postergacao_comunicada_por ? [postergacao.postergacao_comunicada_por] : []),
  ] as string[]))
  const { data: profiles } = profileIds.length
    ? await dataClient.from('profiles').select('id, nome_completo, email').in('id', profileIds)
    : { data: [] }
  const profileNames = new Map((profiles || []).map((profile) => [profile.id, profile.nome_completo || profile.email]))
  const latestAnalysis = new Map<string, { resultado: string; observacoes: string | null; analisadoPorId: string | null; analisadoPorNome: string | null; analisadoEm: string }>()
  for (const analysis of analysisRows) {
    if (!latestAnalysis.has(analysis.documento_versao_id)) latestAnalysis.set(analysis.documento_versao_id, {
      resultado: analysis.resultado,
      observacoes: analysis.observacoes,
      analisadoPorId: analysis.analisado_por,
      analisadoPorNome: analysis.analisado_por ? profileNames.get(analysis.analisado_por) || null : null,
      analisadoEm: analysis.analisado_em,
    })
  }

  const policyRequirementById = new Map(policyRequirements.map((requirement) => [requirement.id, requirement]))

  const items: ChecklistDocumentoItem[] = rows.map((row) => {
    const type = row.documento_tipo_id
      ? types.get(row.documento_tipo_id)
      : typesByCode.get(normalizarCodigoDocumentoCatalogo(row.tipo_documento_codigo_snapshot))
    const fase: ChecklistDocumentoItem['fase'] = faseDocumentalPorEscopo(row.escopo_snapshot)
    const policyRequirement = policyRequirementById.get(row.politica_requisito_id)
    const nivelValidacao = (row.nivel_validacao_snapshot || policyRequirement?.nivel_validacao || 'manual') as PoliticaNivelValidacao
    const momentoObrigatorio = policyRequirement?.momento_obrigatorio || row.escopo_snapshot
    const bloqueiaFluxo = policyRequirement?.bloqueia_fluxo ?? row.obrigatorio
    const itemVersions = versions
      .filter((version) => version.documento_id === row.documento_id)
      .map((version) => ({
        id: version.id,
        numero: version.numero_versao,
        status: version.status,
        nome: version.nome_original,
        sha256: version.sha256,
        enviadoPorId: version.enviado_por,
        enviadoPorNome: profileNames.get(version.enviado_por) || null,
        enviadoEm: version.enviado_em,
        criadoEm: version.created_at,
        ultimaAnalise: latestAnalysis.get(version.id) || null,
      }))
    const codigoCatalogo = normalizarCodigoDocumentoCatalogo(row.tipo_documento_codigo_snapshot)
    const latestVersion = itemVersions[0]
    const validacaoEstruturalOk = Boolean(
      latestVersion
      && DOCUMENTOS_COM_VALIDACAO_ESTRUTURAL_NO_UPLOAD.has(codigoCatalogo)
      && ['enviado', 'em_analise', 'aprovado'].includes(latestVersion.status)
      && !['rejeitado', 'requer_ajuste'].includes(latestVersion.ultimaAnalise?.resultado || ''),
    )
    const satisfacaoInput = {
      requisitoId: row.politica_requisito_id,
      tipoDocumento: codigoCatalogo,
      obrigatorio: row.obrigatorio,
      bloqueiaFluxo,
      momento: momentoObrigatorio,
      regraValidade: nivelValidacao,
      statusInstancia: row.status,
      documentoId: row.documento_id,
      versaoAprovadaId: row.versao_aprovada_id,
      validacaoEstruturalOk,
      versoes: itemVersions,
    }
    const prazo = calcularPrazoDocumento({
      status: row.status,
      prazoLimite: row.prazo_limite,
      dataInicioPrazo: fase === 'pos_cessao' ? (entrega?.cessao_efetivada_em || entrega?.created_at || null) : null,
    })
    const isNfRemessa = row.tipo_documento_codigo_snapshot === TIPO_DOCUMENTO_NF_REMESSA
    const descricaoNfRemessa = row.status === 'satisfeito' && remessaValidada
      ? `Atendido — NF de Remessa ${remessaValidada.numero || remessaValidada.chave_acesso} validada.`
      : 'Pendente — nenhuma NF de Remessa validada. Envie pelo card "NF de Remessa" nesta pagina.'
    return {
      id: row.id,
      politicaRequisitoId: row.politica_requisito_id,
      codigo: row.tipo_documento_codigo_snapshot,
      nome: isNfRemessa ? documentLabel(row.tipo_documento_codigo_snapshot) : (type?.nome || row.tipo_documento_codigo_snapshot),
      descricao: isNfRemessa
        ? descricaoNfRemessa
        : fase === 'pos_cessao'
          ? 'Documento exigido apos a cessao/desembolso para acompanhamento logistico da NF.'
          : 'Documento exigido antes da cessao para validacao da NF.',
      fase,
      escopo: row.escopo_snapshot,
      obrigatorio: row.obrigatorio,
      status: row.status,
      nivelValidacao,
      momentoObrigatorio,
      ...prazo,
      bloqueiaFluxo,
      formatosAceitos: row.formatos_aceitos_snapshot || [],
      // NF de Remessa nunca usa o upload generico -- o unico caminho de
      // envio e o card RemessaDaNota (registrar_nota_fiscal_remessa),
      // nunca duplicado aqui.
      uploadPermitido: isNfRemessa ? false : !!type,
      documentoId: row.documento_id,
      versaoAprovadaId: row.versao_aprovada_id,
      entregaId: row.nota_fiscal_entrega_id,
      envioAntecipado: false,
      familiaDocumental: policyRequirement?.familia_documental || resolverFamiliaDocumentalLogistica(row.tipo_documento_codigo_snapshot),
      nfsCompartilhamento: [],
      erroNfsCompartilhamento: null,
      satisfacaoSubmissao: resolverSatisfacaoRequisitoParaSubmissao(satisfacaoInput),
      satisfacaoAprovacao: resolverSatisfacaoRequisitoParaAprovacao(satisfacaoInput),
      versoes: itemVersions,
    }
  })

  const documentTypeIdByDocumentId = new Map(evidenceDocuments.map((document) => [document.id, document.documento_tipo_id]))
  const earlyItems: ChecklistDocumentoItem[] = entrega ? [] : policyRequirements
    .filter((requirement) => requirement.ativo && ['pos_cessao', 'entrega'].includes(requirement.escopo))
    .map((requirement) => ({ requirement, family: requirement.familia_documental || resolverFamiliaDocumentalLogistica(requirement.tipo_documento_codigo) }))
    .filter((entry): entry is { requirement: typeof policyRequirements[number]; family: FamiliaDocumentalLogistica } => Boolean(entry.family))
    .map(({ requirement, family }) => {
      const evidence = evidences.find((item) => item.politica_requisito_id === requirement.id && item.familia_documental === family) || null
      const orderedHistory = evidenceHistory
        .filter((history) => history.evidencia_logistica_id === evidence?.id)
      const itemVersions = orderedHistory
        .map((history, index) => {
          const version = versions.find((candidate) => candidate.id === history.documento_versao_id)
          if (!version) return null
          return {
          id: version.id,
          // Cada substituicao pode criar um novo documento fisico. A numeracao
          // exibida e a sequencia logica append-only desta evidencia.
          numero: orderedHistory.length - index,
          status: version.status,
          nome: version.nome_original,
          sha256: version.sha256,
          enviadoPorId: version.enviado_por,
          enviadoPorNome: profileNames.get(version.enviado_por) || null,
          enviadoEm: version.enviado_em,
          criadoEm: version.created_at,
          ultimaAnalise: latestAnalysis.get(version.id) || null,
          }
        })
        .filter((version): version is NonNullable<typeof version> => Boolean(version))
      const currentVersion = itemVersions.find((version) => version.id === evidence?.documento_versao_atual_id) || itemVersions[0] || null
      const approved = Boolean(currentVersion && (currentVersion.status === 'aprovado' || currentVersion.ultimaAnalise?.resultado === 'aprovado'))
      const rejected = Boolean(currentVersion && (currentVersion.status === 'rejeitado' || ['rejeitado', 'requer_ajuste'].includes(currentVersion.ultimaAnalise?.resultado || '')))
      const status = approved ? 'satisfeito' : rejected ? 'rejeitado' : currentVersion ? 'em_analise' : 'pendente'
      const typeId = evidence?.documento_id ? documentTypeIdByDocumentId.get(evidence.documento_id) : null
      const type = typeId ? types.get(typeId) : null
      const formatosAceitos = family === 'cte'
        ? ['xml', 'pdf']
        : (requirement.formatos_aceitos?.length ? requirement.formatos_aceitos : ['pdf', 'jpg', 'jpeg', 'png'])
      const satisfactionInput = {
        requisitoId: requirement.id,
        tipoDocumento: requirement.tipo_documento_codigo,
        obrigatorio: requirement.obrigatorio,
        bloqueiaFluxo: false,
        momento: requirement.momento_obrigatorio || requirement.escopo,
        regraValidade: requirement.nivel_validacao,
        statusInstancia: status,
        documentoId: evidence?.documento_id || null,
        versaoAprovadaId: approved ? currentVersion?.id || null : null,
        validacaoEstruturalOk: approved,
        versoes: itemVersions,
      }
      return {
        id: `antecipado:${requirement.id}`,
        politicaRequisitoId: requirement.id,
        codigo: requirement.tipo_documento_codigo,
        nome: family === 'cte' ? 'CT-e / DACTE' : 'Comprovante de entrega',
        descricao: 'Documento logistico oficialmente pos-cessao, disponivel para envio antecipado sem duplicar o requisito da politica.',
        fase: 'pos_cessao',
        escopo: requirement.escopo,
        obrigatorio: requirement.obrigatorio,
        status,
        nivelValidacao: requirement.nivel_validacao,
        momentoObrigatorio: requirement.momento_obrigatorio || requirement.escopo,
        statusPrazo: 'nao_iniciado',
        prazoDias: null,
        marcoPrazo: null,
        dataInicioPrazo: null,
        dataLimite: null,
        prazoTexto: null,
        prazoDetalhe: null,
        bloqueiaFluxo: false,
        formatosAceitos,
        uploadPermitido: family === 'cte' || Boolean(type || formatosAceitos.length),
        documentoId: evidence?.documento_id || null,
        versaoAprovadaId: approved ? currentVersion?.id || null : null,
        entregaId: null,
        envioAntecipado: true,
        familiaDocumental: family,
        nfsCompartilhamento: family === 'cte' ? sharingNfs : [],
        erroNfsCompartilhamento: family === 'cte' ? sharingNfsResult.erro : null,
        satisfacaoSubmissao: resolverSatisfacaoRequisitoParaSubmissao(satisfactionInput),
        satisfacaoAprovacao: resolverSatisfacaoRequisitoParaAprovacao(satisfactionInput),
        versoes: itemVersions,
      }
    })

  const evidenciasAntecipadas = evidenceHistory.flatMap((history) => {
    const evidence = evidences.find((item) => item.id === history.evidencia_logistica_id)
    if (!evidence) return []
    const version = versions.find((item) => item.id === history.documento_versao_id)
    const analysis = version ? latestAnalysis.get(version.id) : null
    return [{
      familia: evidence.familia_documental,
      documentoId: history.documento_id,
      versaoId: history.documento_versao_id,
      versaoStatus: version?.status || 'em_analise',
      analiseResultado: analysis?.resultado || null,
      analisadoEm: analysis?.analisadoEm || null,
      analisadoPor: analysis?.analisadoPorId || null,
      criadoEm: history.created_at,
    }]
  })
  const evidenciasLogisticas = [...evidenciasAntecipadas, ...evidenciasDoChecklistRegular(items)]
  const classificacaoLogistica = classificarStatusLogisticoPreCessao(evidenciasLogisticas)
  const snapshotGate = operation?.politica_snapshot?.exigir_status_logistico_pre_cessao
  const gateLogisticoExigido = typeof snapshotGate === 'boolean'
    ? snapshotGate
    : Boolean((policyVersionData as { exigir_status_logistico_pre_cessao?: boolean } | null)?.exigir_status_logistico_pre_cessao)
  // Submissao pelo cedente exige apenas evidencia VIGENTE (enviada, em
  // analise ou aprovada) -- diferente da aprovacao pelo gestor, que exige
  // aprovada. classificarStatusLogisticoPreCessao (acima) so considera
  // evidencias aprovadas -- correto para o rotulo de exibicao e para o gate
  // do gestor, mas errado para o gate de submissao do cedente.
  const gateLogisticoPermitidoSubmissao = avaliarSubmissaoLogisticaPreCessao({
    exigido: gateLogisticoExigido,
    evidencias: evidenciasLogisticas,
  })
  const requisitosDaPolitica: RequisitoChecklistAplicavel[] = (policyRequirementRows || []).length > 0
    ? policyRequirements
      .filter((row) => (entrega || row.escopo === 'nf_pre_cessao') && !codigosPorParcela.has(row.tipo_documento_codigo))
      .map((row) => ({
      id: row.id,
      codigo: row.codigo,
      tipoDocumentoCodigo: row.tipo_documento_codigo,
      escopo: row.escopo,
      obrigatorio: row.obrigatorio,
      ativo: row.ativo,
    }))
    : rows
      .filter((row) => row.politica_operacional_versao_id)
      .filter((row) => ['nf_pre_cessao', 'pos_cessao', 'entrega'].includes(row.escopo_snapshot))
      .filter((row) => !codigosPorParcela.has(row.tipo_documento_codigo_snapshot))
      .map((row) => ({
        id: row.politica_requisito_id,
        codigo: row.tipo_documento_codigo_snapshot,
        tipoDocumentoCodigo: row.tipo_documento_codigo_snapshot,
        escopo: row.escopo_snapshot,
        obrigatorio: row.obrigatorio,
        ativo: true,
      }))
      .filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index)
  const estadoChecklist = resolverEstadoChecklistDocumental({
    politicaSnapshot: Boolean(politicaVersaoId || rows.some((row) => row.politica_operacional_versao_id)),
    requisitosAplicaveis: requisitosDaPolitica,
    instancias: items.map((item) => ({
      requisitoId: item.politicaRequisitoId,
      codigo: item.codigo,
      obrigatorio: item.obrigatorio,
      status: item.status,
      documentoId: item.documentoId,
      versaoAprovadaId: item.versaoAprovadaId,
      nivelValidacao: item.nivelValidacao,
      versoes: item.versoes.map((version) => ({ status: version.status, ultimaAnalise: version.ultimaAnalise ? { resultado: version.ultimaAnalise.resultado } : null })),
    })),
  })
  const requisitosVisiveis = new Set(estadoChecklist.requisitosAplicaveis.map((item) => item.id))
  const itensVisiveis = items.filter((item) => requisitosVisiveis.has(item.politicaRequisitoId))
  const preCessaoVisivel = itensVisiveis.filter((item) => item.fase === 'pre_cessao')
  const posCessaoVisivel = itensVisiveis.filter((item) => item.fase === 'pos_cessao')
  const posObrigatoriosPendentes = posCessaoVisivel.filter((item) => item.obrigatorio && !documentoItemEstaAprovado(item))
  const preObrigatoriosPendentes = preCessaoVisivel.filter((item) => item.obrigatorio && !documentoItemEstaAprovado(item))
  const posStatus = !entrega
    ? 'nao_iniciado'
    : posCessaoVisivel.some((item) => item.statusPrazo === 'vencido' || item.status === 'vencido')
      ? 'vencido'
      : posObrigatoriosPendentes.length === 0 && posCessaoVisivel.length > 0
        ? 'concluido'
        : posCessaoVisivel.some((item) => item.versoes.some((version) => version.status === 'em_analise' || version.status === 'enviado'))
          ? 'em_analise'
          : 'pendente'
  const canhotoItems = posCessaoVisivel.filter((item) => ['canhoto', 'comprovante_entrega'].includes(normalizarCodigoDocumentoCatalogo(item.codigo)))
  const firstDocumentUpload = canhotoItems
    .flatMap((item) => item.versoes)
    .map((version) => version.criadoEm)
    .filter(Boolean)
    .sort()[0] || null
  const firstLegacyUpload = ((legacyCanhotos || []) as Array<{ created_at: string }>)[0]?.created_at || null
  const primeiroUploadCanhotoEm = [firstDocumentUpload, firstLegacyUpload].filter(Boolean).sort()[0] || null
  const hoje = new Date().toISOString().slice(0, 10)
  const snapshot = operation?.politica_snapshot ?? null
  const prazoOriginalCanhoto = postergacao?.prazo_original_upload_canhoto || entrega?.data_limite_canhoto || null
  const postergacaoCanhoto = entrega && prazoOriginalCanhoto && snapshotExigeCanhoto(snapshot) ? {
    dataReferencia: hoje,
    prazoOriginal: prazoOriginalCanhoto,
    statusPrazoOriginal: calcularStatusPrazoUploadCanhoto({ prazo: prazoOriginalCanhoto, hoje, primeiroUploadEm: primeiroUploadCanhotoEm }),
    novaPrevisao: postergacao?.nova_previsao_upload_canhoto || null,
    statusNovaPrevisao: postergacao?.nova_previsao_upload_canhoto
      ? calcularStatusPrazoUploadCanhoto({ prazo: postergacao.nova_previsao_upload_canhoto, hoje, primeiroUploadEm: primeiroUploadCanhotoEm })
      : null,
    motivo: postergacao?.motivo_postergacao || null,
    comunicadaEm: postergacao?.postergacao_comunicada_em || null,
    comunicadaPorId: postergacao?.postergacao_comunicada_por || null,
    comunicadaPorNome: postergacao?.postergacao_comunicada_por ? profileNames.get(postergacao.postergacao_comunicada_por) || null : null,
    limiteDiasAplicado: postergacao?.limite_postergacao_dias_aplicado || null,
    primeiroUploadEm: primeiroUploadCanhotoEm,
    avaliacao: avaliarPossibilidadePostergacaoCanhoto({
      snapshot,
      prazoOriginal: prazoOriginalCanhoto,
      hoje,
      postergacaoJaUtilizada: Boolean(postergacao),
      primeiroUploadEm: primeiroUploadCanhotoEm,
      notaCedida: Boolean(entrega.cessao_efetivada_em && operation?.cessao_efetivada_em),
    }),
  } : null
  const proximoPrazo = items
    .filter((item) => itensVisiveis.includes(item) && item.dataLimite && !documentoItemEstaAprovado(item) && !['dispensado', 'cancelado'].includes(item.status))
    .sort((a, b) => String(a.dataLimite).localeCompare(String(b.dataLimite)))[0] || null
  const elegibilidadeIndisponivel: ElegibilidadeDocumental = {
    elegivel: false,
    requisitosPendentes: [],
    requisitosRejeitados: [],
    requisitosEmAnalise: [],
    motivos: [estadoChecklist.mensagemGestor || 'A documentação desta nota ainda não está pronta para análise.'],
    totalObrigatorios: 0,
    concluidosObrigatorios: 0,
    pendentesObrigatorios: estadoChecklist.pendentes,
  }
  const checklistIndisponivel = ['sem_politica', 'nao_instanciado', 'erro'].includes(estadoChecklist.estado)
  const elegibilidade = checklistIndisponivel
    ? elegibilidadeIndisponivel
    : calcularElegibilidadeSubmissao(preCessaoVisivel)
  const elegibilidadeAprovacao = checklistIndisponivel
    ? { ...elegibilidadeIndisponivel, motivos: [...elegibilidadeIndisponivel.motivos] }
    : calcularElegibilidadeAprovacao(preCessaoVisivel)
  return {
    notaFiscalId,
    items: [...itensVisiveis, ...earlyItems],
    estadoChecklist,
    preCessao: preCessaoVisivel,
    logisticaAntecipada: earlyItems,
    posCessao: posCessaoVisivel,
    gateLogisticoPreCessao: {
      exigido: gateLogisticoExigido,
      status: classificacaoLogistica.status,
      permitidoSubmissao: gateLogisticoPermitidoSubmissao.permitido,
    },
    entrega: entrega ? {
      id: entrega.id,
      status: entrega.status_entrega,
      dataInicioPrazo: entrega.cessao_efetivada_em || entrega.created_at,
      motivoPendencia: entrega.motivo_pendencia,
      dataEntrega: entrega.data_entrega,
      entregaConfirmadaEm: entrega.entrega_confirmada_em,
    } : null,
    postergacaoCanhoto,
    elegibilidade,
    elegibilidadeAprovacao,
    posCessaoResumo: {
      existe: posCessaoVisivel.length > 0,
      obrigatoriosPendentes: posObrigatoriosPendentes.length,
      status: posStatus,
    },
    resumoOperacional: {
      statusAntecipacao: notaFiscal?.status || 'nao_informado',
      statusLogistico: calcularStatusLogisticoDocumental({
        entregaStatus: entrega?.status_entrega || null,
        nfStatus: notaFiscal?.status || null,
        possuiRequisitosPosCessao: posCessaoVisivel.length > 0,
        possuiDocumentoPosCessaoEnviado: posCessaoVisivel.some((item) => item.versoes.length > 0),
        posCessaoVencida: posStatus === 'vencido',
      }),
      pendenciasPreCessao: preObrigatoriosPendentes.length,
      pendenciasPosCessao: posObrigatoriosPendentes.length,
      pendenciasTotal: preObrigatoriosPendentes.length + posObrigatoriosPendentes.length,
      proximoPrazo: proximoPrazo ? {
        nome: proximoPrazo.nome,
        dataLimite: proximoPrazo.dataLimite,
        statusPrazo: proximoPrazo.statusPrazo,
        prazoDetalhe: proximoPrazo.prazoDetalhe,
        fase: proximoPrazo.fase,
      } : null,
    },
  }
}

function documentoItemEstaAprovado(item: Pick<ChecklistDocumentoItem, 'satisfacaoAprovacao'>) {
  return item.satisfacaoAprovacao.aprovado
}

function requisitosQueBloqueiam(items: ChecklistDocumentoItem[]) {
  return items.filter((item) => item.obrigatorio || item.bloqueiaFluxo)
}

function calcularElegibilidadeSubmissao(items: ChecklistDocumentoItem[]): ElegibilidadeDocumental {
  const mandatory = requisitosQueBloqueiam(items)
  const pending = mandatory.filter((item) => !item.satisfacaoSubmissao.satisfazSubmissao)
  const rejected = mandatory.filter((item) => ['rejeitado', 'ajuste_solicitado'].includes(item.satisfacaoSubmissao.statusAnalise))
  const reviewing = mandatory.filter((item) => item.satisfacaoSubmissao.statusAnalise === 'aguardando_analise')
  return {
    elegivel: pending.length === 0,
    requisitosPendentes: pending.map((item) => item.nome),
    requisitosRejeitados: rejected.map((item) => item.nome),
    requisitosEmAnalise: reviewing.map((item) => item.nome),
    motivos: pending.map((item) => `${item.nome}: ${item.satisfacaoSubmissao.motivoBloqueio || 'requisito documental pendente'}`),
    totalObrigatorios: mandatory.length,
    concluidosObrigatorios: mandatory.length - pending.length,
    pendentesObrigatorios: pending.length,
  }
}

function calcularElegibilidadeAprovacao(items: ChecklistDocumentoItem[]): ElegibilidadeDocumental {
  const mandatory = requisitosQueBloqueiam(items)
  const pending = mandatory.filter((item) => !item.satisfacaoAprovacao.aprovado)
  const rejected = mandatory.filter((item) => ['rejeitado', 'ajuste_solicitado'].includes(item.satisfacaoAprovacao.statusAnalise))
  const reviewing = mandatory.filter((item) => item.satisfacaoAprovacao.statusAnalise === 'aguardando_analise')
  return {
    elegivel: pending.length === 0,
    requisitosPendentes: pending.map((item) => item.nome),
    requisitosRejeitados: rejected.map((item) => item.nome),
    requisitosEmAnalise: reviewing.map((item) => item.nome),
    motivos: pending.map((item) => `${item.nome}: ${item.satisfacaoAprovacao.motivoBloqueio || 'aprovação documental pendente'}`),
    totalObrigatorios: mandatory.length,
    concluidosObrigatorios: mandatory.length - pending.length,
    pendentesObrigatorios: pending.length,
  }
}

export async function listarChecklistDaNota(notaFiscalId: string): Promise<ChecklistDocumento> {
  return carregarChecklist(notaFiscalId)
}

export async function enviarDocumentoDaNota(formData: FormData) {
  const notaFiscalId = String(formData.get('notaFiscalId') || '')
  const requisitoId = String(formData.get('requisitoId') || '')
  const entregaId = String(formData.get('entregaId') || '')
  const envioAntecipado = String(formData.get('envioAntecipado') || '') === 'true'
  const notaFiscalIds = Array.from(new Set(
    String(formData.get('notaFiscalIds') || notaFiscalId)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .concat(notaFiscalId),
  ))
  const arquivo = formData.get('arquivo')
  if (!notaFiscalId || !requisitoId || !(arquivo instanceof File)) return { success: false, message: 'NF, requisito e arquivo sao obrigatorios.' }
  try {
    const client = await createClient()
    const result = envioAntecipado
      ? await uploadDocumentoLogisticoAntecipado({ notaFiscalIds, politicaRequisitoId: requisitoId, arquivo }, client)
      : entregaId
        ? await uploadDocumentoDaEntrega({ notaFiscalId, entregaId, requisitoId, arquivo }, client)
        : await uploadDocumentoDaNota({ notaFiscalId, requisitoId, arquivo }, client)
    const resultMessage = (result as { message?: unknown }).message
    return { success: true, message: typeof resultMessage === 'string' ? resultMessage : 'Documento enviado para analise.', data: result }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel enviar o documento.' }
  }
}

export async function baixarVersaoDocumento(versaoId: string) {
  const supabase = await createClient()
  const { data: version, error } = await supabase.from('documento_versoes').select('id, documento_id, path, nome_original').eq('id', versaoId).maybeSingle()
  if (error || !version) return { success: false, message: 'Versao documental nao encontrada.' }
  const { data: link } = await supabase
    .from('documento_vinculos')
    .select('nota_fiscal_id, nota_fiscal_entrega_id')
    .eq('documento_id', version.documento_id)
    .limit(1)
    .maybeSingle()
  let notaFiscalId = link?.nota_fiscal_id as string | null | undefined
  if (!notaFiscalId && link?.nota_fiscal_entrega_id) {
    const { data: entrega } = await supabase
      .from('nota_fiscal_entregas')
      .select('nota_fiscal_id')
      .eq('id', link.nota_fiscal_entrega_id)
      .maybeSingle()
    notaFiscalId = entrega?.nota_fiscal_id as string | null | undefined
  }
  if (!notaFiscalId) return { success: false, message: 'Vinculo documental invalido.' }
  await requireNotaFiscalAccess(notaFiscalId, supabase)
  try {
    return { success: true, url: await gerarUrlDocumento(version.path), nome: version.nome_original }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel gerar o download.' }
  }
}

export async function analisarVersaoDocumento(versaoId: string, resultado: DocumentoAnaliseResultado, observacoes?: string) {
  const context = await requireGestor()
  const { data, error } = await context.supabase.rpc('analisar_documento_versao', {
    p_documento_versao_id: versaoId,
    p_resultado: resultado,
    p_observacoes: observacoes || null,
    p_dados_estruturados: {},
  })
  if (error) return { success: false, message: error.message }
  await registrarLog({ tipo_evento: 'DOCUMENTO_V2_ANALISADO', entidade_tipo: 'documento_versoes', entidade_id: versaoId, dados_depois: { resultado, observacoes } }).catch(() => {})
  const contextoEvento = await carregarContextoEventoDocumentoVersao(context.supabase, versaoId)
  const aprovado = resultado === 'aprovado'
  await registrarEventoDominio({
    ...contextoEvento,
    tipo_evento: aprovado ? 'documento_aprovado' : 'documento_rejeitado',
    categoria: aprovado ? 'aprovacao' : 'reprovacao',
    descricao: aprovado ? `${contextoEvento.documento_nome ?? 'Documento'} aprovado.` : `${contextoEvento.documento_nome ?? 'Documento'} rejeitado.`,
    metadata: {
      documento: contextoEvento.documento_nome,
      tipo_documento: contextoEvento.documento_tipo,
      numero_versao: contextoEvento.numero_versao,
      resultado,
      motivo_resumido: observacoes ? observacoes.slice(0, 120) : null,
    },
    visibilidade: 'ambos',
    origem: 'analise_documental',
  }, context.supabase)
  revalidatePath('/gestor/documentos')
  if (contextoEvento.nota_fiscal_id) {
    revalidatePath('/gestor/notas-fiscais')
    revalidatePath(`/gestor/notas-fiscais/${contextoEvento.nota_fiscal_id}`)
  }
  return { success: true, data }
}

export async function verificarElegibilidadeDocumental(notaFiscalId: string): Promise<ElegibilidadeDocumental> {
  return (await carregarChecklist(notaFiscalId)).elegibilidadeAprovacao
}

export async function verificarElegibilidadeSubmissaoDocumental(notaFiscalId: string): Promise<ElegibilidadeDocumental> {
  return (await carregarChecklist(notaFiscalId)).elegibilidade
}

import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { projetarDocumentoLogistico } from '@/lib/logistica/central/dominio'
import { normalizarSnapshotPoliticaOperacao } from '@/lib/operacoes/politica-operacao'
import { EMAIL_PROVIDER, enviarEmailOperacional } from '@/lib/email'
import { ehDiaUtilAnbima } from '@/lib/operacoes/calculo'
import { agruparComunicacoes } from './agrupamento'
import { dataCivilSaoPaulo } from './calendario'
import { resolverNomeRemetenteGestora } from './remetente'
import { resolverEtapaAcionavel } from './regua'
import {
  criarGrupoPreview,
  hashTemplate,
  obterTemplatePadrao,
  renderizarComunicacao,
  type TemplateComunicacao,
} from './templates'
import {
  REGUA_FINANCEIRA_PADRAO,
  REGUA_LOGISTICA_PADRAO,
  type ComunicacaoCategoria,
  type GrupoComunicacao,
  type ItemComunicacao,
  type ReguaComunicacao,
} from './tipos'

const MAX_ITENS_RUN = Number(process.env.COMUNICACOES_MAX_ITENS_RUN || 5000)
const MAX_COMUNICACOES_RUN = Number(process.env.COMUNICACOES_MAX_COMUNICACOES_RUN || 500)
const MAX_ITENS_EMAIL = Number(process.env.COMUNICACOES_MAX_ITENS_EMAIL || 100)
const CODIGOS_CTE = new Set(['cte', 'cte_xml', 'cte_pdf_dacte', 'cte_dacte_pdf', 'dacte'])
const CODIGOS_COMPROVANTE = new Set(['canhoto', 'comprovante_entrega', 'comprovante_de_entrega'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ConfigAtiva = {
  id: string
  fundoId: string
  fundoNome: string
  gestoraNome: string
  ativadaEm: string
  logistica: boolean
  cte: boolean
  comprovante: boolean
  financeiro: boolean
  reguaLogistica: ReguaComunicacao
  reguaFinanceira: ReguaComunicacao
  templates: Map<ComunicacaoCategoria, { id: string; template: TemplateComunicacao }>
}

type ResultadoMotor = {
  runId: string | null
  dryRun: boolean
  dataReferencia: string
  encontradas: number
  agrupadas: number
  enviadas: number
  falhas: number
  bloqueadas: number
  ignoradas: number
  grupos?: GrupoComunicacao[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseRegua(value: unknown, fallback: ReguaComunicacao): ReguaComunicacao {
  const raw = asRecord(value)
  const offsets = Array.isArray(raw.offsets) ? raw.offsets.map(Number).filter(Number.isInteger) : fallback.offsets
  return {
    offsets,
    recorrenciaApos: Number(raw.recorrencia_apos ?? raw.recorrenciaApos ?? fallback.recorrenciaApos),
    recorrenciaDias: Number(raw.recorrencia_dias ?? raw.recorrenciaDias ?? fallback.recorrenciaDias),
  }
}

function normalizarCodigo(value: unknown): string {
  return String(value || '').trim().toLowerCase().replaceAll('-', '_')
}

function variantesCnpj(cnpj: string): string[] {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return [cnpj]
  return [digits, `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`]
}

function emailValido(value: unknown): string | null {
  const email = String(value || '').trim().toLowerCase()
  return EMAIL_RE.test(email) ? email : null
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function assertWithinLimit(rows: unknown[] | null, limit: number, context: string): void {
  if ((rows?.length || 0) > limit) throw new Error(`${context} excedeu o limite controlado de ${limit} registros; a execucao foi interrompida sem truncamento.`)
}

function baseUrlAutorizada(): string {
  const candidate = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL
  if (!candidate && process.env.NODE_ENV !== 'production') return 'http://localhost:3001'
  const url = new URL(candidate || '')
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('APP_BASE_URL deve utilizar HTTP ou HTTPS.')
  return url.origin
}

function categoriaPorEtapa(familia: 'LOGISTICA' | 'FINANCEIRO', offset: number): ComunicacaoCategoria {
  if (familia === 'LOGISTICA') return offset < 0 ? 'LOGISTICA_LEMBRETE' : offset === 0 ? 'LOGISTICA_VENCE_HOJE' : 'LOGISTICA_VENCIDO'
  return offset < 0 ? 'FINANCEIRO_LEMBRETE' : offset === 0 ? 'FINANCEIRO_VENCE_HOJE' : 'FINANCEIRO_VENCIDO'
}

async function carregarConfiguracoes(fundoId?: string): Promise<ConfigAtiva[]> {
  const admin = createAdminClient()
  let query = admin
    .from('comunicacao_configuracao_versoes')
    .select('*')
    .eq('status', 'publicada')
    .limit(200)
  if (fundoId) query = query.eq('fundo_id', fundoId)
  const { data: versions, error } = await query
  if (error) throw new Error(`Falha ao carregar configuracoes de comunicacao: ${error.message}`)
  if (!versions?.length) return []
  const configIds = versions.map((row) => row.configuracao_id)
  const fundoIds = [...new Set(versions.map((row) => row.fundo_id))]
  const versionIds = versions.map((row) => row.id)
  const [{ data: roots, error: rootError }, { data: funds, error: fundError }, { data: templates, error: templateError }] = await Promise.all([
    admin.from('comunicacao_configuracoes').select('id, fundo_id, pausada').in('id', configIds),
    admin.from('fundos').select('id, nome, gestora_nome').in('id', fundoIds).eq('ativo', true),
    admin.from('comunicacao_template_versoes').select('*').in('configuracao_versao_id', versionIds),
  ])
  if (rootError || fundError || templateError) throw new Error(`Falha ao resolver configuracao publicada: ${rootError?.message || fundError?.message || templateError?.message}`)
  const rootsMap = new Map((roots || []).map((row) => [row.id, row]))
  const fundsMap = new Map((funds || []).map((row) => [row.id, row]))
  return versions.flatMap((row) => {
    const root = rootsMap.get(row.configuracao_id)
    if (!root || root.pausada || !row.ativada_em) return []
    const templateMap = new Map<ComunicacaoCategoria, { id: string; template: TemplateComunicacao }>()
    for (const template of (templates || []).filter((candidate) => candidate.configuracao_versao_id === row.id)) {
      const categoria = template.categoria as ComunicacaoCategoria
      const resolved = template.modo === 'personalizado'
        ? { assunto: template.assunto || '', html: template.corpo_html || '', texto: template.corpo_texto || '' }
        : obterTemplatePadrao(categoria)
      templateMap.set(categoria, { id: template.id, template: resolved })
    }
    const fund = fundsMap.get(row.fundo_id)
    if (!fund) return []
    return [{
      id: row.id,
      fundoId: row.fundo_id,
      fundoNome: fund?.nome || row.fundo_id,
      gestoraNome: resolverNomeRemetenteGestora(fund?.gestora_nome),
      ativadaEm: row.ativada_em.slice(0, 10),
      logistica: row.logistica_habilitada,
      cte: row.cte_habilitado,
      comprovante: row.comprovante_habilitado,
      financeiro: row.financeiro_habilitado,
      reguaLogistica: parseRegua(row.regua_logistica, REGUA_LOGISTICA_PADRAO),
      reguaFinanceira: parseRegua(row.regua_financeira, REGUA_FINANCEIRA_PADRAO),
      templates: templateMap,
    } satisfies ConfigAtiva]
  })
}

async function carregarEstagios(configs: ConfigAtiva[]) {
  if (!configs.length) return new Map<string, Set<string>>()
  const admin = createAdminClient()
  const fundoIds = configs.map((config) => config.fundoId)
  const { data: stages, error } = await admin.from('comunicacao_item_estagios').select('item_key, etapa, comunicacao_id, status').in('fundo_id', fundoIds).limit((MAX_ITENS_RUN * 2) + 1)
  if (error) throw new Error(`Falha ao carregar idempotencia do motor: ${error.message}`)
  assertWithinLimit(stages, MAX_ITENS_RUN * 2, 'Historico de estagios')
  const communicationIds = [...new Set((stages || []).map((row) => row.comunicacao_id).filter((value): value is string => Boolean(value)))]
  const statusMap = new Map<string, string>()
  if (communicationIds.length) {
    const { data: communications, error: communicationError } = await admin.from('comunicacoes').select('id, status').in('id', communicationIds)
    if (communicationError) throw new Error(`Falha ao carregar comunicacoes existentes: ${communicationError.message}`)
    for (const row of communications || []) statusMap.set(row.id, row.status)
  }
  const result = new Map<string, Set<string>>()
  for (const row of stages || []) {
    if (row.comunicacao_id && statusMap.get(row.comunicacao_id) === 'BLOQUEADA') continue
    const set = result.get(row.item_key) || new Set<string>()
    set.add(row.etapa)
    result.set(row.item_key, set)
  }
  return result
}

async function carregarCcGestores(fundoIds: string[]) {
  const admin = createAdminClient()
  const { data: links, error } = await admin.from('usuario_fundos').select('fundo_id, usuario_id').in('fundo_id', fundoIds).eq('status', 'ativo')
  if (error) throw new Error(`Falha ao resolver gestores por fundo: ${error.message}`)
  const typedLinks = (links || []) as unknown as Array<{ fundo_id: string; usuario_id: string }>
  const ids = [...new Set(typedLinks.map((row) => row.usuario_id))]
  const profiles = ids.length ? await admin.from('profiles').select('id, email, status, role').in('id', ids) : { data: [], error: null }
  if (profiles.error) throw new Error(`Falha ao resolver contatos dos gestores: ${profiles.error.message}`)
  const profileMap = new Map((profiles.data || []).filter((row) => row.status === 'ativo' && row.role === 'gestor').map((row) => [row.id, emailValido(row.email)]))
  const result = new Map<string, string[]>()
  for (const link of typedLinks) {
    const email = profileMap.get(link.usuario_id)
    if (!email) continue
    const list = result.get(link.fundo_id) || []
    if (!list.includes(email)) list.push(email)
    result.set(link.fundo_id, list)
  }
  return result
}

async function projetarItensLogisticos(configs: ConfigAtiva[], dataReferencia: string, stages: Map<string, Set<string>>): Promise<ItemComunicacao[]> {
  const enabled = configs.filter((config) => config.logistica && (config.cte || config.comprovante))
  if (!enabled.length) return []
  const admin = createAdminClient()
  const configMap = new Map(enabled.map((config) => [config.fundoId, config]))
  const { data: links, error: linkError } = await admin.from('cedente_fundos').select('id, cedente_id, fundo_id').in('fundo_id', enabled.map((config) => config.fundoId)).eq('status', 'ativo').limit(MAX_ITENS_RUN + 1)
  if (linkError) throw new Error(`Falha ao carregar vinculos logisticos: ${linkError.message}`)
  assertWithinLimit(links, MAX_ITENS_RUN, 'Vinculos logisticos')
  const linkIds = (links || []).map((row) => row.id)
  if (!linkIds.length) return []
  const { data: operations, error: operationError } = await admin.from('operacoes').select('id, cedente_id, cedente_fundo_id, status, cessao_efetivada_em, aprovado_em, politica_snapshot').in('cedente_fundo_id', linkIds).in('status', ['em_andamento', 'inadimplente', 'liquidada']).limit(MAX_ITENS_RUN + 1)
  if (operationError) throw new Error(`Falha ao carregar operacoes logisticas: ${operationError.message}`)
  assertWithinLimit(operations, MAX_ITENS_RUN, 'Operacoes logisticas')
  const operationIds = (operations || []).map((row) => row.id)
  if (!operationIds.length) return []
  const { data: deliveries, error: deliveryError } = await admin.from('nota_fiscal_entregas').select('*').in('operacao_id', operationIds).limit(MAX_ITENS_RUN + 1)
  if (deliveryError) throw new Error(`Falha ao carregar entregas logisticas: ${deliveryError.message}`)
  assertWithinLimit(deliveries, MAX_ITENS_RUN, 'Entregas logisticas')
  if (!deliveries?.length) return []
  const deliveryIds = deliveries.map((row) => row.id)
  const noteIds = [...new Set(deliveries.map((row) => row.nota_fiscal_id))]
  const [{ data: requirements, error: requirementError }, { data: notes, error: noteError }, { data: postponements, error: postponementError }] = await Promise.all([
    admin.from('documento_requisito_instancias').select('*').in('nota_fiscal_entrega_id', deliveryIds).limit(MAX_ITENS_RUN + 1),
    admin.from('notas_fiscais').select('id, numero_nf, cedente_id, fundo_id, razao_social_destinatario').in('id', noteIds),
    admin.from('nota_fiscal_entrega_postergacoes_canhoto').select('*').in('nota_fiscal_entrega_id', deliveryIds).eq('utilizada', true),
  ])
  if (requirementError || noteError || postponementError) throw new Error(`Falha ao carregar requisitos logisticos: ${requirementError?.message || noteError?.message || postponementError?.message}`)
  assertWithinLimit(requirements, MAX_ITENS_RUN, 'Requisitos logisticos')
  const relevant = (requirements || []).filter((row) => CODIGOS_CTE.has(normalizarCodigo(row.tipo_documento_codigo_snapshot)) || CODIGOS_COMPROVANTE.has(normalizarCodigo(row.tipo_documento_codigo_snapshot)))
  const documentIds = [...new Set(relevant.map((row) => row.documento_id).filter((value): value is string => Boolean(value)))]
  const versionsResult = documentIds.length ? await admin.from('documento_versoes').select('id, documento_id, numero_versao, nome_original, status, enviado_em').in('documento_id', documentIds).limit(MAX_ITENS_RUN + 1) : { data: [], error: null }
  if (versionsResult.error) throw new Error(`Falha ao carregar versoes logisticas: ${versionsResult.error.message}`)
  assertWithinLimit(versionsResult.data, MAX_ITENS_RUN, 'Versoes documentais logisticas')
  const versionIds = (versionsResult.data || []).map((row) => row.id)
  const analysesResult = versionIds.length ? await admin.from('documento_analises').select('id, documento_versao_id, resultado, analisado_em, analisado_por, observacoes').in('documento_versao_id', versionIds).limit(MAX_ITENS_RUN + 1) : { data: [], error: null }
  if (analysesResult.error) throw new Error(`Falha ao carregar analises logisticas: ${analysesResult.error.message}`)
  assertWithinLimit(analysesResult.data, MAX_ITENS_RUN, 'Analises documentais logisticas')
  const cedenteIds = [...new Set((links || []).map((row) => row.cedente_id))]
  const { data: cedentes, error: cedenteError } = await admin.from('cedentes').select('id, razao_social, email_comercial').in('id', cedenteIds)
  if (cedenteError) throw new Error(`Falha ao resolver contatos dos cedentes: ${cedenteError.message}`)
  const linkMap = new Map((links || []).map((row) => [row.id, row]))
  const operationMap = new Map((operations || []).map((row) => [row.id, row]))
  const noteMap = new Map((notes || []).map((row) => [row.id, row]))
  const cedenteMap = new Map((cedentes || []).map((row) => [row.id, row]))
  const postponementMap = new Map((postponements || []).map((row) => [row.nota_fiscal_entrega_id, row]))
  const baseUrl = baseUrlAutorizada()
  const items: ItemComunicacao[] = []

  for (const requirement of relevant) {
    const delivery = deliveries.find((row) => row.id === requirement.nota_fiscal_entrega_id)
    if (!delivery) continue
    const operation = operationMap.get(delivery.operacao_id)
    const link = operation?.cedente_fundo_id ? linkMap.get(operation.cedente_fundo_id) : null
    const config = link ? configMap.get(link.fundo_id) : null
    const note = noteMap.get(delivery.nota_fiscal_id)
    const cedente = note ? cedenteMap.get(note.cedente_id) : null
    if (!config || !note || !cedente) continue
    const code = normalizarCodigo(requirement.tipo_documento_codigo_snapshot)
    const family = CODIGOS_CTE.has(code) ? 'cte' : 'comprovante_entrega'
    if ((family === 'cte' && !config.cte) || (family === 'comprovante_entrega' && !config.comprovante)) continue
    const postponement = family === 'comprovante_entrega' ? postponementMap.get(delivery.id) : null
    const versions = (versionsResult.data || []).filter((row) => row.documento_id === requirement.documento_id).map((row) => ({
      id: row.id, documentoId: row.documento_id, numero: row.numero_versao, nome: row.nome_original, status: row.status, enviadoEm: row.enviado_em,
    }))
    const analyses = (analysesResult.data || []).filter((row) => versions.some((version) => version.id === row.documento_versao_id)).map((row) => ({
      id: row.id, versaoId: row.documento_versao_id, resultado: row.resultado, analisadoEm: row.analisado_em, analisadoPor: row.analisado_por,
    }))
    const projected = projetarDocumentoLogistico({
      familia: family,
      documentoId: requirement.documento_id,
      versaoAprovadaId: requirement.versao_aprovada_id,
      obrigatorio: requirement.obrigatorio,
      prazoOriginal: requirement.prazo_limite || (family === 'cte' ? delivery.data_limite_cte : delivery.data_limite_canhoto),
      novaPrevisao: postponement?.nova_previsao_upload_canhoto || null,
      versoes: versions,
      analises: analyses,
    }, operation?.cessao_efetivada_em || operation?.aprovado_em || null)
    if (!projected.obrigatorio || projected.status === 'APROVADO' || projected.status === 'AGUARDANDO_ANALISE' || !projected.prazoEfetivo) continue
    const itemKey = `logistica:requisito:${requirement.id}`
    let selectedStage
    let category: ComunicacaoCategoria = 'LOGISTICA_LEMBRETE'
    let rejectionVersionId: string | null = null
    let rejectionReason: string | null = null
    if (projected.status === 'REJEITADO' && projected.versaoAtualId) {
      const key = `REJEITADO:${projected.versaoAtualId}`
      if (!stages.get(itemKey)?.has(key)) {
        selectedStage = { chave: key, offset: 1, dataObrigacao: projected.prazoEfetivo, dataNominal: dataReferencia, dataEfetiva: dataReferencia, motivoAjuste: null, recorrente: false }
        category = 'LOGISTICA_REJEITADO'
        rejectionVersionId = projected.versaoAtualId
        const latest = (analysesResult.data || []).filter((row) => row.documento_versao_id === projected.versaoAtualId && row.resultado === 'rejeitado').sort((a, b) => b.analisado_em.localeCompare(a.analisado_em))[0]
        rejectionReason = latest?.observacoes?.slice(0, 300) || 'Documento rejeitado na analise. Consulte o portal.'
      }
    }
    if (!selectedStage) {
      selectedStage = resolverEtapaAcionavel({ dataObrigacao: projected.prazoEfetivo, dataExecucao: dataReferencia, ativadaEm: config.ativadaEm, regua: config.reguaLogistica, etapasComunicadas: stages.get(itemKey) })
      if (!selectedStage) continue
      category = categoriaPorEtapa('LOGISTICA', selectedStage.offset)
    }
    items.push({
      familia: 'LOGISTICA', fundoId: config.fundoId, fundoNome: config.fundoNome,
      itemKey, entidadeTipo: 'documento_requisito_instancia', entidadeId: requirement.id,
      notaFiscalId: note.id, operacaoId: operation?.id || null, numeroNf: note.numero_nf,
      cedenteNome: cedente.razao_social, sacadoNome: note.razao_social_destinatario,
      destinatarioNome: cedente.razao_social, destinatarioEmail: emailValido(cedente.email_comercial),
      dataObrigacao: projected.prazoEfetivo, etapa: selectedStage, categoria: category,
      valor: null, tipoDocumento: family === 'cte' ? 'CT-e / DACTE' : 'Comprovante de entrega',
      motivoRejeicao: rejectionReason, prazoOriginal: projected.prazoOriginal,
      novaPrevisao: projected.novaPrevisao, linkPortal: `${baseUrl}/cedente/notas-fiscais/${note.id}`,
      rejeicaoVersaoId: rejectionVersionId, critico: category === 'LOGISTICA_REJEITADO' || selectedStage.offset > 0,
    })
    if (items.length >= MAX_ITENS_RUN) break
  }
  return items
}

async function projetarItensFinanceiros(configs: ConfigAtiva[], dataReferencia: string, stages: Map<string, Set<string>>): Promise<ItemComunicacao[]> {
  const enabled = configs.filter((config) => config.financeiro)
  if (!enabled.length) return []
  const admin = createAdminClient()
  const configMap = new Map(enabled.map((config) => [config.fundoId, config]))
  const { data: links, error: linkError } = await admin.from('cedente_fundos').select('id, cedente_id, fundo_id').in('fundo_id', enabled.map((config) => config.fundoId)).eq('status', 'ativo').limit(MAX_ITENS_RUN + 1)
  if (linkError) throw new Error(`Falha ao carregar vinculos financeiros: ${linkError.message}`)
  assertWithinLimit(links, MAX_ITENS_RUN, 'Vinculos financeiros')
  const linkIds = (links || []).map((row) => row.id)
  if (!linkIds.length) return []
  const { data: operations, error: operationError } = await admin.from('operacoes').select('id, cedente_id, cedente_fundo_id, status, aceite_sacado_exigido, politica_snapshot').in('cedente_fundo_id', linkIds).in('status', ['em_andamento', 'inadimplente']).limit(MAX_ITENS_RUN + 1)
  if (operationError) throw new Error(`Falha ao carregar obrigacoes financeiras: ${operationError.message}`)
  assertWithinLimit(operations, MAX_ITENS_RUN, 'Operacoes financeiras')
  const operationIds = (operations || []).map((row) => row.id)
  if (!operationIds.length) return []
  const { data: junctions, error: junctionError } = await admin.from('operacoes_nfs').select('operacao_id, nota_fiscal_id').in('operacao_id', operationIds).limit(MAX_ITENS_RUN + 1)
  if (junctionError) throw new Error(`Falha ao carregar titulos das operacoes: ${junctionError.message}`)
  assertWithinLimit(junctions, MAX_ITENS_RUN, 'Titulos financeiros')
  const noteIds = [...new Set((junctions || []).map((row) => row.nota_fiscal_id))]
  const [{ data: notes, error: noteError }, { data: cedentes, error: cedenteError }] = await Promise.all([
    admin.from('notas_fiscais').select('id, numero_nf, cedente_id, fundo_id, status, data_vencimento, valor_bruto, cnpj_destinatario, razao_social_destinatario').in('id', noteIds).not('status', 'in', '(liquidada,cancelada)'),
    admin.from('cedentes').select('id, razao_social, email_comercial').in('id', [...new Set((links || []).map((row) => row.cedente_id))]),
  ])
  if (noteError || cedenteError) throw new Error(`Falha ao carregar dados financeiros: ${noteError?.message || cedenteError?.message}`)
  const cnpjs = [...new Set((notes || []).map((row) => row.cnpj_destinatario.replace(/\D/g, '')))]
  const cnpjVariants = [...new Set(cnpjs.flatMap(variantesCnpj))]
  const { data: sacados, error: sacadoError } = cnpjVariants.length ? await admin.from('sacados').select('cnpj, razao_social, email').in('cnpj', cnpjVariants) : { data: [], error: null }
  if (sacadoError) throw new Error(`Falha ao resolver contatos dos sacados: ${sacadoError.message}`)
  const linkMap = new Map((links || []).map((row) => [row.id, row]))
  const operationMap = new Map((operations || []).map((row) => [row.id, row]))
  const noteMap = new Map((notes || []).map((row) => [row.id, row]))
  const cedenteMap = new Map((cedentes || []).map((row) => [row.id, row]))
  const sacadoMap = new Map((sacados || []).map((row) => [row.cnpj.replace(/\D/g, ''), row]))
  const baseUrl = baseUrlAutorizada()
  const items: ItemComunicacao[] = []
  for (const junction of junctions || []) {
    const operation = operationMap.get(junction.operacao_id)
    const note = noteMap.get(junction.nota_fiscal_id)
    const link = operation?.cedente_fundo_id ? linkMap.get(operation.cedente_fundo_id) : null
    const config = link ? configMap.get(link.fundo_id) : null
    const cedente = note ? cedenteMap.get(note.cedente_id) : null
    if (!operation || !note || !config || !cedente) continue
    const itemKey = `financeiro:nf:${note.id}`
    const selectedStage = resolverEtapaAcionavel({ dataObrigacao: note.data_vencimento, dataExecucao: dataReferencia, ativadaEm: config.ativadaEm, regua: config.reguaFinanceira, etapasComunicadas: stages.get(itemKey) })
    if (!selectedStage) continue
    const snapshot = normalizarSnapshotPoliticaOperacao(operation.politica_snapshot)
    const sacadoParticipa = operation.aceite_sacado_exigido ?? snapshot.aceiteSacadoObrigatorio
    const sacado = sacadoMap.get(note.cnpj_destinatario.replace(/\D/g, ''))
    const recipientName = sacadoParticipa ? (sacado?.razao_social || note.razao_social_destinatario) : cedente.razao_social
    const recipientEmail = sacadoParticipa ? emailValido(sacado?.email) : emailValido(cedente.email_comercial)
    const category = categoriaPorEtapa('FINANCEIRO', selectedStage.offset)
    items.push({
      familia: 'FINANCEIRO', fundoId: config.fundoId, fundoNome: config.fundoNome,
      itemKey, entidadeTipo: 'nota_fiscal', entidadeId: note.id, notaFiscalId: note.id,
      operacaoId: operation.id, numeroNf: note.numero_nf, cedenteNome: cedente.razao_social,
      sacadoNome: note.razao_social_destinatario, destinatarioNome: recipientName,
      destinatarioEmail: recipientEmail, dataObrigacao: note.data_vencimento,
      etapa: selectedStage, categoria: category, valor: Number(note.valor_bruto), tipoDocumento: null,
      motivoRejeicao: null, prazoOriginal: null, novaPrevisao: null,
      linkPortal: sacadoParticipa ? `${baseUrl}/sacado/pagamentos` : `${baseUrl}/cedente/operacoes/${operation.id}`,
      rejeicaoVersaoId: null, critico: selectedStage.offset > 0,
    })
    if (items.length >= MAX_ITENS_RUN) break
  }
  return items
}

function templateDoGrupo(configs: ConfigAtiva[], group: GrupoComunicacao) {
  const config = configs.find((item) => item.id && item.fundoId === group.fundoId)
  const template = config?.templates.get(group.categoria)
  if (!config || !template) throw new Error(`Template ${group.categoria} nao configurado para o fundo.`)
  return { config, ...template }
}

function idempotencyKey(group: GrupoComunicacao): string {
  const items = group.itens.map((item) => `${item.itemKey}:${item.etapa.chave}`).sort()
  return hash(JSON.stringify([group.fundoId, group.familia, group.dataEfetiva, items]))
}

async function persistirGrupo(input: { group: GrupoComunicacao; configs: ConfigAtiva[]; runId: string; cc: string[] }) {
  const admin = createAdminClient()
  const { config, id: templateId, template } = templateDoGrupo(input.configs, input.group)
  const rendered = renderizarComunicacao({
    ...input.group,
    itens: input.group.itens.slice(0, MAX_ITENS_EMAIL),
  }, template)
  const key = idempotencyKey(input.group)
  const { data: existing } = await admin.from('comunicacoes').select('id, status').eq('idempotency_key', key).maybeSingle()
  if (existing) {
    if (existing.status === 'BLOQUEADA' && input.group.destinatarioEmail) {
      await admin.from('comunicacoes').update({
        status: 'PENDENTE', destinatario_email: input.group.destinatarioEmail,
        destinatario_hash: hash(input.group.destinatarioEmail), bloqueio_motivo: null,
        atualizada_em: new Date().toISOString(),
      }).eq('id', existing.id).eq('status', 'BLOQUEADA')
    }
    return existing.id
  }
  const blocked = !input.group.destinatarioEmail
  const messageId = `<${key.slice(0, 40)}@comunicacoes.bw-antecipa>`
  const { data, error } = await admin.rpc('registrar_comunicacao_operacional', {
    p_comunicacao: {
      fundo_id: input.group.fundoId, configuracao_versao_id: config.id, template_versao_id: templateId,
      execucao_id: input.runId, familia: input.group.familia, categoria: input.group.categoria,
      status: blocked ? 'BLOQUEADA' : 'PENDENTE', remetente_nome: config.gestoraNome,
      destinatario_nome: input.group.destinatarioNome,
      destinatario_email: input.group.destinatarioEmail || '', destinatario_hash: input.group.destinatarioEmail ? hash(input.group.destinatarioEmail) : '',
      copias: input.cc, assunto: rendered.assunto, corpo_html: rendered.html, corpo_texto: rendered.texto,
      conteudo_hash: rendered.hash, message_id: messageId, idempotency_key: key,
      data_efetiva: input.group.dataEfetiva, bloqueio_motivo: blocked ? 'Contato canonico sem e-mail valido.' : '',
    },
    p_itens: input.group.itens.map((item) => ({
      item_key: item.itemKey, entidade_tipo: item.entidadeTipo, entidade_id: item.entidadeId || '',
      nota_fiscal_id: item.notaFiscalId || '', operacao_id: item.operacaoId || '', etapa: item.etapa.chave,
      data_obrigacao: item.dataObrigacao, data_nominal: item.etapa.dataNominal,
      data_efetiva: item.etapa.dataEfetiva, motivo_ajuste: item.etapa.motivoAjuste || '',
      rejeicao_versao_id: item.rejeicaoVersaoId || '',
      snapshot: { numero_nf: item.numeroNf, tipo_documento: item.tipoDocumento, valor: item.valor, prazo_original: item.prazoOriginal, nova_previsao: item.novaPrevisao },
    })),
  })
  if (error) throw new Error(`Falha ao registrar comunicacao idempotente: ${error.message}`)
  return data
}

async function processarEnvios() {
  const admin = createAdminClient()
  await admin.from('comunicacoes').update({ status: 'FALHA', atualizada_em: new Date().toISOString() }).eq('status', 'PROCESSANDO').lt('atualizada_em', new Date(Date.now() - 30 * 60_000).toISOString())
  const { data: rows, error } = await admin.from('comunicacoes').select('*').in('status', ['PENDENTE', 'FALHA']).order('criada_em').limit(MAX_COMUNICACOES_RUN)
  if (error) throw new Error(`Falha ao carregar fila de comunicacoes: ${error.message}`)
  let enviadas = 0
  let falhas = 0
  for (const row of rows || []) {
    const { count } = await admin.from('comunicacao_tentativas').select('id', { count: 'exact', head: true }).eq('comunicacao_id', row.id)
    let attempt = (count || 0) + 1
    let success = false
    while (attempt <= 3 && !success) {
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt - 1)))
      const { error: attemptError } = await admin.from('comunicacao_tentativas').insert({
        comunicacao_id: row.id,
        numero_tentativa: attempt,
        status: 'PROCESSANDO',
        provider: EMAIL_PROVIDER,
      })
      if (attemptError) break
      await admin.from('comunicacoes').update({ status: 'PROCESSANDO', atualizada_em: new Date().toISOString() }).eq('id', row.id)
      const result = await enviarEmailOperacional({
        to: row.destinatario_email || '', subject: row.assunto, html: row.corpo_html, text: row.corpo_texto,
        cc: Array.isArray(row.copias) ? row.copias.map(String) : [], messageId: row.message_id, idempotencyKey: row.idempotency_key,
        fromName: resolverNomeRemetenteGestora(row.remetente_nome),
      })
      const now = new Date().toISOString()
      await admin.from('comunicacao_tentativas').update({
        status: result.success ? 'ENVIADA' : 'FALHA', provider_id: result.providerId,
        erro_codigo: result.errorCode, erro_sanitizado: result.errorMessage, finalizada_em: now,
      }).eq('comunicacao_id', row.id).eq('numero_tentativa', attempt)
      if (result.success) {
        success = true
        enviadas += 1
        await Promise.all([
          admin.from('comunicacoes').update({ status: 'ENVIADA', provider_id: result.providerId, enviada_em: now, atualizada_em: now }).eq('id', row.id),
          admin.from('comunicacao_item_estagios').update({ status: 'COMUNICADO', comunicada_em: now }).eq('comunicacao_id', row.id),
        ])
      } else {
        await admin.from('comunicacoes').update({ status: 'FALHA', atualizada_em: now }).eq('id', row.id)
        if (result.errorCode === 'EMAIL_DISABLED') break
        attempt += 1
      }
    }
    if (!success) falhas += 1
  }
  return { enviadas, falhas }
}

export async function executarMotorComunicacoes(input: { dryRun?: boolean; dataReferencia?: string; fundoId?: string } = {}): Promise<ResultadoMotor> {
  const started = Date.now()
  const dataReferencia = input.dataReferencia || dataCivilSaoPaulo()
  if (!ehDiaUtilAnbima(dataReferencia)) return { runId: null, dryRun: Boolean(input.dryRun), dataReferencia, encontradas: 0, agrupadas: 0, enviadas: 0, falhas: 0, bloqueadas: 0, ignoradas: 0, grupos: input.dryRun ? [] : undefined }
  const configs = await carregarConfiguracoes(input.fundoId)
  if (!configs.length) return { runId: null, dryRun: Boolean(input.dryRun), dataReferencia, encontradas: 0, agrupadas: 0, enviadas: 0, falhas: 0, bloqueadas: 0, ignoradas: 0, grupos: input.dryRun ? [] : undefined }
  const stages = await carregarEstagios(configs)
  const [logistics, financial] = await Promise.all([
    projetarItensLogisticos(configs, dataReferencia, stages),
    projetarItensFinanceiros(configs, dataReferencia, stages),
  ])
  const allItems = [...logistics, ...financial]
  const allGroups = agruparComunicacoes(allItems)
  if (!input.dryRun && allGroups.length > MAX_COMUNICACOES_RUN) throw new Error(`A execucao encontrou ${allGroups.length} comunicacoes agrupadas e foi interrompida sem truncamento.`)
  const groups = allGroups.slice(0, MAX_COMUNICACOES_RUN)
  if (input.dryRun) return { runId: null, dryRun: true, dataReferencia, encontradas: allItems.length, agrupadas: allGroups.length, enviadas: 0, falhas: 0, bloqueadas: allGroups.filter((group) => !group.destinatarioEmail).length, ignoradas: Math.max(0, allGroups.length - groups.length), grupos: groups }

  const admin = createAdminClient()
  const { data: runId, error: runError } = await admin.rpc('iniciar_execucao_comunicacoes', { p_data_referencia: dataReferencia })
  if (runError) throw new Error(`Falha ao iniciar execucao protegida: ${runError.message}`)
  if (!runId) return { runId: null, dryRun: false, dataReferencia, encontradas: allItems.length, agrupadas: groups.length, enviadas: 0, falhas: 0, bloqueadas: 0, ignoradas: groups.length }
  const ccByFund = await carregarCcGestores(configs.map((config) => config.fundoId))
  let blocked = 0
  try {
    for (const group of groups) {
      const cc = group.itens.some((item) => item.critico) ? (ccByFund.get(group.fundoId) || []).filter((email) => email !== group.destinatarioEmail) : []
      await persistirGrupo({ group, configs, runId, cc })
      if (!group.destinatarioEmail) blocked += 1
    }
    const sent = await processarEnvios()
    await admin.from('comunicacao_execucoes').update({
      status: 'CONCLUIDA', encontrada: allItems.length, agrupada: groups.length,
      enviada: sent.enviadas, falha: sent.falhas, bloqueada: blocked, finalizada_em: new Date().toISOString(),
    }).eq('id', runId)
    console.info('[comunicacoes] execucao concluida', { runId, fundos: configs.length, encontrada: allItems.length, agrupada: groups.length, enviada: sent.enviadas, falha: sent.falhas, bloqueada: blocked, duracaoMs: Date.now() - started })
    return { runId, dryRun: false, dataReferencia, encontradas: allItems.length, agrupadas: groups.length, enviadas: sent.enviadas, falhas: sent.falhas, bloqueadas: blocked, ignoradas: Math.max(0, allItems.length - MAX_ITENS_RUN) }
  } catch (error) {
    await admin.from('comunicacao_execucoes').update({ status: 'FALHA', erro_sanitizado: error instanceof Error ? error.message.slice(0, 300) : 'Falha inesperada.', finalizada_em: new Date().toISOString() }).eq('id', runId)
    throw error
  }
}

export async function enviarTesteComunicacao(input: { familia: 'LOGISTICA' | 'FINANCEIRO'; email: string; gestoraNome: string; categoria?: ComunicacaoCategoria }) {
  const email = emailValido(input.email)
  if (!email) throw new Error('Informe um e-mail de teste valido.')
  const group = criarGrupoPreview(input.familia)
  const categoria = input.categoria || group.categoria
  const template = obterTemplatePadrao(categoria)
  const rendered = renderizarComunicacao({ ...group, categoria, destinatarioEmail: email }, template)
  return enviarEmailOperacional({
    to: email,
    subject: `[TESTE] ${rendered.assunto}`,
    html: rendered.html,
    text: rendered.texto,
    idempotencyKey: `teste-${randomUUID()}`,
    fromName: resolverNomeRemetenteGestora(input.gestoraNome),
  })
}

export function templatesPadraoParaPersistencia() {
  return (Object.keys({
    LOGISTICA_LEMBRETE: true, LOGISTICA_VENCE_HOJE: true, LOGISTICA_VENCIDO: true, LOGISTICA_REJEITADO: true,
    FINANCEIRO_LEMBRETE: true, FINANCEIRO_VENCE_HOJE: true, FINANCEIRO_VENCIDO: true,
  }) as ComunicacaoCategoria[]).map((categoria) => ({ categoria, template: obterTemplatePadrao(categoria), hash: hashTemplate(obterTemplatePadrao(categoria)) }))
}

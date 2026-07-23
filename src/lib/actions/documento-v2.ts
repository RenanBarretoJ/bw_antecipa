'use server'

import { createClient } from '@/lib/supabase/server'
import { requireGestor, requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { registrarLog } from './auditoria'
import { instanciarRequisitosDaNota } from '@/lib/documentos-v2/requisitos'
import { gerarUrlDocumento } from '@/lib/documentos-v2/storage'
import { uploadDocumentoDaEntrega, uploadDocumentoDaNota } from '@/lib/documentos-v2/upload'
import { normalizarCodigoDocumentoCatalogo } from '@/lib/documentos-v2/tipos'
import { calcularPrazoDocumento, type StatusPrazoDocumento } from '@/lib/documentos-v2/prazos'
import { calcularStatusLogisticoDocumental, type StatusLogisticoResumo } from '@/lib/documentos-v2/resumo-operacional'
import type { DocumentoAnaliseResultado } from '@/lib/types/domain'

export interface ChecklistDocumentoItem {
  id: string
  codigo: string
  nome: string
  descricao: string
  fase: 'pre_cessao' | 'pos_cessao'
  escopo: string
  obrigatorio: boolean
  status: string
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
  preCessao: ChecklistDocumentoItem[]
  posCessao: ChecklistDocumentoItem[]
  entrega: { id: string; status: string; dataInicioPrazo: string | null; motivoPendencia: string | null; dataEntrega: string | null; entregaConfirmadaEm: string | null } | null
  elegibilidade: ElegibilidadeDocumental
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
}

async function carregarChecklist(notaFiscalId: string): Promise<ChecklistDocumento> {
  const supabase = await createClient()
  const context = await requireNotaFiscalAccess(notaFiscalId, supabase)
  if (context.profile.role === 'cedente' || context.profile.role === 'gestor') {
    await instanciarRequisitosDaNota(notaFiscalId, supabase)
  }

  const [{ data: nfData }, { data: entregaData }] = await Promise.all([
    supabase
      .from('notas_fiscais')
      .select('id, status')
      .eq('id', notaFiscalId)
      .maybeSingle(),
    supabase
    .from('nota_fiscal_entregas')
    .select('id, status_entrega, cessao_efetivada_em, data_entrega, entrega_confirmada_em, motivo_pendencia, created_at')
    .eq('nota_fiscal_id', notaFiscalId)
    .not('status_entrega', 'eq', 'nao_aplicavel')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle(),
  ])
  const notaFiscal = nfData as { id: string; status: string } | null
  const entrega = entregaData as { id: string; status_entrega: string; cessao_efetivada_em: string | null; data_entrega: string | null; entrega_confirmada_em: string | null; motivo_pendencia: string | null; created_at: string } | null

  const { data: instances, error } = await supabase
    .from('documento_requisito_instancias')
    .select('id, documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, obrigatorio, status, documento_id, versao_aprovada_id, nota_fiscal_id, nota_fiscal_entrega_id, prazo_limite, quantidade_minima_snapshot, formatos_aceitos_snapshot')
    .or([
      `nota_fiscal_id.eq.${notaFiscalId}`,
      entrega?.id ? `nota_fiscal_entrega_id.eq.${entrega.id}` : '',
    ].filter(Boolean).join(','))
    .order('id')
  if (error) throw new Error(`Erro ao carregar checklist: ${error.message}`)

  const rows = (instances || []) as Array<{
    id: string; documento_tipo_id: string | null; tipo_documento_codigo_snapshot: string; escopo_snapshot: string; obrigatorio: boolean; status: string; documento_id: string | null; versao_aprovada_id: string | null; nota_fiscal_id: string | null; nota_fiscal_entrega_id: string | null; prazo_limite: string | null; quantidade_minima_snapshot: number; formatos_aceitos_snapshot: string[]
  }>
  const typeIds = rows.map((row) => row.documento_tipo_id).filter(Boolean) as string[]
  const typeCodes = Array.from(new Set(rows.map((row) => normalizarCodigoDocumentoCatalogo(row.tipo_documento_codigo_snapshot))))
  const docIds = rows.map((row) => row.documento_id).filter(Boolean) as string[]
  const [typesResult, versionsResult] = await Promise.all([
    typeIds.length || typeCodes.length
      ? supabase.from('documento_tipos').select('id, codigo, nome').or([
        typeIds.length ? `id.in.(${typeIds.join(',')})` : '',
        typeCodes.length ? `codigo.in.(${typeCodes.join(',')})` : '',
      ].filter(Boolean).join(','))
      : Promise.resolve({ data: [], error: null }),
    docIds.length ? supabase.from('documento_versoes').select('id, documento_id, numero_versao, status, nome_original, sha256, enviado_por, enviado_em, created_at').in('documento_id', docIds).order('numero_versao', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  if (typesResult.error || versionsResult.error) throw new Error('Erro ao carregar tipos ou versoes documentais.')
  const types = new Map((typesResult.data || []).map((type) => [type.id, type]))
  const typesByCode = new Map((typesResult.data || []).map((type) => [type.codigo, type]))
  const versions = (versionsResult.data || []) as Array<{ id: string; documento_id: string; numero_versao: number; status: string; nome_original: string; sha256: string; enviado_por: string; enviado_em: string; created_at: string }>
  const versionIds = versions.map((version) => version.id)
  const { data: analyses } = versionIds.length
    ? await supabase.from('documento_analises').select('documento_versao_id, resultado, observacoes, analisado_por, analisado_em').in('documento_versao_id', versionIds).order('analisado_em', { ascending: false })
    : { data: [] }
  const analysisRows = (analyses || []) as Array<{ documento_versao_id: string; resultado: string; observacoes: string | null; analisado_por: string | null; analisado_em: string }>
  const profileIds = Array.from(new Set([
    ...versions.map((version) => version.enviado_por).filter(Boolean),
    ...analysisRows.map((analysis) => analysis.analisado_por).filter(Boolean),
  ] as string[]))
  const { data: profiles } = profileIds.length
    ? await supabase.from('profiles').select('id, nome_completo, email').in('id', profileIds)
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

  const items = rows.map((row) => {
    const type = row.documento_tipo_id
      ? types.get(row.documento_tipo_id)
      : typesByCode.get(normalizarCodigoDocumentoCatalogo(row.tipo_documento_codigo_snapshot))
    const fase: ChecklistDocumentoItem['fase'] = row.nota_fiscal_entrega_id ? 'pos_cessao' : 'pre_cessao'
    const prazo = calcularPrazoDocumento({
      status: row.status,
      prazoLimite: row.prazo_limite,
      dataInicioPrazo: fase === 'pos_cessao' ? (entrega?.cessao_efetivada_em || entrega?.created_at || null) : null,
    })
    return {
      id: row.id,
      codigo: row.tipo_documento_codigo_snapshot,
      nome: type?.nome || row.tipo_documento_codigo_snapshot,
      descricao: fase === 'pos_cessao'
        ? 'Documento exigido apos a cessao/desembolso para acompanhamento logistico da NF.'
        : 'Documento exigido antes da cessao para validacao da NF.',
      fase,
      escopo: row.escopo_snapshot,
      obrigatorio: row.obrigatorio,
      status: row.status,
      ...prazo,
      bloqueiaFluxo: row.obrigatorio && fase === 'pos_cessao',
      formatosAceitos: row.formatos_aceitos_snapshot || [],
      uploadPermitido: !!type,
      documentoId: row.documento_id,
      versaoAprovadaId: row.versao_aprovada_id,
      entregaId: row.nota_fiscal_entrega_id,
      versoes: versions.filter((version) => version.documento_id === row.documento_id).map((version) => ({
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
      })),
    }
  })
  const preCessao = items.filter((item) => item.fase === 'pre_cessao')
  const posCessao = items.filter((item) => item.fase === 'pos_cessao')
  const posObrigatoriosPendentes = posCessao.filter((item) => item.obrigatorio && item.status !== 'satisfeito')
  const preObrigatoriosPendentes = preCessao.filter((item) => item.obrigatorio && item.status !== 'satisfeito')
  const posStatus = !entrega
    ? 'nao_iniciado'
    : posCessao.some((item) => item.statusPrazo === 'vencido' || item.status === 'vencido')
      ? 'vencido'
      : posObrigatoriosPendentes.length === 0 && posCessao.length > 0
        ? 'concluido'
        : posCessao.some((item) => item.versoes.some((version) => version.status === 'em_analise' || version.status === 'enviado'))
          ? 'em_analise'
          : 'pendente'
  const proximoPrazo = items
    .filter((item) => item.dataLimite && !['satisfeito', 'dispensado', 'cancelado'].includes(item.status))
    .sort((a, b) => String(a.dataLimite).localeCompare(String(b.dataLimite)))[0] || null
  return {
    notaFiscalId,
    items,
    preCessao,
    posCessao,
    entrega: entrega ? {
      id: entrega.id,
      status: entrega.status_entrega,
      dataInicioPrazo: entrega.cessao_efetivada_em || entrega.created_at,
      motivoPendencia: entrega.motivo_pendencia,
      dataEntrega: entrega.data_entrega,
      entregaConfirmadaEm: entrega.entrega_confirmada_em,
    } : null,
    elegibilidade: calcularElegibilidade(preCessao),
    posCessaoResumo: {
      existe: posCessao.length > 0,
      obrigatoriosPendentes: posObrigatoriosPendentes.length,
      status: posStatus,
    },
    resumoOperacional: {
      statusAntecipacao: notaFiscal?.status || 'nao_informado',
      statusLogistico: calcularStatusLogisticoDocumental({
        entregaStatus: entrega?.status_entrega || null,
        nfStatus: notaFiscal?.status || null,
        possuiRequisitosPosCessao: posCessao.length > 0,
        possuiDocumentoPosCessaoEnviado: posCessao.some((item) => item.versoes.length > 0),
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

function calcularElegibilidade(items: ChecklistDocumentoItem[]): ElegibilidadeDocumental {
  const mandatory = items.filter((item) => item.obrigatorio)
  const pending = mandatory.filter((item) => item.status !== 'satisfeito')
  const rejected = mandatory.filter((item) => item.versoes.some((version) => version.status === 'rejeitado' || version.ultimaAnalise?.resultado === 'rejeitado' || version.ultimaAnalise?.resultado === 'requer_ajuste'))
  const reviewing = mandatory.filter((item) => item.status !== 'satisfeito' && item.versoes.some((version) => version.status === 'em_analise' || version.ultimaAnalise?.resultado === 'pendente'))
  return {
    elegivel: pending.length === 0,
    requisitosPendentes: pending.map((item) => item.nome),
    requisitosRejeitados: rejected.map((item) => item.nome),
    requisitosEmAnalise: reviewing.map((item) => item.nome),
    motivos: pending.map((item) => `${item.nome}: ${item.status === 'pendente' ? 'aguardando documento aprovado' : item.status}`),
  }
}

export async function listarChecklistDaNota(notaFiscalId: string): Promise<ChecklistDocumento> {
  return carregarChecklist(notaFiscalId)
}

export async function enviarDocumentoDaNota(formData: FormData) {
  const notaFiscalId = String(formData.get('notaFiscalId') || '')
  const requisitoId = String(formData.get('requisitoId') || '')
  const entregaId = String(formData.get('entregaId') || '')
  const arquivo = formData.get('arquivo')
  if (!notaFiscalId || !requisitoId || !(arquivo instanceof File)) return { success: false, message: 'NF, requisito e arquivo sao obrigatorios.' }
  try {
    const client = await createClient()
    const result = entregaId
      ? await uploadDocumentoDaEntrega({ notaFiscalId, entregaId, requisitoId, arquivo }, client)
      : await uploadDocumentoDaNota({ notaFiscalId, requisitoId, arquivo }, client)
    return { success: true, message: 'Documento enviado para analise.', data: result }
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
  return { success: true, data }
}

export async function verificarElegibilidadeDocumental(notaFiscalId: string): Promise<ElegibilidadeDocumental> {
  return (await carregarChecklist(notaFiscalId)).elegibilidade
}

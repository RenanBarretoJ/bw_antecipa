'use server'

import { createClient } from '@/lib/supabase/server'
import { requireGestor, requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { registrarLog } from './auditoria'
import { instanciarRequisitosDaNota } from '@/lib/documentos-v2/requisitos'
import { gerarUrlDocumento } from '@/lib/documentos-v2/storage'
import { uploadDocumentoDaNota } from '@/lib/documentos-v2/upload'
import type { DocumentoAnaliseResultado } from '@/lib/types/domain'

export interface ChecklistDocumentoItem {
  id: string
  codigo: string
  nome: string
  obrigatorio: boolean
  status: string
  uploadPermitido: boolean
  documentoId: string | null
  versaoAprovadaId: string | null
  versoes: Array<{
    id: string
    numero: number
    status: string
    nome: string
    sha256: string
    criadoEm: string
    ultimaAnalise: { resultado: string; observacoes: string | null; analisadoEm: string } | null
  }>
}

export interface ChecklistDocumento {
  notaFiscalId: string
  items: ChecklistDocumentoItem[]
  elegibilidade: ElegibilidadeDocumental
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

  const { data: instances, error } = await supabase
    .from('documento_requisito_instancias')
    .select('id, documento_tipo_id, tipo_documento_codigo_snapshot, obrigatorio, status, documento_id, versao_aprovada_id')
    .eq('nota_fiscal_id', notaFiscalId)
    .order('id')
  if (error) throw new Error(`Erro ao carregar checklist: ${error.message}`)

  const rows = (instances || []) as Array<{
    id: string; documento_tipo_id: string | null; tipo_documento_codigo_snapshot: string; obrigatorio: boolean; status: string; documento_id: string | null; versao_aprovada_id: string | null
  }>
  const typeIds = rows.map((row) => row.documento_tipo_id).filter(Boolean) as string[]
  const docIds = rows.map((row) => row.documento_id).filter(Boolean) as string[]
  const [typesResult, versionsResult] = await Promise.all([
    typeIds.length ? supabase.from('documento_tipos').select('id, codigo, nome').in('id', typeIds) : Promise.resolve({ data: [], error: null }),
    docIds.length ? supabase.from('documento_versoes').select('id, documento_id, numero_versao, status, nome_original, sha256, created_at').in('documento_id', docIds).order('numero_versao', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  if (typesResult.error || versionsResult.error) throw new Error('Erro ao carregar tipos ou versoes documentais.')
  const types = new Map((typesResult.data || []).map((type) => [type.id, type]))
  const versions = (versionsResult.data || []) as Array<{ id: string; documento_id: string; numero_versao: number; status: string; nome_original: string; sha256: string; created_at: string }>
  const versionIds = versions.map((version) => version.id)
  const { data: analyses } = versionIds.length
    ? await supabase.from('documento_analises').select('documento_versao_id, resultado, observacoes, analisado_em').in('documento_versao_id', versionIds).order('analisado_em', { ascending: false })
    : { data: [] }
  const latestAnalysis = new Map<string, { resultado: string; observacoes: string | null; analisadoEm: string }>()
  for (const analysis of (analyses || []) as Array<{ documento_versao_id: string; resultado: string; observacoes: string | null; analisado_em: string }>) {
    if (!latestAnalysis.has(analysis.documento_versao_id)) latestAnalysis.set(analysis.documento_versao_id, { resultado: analysis.resultado, observacoes: analysis.observacoes, analisadoEm: analysis.analisado_em })
  }

  const items = rows.map((row) => {
    const type = row.documento_tipo_id ? types.get(row.documento_tipo_id) : null
    return {
      id: row.id,
      codigo: row.tipo_documento_codigo_snapshot,
      nome: type?.nome || row.tipo_documento_codigo_snapshot,
      obrigatorio: row.obrigatorio,
      status: row.status,
      uploadPermitido: !!row.documento_tipo_id,
      documentoId: row.documento_id,
      versaoAprovadaId: row.versao_aprovada_id,
      versoes: versions.filter((version) => version.documento_id === row.documento_id).map((version) => ({
        id: version.id,
        numero: version.numero_versao,
        status: version.status,
        nome: version.nome_original,
        sha256: version.sha256,
        criadoEm: version.created_at,
        ultimaAnalise: latestAnalysis.get(version.id) || null,
      })),
    }
  })
  return { notaFiscalId, items, elegibilidade: calcularElegibilidade(items) }
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
  const arquivo = formData.get('arquivo')
  if (!notaFiscalId || !requisitoId || !(arquivo instanceof File)) return { success: false, message: 'NF, requisito e arquivo sao obrigatorios.' }
  try {
    const result = await uploadDocumentoDaNota({ notaFiscalId, requisitoId, arquivo }, await createClient())
    return { success: true, message: 'Documento enviado para analise.', data: result }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel enviar o documento.' }
  }
}

export async function baixarVersaoDocumento(versaoId: string) {
  const supabase = await createClient()
  const { data: version, error } = await supabase.from('documento_versoes').select('id, documento_id, path, nome_original').eq('id', versaoId).maybeSingle()
  if (error || !version) return { success: false, message: 'Versao documental nao encontrada.' }
  const { data: link } = await supabase.from('documento_vinculos').select('nota_fiscal_id').eq('documento_id', version.documento_id).not('nota_fiscal_id', 'is', null).limit(1).maybeSingle()
  if (!link?.nota_fiscal_id) return { success: false, message: 'Vinculo documental invalido.' }
  await requireNotaFiscalAccess(link.nota_fiscal_id, supabase)
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

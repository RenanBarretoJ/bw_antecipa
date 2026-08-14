import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classificarStatusLogisticoPreCessao,
  resolverFamiliaDocumentalLogistica,
  type ClassificacaoLogisticaPreCessao,
  type EvidenciaLogisticaParaClassificacao,
  type FamiliaDocumentalLogistica,
} from '@/lib/logistica/evidencias-logisticas'
import type { Database } from '@/types/database'

type Candidate = { notaId: string; familia: FamiliaDocumentalLogistica; documentoId: string; versaoId: string; approved?: boolean }
type LooseRow = Record<string, unknown>

export async function classificarLogisticaDasNotas(
  supabase: SupabaseClient<Database>,
  fundoId: string,
  notaIds: string[],
): Promise<Map<string, ClassificacaoLogisticaPreCessao>> {
  const uniqueNotes = [...new Set(notaIds)]
  const result = new Map<string, ClassificacaoLogisticaPreCessao>()
  if (!uniqueNotes.length) return result
  const candidates: Candidate[] = []

  const [requirements, early, cteLinks, deliveries] = await Promise.all([
    supabase.from('documento_requisito_instancias')
      .select('nota_fiscal_id,tipo_documento_codigo_snapshot,documento_id,versao_aprovada_id')
      .in('nota_fiscal_id', uniqueNotes),
    supabase.from('evidencias_logisticas_antecipadas')
      .select('nota_fiscal_id,familia_documental,documento_id,documento_versao_atual_id')
      .eq('fundo_id', fundoId).in('nota_fiscal_id', uniqueNotes),
    supabase.from('cte_notas_fiscais').select('nota_fiscal_id,cte_id').in('nota_fiscal_id', uniqueNotes),
    supabase.from('nota_fiscal_entregas').select('id,nota_fiscal_id').in('nota_fiscal_id', uniqueNotes),
  ])
  for (const response of [requirements, early, cteLinks, deliveries]) {
    if (response.error) throw new Error(`Nao foi possivel resolver evidencias logisticas: ${response.error.message}`)
  }

  for (const row of requirements.data || []) {
    const familia = resolverFamiliaDocumentalLogistica(row.tipo_documento_codigo_snapshot)
    if (familia && row.nota_fiscal_id && row.documento_id && row.versao_aprovada_id) candidates.push({ notaId: row.nota_fiscal_id, familia, documentoId: row.documento_id, versaoId: row.versao_aprovada_id, approved: true })
  }
  for (const row of early.data || []) {
    if (row.documento_id && row.documento_versao_atual_id) candidates.push({ notaId: row.nota_fiscal_id, familia: row.familia_documental, documentoId: row.documento_id, versaoId: row.documento_versao_atual_id })
  }

  const cteIds = [...new Set((cteLinks.data || []).map((row) => row.cte_id))]
  if (cteIds.length) {
    const ctes = await supabase.from('ctes').select('id,documento_id,documento_versao_aprovada_id').eq('fundo_id', fundoId).in('id', cteIds)
    if (ctes.error) throw new Error(`Nao foi possivel carregar CT-es aprovados: ${ctes.error.message}`)
    const byId = new Map<string, LooseRow>((ctes.data || []).map((row) => [String(row.id), row as LooseRow]))
    for (const link of cteLinks.data || []) {
      const cte = byId.get(link.cte_id)
      if (cte?.documento_id && cte?.documento_versao_aprovada_id) candidates.push({ notaId: link.nota_fiscal_id, familia: 'cte', documentoId: String(cte.documento_id), versaoId: String(cte.documento_versao_aprovada_id), approved: true })
    }
  }

  const deliveryById = new Map<string, string>((deliveries.data || []).map((row) => [String(row.id), String(row.nota_fiscal_id)]))
  const deliveryIds = [...deliveryById.keys()]
  if (deliveryIds.length) {
    const proofs = await supabase.from('canhotos').select('nota_fiscal_entrega_id,documento_id,documento_versao_aprovada_id').in('nota_fiscal_entrega_id', deliveryIds)
    if (proofs.error) throw new Error(`Nao foi possivel carregar comprovantes aprovados: ${proofs.error.message}`)
    for (const proof of proofs.data || []) {
      const notaId = deliveryById.get(proof.nota_fiscal_entrega_id)
      if (notaId && proof.documento_id && proof.documento_versao_aprovada_id) candidates.push({ notaId, familia: 'comprovante_entrega', documentoId: proof.documento_id, versaoId: proof.documento_versao_aprovada_id, approved: true })
    }
  }

  const versionIds = [...new Set(candidates.map((item) => item.versaoId))]
  const [versions, analyses] = await Promise.all([
    supabase.from('documento_versoes').select('id,status').in('id', versionIds),
    supabase.from('documento_analises').select('id,documento_versao_id,resultado,analisado_em,analisado_por').in('documento_versao_id', versionIds).order('analisado_em', { ascending: false }),
  ])
  if (versions.error || analyses.error) throw new Error(`Nao foi possivel validar as evidencias logisticas: ${versions.error?.message || analyses.error?.message}`)
  const versionById = new Map<string, LooseRow>((versions.data || []).map((row) => [String(row.id), row as LooseRow]))
  const analysisByVersion = new Map<string, LooseRow>()
  for (const row of analyses.data || []) if (!analysisByVersion.has(row.documento_versao_id)) analysisByVersion.set(row.documento_versao_id, row)

  for (const notaId of uniqueNotes) {
    const evidencias: EvidenciaLogisticaParaClassificacao[] = candidates.filter((item) => item.notaId === notaId).map((item) => {
      const version = versionById.get(item.versaoId)
      const analysis = analysisByVersion.get(item.versaoId)
      return {
        familia: item.familia, documentoId: item.documentoId, versaoId: item.versaoId,
        versaoStatus: item.approved ? 'aprovado' : String(version?.status || ''),
        analiseId: analysis?.id ? String(analysis.id) : null,
        analiseResultado: analysis?.resultado ? String(analysis.resultado) : null,
        analisadoEm: analysis?.analisado_em ? String(analysis.analisado_em) : null,
        analisadoPor: analysis?.analisado_por ? String(analysis.analisado_por) : null,
      }
    })
    result.set(notaId, classificarStatusLogisticoPreCessao(evidencias))
  }
  return result
}

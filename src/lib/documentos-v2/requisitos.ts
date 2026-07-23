import { CedenteFundoError } from '@/lib/fundos/cedente-fundo'
import { resolverPoliticaAtiva, resolverPoliticaAtivaPorVinculo } from '@/lib/operacoes/politica'
import type { AppSupabaseClient } from '@/lib/auth/authorization'

export interface ContextoDocumentoNotaFiscal {
  cedenteId: string
  cedenteFundoId: string
  fundoId: string
  entidadeTipo: 'nota_fiscal'
  entidadeId: string
}

export async function instanciarRequisitosDaNota(
  notaFiscalId: string,
  client: AppSupabaseClient,
  contexto?: ContextoDocumentoNotaFiscal,
) {
  try {
    const { data: notaFiscal, error: notaFiscalError } = await client
      .from('notas_fiscais')
      .select('cedente_id, cedente_fundo_id, fundo_id')
      .eq('id', notaFiscalId)
      .single()
    if (notaFiscalError || !notaFiscal) throw new Error('Nota fiscal nao encontrada para instanciar requisitos.')
    const nf = notaFiscal as { cedente_id: string; cedente_fundo_id: string | null; fundo_id: string | null }

    if (contexto) {
      if (contexto.entidadeTipo !== 'nota_fiscal' || contexto.entidadeId !== notaFiscalId) {
        throw new Error('Contexto documental inconsistente com a nota fiscal informada.')
      }
      if (contexto.cedenteId !== nf.cedente_id || contexto.cedenteFundoId !== nf.cedente_fundo_id || contexto.fundoId !== nf.fundo_id) {
        throw new Error('Contexto documental diverge do contexto multifundo da nota fiscal.')
      }
    }

    const politica = nf.cedente_fundo_id && nf.fundo_id
      ? await resolverPoliticaAtivaPorVinculo({
        cedenteId: nf.cedente_id,
        cedenteFundoId: nf.cedente_fundo_id,
        fundoId: nf.fundo_id,
      }, client)
      : await resolverPoliticaAtiva(nf.cedente_id, client)

    const { data, error } = await client.rpc('instanciar_requisitos_nota', {
      p_nota_fiscal_id: notaFiscalId,
      p_politica_operacional_id: politica.politica.id,
      p_politica_versao_id: politica.versao.id,
    })
    if (error) throw new Error(`Erro ao instanciar requisitos documentais: ${error.message}`)
    return { politica, resultado: data }
  } catch (error) {
    if (error instanceof CedenteFundoError && error.code === 'POLITICA_CONTEXT_NOT_CONFIGURED') return null
    throw error
  }
}

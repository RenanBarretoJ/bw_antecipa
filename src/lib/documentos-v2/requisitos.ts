import { CedenteFundoError } from '@/lib/fundos/cedente-fundo'
import { resolverPoliticaAtiva } from '@/lib/operacoes/politica'
import type { AppSupabaseClient } from '@/lib/auth/authorization'

export async function instanciarRequisitosDaNota(notaFiscalId: string, client: AppSupabaseClient) {
  try {
    const { data: notaFiscal, error: notaFiscalError } = await client
      .from('notas_fiscais')
      .select('cedente_id')
      .eq('id', notaFiscalId)
      .single()
    if (notaFiscalError || !notaFiscal) throw new Error('Nota fiscal nao encontrada para instanciar requisitos.')
    const politica = await resolverPoliticaAtiva(notaFiscal.cedente_id, client)
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

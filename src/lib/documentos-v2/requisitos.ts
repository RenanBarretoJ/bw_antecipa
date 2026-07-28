import { CedenteFundoError } from '@/lib/fundos/cedente-fundo'
import { createAdminClient } from '@/lib/supabase/server'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PoliticaOperacional, PoliticaOperacionalVersao } from '@/types/database'

export interface ContextoDocumentoNotaFiscal {
  cedenteId: string
  cedenteFundoId: string
  fundoId: string
  entidadeTipo: 'nota_fiscal'
  entidadeId: string
}

async function resolverPoliticaDocumentalPorContexto(input: {
  cedenteId: string
  cedenteFundoId: string
  fundoId: string
}): Promise<{ politica: PoliticaOperacional; versao: PoliticaOperacionalVersao }> {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: cedenteFundo, error: cedenteFundoError } = await admin
    .from('cedente_fundos')
    .select('id, status')
    .eq('id', input.cedenteFundoId)
    .eq('cedente_id', input.cedenteId)
    .eq('fundo_id', input.fundoId)
    .maybeSingle()

  if (cedenteFundoError) throw new Error(`Erro ao validar vinculo cedente-fundo: ${cedenteFundoError.message}`)
  if (!cedenteFundo || cedenteFundo.status !== 'ativo') {
    throw new CedenteFundoError('Vinculo cedente-fundo ativo nao encontrado para a NF.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }

  const { data: assignment, error: assignmentError } = await admin
    .from('cedente_fundo_politicas')
    .select('politica_operacional_id')
    .eq('cedente_fundo_id', input.cedenteFundoId)
    .eq('status', 'ativa')
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('vigente_desde', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (assignmentError) throw new Error(`Erro ao buscar politica vinculada ao cedente-fundo: ${assignmentError.message}`)
  if (!assignment) {
    throw new CedenteFundoError('Politica operacional publicada nao vinculada ao cedente-fundo.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }

  const { data: politica, error: politicaError } = await admin
    .from('politicas_operacionais')
    .select('*')
    .eq('id', assignment.politica_operacional_id)
    .eq('fundo_id', input.fundoId)
    .eq('status', 'ativa')
    .maybeSingle()

  if (politicaError) throw new Error(`Erro ao buscar politica operacional: ${politicaError.message}`)
  if (!politica) {
    throw new CedenteFundoError('Politica operacional ativa nao encontrada para o fundo.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }

  const { data: versao, error: versaoError } = await admin
    .from('politica_operacional_versoes')
    .select('*')
    .eq('politica_operacional_id', politica.id)
    .eq('fundo_id', input.fundoId)
    .eq('status', 'publicada')
    .not('publicada_em', 'is', null)
    .lte('vigente_desde', now)
    .or(`vigente_ate.is.null,vigente_ate.gt.${now}`)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (versaoError) throw new Error(`Erro ao buscar versao publicada da politica: ${versaoError.message}`)
  if (!versao) {
    throw new CedenteFundoError('Politica operacional sem versao publicada vigente.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
  }

  return {
    politica: politica as PoliticaOperacional,
    versao: versao as PoliticaOperacionalVersao,
  }
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

    if (!nf.cedente_fundo_id || !nf.fundo_id) {
      throw new CedenteFundoError('Nota fiscal sem contexto cedente-fundo/fundo.', 'POLITICA_CONTEXT_NOT_CONFIGURED')
    }

    const politica = await resolverPoliticaDocumentalPorContexto({
      cedenteId: nf.cedente_id,
      cedenteFundoId: nf.cedente_fundo_id,
      fundoId: nf.fundo_id,
    })

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

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { isNfStatus, type NfStatus } from '@/lib/types/domain'
import {
  resolverFamiliaDocumentalLogistica,
  type FamiliaDocumentalLogistica,
} from './evidencias-logisticas'

export const NF_STATUS_CANCELADA_CTE: NfStatus = 'cancelada'

export interface RequisitoCteAntecipavel {
  ativo: boolean
  escopo: string
  tipo_documento_codigo: string
  familia_documental: FamiliaDocumentalLogistica | null
}

export interface ContextoCandidatasCte {
  notaFiscalId: string
  cedenteId: string
  cedenteFundoId: string
  fundoId: string
}

export interface NfCandidataCte {
  id: string
  numero: string
  chaveAcesso: string | null
  status: NfStatus
}

export interface ContextoNfCompartilhamentoCte {
  cedente_id: string
  cedente_fundo_id: string | null
  fundo_id: string | null
}

export interface ResultadoCandidatasCte {
  aplicavel: boolean
  candidatas: NfCandidataCte[]
  erro: string | null
}

export class ErroContextoCandidatasCte extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErroContextoCandidatasCte'
  }
}

export function possuiRequisitoCteAntecipavel(
  requisitos: readonly RequisitoCteAntecipavel[],
): boolean {
  return requisitos.some((requisito) => {
    if (!requisito.ativo || !['pos_cessao', 'entrega'].includes(requisito.escopo)) return false
    const familia = requisito.familia_documental
      ?? resolverFamiliaDocumentalLogistica(requisito.tipo_documento_codigo)
    return familia === 'cte'
  })
}

export function statusNfPermiteCandidaturaCte(status: NfStatus): boolean {
  return status !== NF_STATUS_CANCELADA_CTE
}

export function nfsCompartilhamContextoCte(
  nfs: readonly ContextoNfCompartilhamentoCte[],
): boolean {
  const primeira = nfs[0]
  if (!primeira?.cedente_id || !primeira.cedente_fundo_id || !primeira.fundo_id) return false
  return nfs.every((nf) => (
    nf.cedente_id === primeira.cedente_id
    && nf.cedente_fundo_id === primeira.cedente_fundo_id
    && nf.fundo_id === primeira.fundo_id
  ))
}

export async function listarNfsCandidatasCte(
  client: AppSupabaseClient,
  contexto: ContextoCandidatasCte,
): Promise<NfCandidataCte[]> {
  const { data: vinculo, error: vinculoError } = await client
    .from('cedente_fundos')
    .select('id')
    .eq('id', contexto.cedenteFundoId)
    .eq('cedente_id', contexto.cedenteId)
    .eq('fundo_id', contexto.fundoId)
    .eq('status', 'ativo')
    .maybeSingle()

  if (vinculoError) {
    throw new ErroContextoCandidatasCte(`Erro ao validar o vinculo ativo da NF: ${vinculoError.message}`)
  }
  if (!vinculo) {
    throw new ErroContextoCandidatasCte('O vinculo entre cedente e fundo nao esta ativo para esta NF.')
  }

  const { data, error } = await client
    .from('notas_fiscais')
    .select('id, numero_nf, chave_acesso, status, cedente_id, cedente_fundo_id, fundo_id')
    .eq('cedente_fundo_id', contexto.cedenteFundoId)
    .eq('cedente_id', contexto.cedenteId)
    .eq('fundo_id', contexto.fundoId)
    .neq('status', NF_STATUS_CANCELADA_CTE)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(`Erro ao consultar NFs candidatas ao CT-e: ${error.message}`)
  if ((data || []).length > 0 && !nfsCompartilhamContextoCte(data || [])) {
    throw new ErroContextoCandidatasCte('As NFs candidatas nao compartilham o mesmo contexto autorizado.')
  }

  return (data || []).flatMap((row) => {
    if (!isNfStatus(row.status)) {
      throw new ErroContextoCandidatasCte('Foi encontrado um status de NF incompatível com o domínio atual.')
    }
    if (!statusNfPermiteCandidaturaCte(row.status)) return []
    return [{
      id: String(row.id),
      numero: String(row.numero_nf || row.id),
      chaveAcesso: row.chave_acesso ? String(row.chave_acesso) : null,
      status: row.status,
    }]
  })
}

export async function carregarNfsCandidatasCteSeAplicavel(input: {
  client: AppSupabaseClient
  contexto: ContextoCandidatasCte
  requisitos: readonly RequisitoCteAntecipavel[]
}): Promise<ResultadoCandidatasCte> {
  const aplicavel = possuiRequisitoCteAntecipavel(input.requisitos)
  if (!aplicavel) return { aplicavel: false, candidatas: [], erro: null }

  try {
    return {
      aplicavel: true,
      candidatas: await listarNfsCandidatasCte(input.client, input.contexto),
      erro: null,
    }
  } catch (error) {
    if (error instanceof ErroContextoCandidatasCte) throw error
    return {
      aplicavel: true,
      candidatas: [],
      erro: 'Nao foi possivel carregar outras NFs elegiveis para compartilhar o CT-e.',
    }
  }
}

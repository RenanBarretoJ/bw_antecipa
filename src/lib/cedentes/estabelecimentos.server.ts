import 'server-only'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { normalizarCnpj14 } from '@/lib/notas-fiscais/emitente-autorizado'
import type { EstabelecimentoOrigem } from './estabelecimentos'

type EstabelecimentoRow = {
  id: string
  cedente_id: string
  cnpj: string
  razao_social: string
  tipo: 'matriz' | 'filial'
  status: EstabelecimentoOrigem['status']
  ativo: boolean
}

export class EstabelecimentoOrigemError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'CNPJ_INVALIDO'
      | 'NAO_CADASTRADO'
      | 'OUTRO_CEDENTE'
      | 'NAO_APROVADO'
      | 'CONTEXTO_INATIVO',
  ) {
    super(message)
    this.name = 'EstabelecimentoOrigemError'
  }
}

export async function resolverEstabelecimentoOrigem(input: {
  supabase: AppSupabaseClient
  cedenteId: string
  fundoId: string
  cnpjEmitente: string
}): Promise<EstabelecimentoOrigem> {
  const cnpj = normalizarCnpj14(input.cnpjEmitente)
  if (!/^\d{14}$/.test(cnpj)) {
    throw new EstabelecimentoOrigemError('CNPJ emitente invalido.', 'CNPJ_INVALIDO')
  }

  const { data, error } = await input.supabase
    .from('cedente_estabelecimentos')
    .select('id, cedente_id, cnpj, razao_social, tipo, status, ativo')
    .eq('cnpj', cnpj)
    .maybeSingle()

  if (error) throw new Error(`Nao foi possivel validar o estabelecimento emitente: ${error.message}`)
  if (!data) {
    throw new EstabelecimentoOrigemError(
      'CNPJ emitente nao pertence a este Cedente ou ainda nao foi cadastrado.',
      'NAO_CADASTRADO',
    )
  }

  const row = data as EstabelecimentoRow
  if (row.cedente_id !== input.cedenteId) {
    throw new EstabelecimentoOrigemError('CNPJ emitente nao pertence a este Cedente.', 'OUTRO_CEDENTE')
  }
  if (row.status !== 'aprovado' || !row.ativo) {
    throw new EstabelecimentoOrigemError(
      'CNPJ emitente ainda nao esta aprovado para originar recebiveis.',
      'NAO_APROVADO',
    )
  }

  const { data: permitido, error: gateError } = await input.supabase.rpc('estabelecimento_pode_originar', {
    p_estabelecimento_id: row.id,
    p_cedente_id: input.cedenteId,
    p_fundo_id: input.fundoId,
  })
  if (gateError) throw new Error(`Nao foi possivel validar a origem do estabelecimento: ${gateError.message}`)
  if (permitido !== true) {
    throw new EstabelecimentoOrigemError(
      'O estabelecimento, a Matriz ou o vinculo com o fundo nao esta ativo para novas originacoes.',
      'CONTEXTO_INATIVO',
    )
  }

  return {
    id: row.id,
    cedenteId: row.cedente_id,
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    tipo: row.tipo,
    status: row.status,
    ativo: row.ativo,
  }
}

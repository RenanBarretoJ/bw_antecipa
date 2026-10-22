import 'server-only'
import { AuthorizationError, type AuthContext } from '@/lib/auth/authorization'
import { carteiraProcessamentoPermitido } from './carteira-rotina'
import { consultarEPersistirCarteiraVortx } from './carteira-persistencia.server'
import { carregarPosicaoCarteiraVortx } from './carteira-posicao.server'
import type { ProcessamentoCarteiraResult } from './carteira-operacao'
import type { ContextoRelatorios } from './relatorios-operacao'

export type EscopoCarteira = { fundoId: string; versaoId?: string }

export function exigirContextoCarteira(input: {
  atorId: string; atualId: string; fundoId: string; contexto: ContextoRelatorios; escopo: EscopoCarteira
}) {
  const { atorId, atualId, fundoId, contexto, escopo } = input
  if (atualId !== atorId || contexto.fundo.id !== fundoId || escopo.fundoId !== fundoId || contexto.podeSolicitar !== true) {
    throw new AuthorizationError('É necessário acesso operacional ativo à carteira deste Fundo.', 'FORBIDDEN')
  }
  if (!contexto.versoes.some(v => v.ambiente === 'producao' && v.capabilities.includes('CARTEIRA') && (!escopo.versaoId || v.id === escopo.versaoId))) {
    throw new AuthorizationError('Carteira não está habilitada na versão publicada deste Fundo. Publique a capacidade Carteira na integração, mantendo as cotas esperadas.', 'FORBIDDEN')
  }
}

/** Shared use case; each portal supplies its fresh, canonical authorization adapter. */
export async function processarCarteiraAutorizada(input: { fundoId: string; dataReferencia: string }, auth: AuthContext,
  autorizar: (scope: EscopoCarteira) => Promise<void>): Promise<ProcessamentoCarteiraResult> {
  if (!carteiraProcessamentoPermitido(input.fundoId)) return { success: false, message: 'O processamento da carteira ainda não está habilitado para este Fundo.' }
  await autorizar({ fundoId: input.fundoId })
  const result = await consultarEPersistirCarteiraVortx(input, autorizar)
  if (result.estado === 'AGUARDANDO_COTAS') return { success: true, estado: result.estado, dataReferencia: result.dataReferencia, cotasPendentes: result.cotasPendentes }
  if (result.estado === 'CONFIGURACAO_PENDENTE' || result.estado === 'REVISAO_NECESSARIA') return { success: true, estado: result.estado }
  const posicao = await carregarPosicaoCarteiraVortx(auth.supabase, input.fundoId, result.id)
  if (!posicao) throw new Error('CARTEIRA_CONFIRMACAO_INDISPONIVEL')
  return { success: true, estado: !posicao.vigente ? 'CONTEUDO_HISTORICO' : result.estado === 'DUPLICADA' ? 'JA_REGISTRADA' : 'PUBLICADA', posicao }
}

export function falhaProcessamentoCarteira(error: unknown): ProcessamentoCarteiraResult {
  return { success: false, message: error instanceof AuthorizationError ? error.message
    : 'Não foi possível confirmar o processamento. Atualize a posição antes de tentar novamente; o PL vigente não é substituído por uma carteira incompleta.' }
}

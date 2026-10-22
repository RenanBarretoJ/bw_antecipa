'use server'

import { z } from 'zod'
import { requireGestor, AuthorizationError } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { carregarContextoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { carteiraProcessamentoPermitido } from '@/lib/integracoes/vortx/carteira-rotina'
import { consultarEPersistirCarteiraVortx } from '@/lib/integracoes/vortx/carteira-persistencia.server'
import { carregarPosicaoCarteiraVortx } from '@/lib/integracoes/vortx/carteira-posicao.server'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import type { ProcessamentoCarteiraResult } from '@/lib/integracoes/vortx/carteira-operacao'

export async function processarCarteiraVortxAction(input: unknown): Promise<ProcessamentoCarteiraResult> {
  try {
    const parsed = z.object({ dataReferencia: z.iso.date() }).strict().safeParse(input)
    if (!parsed.success || parsed.data.dataReferencia > obterDataCivilOperacional()) return { success: false, message: 'Informe uma data de posição válida, sem datas futuras.' }
    const auth = await requireGestor()
    const { fundoId } = await resolverContextoFundoGestor(auth)
    if (!carteiraProcessamentoPermitido(fundoId)) return { success: false, message: 'O processamento da carteira ainda não está habilitado para este Fundo.' }
    async function autorizar(scope: { fundoId: string; versaoId?: string }) {
      const { auth: atual, contexto } = await carregarContextoRelatorios(fundoId)
      const ativo = await resolverContextoFundoGestor(atual)
      if (atual.user.id !== auth.user.id || atual.profile.role !== 'gestor' || ativo.fundoId !== fundoId || contexto.fundo.id !== fundoId
        || scope.fundoId !== fundoId || contexto.podeSolicitar !== true
        || !contexto.versoes.some(v => v.ambiente === 'producao' && v.capabilities.includes('CARTEIRA') && (!scope.versaoId || v.id === scope.versaoId))) {
        throw new AuthorizationError('É necessário acesso operacional ativo à carteira deste Fundo.', 'FORBIDDEN')
      }
    }
    await autorizar({ fundoId })
    const result = await consultarEPersistirCarteiraVortx({ fundoId, dataReferencia: parsed.data.dataReferencia }, autorizar)
    if (result.estado === 'AGUARDANDO_COTAS') return { success: true, estado: result.estado, dataReferencia: result.dataReferencia, cotasPendentes: result.cotasPendentes }
    if (result.estado === 'CONFIGURACAO_PENDENTE' || result.estado === 'REVISAO_NECESSARIA') return { success: true, estado: result.estado }
    const posicao = await carregarPosicaoCarteiraVortx(auth.supabase, fundoId, result.id)
    if (!posicao) throw new Error('CARTEIRA_CONFIRMACAO_INDISPONIVEL')
    return { success: true, estado: !posicao.vigente ? 'CONTEUDO_HISTORICO' : result.estado === 'DUPLICADA' ? 'JA_REGISTRADA' : 'PUBLICADA', posicao }
  } catch (error) {
    return { success: false, message: error instanceof AuthorizationError ? error.message
      : 'Não foi possível confirmar o processamento. Atualize a posição antes de tentar novamente; o PL vigente não é substituído por uma carteira incompleta.' }
  }
}

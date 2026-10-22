'use server'

import { z } from 'zod'
import { requireGestor, AuthorizationError } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { carregarContextoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { exigirContextoCarteira, processarCarteiraAutorizada, falhaProcessamentoCarteira } from '@/lib/integracoes/vortx/carteira-processamento.server'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import type { ProcessamentoCarteiraResult } from '@/lib/integracoes/vortx/carteira-operacao'

export async function processarCarteiraVortxAction(input: unknown): Promise<ProcessamentoCarteiraResult> {
  try {
    const parsed = z.object({ dataReferencia: z.iso.date() }).strict().safeParse(input)
    if (!parsed.success || parsed.data.dataReferencia > obterDataCivilOperacional()) return { success: false, message: 'Informe uma data de posição válida, sem datas futuras.' }
    const auth = await requireGestor()
    const { fundoId } = await resolverContextoFundoGestor(auth)
    async function autorizar(scope: { fundoId: string; versaoId?: string }) {
      const { auth: atual, contexto } = await carregarContextoRelatorios(fundoId)
      const ativo = await resolverContextoFundoGestor(atual)
      if (atual.profile.role !== 'gestor' || ativo.fundoId !== fundoId) {
        throw new AuthorizationError('É necessário acesso operacional ativo à carteira deste Fundo.', 'FORBIDDEN')
      }
      exigirContextoCarteira({ atorId: auth.user.id, atualId: atual.user.id, fundoId, contexto, escopo: scope })
    }
    return await processarCarteiraAutorizada({ fundoId, dataReferencia: parsed.data.dataReferencia }, auth, autorizar)
  } catch (error) {
    return falhaProcessamentoCarteira(error)
  }
}

'use server'

import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { carregarContextoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { exigirContextoCarteira, processarCarteiraAutorizada, falhaProcessamentoCarteira } from '@/lib/integracoes/vortx/carteira-processamento.server'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import type { ProcessamentoCarteiraResult } from '@/lib/integracoes/vortx/carteira-operacao'

export async function processarCarteiraVortxAdminAction(fundoDaPagina: string, input: unknown): Promise<ProcessamentoCarteiraResult> {
  try {
    const fundo = z.uuid().safeParse(fundoDaPagina)
    const parsed = z.object({ dataReferencia: z.iso.date() }).strict().safeParse(input)
    if (!fundo.success || !parsed.success || parsed.data.dataReferencia > obterDataCivilOperacional()) return { success: false, message: 'Informe um Fundo e uma data de posição válidos, sem datas futuras.' }
    const fundoId = fundo.data
    const auth = await requireSuperAdmin()
    async function autorizar(scope: { fundoId: string; versaoId?: string }) {
      // Canonical platform roles may differ from profile.role. Never infer admin access from it.
      const atual = await requireSuperAdmin()
      if (atual.user.id !== auth.user.id) throw new AuthorizationError('É necessário acesso administrativo ativo.', 'FORBIDDEN')
      const { auth: sessao, contexto } = await carregarContextoRelatorios(fundoId)
      exigirContextoCarteira({ atorId: auth.user.id, atualId: sessao.user.id, fundoId, contexto, escopo: scope })
    }
    return await processarCarteiraAutorizada({ fundoId, dataReferencia: parsed.data.dataReferencia }, auth, autorizar)
  } catch (error) { return falhaProcessamentoCarteira(error) }
}

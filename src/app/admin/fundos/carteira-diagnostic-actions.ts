'use server'

import { randomUUID } from 'node:crypto'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { carteiraDiagnosticSchema, diagnosticoCarteiraPermitido, hojeCarteira, type CarteiraDiagnosticResult } from '@/lib/integracoes/vortx/carteira-diagnostic'
import { consultarCarteiraComTokenVrs } from '@/lib/integracoes/vortx/carteira-diagnostic.server'
import { resolverConfiguracaoVortxVrs } from '@/lib/integracoes/vortx/credenciais.server'

export async function diagnosticarCarteiraJsonVrs(input: unknown): Promise<CarteiraDiagnosticResult> {
  const correlationId = randomUUID()
  try {
    const parsed = carteiraDiagnosticSchema.safeParse(input)
    if (!parsed.success) return { success: false, message: 'Revise a data e a confirmacao MFA.' }
    const { fundoId, dataCarteira, mfaCode } = parsed.data
    if (!diagnosticoCarteiraPermitido(fundoId)) return { success: false, message: 'Diagnostico indisponivel neste ambiente ou Fundo.' }
    const context = await requireSuperAdmin()
    if (dataCarteira > hojeCarteira()) return { success: false, message: 'A data da carteira nao pode ser futura.' }
    const { data: fund, error } = await context.supabase.from('fundos').select('id,cnpj,ativo').eq('id', fundoId).single()
    if (error || !fund?.ativo) return { success: false, message: 'Fundo ativo nao encontrado.' }
    // Reutiliza a autorizacao existente de teste VRS: mesmo Fundo, credencial, MFA e nonce de uso unico.
    await autorizarEConsumirAcaoSensivel(context, 'testar_conexao_vortx_vrs', mfaCode)
    const config = await resolverConfiguracaoVortxVrs(fundoId, 'producao')
    await registrarEventoSeguranca({ tipo_evento: 'CREDENCIAL_USADA', ator_usuario_id: context.user.id, correlation_id: correlationId,
      entidade_tipo: 'integracoes_vortx_vrs_credenciais', dados: { fundo_id: fundoId, data_carteira: dataCarteira, diagnostico: 'TOKEN_VRS_EM_CARTEIRA_JSON', etapa: 'INICIADO' } })
    const result = await consultarCarteiraComTokenVrs({ config, cnpjFundo: fund.cnpj.replace(/\D/g, ''), dataCarteira })
    await registrarEventoSeguranca({ tipo_evento: 'CREDENCIAL_USADA', ator_usuario_id: context.user.id, correlation_id: correlationId,
      entidade_tipo: 'integracoes_vortx_vrs_credenciais', dados: { fundo_id: fundoId, data_carteira: dataCarteira, diagnostico: 'TOKEN_VRS_EM_CARTEIRA_JSON', etapa: 'CONCLUIDO', http_status: result.statusHttp } })
    return { success: true, data: result }
  } catch (error) {
    if (error instanceof AuthorizationError) return { success: false, message: error.message }
    return { success: false, message: 'Nao foi possivel concluir o diagnostico. Nao houve retentativa automatica; o GET pode ter sido recebido pelo provedor. Respostas excessivas ou fora do Fundo esperado nao sao exibidas.' }
  }
}

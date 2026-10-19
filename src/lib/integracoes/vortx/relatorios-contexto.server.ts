import 'server-only'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { obterConfiguracoesTecnicasAdminFundo } from '@/lib/admin/configuracoes-tecnicas.server'
import { CODIGO_CARTEIRA_PATTERN } from '@/lib/integracoes/configuracao-vortx-vrs'
import { historicoRelatorioSchema, relatoriosPreviewPermitidos, type ContextoRelatorios } from './relatorios-operacao'

export async function carregarContextoRelatorios(fundoId: string) {
  if (!relatoriosPreviewPermitidos(fundoId)) throw new AuthorizationError('Solicitação de relatórios indisponível neste ambiente ou Fundo.', 'FORBIDDEN')
  const auth = await requireSuperAdmin()
  const [state, binding] = await Promise.all([
    obterConfiguracoesTecnicasAdminFundo(fundoId),
    auth.supabase.from('usuario_fundos').select('id').eq('usuario_id', auth.user.id).eq('fundo_id', fundoId).eq('status', 'ativo').maybeSingle(),
  ])
  if (binding.error || !binding.data || !state.fundo.ativo || state.fundo.id !== fundoId) {
    throw new AuthorizationError('É necessário vínculo ativo com este Fundo.', 'FORBIDDEN')
  }
  const contexto: ContextoRelatorios = {
    fundo: { id: state.fundo.id, nome: state.fundo.nome, cnpj: state.fundo.cnpj },
    versoes: state.integracoes.filter(i => i.status === 'ativa' && i.provider_key === 'VORTX').flatMap(i => i.versoes
      .filter(v => v.status === 'publicada' && v.adapter_key === 'vortx_vrs')
      .flatMap(v => {
        const carteira = v.configuracao_nao_sensivel.codigo_carteira
        return typeof carteira === 'string' && CODIGO_CARTEIRA_PATTERN.test(carteira.trim())
          ? [{ id: v.id, versao: v.versao, ambiente: v.ambiente, carteira: carteira.trim(), capabilities: v.active_capabilities }]
          : []
      })),
  }
  return { auth, contexto }
}

export async function carregarHistoricoRelatorios(fundoId: string, pagina: number) {
  const { auth, contexto } = await carregarContextoRelatorios(fundoId)
  const { data, error } = await auth.supabase.rpc('admin_listar_relatorios_vortx', { p_fundo_id: fundoId, p_pagina: pagina })
  if (error) throw new Error('Não foi possível carregar o histórico. Nenhuma consulta foi enviada à Vórtx.')
  return { contexto, historico: historicoRelatorioSchema.parse(data) }
}

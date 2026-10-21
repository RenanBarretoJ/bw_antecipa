import 'server-only'
import { AuthorizationError, requireAuthenticated } from '@/lib/auth/authorization'
import { contextoRelatoriosSchema, historicoRelatorioSchema, relatoriosPreviewPermitidos } from './relatorios-operacao'
import { filtrosBasesSchema, type FiltrosBases } from './central-bases'

export async function carregarContextoRelatorios(fundoId: string) {
  if (!relatoriosPreviewPermitidos(fundoId)) throw new AuthorizationError('Solicitação de relatórios indisponível neste ambiente ou Fundo.', 'FORBIDDEN')
  const auth = await requireAuthenticated()
  const { data, error } = await auth.supabase.rpc('vortx_contexto_relatorios', { p_fundo_id: fundoId })
  const parsed = contextoRelatoriosSchema.safeParse(data)
  if (error || !parsed.success || parsed.data.fundo.id !== fundoId) {
    throw new AuthorizationError('É necessário vínculo ativo com este Fundo.', 'FORBIDDEN')
  }
  return { auth, contexto: parsed.data }
}

export async function carregarHistoricoRelatorios(fundoId: string, pagina: number, filtros?: FiltrosBases) {
  const consulta = filtros === undefined ? undefined : filtrosBasesSchema.parse(filtros)
  const { auth, contexto } = await carregarContextoRelatorios(fundoId)
  const { data, error } = consulta === undefined
    ? await auth.supabase.rpc('admin_listar_relatorios_vortx', { p_fundo_id: fundoId, p_pagina: pagina })
    : await auth.supabase.rpc('vortx_central_bases_historico', { p_fundo_id: fundoId, p_pagina: pagina,
      p_tipo: consulta.tipo ?? null, p_origem: consulta.origem ?? null,
      p_estado: consulta.estado ?? null, p_referencia: consulta.referencia ?? null })
  if (error) throw new Error('Não foi possível carregar o histórico. Nenhuma consulta foi enviada à Vórtx.')
  const historico = historicoRelatorioSchema.parse(data)
  if ([...historico.solicitacoes, ...(historico.resumo || [])].some(row => row.fundo_id !== fundoId)) {
    throw new Error('Não foi possível confirmar o contexto do histórico.')
  }
  return { contexto, historico }
}

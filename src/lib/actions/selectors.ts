'use server'

import { requireAuthenticated } from '@/lib/auth/authorization'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { normalizeSearch } from '@/lib/pagination'
import { preservarOpcaoSelecionada } from '@/lib/selectors/remote'

export interface RemoteOption {
  value: string
  label: string
  description?: string
}

export async function buscarOpcoesEscopo(input: {
  tipo: 'cedente' | 'politica'
  q?: string
  selectedId?: string | null
}): Promise<{ success: true; options: RemoteOption[] } | { success: false; message: string }> {
  try {
    const auth = await requireAuthenticated()
    const q = normalizeSearch(input.q, 80).replace(/[,%().'"\u005c]/g, ' ')
    const selectedId = input.selectedId && /^[0-9a-f-]{36}$/i.test(input.selectedId) ? input.selectedId : null

    if (input.tipo === 'politica') {
      if (auth.profile.role !== 'gestor') return { success: false, message: 'Seletor indisponivel para o perfil atual.' }
      const contexto = await resolverContextoFundoGestor(auth)
      let query = auth.supabase
        .from('politicas_operacionais')
        .select('id, nome, codigo')
        .eq('fundo_id', contexto.fundoId)
        .eq('status', 'ativa')
      if (q) query = query.or(`nome.ilike.%${q}%,codigo.ilike.%${q}%`)
      const { data, error } = await query.order('nome').limit(20)
      if (error) throw error
      const { data: selecionada } = selectedId
        ? await auth.supabase
          .from('politicas_operacionais')
          .select('id, nome, codigo')
          .eq('id', selectedId)
          .eq('fundo_id', contexto.fundoId)
          .eq('status', 'ativa')
          .maybeSingle()
        : { data: null }
      return {
        success: true,
        options: preservarOpcaoSelecionada(
          (data || []).map((item) => ({ value: item.id, label: item.nome, description: item.codigo })),
          selecionada ? { value: selecionada.id, label: selecionada.nome, description: selecionada.codigo } : null,
        ),
      }
    }

    let cedenteIds: string[] = []
    if (auth.profile.role === 'gestor') {
      const contexto = await resolverContextoFundoGestor(auth)
      const { data, error } = await auth.supabase
        .from('cedente_fundos')
        .select('cedente_id')
        .eq('fundo_id', contexto.fundoId)
        .in('status', ['ativo', 'suspenso'])
      if (error) throw error
      cedenteIds = Array.from(new Set((data || []).map((item) => item.cedente_id)))
    } else if (auth.profile.role === 'consultor') {
      const { data, error } = await auth.supabase
        .from('consultor_cedente')
        .select('cedente_id')
        .eq('consultor_id', auth.user.id)
      if (error) throw error
      cedenteIds = Array.from(new Set((data || []).map((item) => item.cedente_id)))
    } else if (auth.profile.role === 'cedente') {
      // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto
      // um usuario convidado via cedente_acessos.
      const { data: cedenteId, error: cedenteIdError } = await auth.supabase.rpc('get_user_cedente_id')
      if (cedenteIdError) throw cedenteIdError
      cedenteIds = cedenteId ? [cedenteId] : []
    }
    if (!cedenteIds.length) return { success: true, options: [] }

    let query = auth.supabase.from('cedentes').select('id, razao_social, cnpj').in('id', cedenteIds)
    if (q) {
      const digitos = q.replace(/\D/g, '')
      query = query.or([`razao_social.ilike.%${q}%`, ...(digitos ? [`cnpj.ilike.%${digitos}%`] : [])].join(','))
    }
    const { data, error } = await query.order('razao_social').limit(20)
    if (error) throw error
    const { data: selecionada } = selectedId && cedenteIds.includes(selectedId)
      ? await auth.supabase
        .from('cedentes')
        .select('id, razao_social, cnpj')
        .eq('id', selectedId)
        .maybeSingle()
      : { data: null }
    return {
      success: true,
      options: preservarOpcaoSelecionada(
        (data || []).map((item) => ({ value: item.id, label: item.razao_social, description: item.cnpj })),
        selecionada ? { value: selecionada.id, label: selecionada.razao_social, description: selecionada.cnpj } : null,
      ),
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel carregar as opcoes.' }
  }
}

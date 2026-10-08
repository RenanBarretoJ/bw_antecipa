import 'server-only'
import { requireAuthenticated } from '@/lib/auth/authorization'
import { validarContextoNotificacoes } from './contexto.server'
import type { NotificacaoEscopo } from './contracts'

export async function resolverDestinoNotificacao(id: string, escopo: NotificacaoEscopo): Promise<string> {
  const auth = await requireAuthenticated()
  await validarContextoNotificacoes(auth, escopo)
  const { data, error } = await auth.supabase.rpc('obter_destino_notificacao', { p_id: id, p_scope: escopo.scope, p_fundo_id: escopo.fundoId })
  const destino = data?.[0]
  if (error || !destino) throw new Error('Notificação ou destino não autorizado neste contexto.')
  const role = auth.profile.role
  const base = role === 'super_admin' ? '/admin' : `/${role}`
  if (destino.entidade_tipo === 'seguranca') return `${base}/minha-conta/seguranca`
  if (destino.fundo_id !== escopo.fundoId) throw new Error('Contexto divergente.')
  const query = `?fundo=${encodeURIComponent(destino.fundo_id!)}`
  // Sacado has no standalone NF/operation detail route in this release. Use an
  // exact, protected origin view instead of an unfiltered multi-fund listing.
  if (role === 'sacado') return `/notificacoes/detalhe/${id}${query}`
  if (destino.entidade_tipo === 'nota_fiscal') {
    return `${base}/notas-fiscais/${destino.entidade_id}${query}`
  }
  if (destino.entidade_tipo === 'operacao') {
    return role === 'consultor' ? `/consultor/operacoes${query}&q=${destino.entidade_id}` : `${base}/operacoes/${destino.entidade_id}${query}`
  }
  if (destino.entidade_tipo === 'entrega') {
    const { data: entrega, error: entregaError } = await auth.supabase.from('nota_fiscal_entregas').select('operacao_id').eq('id', destino.entidade_id!).maybeSingle()
    if (entregaError || !entrega) throw new Error('Entrega não autorizada.')
    return role === 'consultor' ? `/consultor/operacoes${query}&q=${entrega.operacao_id}` : `${base}/operacoes/${entrega.operacao_id}${query}`
  }
  if (destino.entidade_tipo === 'evento_dominio') {
    const { data: evento, error: eventoError } = await auth.supabase.from('eventos_dominio').select('operacao_id, nota_fiscal_id').eq('id', destino.entidade_id!).maybeSingle()
    if (eventoError || !evento) throw new Error('Evento não autorizado.')
    if (evento.operacao_id) return role === 'consultor' ? `/consultor/operacoes${query}&q=${evento.operacao_id}` : `${base}/operacoes/${evento.operacao_id}${query}`
    if (evento.nota_fiscal_id) return `${base}/notas-fiscais/${evento.nota_fiscal_id}${query}`
  }
  if (role === 'gestor') return `/gestor/cedentes/${destino.cedente_id}${query}`
  if (role === 'consultor') return `/consultor/cedentes/${destino.cedente_id}/cadastro${query}`
  if (role === 'cedente') return `/cedente/cadastro${query}`
  throw new Error('Destino indisponível para este perfil.')
}

export async function carregarDetalheNotificacao(id: string, escopo: NotificacaoEscopo) {
  const auth = await requireAuthenticated()
  await validarContextoNotificacoes(auth, escopo)
  const { data, error } = await auth.supabase.rpc('obter_destino_notificacao', { p_id: id, p_scope: escopo.scope, p_fundo_id: escopo.fundoId })
  const destino = data?.[0]
  if (error || !destino || destino.fundo_id !== escopo.fundoId || escopo.scope !== 'FUNDO') throw new Error('Destino não autorizado.')
  const { data: aviso, error: avisoError } = await auth.supabase.from('notificacoes')
    .select('titulo, mensagem, created_at').eq('id', id).eq('usuario_id', auth.user.id).eq('scope_type', 'FUNDO').eq('fundo_id', escopo.fundoId).maybeSingle()
  if (avisoError || !aviso) throw new Error('Aviso indisponível.')
  let origem: { label: string; status: string; valor: number } | null = null
  if (destino.entidade_tipo === 'nota_fiscal') {
    const { data: nota, error: notaError } = await auth.supabase.from('notas_fiscais')
      .select('numero_nf, status, valor_bruto').eq('id', destino.entidade_id!).eq('fundo_id', escopo.fundoId).maybeSingle()
    if (notaError || !nota) throw new Error('Nota não autorizada.')
    origem = { label: `NF ${nota.numero_nf}`, status: nota.status, valor: Number(nota.valor_bruto) }
  } else if (destino.entidade_tipo === 'operacao') {
    const { data: op, error: opError } = await auth.supabase.from('operacoes')
      .select('id, status, valor_bruto_total').eq('id', destino.entidade_id!).maybeSingle()
    if (opError || !op) throw new Error('Operação não autorizada.')
    origem = { label: `Operação #${op.id.slice(0, 8)}`, status: op.status, valor: Number(op.valor_bruto_total) }
  }
  if (!origem) throw new Error('Tipo de destino indisponível.')
  const { data: fundos, error: fundosError } = await auth.supabase.rpc('listar_fundos_notificacoes')
  if (fundosError) throw new Error('Fundo indisponível.')
  return { aviso, origem, fundo: fundos?.find((f) => f.id === escopo.fundoId)?.nome, role: auth.profile.role }
}

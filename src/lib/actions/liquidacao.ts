'use server'

import { createClient } from '@/lib/supabase/server'
import { registrarLog } from './auditoria'
import { criarNotificacao, notificarGestores } from './notificacao'

export type LiquidacaoState = {
  success?: boolean
  message?: string
} | undefined

// Gestor: liquidar operacao (confirmar que sacado pagou)
export async function liquidarOperacao(operacaoId: string): Promise<LiquidacaoState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { data: op } = await supabase
    .from('operacoes')
    .select('id, status, valor_bruto_total, valor_liquido_desembolso, conta_escrow_id, cedente_id, cedentes(user_id, razao_social)')
    .eq('id', operacaoId)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }
  const opData = op as {
    id: string; status: string; valor_bruto_total: number; valor_liquido_desembolso: number;
    conta_escrow_id: string; cedente_id: string;
    cedentes: { user_id: string; razao_social: string }
  }

  if (opData.status !== 'em_andamento' && opData.status !== 'inadimplente') {
    return { success: false, message: 'Operacao nao pode ser liquidada neste status.' }
  }

  // Atualizar status
  await supabase
    .from('operacoes')
    .update({ status: 'liquidada' } as never)
    .eq('id', operacaoId)

  // Atualizar NFs para liquidada
  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  if (opNfs) {
    const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
    await supabase
      .from('notas_fiscais')
      .update({ status: 'liquidada' } as never)
      .in('id', nfIds)
  }

  // Registrar credito do pagamento do sacado na escrow
  const receita = opData.valor_bruto_total - opData.valor_liquido_desembolso
  if (receita > 0 && opData.conta_escrow_id) {
    const { data: conta } = await supabase
      .from('contas_escrow')
      .select('saldo_disponivel')
      .eq('id', opData.conta_escrow_id)
      .single()

    if (conta) {
      const saldo = (conta as { saldo_disponivel: number }).saldo_disponivel
      const novoSaldo = saldo + receita

      await supabase
        .from('contas_escrow')
        .update({ saldo_disponivel: novoSaldo } as never)
        .eq('id', opData.conta_escrow_id)

      await supabase.from('movimentos_escrow').insert({
        conta_escrow_id: opData.conta_escrow_id,
        tipo: 'credito',
        descricao: `Liquidacao operacao #${operacaoId.substring(0, 8)} - Pagamento sacado`,
        valor: opData.valor_bruto_total,
        saldo_apos: novoSaldo,
        operacao_id: operacaoId,
      } as never)
    }
  }

  // Notificar cedente
  await criarNotificacao({
    usuario_id: opData.cedentes.user_id,
    titulo: 'Operacao liquidada!',
    mensagem: `A operacao #${operacaoId.substring(0, 8)} foi liquidada. O sacado efetuou o pagamento.`,
    tipo: 'operacao_liquidada',
  })

  await registrarLog({
    tipo_evento: 'OPERACAO_LIQUIDADA',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_antes: { status: opData.status },
    dados_depois: { status: 'liquidada' },
  })

  return { success: true, message: 'Operacao liquidada com sucesso!' }
}

// Gestor: marcar operacao como inadimplente
export async function marcarInadimplente(operacaoId: string): Promise<LiquidacaoState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: op } = await supabase
    .from('operacoes')
    .select('status, cedentes(user_id)')
    .eq('id', operacaoId)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }
  const opData = op as { status: string; cedentes: { user_id: string } }

  await supabase
    .from('operacoes')
    .update({ status: 'inadimplente' } as never)
    .eq('id', operacaoId)

  await criarNotificacao({
    usuario_id: opData.cedentes.user_id,
    titulo: 'ALERTA: Operacao inadimplente',
    mensagem: `A operacao #${operacaoId.substring(0, 8)} foi marcada como inadimplente. O sacado nao efetuou o pagamento no vencimento.`,
    tipo: 'operacao_inadimplente',
  })

  await registrarLog({
    tipo_evento: 'OPERACAO_INADIMPLENTE',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_antes: { status: opData.status },
    dados_depois: { status: 'inadimplente' },
  })

  return { success: true, message: 'Operacao marcada como inadimplente.' }
}

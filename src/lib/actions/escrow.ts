'use server'

import { createClient } from '@/lib/supabase/server'
import { registrarLog } from './auditoria'

export type EscrowActionState = {
  success?: boolean
  message?: string
} | undefined

// Registrar movimento na conta escrow (usado internamente e pela API externa)
export async function registrarMovimentoEscrow({
  conta_escrow_id,
  tipo,
  descricao,
  valor,
  operacao_id,
}: {
  conta_escrow_id: string
  tipo: 'credito' | 'debito'
  descricao: string
  valor: number
  operacao_id?: string | null
}): Promise<EscrowActionState> {
  const supabase = await createClient()

  if (valor <= 0) return { success: false, message: 'Valor deve ser positivo.' }

  // Buscar saldo atual
  const { data: conta } = await supabase
    .from('contas_escrow')
    .select('saldo_disponivel, status')
    .eq('id', conta_escrow_id)
    .single()

  if (!conta) return { success: false, message: 'Conta escrow nao encontrada.' }
  const contaData = conta as { saldo_disponivel: number; status: string }

  if (contaData.status !== 'ativa') {
    return { success: false, message: 'Conta escrow nao esta ativa.' }
  }

  const novoSaldo = tipo === 'credito'
    ? contaData.saldo_disponivel + valor
    : contaData.saldo_disponivel - valor

  if (tipo === 'debito' && novoSaldo < 0) {
    return { success: false, message: 'Saldo insuficiente.' }
  }

  // Atualizar saldo
  const { error: updateError } = await supabase
    .from('contas_escrow')
    .update({ saldo_disponivel: novoSaldo } as never)
    .eq('id', conta_escrow_id)

  if (updateError) return { success: false, message: `Erro ao atualizar saldo: ${updateError.message}` }

  // Registrar movimento
  const { error: movError } = await supabase.from('movimentos_escrow').insert({
    conta_escrow_id,
    tipo,
    descricao,
    valor,
    saldo_apos: novoSaldo,
    operacao_id: operacao_id || null,
  } as never)

  if (movError) return { success: false, message: `Erro ao registrar movimento: ${movError.message}` }

  await registrarLog({
    tipo_evento: tipo === 'credito' ? 'ESCROW_CREDITO' : 'ESCROW_DEBITO',
    entidade_tipo: 'movimentos_escrow',
    entidade_id: conta_escrow_id,
    dados_depois: { tipo, valor, descricao, saldo_apos: novoSaldo },
  })

  return { success: true, message: 'Movimento registrado.' }
}

// Registrar multiplos movimentos em lote (para sync com API externa)
export async function registrarMovimentosLote(
  conta_escrow_id: string,
  movimentos: Array<{
    tipo: 'credito' | 'debito'
    descricao: string
    valor: number
    data?: string
    referencia_externa?: string
  }>
): Promise<EscrowActionState> {
  const supabase = await createClient()

  const { data: conta } = await supabase
    .from('contas_escrow')
    .select('saldo_disponivel, status')
    .eq('id', conta_escrow_id)
    .single()

  if (!conta) return { success: false, message: 'Conta escrow nao encontrada.' }
  const contaData = conta as { saldo_disponivel: number; status: string }

  if (contaData.status !== 'ativa') {
    return { success: false, message: 'Conta escrow nao esta ativa.' }
  }

  let saldoAtual = contaData.saldo_disponivel
  const rows = []

  for (const mov of movimentos) {
    if (mov.valor <= 0) continue

    const novoSaldo = mov.tipo === 'credito'
      ? saldoAtual + mov.valor
      : saldoAtual - mov.valor

    rows.push({
      conta_escrow_id,
      tipo: mov.tipo,
      descricao: mov.referencia_externa
        ? `${mov.descricao} [Ref: ${mov.referencia_externa}]`
        : mov.descricao,
      valor: mov.valor,
      saldo_apos: novoSaldo,
      operacao_id: null,
    })

    saldoAtual = novoSaldo
  }

  if (rows.length === 0) return { success: false, message: 'Nenhum movimento valido.' }

  // Inserir todos os movimentos
  const { error: movError } = await supabase.from('movimentos_escrow').insert(rows as never[])
  if (movError) return { success: false, message: `Erro ao registrar movimentos: ${movError.message}` }

  // Atualizar saldo final
  const { error: updateError } = await supabase
    .from('contas_escrow')
    .update({ saldo_disponivel: saldoAtual } as never)
    .eq('id', conta_escrow_id)

  if (updateError) return { success: false, message: `Erro ao atualizar saldo: ${updateError.message}` }

  await registrarLog({
    tipo_evento: 'ESCROW_SYNC_EXTERNO',
    entidade_tipo: 'contas_escrow',
    entidade_id: conta_escrow_id,
    dados_depois: { movimentos_count: rows.length, saldo_final: saldoAtual },
  })

  return { success: true, message: `${rows.length} movimento(s) registrado(s). Saldo atualizado.` }
}

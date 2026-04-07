'use server'

import { createClient } from '@/lib/supabase/server'
import { registrarLog } from './auditoria'
import { criarNotificacao, notificarGestores } from './notificacao'

export type OperacaoActionState = {
  success?: boolean
  message?: string
  data?: Record<string, unknown>
} | undefined

// ============================================================
// CEDENTE — Solicitar antecipacao
// ============================================================

export async function solicitarAntecipacao(nfIds: string[]): Promise<OperacaoActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  if (!nfIds || nfIds.length === 0) {
    return { success: false, message: 'Selecione ao menos uma NF.' }
  }

  // Buscar cedente
  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id, cnpj, razao_social, status')
    .eq('user_id', user.id)
    .single()

  if (!cedente) return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  const ced = cedente as { id: string; cnpj: string; razao_social: string; status: string }

  if (ced.status !== 'ativo') {
    return { success: false, message: 'Seu cadastro precisa estar ativo para solicitar antecipacoes.' }
  }

  // Buscar conta escrow
  const { data: escrow } = await supabase
    .from('contas_escrow')
    .select('id')
    .eq('cedente_id', ced.id)
    .eq('status', 'ativa')
    .single()

  if (!escrow) return { success: false, message: 'Conta escrow nao encontrada ou inativa.' }
  const escrowData = escrow as { id: string }

  // Buscar NFs selecionadas — devem ser aprovadas e pertencer ao cedente
  const { data: nfs } = await supabase
    .from('notas_fiscais')
    .select('id, valor_bruto, data_vencimento, status, numero_nf, cnpj_destinatario, razao_social_destinatario')
    .in('id', nfIds)
    .eq('cedente_id', ced.id)
    .eq('status', 'aprovada')

  if (!nfs || nfs.length === 0) {
    return { success: false, message: 'Nenhuma NF aprovada selecionada ou NFs nao pertencem a voce.' }
  }

  const nfsTyped = nfs as Array<{
    id: string; valor_bruto: number; data_vencimento: string; status: string;
    numero_nf: string; cnpj_destinatario: string; razao_social_destinatario: string
  }>

  if (nfsTyped.length !== nfIds.length) {
    return {
      success: false,
      message: `${nfIds.length - nfsTyped.length} NF(s) nao estao disponiveis (ja antecipadas, nao aprovadas ou nao encontradas).`,
    }
  }

  // Calcular totais
  const valorBrutoTotal = nfsTyped.reduce((acc, nf) => acc + nf.valor_bruto, 0)

  // Pegar a data de vencimento mais distante
  const dataVencimento = nfsTyped.reduce((max, nf) => {
    return nf.data_vencimento > max ? nf.data_vencimento : max
  }, nfsTyped[0].data_vencimento)

  // Calcular prazo em dias
  const hoje = new Date()
  const venc = new Date(dataVencimento)
  const prazoDias = Math.max(1, Math.ceil((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)))

  // Buscar taxa pre-configurada para este cedente e prazo
  const { data: taxas } = await supabase
    .from('taxas_cedente')
    .select('taxa_percentual, prazo_min, prazo_max')
    .eq('cedente_id', ced.id)
    .lte('prazo_min', prazoDias)
    .gte('prazo_max', prazoDias)
    .limit(1)

  const taxasTyped = (taxas || []) as Array<{ taxa_percentual: number; prazo_min: number; prazo_max: number }>
  const taxaDesconto = taxasTyped.length > 0 ? taxasTyped[0].taxa_percentual : 0

  // Calcular valor liquido estimado (taxa mensal proporcional ao prazo)
  const taxaProporcional = (taxaDesconto / 100) * (prazoDias / 30)
  const valorLiquidoDesembolso = valorBrutoTotal * (1 - taxaProporcional)

  // Criar operacao
  const { data: operacao, error: opError } = await supabase
    .from('operacoes')
    .insert({
      cedente_id: ced.id,
      conta_escrow_id: escrowData.id,
      valor_bruto_total: valorBrutoTotal,
      taxa_desconto: taxaDesconto,
      prazo_dias: prazoDias,
      valor_liquido_desembolso: Math.max(0, valorLiquidoDesembolso),
      data_vencimento: dataVencimento,
      status: 'solicitada',
    } as never)
    .select('id')
    .single()

  if (opError) {
    console.error('[solicitarAntecipacao]', opError.message)
    return { success: false, message: `Erro ao criar operacao: ${opError.message}` }
  }

  const opData = operacao as { id: string }

  // Vincular NFs a operacao
  const vinculos = nfsTyped.map((nf) => ({
    operacao_id: opData.id,
    nota_fiscal_id: nf.id,
  }))

  await supabase.from('operacoes_nfs').insert(vinculos as never[])

  // Atualizar status das NFs para em_antecipacao
  await supabase
    .from('notas_fiscais')
    .update({ status: 'em_antecipacao' } as never)
    .in('id', nfIds)

  // Notificar gestores
  await notificarGestores(
    'Nova solicitacao de antecipacao',
    `O cedente ${ced.razao_social} solicitou antecipacao de ${nfsTyped.length} NF(s), valor bruto total ${formatBRL(valorBrutoTotal)}.`,
    'operacao_solicitada'
  )

  await registrarLog({
    tipo_evento: 'OPERACAO_SOLICITADA',
    entidade_tipo: 'operacoes',
    entidade_id: opData.id,
    dados_depois: {
      valor_bruto_total: valorBrutoTotal,
      taxa_desconto: taxaDesconto,
      prazo_dias: prazoDias,
      nfs: nfsTyped.map((n) => n.numero_nf),
    },
  })

  return {
    success: true,
    message: taxaDesconto > 0
      ? `Solicitacao criada! Taxa pre-configurada: ${taxaDesconto}% a.m. Valor liquido estimado: ${formatBRL(valorLiquidoDesembolso)}.`
      : 'Solicitacao criada! O gestor definira a taxa e valor liquido.',
    data: { operacaoId: opData.id },
  }
}

// ============================================================
// GESTOR — Aprovar operacao com desembolso
// ============================================================

export async function aprovarOperacao(
  operacaoId: string,
  taxaDesconto: number,
  prazoDias: number,
  valorLiquidoDesembolso: number
): Promise<OperacaoActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  // Verificar role gestor
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  if (taxaDesconto < 0) return { success: false, message: 'Taxa deve ser >= 0.' }
  if (valorLiquidoDesembolso <= 0) return { success: false, message: 'Valor liquido deve ser > 0.' }

  // Buscar operacao
  const { data: op } = await supabase
    .from('operacoes')
    .select('*, cedentes(user_id, razao_social, cnpj)')
    .eq('id', operacaoId)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }
  const opData = op as {
    id: string; status: string; cedente_id: string; conta_escrow_id: string;
    valor_bruto_total: number;
    cedentes: { user_id: string; razao_social: string; cnpj: string }
  }

  if (opData.status !== 'solicitada' && opData.status !== 'em_analise') {
    return { success: false, message: `Operacao com status "${opData.status}" nao pode ser aprovada.` }
  }

  // Verificar que todas as NFs foram aceitas pelo sacado
  const { data: opNfsCheck } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  if (opNfsCheck && opNfsCheck.length > 0) {
    const nfIdsCheck = (opNfsCheck as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
    const { data: nfsCheck } = await supabase
      .from('notas_fiscais')
      .select('numero_nf, status')
      .in('id', nfIdsCheck)

    const pendentes = (nfsCheck || [])
      .filter((n) => (n as { numero_nf: string; status: string }).status !== 'aceita')
      .map((n) => (n as { numero_nf: string; status: string }).numero_nf)

    if (pendentes.length > 0) {
      return {
        success: false,
        message: `As seguintes NFs ainda nao foram aceitas pelo sacado: ${pendentes.join(', ')}`,
      }
    }
  }

  // Atualizar operacao
  const { error } = await supabase
    .from('operacoes')
    .update({
      taxa_desconto: taxaDesconto,
      prazo_dias: prazoDias,
      valor_liquido_desembolso: valorLiquidoDesembolso,
      status: 'em_andamento',
      aprovado_por: user.id,
      aprovado_em: new Date().toISOString(),
    } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro ao aprovar: ${error.message}` }

  // Registrar credito na conta escrow
  const { data: escrow } = await supabase
    .from('contas_escrow')
    .select('saldo_disponivel')
    .eq('id', opData.conta_escrow_id)
    .single()

  const saldoAtual = (escrow as { saldo_disponivel: number } | null)?.saldo_disponivel || 0
  const novoSaldo = saldoAtual + valorLiquidoDesembolso

  await supabase
    .from('contas_escrow')
    .update({ saldo_disponivel: novoSaldo } as never)
    .eq('id', opData.conta_escrow_id)

  // Registrar movimento escrow
  await supabase.from('movimentos_escrow').insert({
    conta_escrow_id: opData.conta_escrow_id,
    tipo: 'credito',
    descricao: `Desembolso antecipacao - Operacao ${operacaoId.substring(0, 8)}`,
    valor: valorLiquidoDesembolso,
    saldo_apos: novoSaldo,
    operacao_id: operacaoId,
  } as never)

  // Notificar cedente
  await criarNotificacao({
    usuario_id: opData.cedentes.user_id,
    titulo: 'Operacao aprovada! Desembolso realizado.',
    mensagem: `Sua operacao foi aprovada. Valor desembolsado: ${formatBRL(valorLiquidoDesembolso)} (taxa: ${taxaDesconto}% a.m., prazo: ${prazoDias} dias). Confira seu extrato.`,
    tipo: 'operacao_aprovada',
  })

  // Buscar NFs da operacao para notificar sacados
  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  if (opNfs) {
    const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
    const { data: nfs } = await supabase
      .from('notas_fiscais')
      .select('cnpj_destinatario, razao_social_destinatario, numero_nf')
      .in('id', nfIds)

    if (nfs) {
      // Notificar sacados unicos
      const sacadosCnpjs = [...new Set((nfs as Array<{ cnpj_destinatario: string }>).map((n) => n.cnpj_destinatario))]
      for (const cnpj of sacadosCnpjs) {
        const { data: sacado } = await supabase
          .from('sacados')
          .select('user_id')
          .eq('cnpj', cnpj)
          .single()

        if (sacado) {
          const sacadoData = sacado as { user_id: string }
          const nfsDeSacado = (nfs as Array<{ cnpj_destinatario: string; numero_nf: string }>)
            .filter((n) => n.cnpj_destinatario === cnpj)
            .map((n) => n.numero_nf)
            .join(', ')

          await criarNotificacao({
            usuario_id: sacadoData.user_id,
            titulo: 'Notificacao de cessao de credito',
            mensagem: `As NFs ${nfsDeSacado} emitidas contra voce foram cedidas ao cedente ${opData.cedentes.razao_social}. O pagamento no vencimento devera ser realizado na conta escrow indicada.`,
            tipo: 'cessao_credito',
          })
        }
      }
    }
  }

  await registrarLog({
    tipo_evento: 'OPERACAO_APROVADA',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_antes: { status: opData.status },
    dados_depois: {
      status: 'em_andamento',
      taxa_desconto: taxaDesconto,
      prazo_dias: prazoDias,
      valor_liquido_desembolso: valorLiquidoDesembolso,
    },
  })

  return { success: true, message: `Operacao aprovada. Desembolso de ${formatBRL(valorLiquidoDesembolso)} realizado.` }
}

// ============================================================
// GESTOR — Reprovar operacao
// ============================================================

export async function reprovarOperacao(operacaoId: string, motivo: string): Promise<OperacaoActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  if (!motivo?.trim()) return { success: false, message: 'Motivo e obrigatorio.' }

  const { data: op } = await supabase
    .from('operacoes')
    .select('status, cedente_id, cedentes(user_id, razao_social)')
    .eq('id', operacaoId)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }
  const opData = op as { status: string; cedente_id: string; cedentes: { user_id: string; razao_social: string } }

  // Atualizar operacao
  const { error } = await supabase
    .from('operacoes')
    .update({ status: 'reprovada', motivo_reprovacao: motivo } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro: ${error.message}` }

  // Devolver NFs para status aprovada (disponiveis novamente)
  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  if (opNfs) {
    const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
    await supabase
      .from('notas_fiscais')
      .update({ status: 'aprovada' } as never)
      .in('id', nfIds)
  }

  await criarNotificacao({
    usuario_id: opData.cedentes.user_id,
    titulo: 'Operacao reprovada',
    mensagem: `Sua solicitacao de antecipacao foi reprovada. Motivo: ${motivo}. As NFs estao disponiveis para nova solicitacao.`,
    tipo: 'operacao_reprovada',
  })

  await registrarLog({
    tipo_evento: 'OPERACAO_REPROVADA',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_antes: { status: opData.status },
    dados_depois: { status: 'reprovada', motivo },
  })

  return { success: true, message: 'Operacao reprovada.' }
}

// ============================================================
// CEDENTE — Cancelar operacao (so se ainda nao aprovada)
// ============================================================

export async function cancelarOperacao(operacaoId: string): Promise<OperacaoActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (!cedente) return { success: false, message: 'Cedente nao encontrado.' }
  const ced = cedente as { id: string }

  const { data: op } = await supabase
    .from('operacoes')
    .select('status')
    .eq('id', operacaoId)
    .eq('cedente_id', ced.id)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }
  const opData = op as { status: string }

  if (opData.status !== 'solicitada' && opData.status !== 'em_analise') {
    return { success: false, message: 'So e possivel cancelar operacoes que ainda nao foram aprovadas.' }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({ status: 'cancelada' } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro: ${error.message}` }

  // Devolver NFs para aprovada
  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  if (opNfs) {
    const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
    await supabase
      .from('notas_fiscais')
      .update({ status: 'aprovada' } as never)
      .in('id', nfIds)
  }

  await registrarLog({
    tipo_evento: 'OPERACAO_CANCELADA',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_antes: { status: opData.status },
    dados_depois: { status: 'cancelada' },
  })

  return { success: true, message: 'Operacao cancelada. NFs disponiveis para nova solicitacao.' }
}

// ============================================================
// GESTOR — Gerenciar taxas pre-configuradas do cedente
// ============================================================

export async function salvarTaxasCedente(
  cedenteId: string,
  taxas: Array<{ prazo_min: number; prazo_max: number; taxa_percentual: number }>
): Promise<OperacaoActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  // Validar taxas
  for (const t of taxas) {
    if (t.prazo_min < 0 || t.prazo_max < t.prazo_min || t.taxa_percentual < 0) {
      return { success: false, message: 'Valores de prazo/taxa invalidos.' }
    }
  }

  // Remover taxas existentes
  await supabase.from('taxas_cedente').delete().eq('cedente_id', cedenteId)

  if (taxas.length > 0) {
    const rows = taxas.map((t) => ({
      cedente_id: cedenteId,
      prazo_min: t.prazo_min,
      prazo_max: t.prazo_max,
      taxa_percentual: t.taxa_percentual,
    }))

    const { error } = await supabase.from('taxas_cedente').insert(rows as never[])
    if (error) return { success: false, message: `Erro: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: 'TAXAS_ATUALIZADAS',
    entidade_tipo: 'taxas_cedente',
    entidade_id: cedenteId,
    dados_depois: { taxas },
  })

  return { success: true, message: 'Taxas salvas com sucesso.' }
}

// Remover NF contestada de uma operacao
export async function removerNfDaOperacao(
  operacaoId: string,
  nfId: string
): Promise<OperacaoActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  // Buscar operacao
  const { data: op } = await supabase
    .from('operacoes')
    .select('*, cedentes(user_id, razao_social)')
    .eq('id', operacaoId)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }
  const opData = op as {
    id: string; status: string; cedente_id: string; conta_escrow_id: string;
    valor_bruto_total: number;
    cedentes: { user_id: string; razao_social: string }
  }

  const statusPermitidos = ['solicitada', 'em_analise', 'em_andamento']
  if (!statusPermitidos.includes(opData.status)) {
    return { success: false, message: `Nao e possivel remover NFs de uma operacao com status "${opData.status}".` }
  }

  // Buscar NF e verificar que pertence a operacao e esta contestada
  const { data: vinculo } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)
    .eq('nota_fiscal_id', nfId)
    .single()

  if (!vinculo) return { success: false, message: 'NF nao encontrada nesta operacao.' }

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, status, valor_bruto')
    .eq('id', nfId)
    .single()

  if (!nf) return { success: false, message: 'NF nao encontrada.' }
  const nfData = nf as { id: string; numero_nf: string; status: string; valor_bruto: number }

  if (nfData.status !== 'contestada') {
    return { success: false, message: 'Apenas NFs com status "contestada" podem ser removidas.' }
  }

  // Remover vinculo
  await supabase
    .from('operacoes_nfs')
    .delete()
    .eq('operacao_id', operacaoId)
    .eq('nota_fiscal_id', nfId)

  // Reverter NF para aprovada
  await supabase
    .from('notas_fiscais')
    .update({ status: 'aprovada' } as never)
    .eq('id', nfId)

  // Buscar NFs restantes para recalcular valor
  const { data: restantes } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  const wasEmAndamento = opData.status === 'em_andamento'

  if (!restantes || restantes.length === 0) {
    // Sem NFs restantes — cancelar operacao
    await supabase
      .from('operacoes')
      .update({ status: 'cancelada' } as never)
      .eq('id', operacaoId)

    await registrarLog({
      tipo_evento: 'NF_REMOVIDA_CONTESTACAO',
      entidade_tipo: 'operacoes',
      entidade_id: operacaoId,
      dados_depois: { nf_removida: nfData.numero_nf, operacao_cancelada: true },
    })

    await criarNotificacao({
      usuario_id: opData.cedentes.user_id,
      titulo: 'Operacao cancelada — NF removida',
      mensagem: `A NF ${nfData.numero_nf} foi removida da operacao pois foi contestada pelo sacado. Como era a unica NF, a operacao foi cancelada.`,
      tipo: 'operacao_cancelada',
    })

    const aviso = wasEmAndamento ? ' ATENCAO: A operacao ja estava em andamento — verifique o saldo da conta escrow.' : ''
    return { success: true, message: `NF ${nfData.numero_nf} removida. Operacao cancelada pois nao havia mais NFs.${aviso}` }
  }

  // Recalcular valor_bruto_total com NFs restantes
  const nfIdsRestantes = (restantes as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
  const { data: nfsRestantes } = await supabase
    .from('notas_fiscais')
    .select('valor_bruto')
    .in('id', nfIdsRestantes)

  const novoValorBruto = (nfsRestantes || []).reduce(
    (acc, n) => acc + ((n as { valor_bruto: number }).valor_bruto || 0), 0
  )

  await supabase
    .from('operacoes')
    .update({ valor_bruto_total: novoValorBruto } as never)
    .eq('id', operacaoId)

  await registrarLog({
    tipo_evento: 'NF_REMOVIDA_CONTESTACAO',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_depois: { nf_removida: nfData.numero_nf, novo_valor_bruto: novoValorBruto },
  })

  await criarNotificacao({
    usuario_id: opData.cedentes.user_id,
    titulo: 'NF removida da operacao',
    mensagem: `A NF ${nfData.numero_nf} foi removida da operacao pois foi contestada pelo sacado. O valor da operacao foi recalculado para ${formatBRL(novoValorBruto)}.`,
    tipo: 'nf_removida_contestacao',
  })

  const aviso = wasEmAndamento ? ' ATENCAO: A operacao ja estava em andamento — os termos financeiros precisam ser ajustados manualmente.' : ''
  return { success: true, message: `NF ${nfData.numero_nf} removida. Novo valor bruto: ${formatBRL(novoValorBruto)}.${aviso}` }
}

// Helper
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

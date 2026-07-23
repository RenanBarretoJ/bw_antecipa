'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAuthenticated, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { registrarLog } from './auditoria'
import { criarNotificacao, notificarCedente, notificarGestores } from './notificacao'
import { criarSnapshotPolitica, resolverPoliticaAtiva, statusAceiteInicial } from '@/lib/operacoes/politica'
import { CedenteFundoError } from '@/lib/fundos/cedente-fundo'
import { verificarElegibilidadeDocumental } from '@/lib/actions/documento-v2'
import { validarElegibilidadeAprovacao, validarElegibilidadeSolicitacao } from '@/lib/operacoes/elegibilidade'
import { montarIdempotencyKeySolicitacaoOperacao } from '@/lib/operacoes/idempotencia'

export type OperacaoActionState = {
  success?: boolean
  message?: string
  data?: Record<string, unknown>
} | undefined

// ============================================================
// CEDENTE — Solicitar antecipacao
// ============================================================

export async function solicitarAntecipacao(nfIds: string[]): Promise<OperacaoActionState> {
  await requireAuthenticated()
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
    .single()

  if (!cedente) return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  const ced = cedente as { id: string; cnpj: string; razao_social: string; status: string }

  if (ced.status !== 'ativo') {
    return { success: false, message: 'Seu cadastro precisa estar ativo para solicitar antecipacoes.' }
  }

  // A operacao nova precisa capturar o contexto vigente antes de qualquer alteracao operacional.
  let politicaContexto
  try {
    politicaContexto = await resolverPoliticaAtiva(ced.id, supabase)
  } catch (error) {
    if (error instanceof CedenteFundoError) return { success: false, message: error.message }
    return { success: false, message: 'Nao foi possivel resolver a politica operacional vigente.' }
  }
  const politicaSnapshot = criarSnapshotPolitica(politicaContexto)
  const aceiteSacadoExigido = politicaContexto.versao.aceite_sacado_obrigatorio
  const aceiteSacadoStatus = statusAceiteInicial(aceiteSacadoExigido)

  // Buscar conta escrow
  const { data: escrow } = await supabase
    .from('contas_escrow')
    .select('id')
    .eq('cedente_id', ced.id)
    .eq('status', 'ativa')
    .single()

  if (!escrow) return { success: false, message: 'Conta escrow nao encontrada ou inativa.' }

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

  // Calcular por NF: prazo individual → taxa individual → valor antecipado individual
  const elegibilidades = await Promise.all(nfsTyped.map(async (nf) => ({
    nf,
    resultado: await verificarElegibilidadeDocumental(nf.id),
  })))
  const inelegiveis = elegibilidades.filter(({ resultado }) => !resultado.elegivel)
  if (inelegiveis.length > 0) {
    return {
      success: false,
      message: inelegiveis.map(({ nf, resultado }) => `NF ${nf.numero_nf}: ${resultado.motivos.join(', ')}`).join(' | '),
    }
  }

  const solicitacaoGate = validarElegibilidadeSolicitacao({
    snapshot: politicaSnapshot.snapshot as unknown as Record<string, unknown>,
    politicaOperacionalVersaoId: politicaContexto.versao.id,
    aceiteSacadoObrigatorio: aceiteSacadoExigido,
    quantidadeNfs: nfsTyped.length,
  })
  if (!solicitacaoGate.elegivel) return { success: false, message: solicitacaoGate.bloqueios.join(' ') }

  const hoje = new Date()

  // Buscar todas as taxas do cedente em uma unica query
  const { data: todasTaxas } = await supabase
    .from('taxas_cedente')
    .select('prazo_min, prazo_max, taxa_percentual')
    .eq('cedente_id', ced.id)

  const taxasDisp = (todasTaxas || []) as Array<{ prazo_min: number; prazo_max: number; taxa_percentual: number }>

  const nfsCalculadas = nfsTyped.map((nf) => {
    const prazoDias = Math.max(1, Math.ceil(
      (new Date(nf.data_vencimento).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
    ))
    const taxaConfig = taxasDisp.find((t) => prazoDias >= t.prazo_min && prazoDias <= t.prazo_max)
    const taxa = taxaConfig?.taxa_percentual || 0
    const fator = Math.pow(1 + taxa / 100, prazoDias / 30)
    const valorAntecipado = Math.round((nf.valor_bruto / fator) * 100) / 100
    return { ...nf, prazoDias, taxa, valorAntecipado }
  })

  const valorBrutoTotal = nfsCalculadas.reduce((acc, nf) => acc + nf.valor_bruto, 0)
  const valorLiquidoDesembolso = nfsCalculadas.reduce((acc, nf) => acc + nf.valorAntecipado, 0)

  // Taxa e prazo medios ponderados (referencia para a operacao)
  const taxaMedia = valorBrutoTotal > 0
    ? nfsCalculadas.reduce((acc, nf) => acc + nf.taxa * nf.valor_bruto, 0) / valorBrutoTotal
    : 0
  const prazoMedio = valorBrutoTotal > 0
    ? Math.round(nfsCalculadas.reduce((acc, nf) => acc + nf.prazoDias * nf.valor_bruto, 0) / valorBrutoTotal)
    : 0
  const dataVencimento = nfsCalculadas.reduce(
    (max, nf) => nf.data_vencimento > max ? nf.data_vencimento : max,
    nfsCalculadas[0].data_vencimento
  )

  const idempotencyKey = montarIdempotencyKeySolicitacaoOperacao({
    userId: user.id,
    cedenteId: ced.id,
    cedenteFundoId: politicaContexto.cedenteFundo.id,
    politicaVersaoId: politicaContexto.versao.id,
    nfIds,
  })

  const { data: operacao, error: opError } = await supabase.rpc('solicitar_operacao_antecipacao_atomica', {
    p_cedente_id: ced.id,
    p_cedente_fundo_id: politicaContexto.cedenteFundo.id,
    p_politica_operacional_id: politicaContexto.politica.id,
    p_politica_operacional_versao_id: politicaContexto.versao.id,
    p_politica_versao: politicaContexto.versao.versao,
    p_politica_snapshot: politicaSnapshot.snapshot,
    p_politica_snapshot_hash: politicaSnapshot.hash,
    p_aceite_sacado_exigido: aceiteSacadoExigido,
    p_aceite_sacado_status: aceiteSacadoStatus,
    p_nota_fiscal_ids: nfIds,
    p_valor_bruto_total: valorBrutoTotal,
    p_taxa_desconto: taxaMedia,
    p_prazo_dias: prazoMedio,
    p_valor_liquido_desembolso: Math.max(0, valorLiquidoDesembolso),
    p_data_vencimento: dataVencimento,
    p_idempotency_key: idempotencyKey,
  } as never)

  if (opError) {
    console.error('[solicitarAntecipacao]', {
      etapa: 'rpc_solicitar_operacao_antecipacao_atomica',
      user_id: user.id,
      cedente_id: ced.id,
      cedente_fundo_id: politicaContexto.cedenteFundo.id,
      nf_ids: nfIds,
      erro: opError.message,
    })
    return { success: false, message: `Erro ao criar operacao: ${opError.message}` }
  }

  const operacaoResultado = operacao as { operacao_id?: string; idempotent_replay?: boolean } | null
  const opData = { id: operacaoResultado?.operacao_id || '', idempotentReplay: !!operacaoResultado?.idempotent_replay }
  if (!opData.id) return { success: false, message: 'Operacao criada sem identificador retornado pelo banco.' }

  const mensagemSolicitacao = `O cedente ${ced.razao_social} solicitou antecipacao de ${nfsTyped.length} NF(s), valor bruto total ${formatBRL(valorBrutoTotal)}.`
  if (opData.idempotentReplay) {
    // Retry idempotente: a operacao ja existe; nao reenfileira notificacoes nem logs complementares.
  } else if (aceiteSacadoExigido) {
    await notificarGestores('Nova solicitacao de antecipacao', mensagemSolicitacao, 'operacao_solicitada', `operacao:${opData.id}:solicitada`)
  } else {
    await notificarGestores(
      'Nova operação disponível para análise',
      `${mensagemSolicitacao} O aceite do sacado foi dispensado pela política registrada no snapshot.`,
      'operacao_disponivel_analise',
      `operacao:${opData.id}:encaminhada_gestor`,
    )
    await notificarCedente(
      ced.id,
      'Operação solicitada e encaminhada à gestora',
      `A operação foi criada e encaminhada para análise da gestora. O aceite do sacado foi dispensado pela política da operação.`,
      'operacao_encaminhada_gestor',
      `operacao:${opData.id}:encaminhada_cedente`,
    )
    await registrarLog({
      tipo_evento: 'ACEITE_SACADO_DISPENSADO',
      entidade_tipo: 'operacoes',
      entidade_id: opData.id,
      dados_depois: { aceite_sacado_exigido: false, aceite_sacado_status: 'dispensado', politica_snapshot_hash: politicaSnapshot.hash },
    })
    await registrarLog({
      tipo_evento: 'OPERACAO_ENCAMINHADA_GESTOR',
      entidade_tipo: 'operacoes',
      entidade_id: opData.id,
      dados_depois: { status: 'solicitada', aceite_sacado_status: 'dispensado' },
    })
  }

  return {
    success: true,
    message: opData.idempotentReplay
      ? 'Solicitacao ja havia sido registrada; exibindo a operacao existente.'
      : !aceiteSacadoExigido
      ? 'Solicitacao criada e encaminhada para analise da gestora.'
      : taxaMedia > 0
      ? `Solicitacao criada! Valor liquido estimado: ${formatBRL(valorLiquidoDesembolso)}.`
      : 'Solicitacao criada! O gestor definira a taxa e valor liquido.',
    data: { operacaoId: opData.id },
  }
}

// ============================================================
// GESTOR — Aprovar operacao (etapa 1: define termos, sem desembolso)
// ============================================================

export async function aprovarOperacao(
  operacaoId: string,
  taxaDesconto: number,
  valorLiquidoDesembolso: number
): Promise<OperacaoActionState> {
  const context = await requireGestor()
  await exigirSessaoElevada(context)
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

  const operacaoJaAprovada = opData.status === 'aprovada'
  if (!operacaoJaAprovada && opData.status !== 'solicitada' && opData.status !== 'em_analise') {
    return { success: false, message: `Operacao com status "${opData.status}" nao pode ser aprovada.` }
  }

  // Buscar NFs da operacao (verificar aceite + calcular valores por NF)
  const { data: opNfsData } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  const nfIds = ((opNfsData || []) as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)

  const nfsTyped = (nfIds.length > 0
    ? ((await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, status, valor_liquido, valor_bruto, data_vencimento, cnpj_destinatario, razao_social_destinatario')
        .in('id', nfIds)).data || [])
    : []) as Array<{
      id: string; numero_nf: string; status: string;
      valor_liquido: number; valor_bruto: number; data_vencimento: string;
      cnpj_destinatario: string; razao_social_destinatario: string
    }>

  if (!operacaoJaAprovada) {
    const gate = await validarElegibilidadeAprovacao(supabase, operacaoId, {
      taxaDesconto,
      valorLiquidoDesembolso,
    })
    if (!gate.elegivel) return { success: false, message: gate.bloqueios.join(' ') }
  }

  const { data: aprovacao, error: aprovacaoError } = await supabase.rpc('aprovar_operacao_atomica', {
    p_operacao_id: operacaoId,
    p_taxa_desconto: taxaDesconto,
    p_valor_liquido_desembolso: valorLiquidoDesembolso,
  } as never)

  if (aprovacaoError) return { success: false, message: `Erro ao aprovar: ${aprovacaoError.message}` }
  const aprovacaoResultado = aprovacao as { idempotent_replay?: boolean } | null
  const idempotentReplay = !!aprovacaoResultado?.idempotent_replay

  // Calcular prazo medio ponderado a partir dos vencimentos individuais (referencia)
  // Atualizar operacao (sem desembolso ainda — status vai para aprovada)
  // A atualizacao da operacao foi feita pela RPC transacional.

  // Calcular e salvar taxa_desagio e valor_antecipado por NF com prazo individual
  if (!idempotentReplay && nfsTyped.length > 0) {
    // Notificar sacados (fila historica preservada nesta fase).
    const sacadosCnpjs = [...new Set(nfsTyped.map((n) => n.cnpj_destinatario))]
    for (const cnpj of sacadosCnpjs) {
      const { data: sacado } = await supabase
        .from('sacados')
        .select('user_id')
        .eq('cnpj', cnpj)
        .single()

      if (sacado) {
        const sacadoData = sacado as { user_id: string }
        const nfsDeSacado = nfsTyped
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

  return {
    success: true,
    message: idempotentReplay
      ? 'Operacao ja estava aprovada.'
      : `Operacao aprovada. Envie os documentos assinados e o comprovante TED para desembolsar.`,
  }
}

// ============================================================
// GESTOR — Desembolsar operacao (etapa 2: valida docs, credita escrow)
// ============================================================

export async function desembolsarOperacao(operacaoId: string): Promise<OperacaoActionState> {
  const context = await requireGestor()
  await exigirSessaoElevada(context)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { data: op } = await supabase
    .from('operacoes')
    .select('*, cedentes(user_id, razao_social)')
    .eq('id', operacaoId)
    .single()

  if (!op) return { success: false, message: 'Operacao nao encontrada.' }

  const opData = op as {
    id: string; status: string; cedente_id: string; conta_escrow_id: string;
    valor_liquido_desembolso: number; taxa_desconto: number; prazo_dias: number;
    termo_assinado_url: string | null; comprovante_pagamento_url: string | null;
    cedentes: { user_id: string; razao_social: string }
  }

  if (opData.status !== 'aprovada') {
    return { success: false, message: `Operacao com status "${opData.status}" nao pode ser desembolsada.` }
  }

  if (!opData.termo_assinado_url) {
    return { success: false, message: 'Envie o termo de cessao assinado antes de desembolsar.' }
  }

  if (!opData.comprovante_pagamento_url) {
    return { success: false, message: 'Envie o comprovante de desembolso (TED) antes de confirmar.' }
  }

  const { data: desembolso, error } = await supabase.rpc('desembolsar_operacao_com_logistica', {
    p_operacao_id: operacaoId,
  })
  if (error) return { success: false, message: `Erro ao desembolsar: ${error.message}` }

  await notificarCedente(
    opData.cedente_id,
    'Desembolso realizado!',
    `O desembolso da sua operacao foi confirmado. Valor: ${formatBRL(opData.valor_liquido_desembolso)} (taxa: ${opData.taxa_desconto}% a.m., prazo medio: ${opData.prazo_dias} dias). Confira seu extrato.`,
    'operacao_desembolsada',
  )

  await registrarLog({
    tipo_evento: 'OPERACAO_DESEMBOLSADA',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_antes: { status: 'aprovada' },
    dados_depois: {
      status: 'em_andamento',
      valor_liquido_desembolso: opData.valor_liquido_desembolso,
      logistica: desembolso,
    },
  })

  return { success: true, message: `Desembolso de ${formatBRL(opData.valor_liquido_desembolso)} confirmado.` }
}

// ============================================================
// GESTOR — Reprovar operacao
// ============================================================

export async function reprovarOperacao(operacaoId: string, motivo: string): Promise<OperacaoActionState> {
  await requireGestor()
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
      .update({ status: 'aprovada', aprovacao_sacado_em: null } as never)
      .in('id', nfIds)
  }

  await notificarCedente(
    opData.cedente_id,
    'Operacao reprovada',
    `Sua solicitacao de antecipacao foi reprovada. Motivo: ${motivo}. As NFs estao disponiveis para nova solicitacao.`,
    'operacao_reprovada',
  )

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
  await requireAuthenticated()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id')
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
      .update({ status: 'aprovada', aprovacao_sacado_em: null } as never)
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
  await requireGestor()
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
  await requireGestor()
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
    valor_bruto_total: number; taxa_desconto: number;
    cedentes: { user_id: string; razao_social: string }
  }

  const statusPermitidos = ['solicitada', 'em_analise', 'em_andamento']
  if (!statusPermitidos.includes(opData.status)) {
    return { success: false, message: `Nao e possivel remover NFs de uma operacao com status "${opData.status}".` }
  }

  // Buscar NF e verificar que pertence a operacao
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

  // Remover vinculo
  await supabase
    .from('operacoes_nfs')
    .delete()
    .eq('operacao_id', operacaoId)
    .eq('nota_fiscal_id', nfId)

  // Reverter NF para aprovada e limpar aceite do sacado
  await supabase
    .from('notas_fiscais')
    .update({ status: 'aprovada', aprovacao_sacado_em: null } as never)
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
      tipo_evento: 'NF_REMOVIDA_OPERACAO',
      entidade_tipo: 'operacoes',
      entidade_id: operacaoId,
      dados_depois: { nf_removida: nfData.numero_nf, operacao_cancelada: true },
    })

    await notificarCedente(
      opData.cedente_id,
      'Operacao cancelada — NF removida',
      `A NF ${nfData.numero_nf} foi removida da operacao pelo gestor. Como era a unica NF, a operacao foi cancelada.`,
      'operacao_cancelada',
    )

    const aviso = wasEmAndamento ? ' ATENCAO: A operacao ja estava em andamento — verifique o saldo da conta escrow.' : ''
    return { success: true, message: `NF ${nfData.numero_nf} removida. Operacao cancelada pois nao havia mais NFs.${aviso}` }
  }

  // Recalcular valor_bruto_total e valor_liquido_desembolso com NFs restantes
  const nfIdsRestantes = (restantes as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
  const { data: nfsRestantes } = await supabase
    .from('notas_fiscais')
    .select('valor_bruto, valor_liquido, data_vencimento')
    .in('id', nfIdsRestantes)

  const hoje = new Date()
  const taxaDesconto = opData.taxa_desconto || 0
  const nfsRestantesTyped = (nfsRestantes || []) as Array<{ valor_bruto: number; valor_liquido: number | null; data_vencimento: string }>

  const novoValorBruto = nfsRestantesTyped.reduce((acc, n) => acc + (n.valor_bruto || 0), 0)
  const novoValorLiquido = Math.round(
    nfsRestantesTyped.reduce((acc, n) => {
      const prazoDias = Math.max(1, Math.ceil(
        (new Date(n.data_vencimento).getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
      ))
      const fator = Math.pow(1 + taxaDesconto / 100, prazoDias / 30)
      const base = n.valor_liquido || n.valor_bruto
      return acc + base / fator
    }, 0) * 100
  ) / 100

  await supabase
    .from('operacoes')
    .update({ valor_bruto_total: novoValorBruto, valor_liquido_desembolso: novoValorLiquido } as never)
    .eq('id', operacaoId)

  await registrarLog({
    tipo_evento: 'NF_REMOVIDA_OPERACAO',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_depois: { nf_removida: nfData.numero_nf, novo_valor_bruto: novoValorBruto },
  })

  await notificarCedente(
    opData.cedente_id,
    'NF removida da operacao',
    `A NF ${nfData.numero_nf} foi removida da operacao pelo gestor. O valor bruto da operacao foi recalculado para ${formatBRL(novoValorBruto)}.`,
    'nf_removida_operacao',
  )

  const aviso = wasEmAndamento ? ' ATENCAO: A operacao ja estava em andamento — os termos financeiros precisam ser ajustados manualmente.' : ''
  return { success: true, message: `NF ${nfData.numero_nf} removida. Novo valor bruto: ${formatBRL(novoValorBruto)}.${aviso}` }
}

export async function salvarTestemunhasOperacao(
  operacaoId: string,
  testemunha1Id: string,
  testemunha2Id: string
): Promise<OperacaoActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({ testemunha_1_id: testemunha1Id, testemunha_2_id: testemunha2Id } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro ao salvar testemunhas: ${error.message}` }
  return { success: true, message: 'Testemunhas salvas.' }
}

export async function salvarTermoAssinado(
  operacaoId: string,
  path: string
): Promise<OperacaoActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({ termo_assinado_url: path } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro: ${error.message}` }
  return { success: true, message: 'Termo assinado salvo.' }
}

export async function salvarComprovantePagamento(
  operacaoId: string,
  path: string
): Promise<OperacaoActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({ comprovante_pagamento_url: path } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro: ${error.message}` }
  return { success: true, message: 'Comprovante salvo.' }
}

export async function salvarNotificacaoAssinada(
  operacaoId: string,
  path: string
): Promise<OperacaoActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({ notificacao_assinada_url: path } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro: ${error.message}` }
  return { success: true, message: 'Notificacao assinada salva.' }
}

export async function salvarQuitacaoAssinada(
  operacaoId: string,
  path: string
): Promise<OperacaoActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('operacoes')
    .update({ quitacao_assinada_url: path } as never)
    .eq('id', operacaoId)

  if (error) return { success: false, message: `Erro: ${error.message}` }
  return { success: true, message: 'Termo de quitacao assinado salvo.' }
}

// Helper
function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

'use server'

import { revalidatePath } from 'next/cache'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { carregarContextoEventoOperacao, registrarEventoDominio } from '@/lib/eventos-dominio/registrar'
import { normalizarCnpjSacado, resolverContextoSacado } from '@/lib/sacado/contexto.server'
import { registrarLog } from './auditoria'
import { notificarGestores } from './notificacao'

export type SacadoActionState = {
  success?: boolean
  message?: string
} | undefined

function revalidarAceiteSacado() {
  revalidatePath('/sacado/dashboard')
  revalidatePath('/sacado/notas-fiscais')
  revalidatePath('/sacado/aprovacao')
}

async function validarLoteAceiteSacado(
  supabase: AppSupabaseClient,
  cnpj: string,
  nfIds: string[],
): Promise<string | null> {
  const ids = [...new Set(nfIds)]
  const { data: nfs, error: nfsError } = await supabase
    .from('notas_fiscais')
    .select('id, status, cnpj_destinatario')
    .in('id', ids)

  if (nfsError) return `Nao foi possivel validar as NFs: ${nfsError.message}`
  if ((nfs || []).length !== ids.length) return 'Uma ou mais NFs nao foram encontradas.'
  if ((nfs || []).some((nf) => normalizarCnpjSacado(nf.cnpj_destinatario) !== cnpj)) {
    return 'Uma ou mais NFs nao pertencem ao sacado autenticado.'
  }
  if ((nfs || []).some((nf) => nf.status !== 'em_antecipacao')) {
    return 'Uma ou mais NFs nao estao abertas para aceite.'
  }

  const { data: links, error: linksError } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id, operacao_id')
    .in('nota_fiscal_id', ids)
  if (linksError) return `Nao foi possivel validar os vinculos operacionais: ${linksError.message}`

  const operacoesPorNota = new Map<string, string[]>()
  for (const link of links || []) {
    operacoesPorNota.set(link.nota_fiscal_id, [
      ...(operacoesPorNota.get(link.nota_fiscal_id) || []),
      link.operacao_id,
    ])
  }
  if (ids.some((id) => (operacoesPorNota.get(id) || []).length !== 1)) {
    return 'Todas as NFs precisam possuir um unico vinculo operacional.'
  }

  const operacaoIds = Array.from(new Set((links || []).map((link) => link.operacao_id)))
  const { data: operacoes, error: operacoesError } = await supabase
    .from('operacoes')
    .select('id, status, aceite_sacado_exigido, aceite_sacado_status')
    .in('id', operacaoIds)

  if (operacoesError) return `Nao foi possivel validar as operacoes: ${operacoesError.message}`
  if ((operacoes || []).length !== operacaoIds.length) return 'Uma ou mais operacoes nao estao acessiveis.'
  if ((operacoes || []).some((operacao) => (
    !['solicitada', 'em_analise'].includes(operacao.status)
    || operacao.aceite_sacado_exigido !== true
    || operacao.aceite_sacado_status !== 'pendente'
  ))) {
    return 'Uma ou mais operacoes nao estao abertas para aceite.'
  }
  return null
}

async function executarAceite(
  nfIds: string[],
  acao: 'aceitar' | 'contestar',
  motivo?: string,
) {
  const contexto = await resolverContextoSacado()
  const ids = [...new Set(nfIds)]
  const validacao = await validarLoteAceiteSacado(
    contexto.auth.supabase,
    contexto.cnpj,
    ids,
  )
  if (validacao) return { errorMessage: validacao }

  const { data, error } = await contexto.auth.supabase.rpc('processar_aceite_sacado', {
    p_nota_fiscal_ids: ids,
    p_acao: acao,
    p_motivo: motivo || null,
  })
  if (error) {
    const lower = error.message.toLowerCase()
    if (lower.includes('não exige aceite') || lower.includes('nao exige aceite')) {
      return { errorMessage: 'Esta operacao nao exige aceite do sacado.' }
    }
    return { errorMessage: error.message }
  }
  return { data: data as Record<string, unknown> }
}

async function registrarEventoPagamentoSacado(
  supabase: AppSupabaseClient,
  operacaoId: string,
  comprovante?: string,
) {
  const contexto = await carregarContextoEventoOperacao(supabase, operacaoId)
  await registrarEventoDominio({
    ...contexto,
    tipo_evento: 'pagamento_informado_sacado',
    categoria: 'conclusao',
    descricao: `Sacado informou pagamento da operacao #${operacaoId.substring(0, 8)}.`,
    metadata: {
      comprovante_informado: !!comprovante,
      status_operacao: contexto.status ?? null,
    },
    visibilidade: 'ambos',
    origem: 'portal_sacado',
    origem_evento: 'confirmar_pagamento_sacado',
    origem_registro_id: operacaoId,
  }, supabase)
}

export async function aprovarCessao(nfId: string): Promise<SacadoActionState> {
  const result = await executarAceite([nfId], 'aceitar')
  if (result.errorMessage) return { success: false, message: result.errorMessage }
  revalidarAceiteSacado()
  return { success: true, message: 'Cessao aceita com sucesso.' }
}

export async function aprovarCessaoLote(
  nfIds: string[],
): Promise<SacadoActionState & { aprovadas?: number; invalidas?: number }> {
  if (!nfIds || nfIds.length === 0) {
    return { success: false, message: 'Nenhuma NF selecionada.' }
  }
  const ids = [...new Set(nfIds)]
  const result = await executarAceite(ids, 'aceitar')
  if (result.errorMessage) return { success: false, message: result.errorMessage }
  revalidarAceiteSacado()
  return {
    success: true,
    message: `${ids.length} cessao(oes) aprovada(s) com sucesso.`,
    aprovadas: ids.length,
    invalidas: 0,
  }
}

export async function contestarCessao(
  nfId: string,
  motivo: string,
): Promise<SacadoActionState> {
  if (!motivo?.trim()) {
    return { success: false, message: 'Motivo da contestacao e obrigatorio.' }
  }
  const result = await executarAceite([nfId], 'contestar', motivo.trim())
  if (result.errorMessage) return { success: false, message: result.errorMessage }
  revalidarAceiteSacado()
  return { success: true, message: 'Contestacao registrada. O gestor foi notificado.' }
}

export async function confirmarPagamento(
  operacaoId: string,
  comprovante?: string,
): Promise<SacadoActionState> {
  const contexto = await resolverContextoSacado()
  const supabase = contexto.auth.supabase

  const { data: opNfs, error: vinculosError } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id, operacao_id')
    .eq('operacao_id', operacaoId)

  if (vinculosError) {
    return { success: false, message: `Nao foi possivel validar a operacao: ${vinculosError.message}` }
  }
  if (!opNfs || opNfs.length === 0) {
    return { success: false, message: 'Operacao nao encontrada.' }
  }

  const nfIds = opNfs.map((item) => item.nota_fiscal_id)
  const { data: nfs, error: nfsError } = await supabase
    .from('notas_fiscais')
    .select('id, cnpj_destinatario')
    .in('id', nfIds)

  if (nfsError) {
    return { success: false, message: `Nao foi possivel validar as NFs da operacao: ${nfsError.message}` }
  }
  if (
    !nfs
    || nfs.length !== nfIds.length
    || nfs.some((nota) => normalizarCnpjSacado(nota.cnpj_destinatario) !== contexto.cnpj)
  ) {
    return { success: false, message: 'Operacao nao vinculada a voce.' }
  }

  const { data: operacao, error: operacaoError } = await supabase
    .from('operacoes')
    .select('status')
    .eq('id', operacaoId)
    .maybeSingle()

  if (operacaoError || !operacao) {
    return { success: false, message: 'Operacao nao encontrada.' }
  }
  if (!['em_andamento', 'inadimplente'].includes(operacao.status)) {
    return {
      success: false,
      message: 'Esta operacao ainda nao esta aberta para confirmacao de pagamento.',
    }
  }

  await notificarGestores(
    'Sacado informou pagamento',
    `O sacado ${contexto.razaoSocial} informou que realizou o pagamento da operacao #${operacaoId.substring(0, 8)}.${comprovante ? ' Comprovante informado.' : ''}`,
    'pagamento_informado',
  )

  await registrarLog({
    tipo_evento: 'PAGAMENTO_INFORMADO',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_depois: {
      sacado_cnpj: contexto.cnpj,
      comprovante: comprovante || null,
    },
  })
  await registrarEventoPagamentoSacado(supabase, operacaoId, comprovante)

  revalidatePath('/sacado/pagamentos')
  revalidatePath('/sacado/dashboard')
  return {
    success: true,
    message: 'Pagamento informado. O gestor ira confirmar a liquidacao.',
  }
}

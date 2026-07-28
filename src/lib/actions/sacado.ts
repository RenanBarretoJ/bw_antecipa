'use server'

import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/authorization'
import { registrarLog } from './auditoria'
import { notificarGestores } from './notificacao'
import { carregarContextoEventoNota, carregarContextoEventoOperacao, registrarEventoDominio } from '@/lib/eventos-dominio/registrar'

export type SacadoActionState = {
  success?: boolean
  message?: string
} | undefined

async function getSacadoDoUsuario() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: sacado } = await supabase
    .from('sacados')
    .select('id, cnpj, razao_social, user_id')
    .eq('user_id', user.id)
    .single()

  if (!sacado) return null
  return {
    ...(sacado as { id: string; cnpj: string; razao_social: string; user_id: string }),
    cnpj: String((sacado as { cnpj: string }).cnpj ?? '').replace(/\D/g, ''),
  }
}

async function executarAceite(nfIds: string[], acao: 'aceitar' | 'contestar', motivo?: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('processar_aceite_sacado', {
    p_nota_fiscal_ids: [...new Set(nfIds)],
    p_acao: acao,
    p_motivo: motivo || null,
  })
  if (error) {
    const lower = error.message.toLowerCase()
    if (lower.includes('não exige aceite') || lower.includes('nao exige aceite')) return { errorMessage: 'Esta operação não exige aceite do sacado.' }
    return { errorMessage: error.message }
  }
  return { data: data as Record<string, unknown> }
}

function arrayDeStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

async function registrarEventosAceiteSacado(
  supabase: Awaited<ReturnType<typeof createClient>>,
  data: Record<string, unknown> | undefined,
  acao: 'aceitar' | 'contestar',
  motivo?: string,
) {
  const notaFiscalIds = arrayDeStrings(data?.nota_fiscal_ids)
  const operacaoIds = arrayDeStrings(data?.operacao_ids)
  const operacaoId = operacaoIds[0] ?? null

  await Promise.all(notaFiscalIds.map(async (notaFiscalId) => {
    const contexto = await carregarContextoEventoNota(supabase, notaFiscalId)
    await registrarEventoDominio({
      ...contexto,
      operacao_id: operacaoId,
      tipo_evento: acao === 'aceitar' ? 'cessao_aceita_sacado' : 'cessao_contestada_sacado',
      categoria: acao === 'aceitar' ? 'aprovacao' : 'reprovacao',
      descricao: acao === 'aceitar'
        ? `Sacado aceitou a cessão da NF ${contexto.numero_nf ?? notaFiscalId}.`
        : `Sacado contestou a cessão da NF ${contexto.numero_nf ?? notaFiscalId}.`,
      metadata: {
        acao,
        motivo: acao === 'contestar' ? motivo ?? null : null,
        numero_nf: contexto.numero_nf ?? null,
      },
      visibilidade: 'ambos',
      origem: 'portal_sacado',
      origem_evento: 'processar_aceite_sacado',
      origem_registro_id: notaFiscalId,
    }, supabase)
  }))
}

async function registrarEventoPagamentoSacado(
  supabase: Awaited<ReturnType<typeof createClient>>,
  operacaoId: string,
  comprovante?: string,
) {
  const contexto = await carregarContextoEventoOperacao(supabase, operacaoId)
  await registrarEventoDominio({
    ...contexto,
    tipo_evento: 'pagamento_informado_sacado',
    categoria: 'conclusao',
    descricao: `Sacado informou pagamento da operação #${operacaoId.substring(0, 8)}.`,
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

// O banco valida a operação relacionada, o sacado e o status dentro de uma RPC transacional.
export async function aprovarCessao(nfId: string): Promise<SacadoActionState> {
  await requireRole('sacado')
  const result = await executarAceite([nfId], 'aceitar')
  if (result.errorMessage) return { success: false, message: result.errorMessage }
  await registrarEventosAceiteSacado(await createClient(), result.data, 'aceitar')
  return { success: true, message: 'Cessão aceita com sucesso.' }
}

export async function aprovarCessaoLote(nfIds: string[]): Promise<SacadoActionState & { aprovadas?: number; invalidas?: number }> {
  await requireRole('sacado')
  if (!nfIds || nfIds.length === 0) return { success: false, message: 'Nenhuma NF selecionada.' }
  const ids = [...new Set(nfIds)]
  const result = await executarAceite(ids, 'aceitar')
  if (result.errorMessage) return { success: false, message: result.errorMessage }
  await registrarEventosAceiteSacado(await createClient(), result.data, 'aceitar')
  return { success: true, message: `${ids.length} cessão(ões) aprovada(s) com sucesso.`, aprovadas: ids.length, invalidas: 0 }
}

export async function contestarCessao(nfId: string, motivo: string): Promise<SacadoActionState> {
  await requireRole('sacado')
  if (!motivo?.trim()) return { success: false, message: 'Motivo da contestação é obrigatório.' }
  const result = await executarAceite([nfId], 'contestar', motivo.trim())
  if (result.errorMessage) return { success: false, message: result.errorMessage }
  await registrarEventosAceiteSacado(await createClient(), result.data, 'contestar', motivo.trim())
  return { success: true, message: 'Contestação registrada. O gestor foi notificado.' }
}

// Registrar confirmacao de pagamento (sacado informa que pagou)
export async function confirmarPagamento(operacaoId: string, comprovante?: string): Promise<SacadoActionState> {
  await requireRole('sacado')
  const supabase = await createClient()
  const sacado = await getSacadoDoUsuario()
  if (!sacado) return { success: false, message: 'Sacado nao encontrado.' }

  // Buscar operacao vinculada ao sacado
  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id, operacao_id')
    .eq('operacao_id', operacaoId)

  if (!opNfs || opNfs.length === 0) {
    return { success: false, message: 'Operacao nao encontrada.' }
  }

  // Verificar que pelo menos uma NF da operacao pertence a este sacado
  const nfIds = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
  const { data: nfs } = await supabase
    .from('notas_fiscais')
    .select('id')
    .in('id', nfIds)
    .eq('cnpj_destinatario', sacado.cnpj)
    .limit(1)

  if (!nfs || nfs.length === 0) {
    return { success: false, message: 'Operacao nao vinculada a voce.' }
  }

  const { data: operacao } = await supabase
    .from('operacoes')
    .select('status')
    .eq('id', operacaoId)
    .maybeSingle()

  if (!operacao) {
    return { success: false, message: 'Operacao nao encontrada.' }
  }

  if (!['em_andamento', 'inadimplente'].includes(String((operacao as { status?: string }).status ?? ''))) {
    return { success: false, message: 'Esta operacao ainda nao esta aberta para confirmacao de pagamento.' }
  }

  // Notificar gestor
  await notificarGestores(
    'Sacado informou pagamento',
    `O sacado ${sacado.razao_social} informou que realizou o pagamento da operacao #${operacaoId.substring(0, 8)}.${comprovante ? ' Comprovante informado.' : ''}`,
    'pagamento_informado'
  )

  await registrarLog({
    tipo_evento: 'PAGAMENTO_INFORMADO',
    entidade_tipo: 'operacoes',
    entidade_id: operacaoId,
    dados_depois: { sacado_cnpj: sacado.cnpj, comprovante: comprovante || null },
  })
  await registrarEventoPagamentoSacado(supabase, operacaoId, comprovante)

  return { success: true, message: 'Pagamento informado. O gestor ira confirmar a liquidacao.' }
}

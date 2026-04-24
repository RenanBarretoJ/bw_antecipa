'use server'

import { createClient } from '@/lib/supabase/server'
import { registrarLog } from './auditoria'
import { criarNotificacao, notificarGestores } from './notificacao'

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
  return sacado as { id: string; cnpj: string; razao_social: string; user_id: string }
}

// Aceitar cessao de NF
export async function aceitarCessao(nfId: string): Promise<SacadoActionState> {
  const supabase = await createClient()
  const sacado = await getSacadoDoUsuario()
  if (!sacado) return { success: false, message: 'Sacado nao encontrado.' }

  // Verificar se a NF e destinada a este sacado
  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cnpj_destinatario, cnpj_emitente, razao_social_emitente, status, cedente_id')
    .eq('id', nfId)
    .single()

  if (!nf) return { success: false, message: 'NF nao encontrada.' }
  const nfData = nf as { id: string; numero_nf: string; cnpj_destinatario: string; cnpj_emitente: string; razao_social_emitente: string; status: string; cedente_id: string }

  if (nfData.cnpj_destinatario !== sacado.cnpj) {
    return { success: false, message: 'Esta NF nao e destinada a voce.' }
  }

  if (nfData.status !== 'em_antecipacao') {
    return { success: false, message: 'Esta NF nao pode ser aceita no status atual.' }
  }

  // Atualizar status da NF para aceita e registrar timestamp do aceite
  const { error: updateError } = await supabase
    .from('notas_fiscais')
    .update({ status: 'aceita', aprovacao_sacado_em: new Date().toISOString() } as never)
    .eq('id', nfId)

  if (updateError) return { success: false, message: 'Erro ao registrar aceite.' }

  // Notificar gestor e cedente do aceite
  const { data: cedente } = await supabase
    .from('cedentes')
    .select('user_id, razao_social')
    .eq('id', nfData.cedente_id)
    .single()

  if (cedente) {
    const cedData = cedente as { user_id: string; razao_social: string }
    await criarNotificacao({
      usuario_id: cedData.user_id,
      titulo: 'Aceite de cessao confirmado',
      mensagem: `O sacado ${sacado.razao_social} aceitou a cessao da NF ${nfData.numero_nf}.`,
      tipo: 'cessao_aceita',
    })
  }

  await notificarGestores(
    'Cessao aceita pelo sacado',
    `O sacado ${sacado.razao_social} aceitou a cessao da NF ${nfData.numero_nf} (emitente: ${nfData.razao_social_emitente}).`,
    'cessao_aceita'
  )

  await registrarLog({
    tipo_evento: 'CESSAO_ACEITA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_depois: { sacado_cnpj: sacado.cnpj, aceite: true },
  })

  return { success: true, message: 'Cessao aceita com sucesso.' }
}

// Aprovar cessao de multiplas NFs em lote
export async function aceitarCessaoLote(nfIds: string[]): Promise<SacadoActionState & { aprovadas?: number; invalidas?: number }> {
  const supabase = await createClient()
  const sacado = await getSacadoDoUsuario()
  if (!sacado) return { success: false, message: 'Sacado nao encontrado.' }

  if (!nfIds || nfIds.length === 0) {
    return { success: false, message: 'Nenhuma NF selecionada.' }
  }

  // Buscar todas as NFs de uma vez e validar pertencimento + status
  const { data: nfs } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cnpj_destinatario, razao_social_emitente, status, cedente_id')
    .in('id', nfIds)

  if (!nfs || nfs.length === 0) return { success: false, message: 'NFs nao encontradas.' }

  const nfsValidas = (nfs as Array<{
    id: string; numero_nf: string; cnpj_destinatario: string;
    razao_social_emitente: string; status: string; cedente_id: string
  }>).filter((nf) => nf.cnpj_destinatario === sacado.cnpj && nf.status === 'em_antecipacao')

  if (nfsValidas.length === 0) {
    return { success: false, message: 'Nenhuma NF valida para aprovacao.' }
  }

  const idsValidos = nfsValidas.map((nf) => nf.id)
  const agora = new Date().toISOString()

  const { error } = await supabase
    .from('notas_fiscais')
    .update({ status: 'aceita', aprovacao_sacado_em: agora } as never)
    .in('id', idsValidos)

  if (error) return { success: false, message: 'Erro ao registrar aprovacoes.' }

  // Notificar por cedente (agrupado)
  const porCedente = nfsValidas.reduce<Record<string, string[]>>((acc, nf) => {
    acc[nf.cedente_id] = acc[nf.cedente_id] || []
    acc[nf.cedente_id].push(nf.numero_nf)
    return acc
  }, {})

  for (const [cedenteId, numeros] of Object.entries(porCedente)) {
    const { data: cedente } = await supabase
      .from('cedentes')
      .select('user_id, razao_social')
      .eq('id', cedenteId)
      .single()

    if (cedente) {
      const cedData = cedente as { user_id: string; razao_social: string }
      await criarNotificacao({
        usuario_id: cedData.user_id,
        titulo: 'Aprovação de cessão em lote',
        mensagem: `O sacado ${sacado.razao_social} aprovou ${numeros.length} NF(s): ${numeros.join(', ')}.`,
        tipo: 'cessao_aceita',
      })
    }
  }

  await notificarGestores(
    'Aprovação de cessão em lote pelo sacado',
    `O sacado ${sacado.razao_social} aprovou ${nfsValidas.length} cessão(ões) em lote.`,
    'cessao_aceita'
  )

  await registrarLog({
    tipo_evento: 'CESSAO_ACEITA_LOTE',
    entidade_tipo: 'notas_fiscais',
    entidade_id: undefined,
    dados_depois: { sacado_cnpj: sacado.cnpj, nf_ids: idsValidos, quantidade: idsValidos.length },
  })

  return {
    success: true,
    message: `${nfsValidas.length} cessão(ões) aprovada(s) com sucesso.`,
    aprovadas: nfsValidas.length,
    invalidas: nfIds.length - nfsValidas.length,
  }
}

// Contestar cessao de NF
export async function contestarCessao(nfId: string, motivo: string): Promise<SacadoActionState> {
  const supabase = await createClient()
  const sacado = await getSacadoDoUsuario()
  if (!sacado) return { success: false, message: 'Sacado nao encontrado.' }

  if (!motivo?.trim()) return { success: false, message: 'Motivo da contestacao e obrigatorio.' }

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, numero_nf, cnpj_destinatario, razao_social_emitente, cedente_id, status')
    .eq('id', nfId)
    .single()

  if (!nf) return { success: false, message: 'NF nao encontrada.' }
  const nfData = nf as { id: string; numero_nf: string; cnpj_destinatario: string; razao_social_emitente: string; cedente_id: string; status: string }

  if (nfData.cnpj_destinatario !== sacado.cnpj) {
    return { success: false, message: 'Esta NF nao e destinada a voce.' }
  }

  if (nfData.status !== 'em_antecipacao') {
    return { success: false, message: 'Esta NF nao pode ser contestada no status atual.' }
  }

  // Atualizar status da NF para contestada
  const { error: updateError } = await supabase
    .from('notas_fiscais')
    .update({ status: 'contestada' } as never)
    .eq('id', nfId)

  if (updateError) return { success: false, message: 'Erro ao registrar contestacao.' }

  // Notificar gestor urgente
  await notificarGestores(
    'ALERTA: Cessao contestada pelo sacado',
    `O sacado ${sacado.razao_social} CONTESTOU a cessao da NF ${nfData.numero_nf} (emitente: ${nfData.razao_social_emitente}). Motivo: ${motivo}`,
    'cessao_contestada'
  )

  // Notificar cedente
  const { data: cedente } = await supabase
    .from('cedentes')
    .select('user_id')
    .eq('id', nfData.cedente_id)
    .single()

  if (cedente) {
    const cedData = cedente as { user_id: string }
    await criarNotificacao({
      usuario_id: cedData.user_id,
      titulo: 'Cessao contestada pelo sacado',
      mensagem: `O sacado ${sacado.razao_social} contestou a cessao da NF ${nfData.numero_nf}. Motivo: ${motivo}. O gestor foi notificado.`,
      tipo: 'cessao_contestada',
    })
  }

  await registrarLog({
    tipo_evento: 'CESSAO_CONTESTADA',
    entidade_tipo: 'notas_fiscais',
    entidade_id: nfId,
    dados_depois: { sacado_cnpj: sacado.cnpj, contestacao: true, motivo },
  })

  return { success: true, message: 'Contestacao registrada. O gestor foi notificado.' }
}

// Registrar confirmacao de pagamento (sacado informa que pagou)
export async function confirmarPagamento(operacaoId: string, comprovante?: string): Promise<SacadoActionState> {
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

  return { success: true, message: 'Pagamento informado. O gestor ira confirmar a liquidacao.' }
}

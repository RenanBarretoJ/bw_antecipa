'use server'

import { createClient } from '@/lib/supabase/server'
import { registrarLog } from './auditoria'
import { criarNotificacao } from './notificacao'

export type GestorActionState = {
  success?: boolean
  message?: string
} | undefined

export async function analisarDocumento(
  documentoId: string,
  decisao: 'aprovado' | 'reprovado',
  motivo?: string
): Promise<GestorActionState> {
  if (decisao === 'reprovado' && (!motivo || motivo.trim().length === 0)) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  // Buscar documento atual
  const { data: docAtual } = await supabase
    .from('documentos')
    .select('*, cedentes(user_id, razao_social, cnpj)')
    .eq('id', documentoId)
    .single()

  if (!docAtual) {
    return { success: false, message: 'Documento nao encontrado.' }
  }

  const doc = docAtual as {
    id: string; tipo: string; status: string; cedente_id: string;
    cedentes: { user_id: string; razao_social: string; cnpj: string }
  }

  const dadosAntes = { status: doc.status }

  const { error } = await supabase
    .from('documentos')
    .update({
      status: decisao,
      motivo_reprovacao: decisao === 'reprovado' ? motivo : null,
      analisado_por: user.id,
      analisado_em: new Date().toISOString(),
    } as never)
    .eq('id', documentoId)

  if (error) {
    return { success: false, message: `Erro ao analisar documento: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: decisao === 'aprovado' ? 'DOCUMENTO_APROVADO' : 'DOCUMENTO_REPROVADO',
    entidade_tipo: 'documentos',
    entidade_id: documentoId,
    dados_antes: dadosAntes,
    dados_depois: { status: decisao, motivo_reprovacao: motivo || null },
  })

  const statusLabel = decisao === 'aprovado' ? 'aprovado' : 'reprovado'
  await criarNotificacao({
    usuario_id: doc.cedentes.user_id,
    titulo: `Documento ${statusLabel}`,
    mensagem: decisao === 'aprovado'
      ? `Seu documento "${doc.tipo}" foi aprovado.`
      : `Seu documento "${doc.tipo}" foi reprovado. Motivo: ${motivo}`,
    tipo: `documento_${statusLabel}`,
  })

  return { success: true, message: `Documento ${statusLabel} com sucesso.` }
}

export async function aprovarCedente(cedenteId: string): Promise<GestorActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  // Verificar se todos os docs obrigatorios estao aprovados
  const { data: docs } = await supabase
    .from('documentos')
    .select('tipo, status, representante_id')
    .eq('cedente_id', cedenteId)

  const docsTyped = (docs || []) as Array<{ tipo: string; status: string; representante_id: string | null }>

  // Buscar representantes do cedente
  const { data: reps } = await supabase
    .from('representantes')
    .select('id, nome')
    .eq('cedente_id', cedenteId)
  const repsData = (reps || []) as { id: string; nome: string }[]

  // Docs da empresa (sem representante_id)
  const docsEmpresaObrig = ['contrato_social', 'cartao_cnpj', 'comprovante_endereco',
                            'extrato_bancario', 'balanco_patrimonial', 'dre']
  const faltandoEmpresa = docsEmpresaObrig.filter((t) =>
    !docsTyped.some((d) => d.tipo === t && !d.representante_id && d.status === 'aprovado')
  )

  // docs obrigatórios por representante (fallback legado se tabela vazia)
  // comprovante_de_renda e procuracao sao opcionais
  const docsRepObrig = ['rg_cpf', 'comprovante_endereco']
  const faltandoReps = repsData.length === 0
    ? (docsTyped.some((d) => d.tipo === 'rg_cpf' && d.status === 'aprovado') ? [] : ['rg_cpf (representante)'])
    : repsData.flatMap((rep) =>
        docsRepObrig
          .filter((t) => !docsTyped.some((d) => d.tipo === t && d.representante_id === rep.id && d.status === 'aprovado'))
          .map((t) => `${t} (${rep.nome})`)
      )

  const faltando = [...faltandoEmpresa, ...faltandoReps]

  if (faltando.length > 0) {
    return {
      success: false,
      message: `Documentos obrigatorios pendentes: ${faltando.join(', ')}`,
    }
  }

  // Buscar cedente
  const { data: cedente } = await supabase
    .from('cedentes')
    .select('cnpj, razao_social, user_id, status')
    .eq('id', cedenteId)
    .single()

  if (!cedente) {
    return { success: false, message: 'Cedente nao encontrado.' }
  }

  const cedenteData = cedente as { cnpj: string; razao_social: string; user_id: string; status: string }

  // Atualizar status
  const { error } = await supabase
    .from('cedentes')
    .update({ status: 'ativo' } as never)
    .eq('id', cedenteId)

  if (error) {
    return { success: false, message: `Erro ao aprovar cedente: ${error.message}` }
  }

  // Contar contas escrow existentes para gerar sequencial
  const { count } = await supabase
    .from('contas_escrow')
    .select('id', { count: 'exact', head: true })

  const sequencial = String((count || 0) + 1).padStart(4, '0')
  const cnpjLimpo = cedenteData.cnpj.replace(/\D/g, '')
  const identificador = `ESC-${cnpjLimpo}-${sequencial}`

  // Criar conta escrow
  const { error: escrowError } = await supabase
    .from('contas_escrow')
    .insert({
      cedente_id: cedenteId,
      identificador,
      saldo_disponivel: 0,
      saldo_bloqueado: 0,
      status: 'ativa',
    } as never)

  if (escrowError) {
    return { success: false, message: `Erro ao criar conta escrow: ${escrowError.message}` }
  }

  await registrarLog({
    tipo_evento: 'CEDENTE_APROVADO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: { status: cedenteData.status },
    dados_depois: { status: 'ativo', conta_escrow: identificador },
  })

  await criarNotificacao({
    usuario_id: cedenteData.user_id,
    titulo: 'Cadastro aprovado!',
    mensagem: `Seu cadastro foi aprovado. Sua conta escrow foi criada: ${identificador}. Voce ja pode solicitar antecipacoes.`,
    tipo: 'cadastro_aprovado',
  })

  return { success: true, message: `Cedente aprovado. Conta escrow ${identificador} criada.` }
}

export async function reprovarCedente(cedenteId: string, motivo: string): Promise<GestorActionState> {
  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('user_id, razao_social, status')
    .eq('id', cedenteId)
    .single()

  if (!cedente) {
    return { success: false, message: 'Cedente nao encontrado.' }
  }

  const cedenteData = cedente as { user_id: string; razao_social: string; status: string }

  const { error } = await supabase
    .from('cedentes')
    .update({ status: 'reprovado' } as never)
    .eq('id', cedenteId)

  if (error) {
    return { success: false, message: `Erro ao reprovar cedente: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: 'CEDENTE_REPROVADO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: { status: cedenteData.status },
    dados_depois: { status: 'reprovado', motivo },
  })

  await criarNotificacao({
    usuario_id: cedenteData.user_id,
    titulo: 'Cadastro reprovado',
    mensagem: `Seu cadastro foi reprovado. Motivo: ${motivo}`,
    tipo: 'cadastro_reprovado',
  })

  return { success: true, message: 'Cedente reprovado.' }
}

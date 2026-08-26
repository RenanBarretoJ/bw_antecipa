'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  AuthorizationError,
  requireAuthenticated,
  requireCedenteAccess,
  requireCedenteOrganizationalAccess,
  requireGestor as requireGestorBase,
} from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { registrarLog } from './auditoria'
import { notificarCedente } from './notificacao'
import { suspenderCedenteFundo, vincularCedenteFundo } from '@/lib/fundos/cedente-fundo'
import { resolverContextoFundoGestor } from '@/lib/gestor/contexto-fundo.server'
import { buckets } from '@/lib/storage'
import { revalidatePath } from 'next/cache'

const tipoLabelsDoc: Record<string, string> = {
  contrato_social: 'Contrato Social',
  cartao_cnpj: 'Cartao CNPJ',
  rg_cpf: 'RG e CPF',
  comprovante_endereco: 'Comprovante de Endereco',
  extrato_bancario: 'Comprovante de Faturamento',
  balanco_patrimonial: 'Balanco Patrimonial',
  dre: 'DRE',
  procuracao: 'Procuracao',
  comprovante_de_renda: 'Comprovante de Renda',
  representante_comprovante_residencia: 'Comprovante de Residencia',
}

export type GestorActionState = {
  success?: boolean
  message?: string
  url?: string
  nome?: string
} | undefined

async function requireGestor() {
  const context = await requireGestorBase()
  await exigirSessaoElevada(context)
  return context
}

async function requireGestorOuAdminCedente(cedenteId: string) {
  const context = await requireAuthenticated()
  await exigirSessaoElevada(context)
  if (context.profile.role === 'gestor') {
    await requireCedenteAccess(cedenteId, context.supabase)
    return context
  }
  if (context.profile.role === 'cedente') {
    return requireCedenteOrganizationalAccess('administrativo', context.supabase, cedenteId)
  }
  throw new AuthorizationError('Apenas Gestor ou ADMIN do cedente pode gerenciar acessos.', 'FORBIDDEN')
}

export async function analisarDocumento(
  documentoId: string,
  decisao: 'aprovado' | 'reprovado',
  motivo?: string
): Promise<GestorActionState> {
  const context = await requireGestor()
  if (decisao === 'reprovado' && (!motivo || motivo.trim().length === 0)) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }

  const supabase = context.supabase

  // Buscar documento atual (para notificacao e auditoria)
  const { data: docAtual, error: docError } = await supabase
    .from('documentos')
    .select('id, tipo, status, cedente_id, cedentes(user_id, razao_social, cnpj)')
    .eq('id', documentoId)
    .maybeSingle()

  if (docError || !docAtual) {
    return { success: false, message: 'Documento nao encontrado.' }
  }

  const doc = docAtual as {
    id: string; tipo: string; status: string; cedente_id: string;
    cedentes: { user_id: string; razao_social: string; cnpj: string }
  }
  const dadosAntes = { status: doc.status }

  const { error } = await supabase.rpc('analisar_documento_gestor', {
    p_documento_id: documentoId,
    p_decisao: decisao,
    p_motivo: decisao === 'reprovado' ? motivo : null,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  await registrarLog({
    tipo_evento: decisao === 'aprovado' ? 'DOCUMENTO_APROVADO' : 'DOCUMENTO_REPROVADO',
    entidade_tipo: 'documentos',
    entidade_id: documentoId,
    dados_antes: dadosAntes,
    dados_depois: { status: decisao, motivo_reprovacao: motivo || null },
  })

  const statusLabel = decisao === 'aprovado' ? 'aprovado' : 'reprovado'
  await notificarCedente(
    doc.cedente_id,
    `Documento ${statusLabel}`,
    decisao === 'aprovado'
      ? `Seu documento "${doc.tipo}" foi aprovado.`
      : `Seu documento "${doc.tipo}" foi reprovado. Motivo: ${motivo}`,
    `documento_${statusLabel}`,
  )

  revalidatePath('/gestor/documentos')
  return { success: true, message: `Documento ${statusLabel} com sucesso.` }
}

export async function gerarUrlDocumentoGestor(
  documentoId: string,
): Promise<GestorActionState> {
  const context = await requireGestor()
  const fundo = await resolverContextoFundoGestor(context)
  const { data, error } = await context.supabase
    .from('documentos')
    .select('id, cedente_id, url_arquivo, nome_arquivo')
    .eq('id', documentoId)
    .maybeSingle()

  if (error || !data) {
    return { success: false, message: 'Documento nao encontrado.' }
  }

  const { data: vinculo, error: vinculoError } = await context.supabase
    .from('cedente_fundos')
    .select('id')
    .eq('cedente_id', data.cedente_id)
    .eq('fundo_id', fundo.fundoId)
    .eq('status', 'ativo')
    .maybeSingle()
  if (vinculoError || !vinculo) {
    return { success: false, message: 'Documento nao pertence ao fundo ativo.' }
  }
  if (!data.url_arquivo) {
    return { success: false, message: 'O documento ainda nao possui arquivo.' }
  }

  const { data: signed, error: signedError } = await context.supabase.storage
    .from(buckets.documentos)
    .createSignedUrl(data.url_arquivo, 60 * 10)
  if (signedError || !signed?.signedUrl) {
    return { success: false, message: 'Nao foi possivel abrir o documento.' }
  }

  return {
    success: true,
    url: signed.signedUrl,
    nome: data.nome_arquivo || 'Documento',
  }
}

export async function aprovarCedente(cedenteId: string): Promise<GestorActionState> {
  await requireGestor()
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
  const docsRepObrig = ['rg_cpf', 'representante_comprovante_residencia']
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

  const { data: aprovado, error } = await supabase.rpc('aprovar_cadastro_cedente_gestor', {
    p_cedente_id: cedenteId,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  const identificador = (Array.isArray(aprovado) ? aprovado[0] : aprovado)?.conta_escrow_identificador || ''

  await registrarLog({
    tipo_evento: 'CEDENTE_APROVADO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: { status: cedenteData.status },
    dados_depois: { status: 'ativo', conta_escrow: identificador },
  })

  await notificarCedente(
    cedenteId,
    'Cadastro aprovado!',
    `Seu cadastro foi aprovado. Sua conta escrow foi criada: ${identificador}. Voce ja pode solicitar antecipacoes.`,
    'cadastro_aprovado',
  )

  return { success: true, message: `Cedente aprovado. Conta escrow ${identificador} criada.` }
}

export async function reprovarCedente(cedenteId: string, motivo: string): Promise<GestorActionState> {
  await requireGestor()
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

  const { error } = await supabase.rpc('reprovar_cadastro_cedente_gestor', {
    p_cedente_id: cedenteId,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  await registrarLog({
    tipo_evento: 'CEDENTE_REPROVADO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: { status: cedenteData.status },
    dados_depois: { status: 'reprovado', motivo },
  })

  await notificarCedente(
    cedenteId,
    'Cadastro reprovado',
    `Seu cadastro foi reprovado. Motivo: ${motivo}`,
    'cadastro_reprovado',
  )

  return { success: true, message: 'Cedente reprovado.' }
}

export async function toggleCoobrigacaoCedente(cedenteId: string, habilitar: boolean): Promise<GestorActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('coobrigacao')
    .eq('id', cedenteId)
    .single()

  if (!cedente) {
    return { success: false, message: 'Cedente nao encontrado.' }
  }

  const dadosAntes = { coobrigacao: (cedente as { coobrigacao: boolean }).coobrigacao }

  const { error } = await supabase.rpc('alternar_coobrigacao_cedente_gestor', {
    p_cedente_id: cedenteId,
    p_habilitar: habilitar,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  await registrarLog({
    tipo_evento: 'COOBRIGACAO_ALTERADA',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: dadosAntes,
    dados_depois: { coobrigacao: habilitar },
  })

  return { success: true, message: `Coobrigacao ${habilitar ? 'habilitada' : 'desabilitada'} com sucesso.` }
}

export async function toggleEscrowCedente(cedenteId: string, habilitar: boolean): Promise<GestorActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('habilitar_escrow')
    .eq('id', cedenteId)
    .single()

  if (!cedente) {
    return { success: false, message: 'Cedente nao encontrado.' }
  }

  const dadosAntes = { habilitar_escrow: (cedente as { habilitar_escrow: boolean }).habilitar_escrow }

  const { error } = await supabase.rpc('alternar_escrow_cedente_gestor', {
    p_cedente_id: cedenteId,
    p_habilitar: habilitar,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  await registrarLog({
    tipo_evento: habilitar ? 'ESCROW_HABILITADO' : 'ESCROW_DESABILITADO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: dadosAntes,
    dados_depois: { habilitar_escrow: habilitar },
  })

  return { success: true, message: `Extrato escrow ${habilitar ? 'habilitado' : 'desabilitado'} com sucesso.` }
}

export async function toggleCadastroFiliaisCedente(cedenteId: string, habilitar: boolean): Promise<GestorActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('permite_cadastro_filiais')
    .eq('id', cedenteId)
    .single()

  if (!cedente) {
    return { success: false, message: 'Cedente nao encontrado.' }
  }

  const dadosAntes = { permite_cadastro_filiais: (cedente as { permite_cadastro_filiais: boolean }).permite_cadastro_filiais }

  const { error } = await supabase.rpc('alternar_cadastro_filiais_cedente_gestor', {
    p_cedente_id: cedenteId,
    p_habilitar: habilitar,
  })

  if (error) {
    return { success: false, message: error.message }
  }

  await registrarLog({
    tipo_evento: habilitar ? 'CADASTRO_FILIAIS_HABILITADO' : 'CADASTRO_FILIAIS_DESABILITADO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_antes: dadosAntes,
    dados_depois: { permite_cadastro_filiais: habilitar },
  })

  return { success: true, message: `Cadastro de filiais ${habilitar ? 'habilitado' : 'desabilitado'} com sucesso.` }
}

export async function aprovarAlteracaoCedente(solicitacaoId: string): Promise<GestorActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Usuario nao autenticado.' }

  const { data: sol } = await supabase
    .from('solicitacoes_alteracao_cedente')
    .select('id, cedente_id, dados_propostos, representantes_propostos, representantes_atuais, cedentes(user_id, razao_social)')
    .eq('id', solicitacaoId)
    .single()

  if (!sol) return { success: false, message: 'Solicitacao nao encontrada.' }

  const s = sol as {
    id: string
    cedente_id: string
    dados_propostos: Record<string, unknown>
    representantes_propostos: Array<Record<string, unknown>>
    representantes_atuais: Array<Record<string, unknown>>
    cedentes: { user_id: string; razao_social: string }
  }

  const { error } = await supabase.rpc('aprovar_alteracao_cadastral_cedente_gestor', {
    p_solicitacao_id: solicitacaoId,
  })

  if (error) return { success: false, message: error.message }

  await registrarLog({
    tipo_evento: 'ALTERACAO_CADASTRAL_APROVADA',
    entidade_tipo: 'cedentes',
    entidade_id: s.cedente_id,
    dados_depois: s.dados_propostos,
  })

  await notificarCedente(
    s.cedente_id,
    'Alteracao cadastral aprovada',
    'Sua solicitacao de alteracao de dados cadastrais foi aprovada.',
    'alteracao_cadastral_aprovada',
  )

  return { success: true, message: 'Alteracao cadastral aprovada e aplicada.' }
}

export async function reprovarAlteracaoCedente(solicitacaoId: string, motivo: string): Promise<GestorActionState> {
  await requireGestor()
  if (!motivo || motivo.trim().length === 0) {
    return { success: false, message: 'Motivo da reprovacao e obrigatorio.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Usuario nao autenticado.' }

  const { data: sol } = await supabase
    .from('solicitacoes_alteracao_cedente')
    .select('id, cedente_id, cedentes(user_id)')
    .eq('id', solicitacaoId)
    .single()

  if (!sol) return { success: false, message: 'Solicitacao nao encontrada.' }

  const s = sol as { id: string; cedente_id: string; cedentes: { user_id: string } }

  const { error } = await supabase.rpc('reprovar_alteracao_cadastral_cedente_gestor', {
    p_solicitacao_id: solicitacaoId,
    p_motivo: motivo,
  })

  if (error) return { success: false, message: error.message }

  await registrarLog({
    tipo_evento: 'ALTERACAO_CADASTRAL_REPROVADA',
    entidade_tipo: 'cedentes',
    entidade_id: s.cedente_id,
    dados_depois: { motivo },
  })

  await notificarCedente(
    s.cedente_id,
    'Alteracao cadastral reprovada',
    `Sua solicitacao de alteracao cadastral foi reprovada. Motivo: ${motivo}`,
    'alteracao_cadastral_reprovada',
  )

  return { success: true, message: 'Solicitacao reprovada.' }
}

export async function solicitarAtualizacaoDocumento(documentoId: string): Promise<GestorActionState> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { success: false, message: 'Usuario nao autenticado.' }

  const { data: docRaw } = await supabase
    .from('documentos')
    .select('id, tipo, cedente_id, cedentes(user_id, razao_social)')
    .eq('id', documentoId)
    .single()

  if (!docRaw) return { success: false, message: 'Documento nao encontrado.' }

  const doc = docRaw as {
    id: string; tipo: string; cedente_id: string
    cedentes: { user_id: string; razao_social: string }
  }

  const { error } = await supabase.rpc('solicitar_atualizacao_documento_gestor', {
    p_documento_id: documentoId,
  })

  if (error) return { success: false, message: error.message }

  const tipoLabel = tipoLabelsDoc[doc.tipo] || doc.tipo

  await notificarCedente(
    doc.cedente_id,
    'Atualizacao de documento solicitada',
    `O gestor solicitou a atualizacao do documento "${tipoLabel}". Por favor, envie uma versao atualizada em Documentos.`,
    'documento_atualizacao_solicitada',
  )

  await registrarLog({
    tipo_evento: 'ATUALIZACAO_DOCUMENTO_SOLICITADA',
    entidade_tipo: 'documentos',
    entidade_id: documentoId,
    dados_antes: null,
    dados_depois: { tipo: doc.tipo, cedente_id: doc.cedente_id, solicitado_por: user.id },
  })

  return { success: true, message: 'Atualizacao solicitada. O cedente foi notificado.' }
}

export async function convidarUsuarioCedente(
  cedenteId: string,
  email: string,
  perfil: 'administrador' | 'operador'
): Promise<GestorActionState> {
  const context = await requireGestorOuAdminCedente(cedenteId)
  const user = context.user

  const admin = createAdminClient()
  const perfilCanonico = perfil === 'administrador' ? 'ADMIN' : 'OPERACIONAL'
  const agora = new Date().toISOString()

  // Verificar se o email já existe como usuario
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('email', email.toLowerCase().trim())
    .single()

  let userId: string

  if (existingProfile) {
    const p = existingProfile as { id: string; role: string }
    if (p.role !== 'cedente') {
      return { success: false, message: 'Este email pertence a um usuario com outro perfil no sistema.' }
    }
    userId = p.id
  } else {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      email.toLowerCase().trim(),
      { data: { role: 'cedente' } }
    )
    if (inviteError || !invited?.user) {
      return { success: false, message: `Erro ao convidar usuario: ${inviteError?.message || 'desconhecido'}` }
    }
    userId = invited.user.id
  }

  // Verificar se já existe um vínculo (ativo ou inativo)
  const { data: existing } = await admin
    .from('cedente_acessos')
    .select('id, status, ativo')
    .eq('cedente_id', cedenteId)
    .eq('user_id', userId)
    .single()

  if (existing) {
    const ex = existing as { id: string; status: string | null; ativo: boolean }
    if (ex.status === 'ATIVO' || (ex.status === null && ex.ativo)) {
      return { success: false, message: 'Este usuario ja possui acesso ativo a este cedente.' }
    }
    const { error } = await admin
      .from('cedente_acessos')
      .update({
        perfil: perfilCanonico,
        status: 'ATIVO',
        ativo: true,
        convidado_por: user.id,
        aceito_em: agora,
        revogado_em: null,
      } as never)
      .eq('id', ex.id)
    if (error) return { success: false, message: `Erro ao reativar acesso: ${error.message}` }
  } else {
    const { error } = await admin
      .from('cedente_acessos')
      .insert({
        cedente_id: cedenteId,
        user_id: userId,
        perfil: perfilCanonico,
        status: 'ATIVO',
        ativo: true,
        convidado_por: user.id,
        aceito_em: agora,
      } as never)
    if (error) return { success: false, message: `Erro ao criar acesso: ${error.message}` }
  }

  await registrarLog({
    tipo_evento: 'ACESSO_CEDENTE_CONCEDIDO',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteId,
    dados_depois: { email, perfil, user_id: userId },
  })

  return { success: true, message: `Acesso concedido para ${email}.` }
}

/**
 * cedente_acessos so tem GRANT para service_role desde a canonicalizacao de
 * ACL/RLS (20260817150507) -- toda leitura precisa passar por um client
 * admin, nunca pelo client autenticado do gestor (que recebe "permission
 * denied" silencioso e faz a tela de "Acessos Vinculados" parecer vazia
 * mesmo com acessos ativos).
 */
export async function listarAcessosVinculadosCedente(cedenteId: string): Promise<Array<{
  id: string
  user_id: string
  perfil: 'administrador' | 'operador'
  ativo: boolean
  created_at: string
  profiles: { nome_completo: string; email: string } | null
}>> {
  await requireGestorOuAdminCedente(cedenteId)
  const admin = createAdminClient()
  const { data: acessos, error: acessosError } = await admin
    .from('cedente_acessos')
    .select('id, user_id, perfil, status, ativo, created_at')
    .eq('cedente_id', cedenteId)
    .order('created_at', { ascending: true })
    .limit(50)

  if (acessosError) throw new Error('Nao foi possivel carregar os acessos vinculados ao cedente.')
  const rows = (acessos || []) as Array<{
    id: string
    user_id: string
    perfil: 'ADMIN' | 'OPERACIONAL' | 'administrador' | 'operador'
    status: 'CONVIDADO' | 'ATIVO' | 'REVOGADO' | null
    ativo: boolean
    created_at: string
  }>
  const userIds = Array.from(new Set(rows.map((acesso) => acesso.user_id)))
  if (!userIds.length) return []

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, nome_completo, email')
    .in('id', userIds)

  if (profilesError) throw new Error('Nao foi possivel carregar os perfis vinculados ao cedente.')
  const profilesMap = Object.fromEntries(
    ((profiles || []) as Array<{ id: string; nome_completo: string; email: string }>).map((p) => [p.id, p])
  )

  return rows.map((acesso) => ({
    id: acesso.id,
    user_id: acesso.user_id,
    perfil: acesso.perfil === 'ADMIN' || acesso.perfil === 'administrador' ? 'administrador' as const : 'operador' as const,
    ativo: acesso.status ? acesso.status === 'ATIVO' : acesso.ativo,
    created_at: acesso.created_at,
    profiles: profilesMap[acesso.user_id]
      ? { nome_completo: profilesMap[acesso.user_id].nome_completo, email: profilesMap[acesso.user_id].email }
      : null,
  }))
}

export async function revogarAcessoCedente(acessoId: string): Promise<GestorActionState> {
  const admin = createAdminClient()

  const { data: acesso } = await admin
    .from('cedente_acessos')
    .select('cedente_id, user_id')
    .eq('id', acessoId)
    .single()

  if (!acesso) return { success: false, message: 'Acesso nao encontrado.' }
  const acessoAtual = acesso as { cedente_id: string; user_id: string }
  const context = await requireGestorOuAdminCedente(acessoAtual.cedente_id)
  if (context.profile.role === 'cedente' && acessoAtual.user_id === context.user.id) {
    return { success: false, message: 'O ADMIN nao pode revogar o proprio acesso.' }
  }

  const { error } = await admin
    .from('cedente_acessos')
    .update({ status: 'REVOGADO', ativo: false, revogado_em: new Date().toISOString() } as never)
    .eq('id', acessoId)

  if (error) return { success: false, message: `Erro ao revogar acesso: ${error.message}` }

  await registrarLog({
    tipo_evento: 'ACESSO_CEDENTE_REVOGADO',
    entidade_tipo: 'cedentes',
    entidade_id: acessoAtual.cedente_id,
    dados_depois: { acesso_id: acessoId },
  })

  return { success: true, message: 'Acesso revogado com sucesso.' }
}

// ─── Gestão de Fundos ──────────────────────────────────────────────────────

export async function vincularFundoCedente(cedenteId: string, fundoId: string | null): Promise<GestorActionState> {
  try {
    if (fundoId) {
      await vincularCedenteFundo(cedenteId, fundoId)
      return { success: true, message: 'Fundo vinculado com sucesso.' }
    }

    await suspenderCedenteFundo(cedenteId)
    return { success: true, message: 'Fundo desvinculado.' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Erro ao atualizar vinculo do fundo.' }
  }
}

'use server'

import { createClient } from '@/lib/supabase/server'
import { DOCUMENT_TYPES, type DocumentoTipo } from '@/lib/types/domain'
import { requireAuthenticated, requireGestor } from '@/lib/auth/authorization'
import { cedenteSchema, type CedenteFormData } from '@/lib/validations/cedente'
import { registrarLog } from './auditoria'
import { notificarGestores } from './notificacao'
import {
  criarCaminhoDocumentoCadastral,
  executarUploadDocumentoCadastral,
  validarArquivoDocumentoCadastral,
  type DocumentoCadastralUploadClient,
} from '@/lib/documentos-cadastrais/upload'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function ehAdministrador(supabase: SupabaseClient, userId: string, cedenteUserId: string): Promise<boolean> {
  if (cedenteUserId === userId) return true
  // cedente_acessos so tem GRANT para service_role (canonicalizacao de ACL/
  // RLS em 20260817150507) -- uma leitura direta aqui sempre falhava
  // (permission denied, descartado em silencio), tratando todo usuario
  // convidado como se nao fosse administrador. get_user_cedente_acesso_
  // perfil() e SECURITY DEFINER e ja e GRANTed para authenticated.
  const { data: perfil } = await supabase.rpc('get_user_cedente_acesso_perfil')
  return perfil === 'administrador'
}

export type CedenteActionState = {
  success?: boolean
  errors?: Record<string, string[]>
  message?: string
} | undefined

export async function cadastrarCedente(data: CedenteFormData): Promise<CedenteActionState> {
  await requireAuthenticated()
  const validated = cedenteSchema.safeParse(data)

  if (!validated.success) {
    return {
      success: false,
      errors: validated.error.flatten().fieldErrors as Record<string, string[]>,
    }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente, error } = await supabase.rpc('concluir_onboarding_cedente', {
    p_cadastro: validated.data,
  })

  if (error) {
    console.error('[cadastrarCedente]', {
      codigo: error.code,
      mensagem: error.message,
      usuario_id: user.id,
    })
    return {
      success: false,
      message: error.code === '23505' || error.code === '42501' || error.code === '22023'
        ? error.message
        : 'Nao foi possivel concluir o cadastro. Tente novamente.',
    }
  }

  const cedenteData = cedente as { id: string; razao_social: string; criado: boolean; idempotente: boolean }

  if (cedenteData.criado) {
    await registrarLog({
      tipo_evento: 'CEDENTE_CADASTRADO',
      entidade_tipo: 'cedentes',
      entidade_id: cedenteData.id,
      dados_depois: validated.data as unknown as Record<string, unknown>,
    })

    await notificarGestores(
      'Novo cedente cadastrado',
      `O cedente ${cedenteData.razao_social} (${validated.data.cnpj}) realizou o cadastro e aguarda analise.`,
      'cadastro_cedente'
    )
  }

  return {
    success: true,
    message: cedenteData.idempotente
      ? 'Cadastro ja concluido anteriormente.'
      : 'Cadastro realizado com sucesso!',
  }
}

export async function uploadDocumento(formData: FormData): Promise<CedenteActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id, cnpj, user_id')
    .single()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const cedenteData = cedente as { id: string; cnpj: string; user_id: string }

  if (!await ehAdministrador(supabase, user.id, cedenteData.user_id)) {
    return { success: false, message: 'Sem permissao para enviar documentos. Apenas administradores do cedente podem realizar esta acao.' }
  }
  const file = formData.get('arquivo') as File
  const tipo = formData.get('tipo') as string
  const representanteId = (formData.get('representante_id') as string | null) || null

  if (!file || !tipo) {
    return { success: false, message: 'Arquivo e tipo sao obrigatorios.' }
  }

  if (!DOCUMENT_TYPES.includes(tipo as DocumentoTipo)) {
    return { success: false, message: 'Tipo de documento invalido.' }
  }
  const tipoDocumento = tipo as DocumentoTipo

  const fileValidationError = validarArquivoDocumentoCadastral(file)
  if (fileValidationError) return { success: false, message: fileValidationError }

  const filePath = criarCaminhoDocumentoCadastral({
    cnpj: cedenteData.cnpj,
    tipo: tipoDocumento,
    nomeArquivo: file.name,
    representanteId,
    uploadId: crypto.randomUUID(),
  })

  const result = await executarUploadDocumentoCadastral({
    client: supabase as unknown as DocumentoCadastralUploadClient,
    file,
    tipo: tipoDocumento,
    storagePath: filePath,
    representanteId,
  })

  if (!result.ok) {
    console.error('[uploadDocumento]', {
      etapa: result.etapa,
      codigo: result.etapa === 'database' ? 'DOCUMENT_DATABASE_FAILURE' : 'DOCUMENT_STORAGE_FAILURE',
      usuario_id: user.id,
      cedente_id: cedenteData.id,
      tipo: tipoDocumento,
      representante_id: representanteId,
      storage_path: filePath,
      erro: result.message,
      compensacao_erro: result.compensationError || null,
    })
    return {
      success: false,
      message: result.compensationError
        ? 'Nao foi possivel registrar o documento e a limpeza automatica do arquivo falhou. Contate o suporte.'
        : result.etapa === 'storage'
          ? 'Nao foi possivel enviar o arquivo. Tente novamente.'
          : 'Nao foi possivel registrar o documento. O arquivo enviado foi removido; tente novamente.',
    }
  }

  const novaVersao = result.documento.versao

  await registrarLog({
    tipo_evento: 'DOCUMENTO_ENVIADO',
    entidade_tipo: 'documentos',
    dados_depois: { tipo, versao: novaVersao, nome_arquivo: file.name },
  })

  await notificarGestores(
    'Novo documento enviado',
    `O cedente CNPJ ${cedenteData.cnpj} enviou o documento "${tipo}" (v${novaVersao}).`,
    'documento_enviado'
  )

  return { success: true, message: 'Documento enviado com sucesso!' }
}

export async function reenviarDocumento(documentoId: string, formData: FormData): Promise<CedenteActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: doc } = await supabase
    .from('documentos')
    .select('tipo, cedente_id, representante_id')
    .eq('id', documentoId)
    .single()

  if (!doc) {
    return { success: false, message: 'Documento nao encontrado.' }
  }

  const docData = doc as { tipo: string; cedente_id: string; representante_id: string | null }

  // Usar uploadDocumento reutilizando a logica
  const newFormData = new FormData()
  newFormData.set('arquivo', formData.get('arquivo') as File)
  newFormData.set('tipo', docData.tipo)
  if (docData.representante_id) newFormData.set('representante_id', docData.representante_id)

  return uploadDocumento(newFormData)
}


export async function solicitarAlteracaoCedente(
  dados: Partial<CedenteFormData>
): Promise<CedenteActionState> {
  await requireAuthenticated()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Usuario nao autenticado.' }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id, user_id, cnpj, razao_social, nome_fantasia, cnae, cep, logradouro, numero, complemento, bairro, cidade, estado, telefone_comercial, email_comercial, banco, agencia, conta, tipo_conta')
    .single()

  if (!cedente) return { success: false, message: 'Cedente nao encontrado.' }

  const cedenteData = cedente as { id: string; user_id: string } & Record<string, unknown>

  if (!await ehAdministrador(supabase, user.id, cedenteData.user_id)) {
    return { success: false, message: 'Sem permissao para solicitar alteracoes cadastrais.' }
  }

  // Bloquear se já há solicitação pendente
  const { data: pendente } = await supabase
    .from('solicitacoes_alteracao_cedente')
    .select('id')
    .eq('cedente_id', cedenteData.id)
    .eq('status', 'pendente')
    .limit(1)
    .single()

  if (pendente) {
    return { success: false, message: 'Ja existe uma solicitacao de alteracao aguardando aprovacao.' }
  }

  const { data: reps } = await supabase
    .from('representantes')
    .select('id, nome, cpf, rg, cargo, email, telefone, principal')
    .eq('cedente_id', cedenteData.id)
    .order('principal', { ascending: false })

  const { representantes: representantesPropostos, ...camposPropostos } = dados

  const { error } = await supabase
    .from('solicitacoes_alteracao_cedente')
    .insert({
      cedente_id: cedenteData.id,
      dados_atuais: cedenteData,
      dados_propostos: camposPropostos,
      representantes_atuais: reps || [],
      representantes_propostos: representantesPropostos || [],
    } as never)

  if (error) return { success: false, message: `Erro ao registrar solicitacao: ${error.message}` }

  await registrarLog({
    tipo_evento: 'ALTERACAO_CADASTRAL_SOLICITADA',
    entidade_tipo: 'cedentes',
    entidade_id: cedenteData.id,
    dados_antes: cedenteData,
    dados_depois: camposPropostos as Record<string, unknown>,
  })

  await notificarGestores(
    'Solicitacao de alteracao cadastral',
    `O cedente ${cedenteData.razao_social as string} (${cedenteData.cnpj as string}) solicitou alteracao nos dados cadastrais.`,
    'alteracao_cadastral'
  )

  return { success: true, message: 'Solicitacao enviada. Aguardando aprovacao do gestor.' }
}

export async function salvarContratoAssinado(
  cedenteId: string,
  path: string
): Promise<{ success: boolean; message: string }> {
  await requireGestor()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, message: 'Nao autenticado.' }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile as { role: string }).role !== 'gestor') {
    return { success: false, message: 'Acesso negado.' }
  }

  const { error } = await supabase
    .from('cedentes')
    .update({ contrato_assinado_url: path } as never)
    .eq('id', cedenteId)

  if (error) return { success: false, message: `Erro: ${error.message}` }
  return { success: true, message: 'Contrato assinado salvo.' }
}

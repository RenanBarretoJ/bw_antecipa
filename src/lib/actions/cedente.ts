'use server'

import { createClient } from '@/lib/supabase/server'
import { cedenteSchema, type CedenteFormData } from '@/lib/validations/cedente'
import { registrarLog } from './auditoria'
import { notificarGestores } from './notificacao'
import { buckets } from '@/lib/storage'

export type CedenteActionState = {
  success?: boolean
  errors?: Record<string, string[]>
  message?: string
} | undefined

export async function cadastrarCedente(data: CedenteFormData): Promise<CedenteActionState> {
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

  const existing = await supabase
    .from('cedentes')
    .select('id')
    .eq('user_id', user.id)
    .single()

  if (existing.data) {
    return { success: false, message: 'Voce ja possui um cadastro de cedente.' }
  }

  const { representantes, ...cedenteFields } = validated.data

  const { data: cedente, error } = await supabase
    .from('cedentes')
    .insert({
      ...cedenteFields,
      user_id: user.id,
      status: 'pendente' as const,
    } as never)
    .select('id, razao_social')
    .single()

  if (error) {
    console.error('[cadastrarCedente]', error.message)
    return { success: false, message: `Erro ao cadastrar: ${error.message}` }
  }

  const cedenteData = cedente as { id: string; razao_social: string }

  const { error: repError } = await supabase
    .from('representantes')
    .insert(representantes.map((rep, idx) => ({
      ...rep,
      cedente_id: cedenteData.id,
      principal: idx === 0,
    })) as never)

  if (repError) {
    await supabase.from('cedentes').delete().eq('id', cedenteData.id)
    return { success: false, message: `Erro ao salvar representantes: ${repError.message}` }
  }

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

  return { success: true, message: 'Cadastro realizado com sucesso!' }
}

export async function uploadDocumento(formData: FormData): Promise<CedenteActionState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: cedente } = await supabase
    .from('cedentes')
    .select('id, cnpj')
    .eq('user_id', user.id)
    .single()

  if (!cedente) {
    return { success: false, message: 'Cadastro de cedente nao encontrado.' }
  }

  const cedenteData = cedente as { id: string; cnpj: string }
  const file = formData.get('arquivo') as File
  const tipo = formData.get('tipo') as string
  const representanteId = (formData.get('representante_id') as string | null) || null

  if (!file || !tipo) {
    return { success: false, message: 'Arquivo e tipo sao obrigatorios.' }
  }

  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png']
  if (!allowedTypes.includes(file.type)) {
    return { success: false, message: 'Formato invalido. Aceitos: PDF, JPG, PNG.' }
  }

  if (file.size > 20 * 1024 * 1024) {
    return { success: false, message: 'Arquivo muito grande. Maximo: 20MB.' }
  }

  // Buscar versao atual, filtrando por representante_id se presente
  let versionQuery = supabase
    .from('documentos')
    .select('versao')
    .eq('cedente_id', cedenteData.id)
    .eq('tipo', tipo)
    .order('versao', { ascending: false })
    .limit(1)

  if (representanteId) {
    versionQuery = versionQuery.eq('representante_id', representanteId)
  } else {
    versionQuery = versionQuery.is('representante_id', null)
  }

  const { data: existingDocs } = await versionQuery

  const docs = (existingDocs || []) as Array<{ versao: number }>
  const novaVersao = docs.length > 0 ? docs[0].versao + 1 : 1

  const timestamp = Date.now()
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const subpasta = representanteId ? `representantes/${representanteId}` : tipo
  const filePath = `${cedenteData.cnpj}/${subpasta}/${novaVersao}_${timestamp}_${cleanName}`

  const { error: uploadError } = await supabase.storage
    .from(buckets.documentos)
    .upload(filePath, file)

  if (uploadError) {
    console.error('[uploadDocumento]', uploadError.message)
    return { success: false, message: `Erro no upload: ${uploadError.message}` }
  }

  const { error: dbError } = await supabase
    .from('documentos')
    .insert({
      cedente_id: cedenteData.id,
      tipo,
      versao: novaVersao,
      status: 'enviado',
      url_arquivo: filePath,
      nome_arquivo: file.name,
      representante_id: representanteId || null,
    } as never)

  if (dbError) {
    console.error('[uploadDocumento db]', dbError.message)
    return { success: false, message: `Erro ao registrar documento: ${dbError.message}` }
  }

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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, message: 'Usuario nao autenticado.' }
  }

  const { data: doc } = await supabase
    .from('documentos')
    .select('tipo, cedente_id')
    .eq('id', documentoId)
    .single()

  if (!doc) {
    return { success: false, message: 'Documento nao encontrado.' }
  }

  const docData = doc as { tipo: string; cedente_id: string }

  // Usar uploadDocumento reutilizando a logica
  const newFormData = new FormData()
  newFormData.set('arquivo', formData.get('arquivo') as File)
  newFormData.set('tipo', docData.tipo)

  return uploadDocumento(newFormData)
}

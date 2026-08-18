'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthenticated, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { DOCUMENTO_V2_BUCKET, mimeArquivo, sha256Arquivo, validarArquivoContraTipo } from '@/lib/documentos-v2/tipos'
import { enviarObjetoDocumento, gerarCaminhoDocumentoEstabelecimento, removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import type { CedenteEstabelecimento, CedenteEstabelecimentoContaBancaria, CedenteEstabelecimentoRequisito } from '@/types/database'

export type EstabelecimentoActionResult<T = unknown> = {
  success: boolean
  message: string
  data?: T
}

function falha<T = unknown>(error: unknown, fallback: string): EstabelecimentoActionResult<T> {
  return { success: false, message: error instanceof Error ? error.message : fallback }
}

async function cedenteAutenticado() {
  const context = await requireAuthenticated()
  if (context.profile.role !== 'cedente') throw new Error('Apenas o cedente pode executar esta acao.')
  const { data, error } = await context.supabase
    .from('cedentes')
    .select('id, status')
    .eq('user_id', context.user.id)
    .maybeSingle()
  if (error) throw new Error(`Nao foi possivel consultar o cedente: ${error.message}`)
  if (!data) throw new Error('Cadastro de cedente nao encontrado.')
  return { ...context, cedente: data as { id: string; status: string } }
}

export async function listarMeusEstabelecimentos(): Promise<EstabelecimentoActionResult<{
  estabelecimentos: CedenteEstabelecimento[]
  contas: CedenteEstabelecimentoContaBancaria[]
  requisitos: CedenteEstabelecimentoRequisito[]
  tipos: Array<{ id: string; codigo: string; nome: string }>
}>> {
  try {
    const context = await cedenteAutenticado()
    const { data: estabelecimentos, error } = await context.supabase
      .from('cedente_estabelecimentos')
      .select('*')
      .eq('cedente_id', context.cedente.id)
      .order('tipo')
      .order('razao_social')
    if (error) throw new Error(`Nao foi possivel listar os CNPJs: ${error.message}`)
    const ids = (estabelecimentos || []).map((item) => item.id)
    if (!ids.length) return { success: true, message: 'Nenhum estabelecimento cadastrado.', data: { estabelecimentos: [], contas: [], requisitos: [], tipos: [] } }
    const [{ data: contas, error: contasError }, { data: requisitos, error: requisitosError }] = await Promise.all([
      context.supabase.from('cedente_estabelecimento_contas_bancarias').select('*').in('estabelecimento_id', ids).eq('ativo', true),
      context.supabase.from('cedente_estabelecimento_requisitos').select('*').in('estabelecimento_id', ids).eq('ativo', true),
    ])
    if (contasError) throw new Error(`Nao foi possivel listar as contas bancarias: ${contasError.message}`)
    if (requisitosError) throw new Error(`Nao foi possivel listar os requisitos: ${requisitosError.message}`)
    const tipoIds = [...new Set((requisitos || []).map((item) => item.documento_tipo_id))]
    const { data: tipos, error: tiposError } = tipoIds.length
      ? await context.supabase.from('documento_tipos').select('id, codigo, nome').in('id', tipoIds)
      : { data: [], error: null }
    if (tiposError) throw new Error(`Nao foi possivel listar o catalogo documental: ${tiposError.message}`)
    return {
      success: true,
      message: 'Estabelecimentos carregados.',
      data: {
        estabelecimentos: (estabelecimentos || []) as CedenteEstabelecimento[],
        contas: (contas || []) as CedenteEstabelecimentoContaBancaria[],
        requisitos: (requisitos || []) as CedenteEstabelecimentoRequisito[],
        tipos: (tipos || []) as Array<{ id: string; codigo: string; nome: string }>,
      },
    }
  } catch (error) {
    return falha(error, 'Nao foi possivel listar os estabelecimentos.')
  }
}

export async function cadastrarFilial(formData: FormData): Promise<EstabelecimentoActionResult<CedenteEstabelecimento>> {
  try {
    const context = await cedenteAutenticado()
    if (context.cedente.status !== 'ativo') throw new Error('O cedente precisa estar ativo para cadastrar uma filial.')
    const { data, error } = await context.supabase.rpc('cadastrar_filial_cedente', {
      p_cnpj: String(formData.get('cnpj') || ''),
      p_razao_social: String(formData.get('razao_social') || '').trim(),
      p_nome_fantasia: String(formData.get('nome_fantasia') || '').trim() || null,
    })
    if (error) throw new Error(`Nao foi possivel cadastrar a filial: ${error.message}`)
    revalidatePath('/cedente/estabelecimentos')
    return { success: true, message: 'Filial cadastrada e enviada para analise.', data: data as CedenteEstabelecimento }
  } catch (error) {
    return falha(error, 'Nao foi possivel cadastrar a filial.')
  }
}

export async function salvarContaEstabelecimento(formData: FormData): Promise<EstabelecimentoActionResult<CedenteEstabelecimentoContaBancaria>> {
  try {
    const context = await cedenteAutenticado()
    const { data, error } = await context.supabase.rpc('salvar_conta_estabelecimento_cedente', {
      p_estabelecimento_id: String(formData.get('estabelecimento_id') || ''),
      p_banco: String(formData.get('banco') || '').trim(),
      p_agencia: String(formData.get('agencia') || '').trim(),
      p_conta: String(formData.get('conta') || '').trim(),
      p_tipo_conta: String(formData.get('tipo_conta') || '').trim(),
      p_principal: formData.get('principal') !== 'false',
    })
    if (error) throw new Error(`Nao foi possivel salvar a conta: ${error.message}`)
    revalidatePath('/cedente/estabelecimentos')
    return { success: true, message: 'Conta bancaria salva.', data: data as CedenteEstabelecimentoContaBancaria }
  } catch (error) {
    return falha(error, 'Nao foi possivel salvar a conta bancaria.')
  }
}

export async function enviarDocumentoEstabelecimento(formData: FormData): Promise<EstabelecimentoActionResult> {
  let path: string | null = null
  try {
    const context = await cedenteAutenticado()
    const estabelecimentoId = String(formData.get('estabelecimento_id') || '')
    const requisitoId = String(formData.get('requisito_id') || '')
    const tipoId = String(formData.get('documento_tipo_id') || '')
    const arquivo = formData.get('arquivo')
    if (!(arquivo instanceof File)) throw new Error('Selecione um arquivo valido.')
    const { data: tipo, error: tipoError } = await context.supabase.from('documento_tipos').select('*').eq('id', tipoId).eq('ativo', true).maybeSingle()
    if (tipoError || !tipo) throw new Error('Tipo documental nao encontrado ou inativo.')
    const validacao = validarArquivoContraTipo(arquivo, tipo)
    if (validacao) throw new Error(validacao)
    path = gerarCaminhoDocumentoEstabelecimento({ cedenteId: context.cedente.id, estabelecimentoId, tipoCodigo: tipo.codigo, nomeOriginal: arquivo.name })
    await enviarObjetoDocumento(path, arquivo, mimeArquivo(arquivo))
    const { error } = await context.supabase.rpc('registrar_documento_estabelecimento_upload', {
      p_estabelecimento_id: estabelecimentoId,
      p_requisito_id: requisitoId,
      p_documento_tipo_id: tipoId,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_nome_original: arquivo.name,
      p_mime_type: mimeArquivo(arquivo),
      p_tamanho_bytes: arquivo.size,
      p_sha256: await sha256Arquivo(arquivo),
    })
    if (error) throw new Error(`Nao foi possivel registrar o documento: ${error.message}`)
    revalidatePath('/cedente/estabelecimentos')
    return { success: true, message: 'Documento do estabelecimento enviado para analise.' }
  } catch (error) {
    if (path) await removerObjetoDocumento(path).catch(() => undefined)
    return falha(error, 'Nao foi possivel enviar o documento.')
  }
}

export async function decidirEstabelecimento(formData: FormData): Promise<EstabelecimentoActionResult<CedenteEstabelecimento>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const acao = String(formData.get('acao') || '') as 'aprovar' | 'rejeitar' | 'suspender' | 'reativar'
    const { data, error } = await context.supabase.rpc('decidir_estabelecimento_gestor', {
      p_estabelecimento_id: String(formData.get('estabelecimento_id') || ''),
      p_acao: acao,
      p_motivo: String(formData.get('motivo') || '').trim() || null,
    })
    if (error) throw new Error(`Nao foi possivel atualizar o estabelecimento: ${error.message}`)
    revalidatePath('/gestor/cedentes')
    return { success: true, message: 'Status do estabelecimento atualizado.', data: data as CedenteEstabelecimento }
  } catch (error) {
    return falha(error, 'Nao foi possivel atualizar o estabelecimento.')
  }
}

export async function configurarRequisitoEstabelecimento(formData: FormData): Promise<EstabelecimentoActionResult<CedenteEstabelecimentoRequisito>> {
  try {
    const context = await requireGestor()
    const { data, error } = await context.supabase.rpc('configurar_requisito_estabelecimento_gestor', {
      p_estabelecimento_id: String(formData.get('estabelecimento_id') || ''),
      p_documento_tipo_id: String(formData.get('documento_tipo_id') || ''),
      p_obrigatorio: formData.get('obrigatorio') !== 'false',
      p_ativo: formData.get('ativo') !== 'false',
      p_observacoes: String(formData.get('observacoes') || '').trim() || null,
    })
    if (error) throw new Error(`Nao foi possivel configurar o requisito: ${error.message}`)
    revalidatePath('/gestor/cedentes')
    return { success: true, message: 'Checklist do estabelecimento atualizado.', data: data as CedenteEstabelecimentoRequisito }
  } catch (error) {
    return falha(error, 'Nao foi possivel configurar o requisito.')
  }
}

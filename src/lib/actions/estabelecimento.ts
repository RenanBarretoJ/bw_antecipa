'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthenticated, requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { DOCUMENTO_V2_BUCKET, mimeArquivo, sha256Arquivo, validarArquivoContraTipo } from '@/lib/documentos-v2/tipos'
import { enviarObjetoDocumento, gerarCaminhoDocumentoEstabelecimento, gerarUrlDocumento, removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import { buckets } from '@/lib/storage'
import { notificarCedente } from './notificacao'
import { carregarEstabelecimentosPaginados } from '@/lib/cedentes/estabelecimentos-listagem.server'
import type { FiltrosEstabelecimentos, ResultadoEstabelecimentos } from '@/lib/cedentes/estabelecimentos-listagem'
import type { CedenteEstabelecimento, CedenteEstabelecimentoContaBancaria, CedenteEstabelecimentoRequisito, EstabelecimentoRequisitoStatus } from '@/types/database'

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
  // get_user_cedente_id() resolve tanto o dono (cedentes.user_id) quanto um
  // usuario convidado via cedente_acessos.
  const { data: cedenteId } = await context.supabase.rpc('get_user_cedente_id')
  const { data, error } = cedenteId
    ? await context.supabase.from('cedentes').select('id, status').eq('id', cedenteId).maybeSingle()
    : { data: null, error: null }
  if (error) throw new Error(`Nao foi possivel consultar o cedente: ${error.message}`)
  if (!data) throw new Error('Cadastro de cedente nao encontrado.')
  return { ...context, cedente: data as { id: string; status: string } }
}

export async function obterStatusMatriz(): Promise<EstabelecimentoActionResult<{
  matriz: { id: string; status: string; ativo: boolean } | null
  permiteCadastroFiliais: boolean
}>> {
  try {
    const context = await cedenteAutenticado()
    const [{ data: matriz, error: matrizError }, { data: cedente, error: cedenteError }] = await Promise.all([
      context.supabase
        .from('cedente_estabelecimentos')
        .select('id, status, ativo')
        .eq('cedente_id', context.cedente.id)
        .eq('tipo', 'matriz')
        .maybeSingle(),
      context.supabase
        .from('cedentes')
        .select('permite_cadastro_filiais')
        .eq('id', context.cedente.id)
        .single(),
    ])
    if (matrizError) throw new Error(`Nao foi possivel consultar a matriz: ${matrizError.message}`)
    if (cedenteError) throw new Error(`Nao foi possivel consultar a permissao de cadastro: ${cedenteError.message}`)
    return {
      success: true,
      message: 'Matriz consultada.',
      data: {
        matriz: matriz as { id: string; status: string; ativo: boolean } | null,
        permiteCadastroFiliais: Boolean((cedente as { permite_cadastro_filiais: boolean } | null)?.permite_cadastro_filiais),
      },
    }
  } catch (error) {
    return falha(error, 'Nao foi possivel consultar a matriz.')
  }
}

export async function carregarDetalheEstabelecimento(estabelecimentoId: string): Promise<EstabelecimentoActionResult<{
  requisitos: EstabelecimentoRequisitoStatus[]
  contas: CedenteEstabelecimentoContaBancaria[]
}>> {
  try {
    const context = await requireAuthenticated()
    if (context.profile.role !== 'cedente' && context.profile.role !== 'gestor') {
      throw new Error('Apenas cedente ou gestor podem consultar o detalhe.')
    }
    const [{ data: requisitos, error: requisitosError }, { data: contas, error: contasError }] = await Promise.all([
      context.supabase.rpc('listar_requisitos_estabelecimento', { p_estabelecimento_id: estabelecimentoId }),
      context.supabase.from('cedente_estabelecimento_contas_bancarias').select('*').eq('estabelecimento_id', estabelecimentoId).eq('ativo', true),
    ])
    if (requisitosError) throw new Error(`Nao foi possivel carregar o checklist: ${requisitosError.message}`)
    if (contasError) throw new Error(`Nao foi possivel carregar as contas: ${contasError.message}`)
    return {
      success: true,
      message: 'Detalhe carregado.',
      data: {
        requisitos: (requisitos || []) as EstabelecimentoRequisitoStatus[],
        contas: (contas || []) as CedenteEstabelecimentoContaBancaria[],
      },
    }
  } catch (error) {
    return falha(error, 'Nao foi possivel carregar o detalhe do estabelecimento.')
  }
}

export async function listarEstabelecimentosGestor(
  cedenteId: string,
  filtros: FiltrosEstabelecimentos,
): Promise<EstabelecimentoActionResult<ResultadoEstabelecimentos>> {
  try {
    const context = await requireGestor()
    const data = await carregarEstabelecimentosPaginados(context.supabase, cedenteId, filtros)
    return { success: true, message: 'Estabelecimentos carregados.', data }
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
    const documentoTipoId = String(formData.get('documento_tipo_id') || '')
    const { data, error } = await context.supabase.rpc('configurar_requisito_estabelecimento_gestor', {
      p_estabelecimento_id: String(formData.get('estabelecimento_id') || ''),
      p_documento_tipo_id: documentoTipoId,
      p_obrigatorio: formData.get('obrigatorio') !== 'false',
      p_ativo: formData.get('ativo') !== 'false',
      p_observacoes: String(formData.get('observacoes') || '').trim() || null,
    })
    if (error) throw new Error(`Nao foi possivel configurar o requisito: ${error.message}`)
    const resultado = data as { requisito: CedenteEstabelecimentoRequisito; pendencia_pos_aprovacao: boolean; cedente_id: string }
    if (resultado.pendencia_pos_aprovacao) {
      const { data: tipo } = await context.supabase.from('documento_tipos').select('nome').eq('id', documentoTipoId).maybeSingle()
      await notificarCedente(
        resultado.cedente_id,
        'Nova pendencia documental',
        `Um novo documento obrigatorio ("${(tipo as { nome: string } | null)?.nome || 'documento'}") foi adicionado ao checklist de um estabelecimento ja aprovado. Envie o documento para manter o cadastro completo.`,
        'estabelecimento_pendencia_pos_aprovacao',
      )
    }
    revalidatePath('/gestor/cedentes')
    return { success: true, message: 'Checklist do estabelecimento atualizado.', data: resultado.requisito }
  } catch (error) {
    return falha(error, 'Nao foi possivel configurar o requisito.')
  }
}

export async function obterUrlDocumentoRequisito(input: {
  estabelecimentoId: string
  documentoVersaoId?: string | null
  documentoLegadoId?: string | null
}): Promise<EstabelecimentoActionResult<{ url: string }>> {
  try {
    const context = await requireAuthenticated()
    if (context.profile.role !== 'cedente' && context.profile.role !== 'gestor') {
      throw new Error('Apenas cedente ou gestor podem visualizar o documento.')
    }
    const { data: estab, error: estabError } = await context.supabase
      .from('cedente_estabelecimentos')
      .select('cedente_id')
      .eq('id', input.estabelecimentoId)
      .maybeSingle()
    if (estabError || !estab) throw new Error('Estabelecimento nao encontrado.')

    if (input.documentoVersaoId) {
      const { data: versao, error: versaoError } = await context.supabase
        .from('documento_versoes')
        .select('path')
        .eq('id', input.documentoVersaoId)
        .maybeSingle()
      if (versaoError || !versao) throw new Error('Versao documental nao encontrada.')
      const url = await gerarUrlDocumento((versao as { path: string }).path)
      return { success: true, message: 'URL gerada.', data: { url } }
    }

    if (input.documentoLegadoId) {
      const { data: legado, error: legadoError } = await context.supabase
        .from('documentos')
        .select('cedente_id, url_arquivo')
        .eq('id', input.documentoLegadoId)
        .maybeSingle()
      if (legadoError || !legado) throw new Error('Documento nao encontrado.')
      const doc = legado as { cedente_id: string; url_arquivo: string | null }
      if (doc.cedente_id !== (estab as { cedente_id: string }).cedente_id) throw new Error('Documento nao pertence a este estabelecimento.')
      if (!doc.url_arquivo) throw new Error('Documento ainda nao possui arquivo.')
      const { data: signed, error: signedError } = await context.supabase.storage
        .from(buckets.documentos)
        .createSignedUrl(doc.url_arquivo, 60 * 10)
      if (signedError || !signed?.signedUrl) throw new Error('Nao foi possivel abrir o documento.')
      return { success: true, message: 'URL gerada.', data: { url: signed.signedUrl } }
    }

    throw new Error('Nenhum documento disponivel para este requisito.')
  } catch (error) {
    return falha(error, 'Nao foi possivel gerar a URL do documento.')
  }
}

export async function analisarDocumentoEstabelecimento(formData: FormData): Promise<EstabelecimentoActionResult> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const resultado = String(formData.get('resultado') || '') as 'aprovado' | 'rejeitado' | 'requer_ajuste'
    const observacoes = String(formData.get('observacoes') || '').trim() || null
    if (resultado !== 'aprovado' && !observacoes) throw new Error('Motivo obrigatorio para rejeicao ou solicitacao de ajuste.')
    const { data, error } = await context.supabase.rpc('analisar_documento_estabelecimento_gestor', {
      p_documento_versao_id: String(formData.get('documento_versao_id') || ''),
      p_resultado: resultado,
      p_observacoes: observacoes,
    })
    if (error) throw new Error(`Nao foi possivel analisar o documento: ${error.message}`)
    const info = data as { cedente_id: string; estabelecimento_id: string }
    const labelResultado = resultado === 'aprovado' ? 'aprovado' : resultado === 'rejeitado' ? 'reprovado' : 'com ajuste solicitado'
    await notificarCedente(
      info.cedente_id,
      `Documento de estabelecimento ${labelResultado}`,
      resultado === 'aprovado'
        ? 'Um documento do seu estabelecimento foi aprovado.'
        : `Um documento do seu estabelecimento foi ${labelResultado}. Motivo: ${observacoes}`,
      `documento_estabelecimento_${resultado}`,
    )
    revalidatePath('/gestor/cedentes')
    revalidatePath('/cedente/estabelecimentos')
    return { success: true, message: 'Documento analisado com sucesso.' }
  } catch (error) {
    return falha(error, 'Nao foi possivel analisar o documento.')
  }
}

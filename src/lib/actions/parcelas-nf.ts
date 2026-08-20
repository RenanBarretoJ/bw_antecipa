'use server'

import { requireGestor, requireNotaFiscalAccess } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { DOCUMENTO_V2_BUCKET, mimeArquivo, sha256Arquivo, validarArquivoContraTipo } from '@/lib/documentos-v2/tipos'
import { enviarObjetoDocumento, gerarCaminhoDocumento, removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import { notificarCedente } from './notificacao'
import { registrarLog } from './auditoria'
import { revalidatePath } from 'next/cache'
import type { NotaFiscalParcela } from '@/types/database'

export type ParcelaActionResult<T = unknown> = {
  success: boolean
  message: string
  data?: T
}

function falha<T = unknown>(error: unknown, fallback: string): ParcelaActionResult<T> {
  return { success: false, message: error instanceof Error ? error.message : fallback }
}

export interface ParcelaBoletoItem {
  parcela: NotaFiscalParcela
  requisitoId: string
  obrigatorio: boolean
  status: string
  documentoVersaoId: string | null
  nomeArquivo: string | null
  numeroVersao: number | null
  motivo: string | null
  beneficiarioEstabelecimentoId: string | null
}

/**
 * documento_requisito_instancias.status so e confiavel nos estados
 * terminais (satisfeito apos aprovacao, dispensado/cancelado/vencido).
 * registrar_documento_upload sempre grava 'pendente' apos qualquer envio
 * (novo ou reenvio) -- o estado real durante a analise so existe em
 * documento_versoes.status / documento_analises.resultado, exatamente
 * como RequirementCard/statusVisual (ChecklistCedente.tsx) ja deriva para
 * os documentos por_nf. Esta funcao aplica a mesma logica para boleto.
 */
function derivarStatusBoleto(
  statusInstancia: string,
  versaoAtual: { status: string } | null,
  ultimaAnalise: { resultado: string } | null,
): string {
  if (['satisfeito', 'dispensado', 'cancelado', 'vencido'].includes(statusInstancia)) return statusInstancia
  if (!versaoAtual) return 'pendente'
  if (versaoAtual.status === 'rejeitado' || ultimaAnalise?.resultado === 'rejeitado') return 'rejeitado'
  if (ultimaAnalise?.resultado === 'requer_ajuste') return 'requer_ajuste'
  return 'em_analise'
}

export async function listarParcelasBoletosDaNota(notaFiscalId: string): Promise<ParcelaActionResult<ParcelaBoletoItem[]>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalId)
    const supabase = context.supabase

    const { data: parcelas, error: parcelasError } = await supabase
      .from('nota_fiscal_parcelas')
      .select('*')
      .eq('nota_fiscal_id', notaFiscalId)
      .order('numero_parcela')
    if (parcelasError) throw new Error(`Nao foi possivel carregar as parcelas: ${parcelasError.message}`)

    const parcelasRows = (parcelas || []) as NotaFiscalParcela[]
    if (parcelasRows.length === 0) return { success: true, message: 'NF sem parcelas cadastradas.', data: [] }

    const { data: requisitos, error: requisitosError } = await supabase
      .from('documento_requisito_instancias')
      .select('id, parcela_id, obrigatorio, status, documento_id, tipo_documento_codigo_snapshot')
      .eq('nota_fiscal_id', notaFiscalId)
      .eq('tipo_documento_codigo_snapshot', 'boleto')
      .not('parcela_id', 'is', null)
    if (requisitosError) throw new Error(`Nao foi possivel carregar os requisitos de boleto: ${requisitosError.message}`)

    // So existe requisito de boleto quando a politica da NF realmente exige
    // boleto (instanciar_requisitos_nota so cria a instancia nesse caso).
    // Uma NF com parcelas mas sem boleto na politica nao deve gerar nenhum
    // item aqui -- por isso o resultado e construido a partir das
    // instancias reais, nao de todas as parcelas da NF.
    type RequisitoRow = { id: string; parcela_id: string; obrigatorio: boolean; status: string; documento_id: string | null }
    const requisitosRows = (requisitos || []) as RequisitoRow[]
    if (requisitosRows.length === 0) return { success: true, message: 'Politica desta NF nao exige boleto.', data: [] }
    const documentoIds = requisitosRows.map((r) => r.documento_id).filter((id): id is string => Boolean(id))

    const { data: versoes, error: versoesError } = documentoIds.length
      ? await supabase
        .from('documento_versoes')
        .select('id, documento_id, numero_versao, status, nome_original, beneficiario_estabelecimento_id')
        .in('documento_id', documentoIds)
        .order('numero_versao', { ascending: false })
      : { data: [], error: null }
    if (versoesError) throw new Error(`Nao foi possivel carregar as versoes do boleto: ${versoesError.message}`)

    type VersaoRow = { id: string; documento_id: string; numero_versao: number; status: string; nome_original: string; beneficiario_estabelecimento_id: string | null }
    const versoesRows = (versoes || []) as VersaoRow[]
    const versaoIds = versoesRows.map((v) => v.id)

    const { data: analises, error: analisesError } = versaoIds.length
      ? await supabase
        .from('documento_analises')
        .select('documento_versao_id, resultado, observacoes, analisado_em')
        .in('documento_versao_id', versaoIds)
        .order('analisado_em', { ascending: false })
      : { data: [], error: null }
    if (analisesError) throw new Error(`Nao foi possivel carregar as analises do boleto: ${analisesError.message}`)

    type AnaliseRow = { documento_versao_id: string; resultado: string; observacoes: string | null }
    const analisesRows = (analises || []) as AnaliseRow[]

    const items: ParcelaBoletoItem[] = requisitosRows
      .map((requisito) => {
        const parcela = parcelasRows.find((p) => p.id === requisito.parcela_id)
        if (!parcela) return null
        const versaoAtual = requisito.documento_id
          ? versoesRows.find((v) => v.documento_id === requisito.documento_id) || null
          : null
        const ultimaAnalise = versaoAtual ? analisesRows.find((a) => a.documento_versao_id === versaoAtual.id) || null : null
        return {
          parcela,
          requisitoId: requisito.id,
          obrigatorio: requisito.obrigatorio,
          status: derivarStatusBoleto(requisito.status, versaoAtual, ultimaAnalise),
          documentoVersaoId: versaoAtual?.id ?? null,
          nomeArquivo: versaoAtual?.nome_original ?? null,
          numeroVersao: versaoAtual?.numero_versao ?? null,
          motivo: ultimaAnalise?.observacoes ?? null,
          beneficiarioEstabelecimentoId: versaoAtual?.beneficiario_estabelecimento_id ?? null,
        }
      })
      .filter((item): item is ParcelaBoletoItem => item !== null)
      .sort((a, b) => a.parcela.numero_parcela - b.parcela.numero_parcela)

    return { success: true, message: 'Parcelas carregadas.', data: items }
  } catch (error) {
    return falha(error, 'Nao foi possivel carregar as parcelas da nota fiscal.')
  }
}

export async function listarBeneficiariosElegiveisDaNota(notaFiscalId: string): Promise<ParcelaActionResult<Array<{ id: string; razaoSocial: string; cnpj: string; tipo: string }>>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalId)
    const supabase = context.supabase
    const { data: nf, error: nfError } = await supabase.from('notas_fiscais').select('cedente_id').eq('id', notaFiscalId).maybeSingle()
    if (nfError || !nf) throw new Error('Nota fiscal nao encontrada.')

    const { data, error } = await supabase
      .from('cedente_estabelecimentos')
      .select('id, razao_social, cnpj, tipo')
      .eq('cedente_id', (nf as { cedente_id: string }).cedente_id)
      .eq('status', 'aprovado')
      .order('tipo')
    if (error) throw new Error(`Nao foi possivel carregar os estabelecimentos: ${error.message}`)

    const rows = (data || []) as Array<{ id: string; razao_social: string; cnpj: string; tipo: string }>
    return {
      success: true,
      message: 'Estabelecimentos carregados.',
      data: rows.map((row) => ({ id: row.id, razaoSocial: row.razao_social, cnpj: row.cnpj, tipo: row.tipo })),
    }
  } catch (error) {
    return falha(error, 'Nao foi possivel carregar os estabelecimentos elegiveis.')
  }
}

export async function enviarBoletoDaParcela(formData: FormData): Promise<ParcelaActionResult> {
  let path: string | null = null
  try {
    const notaFiscalId = String(formData.get('nota_fiscal_id') || '')
    const context = await requireNotaFiscalAccess(notaFiscalId)
    if (!['cedente', 'gestor'].includes(context.profile.role)) throw new Error('Somente cedente ou gestor pode enviar o boleto.')
    const supabase = context.supabase

    const requisitoId = String(formData.get('requisito_id') || '')
    const estabelecimentoBeneficiarioId = String(formData.get('estabelecimento_beneficiario_id') || '')
    const arquivo = formData.get('arquivo')
    if (!(arquivo instanceof File)) throw new Error('Selecione um arquivo valido.')
    if (!estabelecimentoBeneficiarioId) throw new Error('Selecione o beneficiario do boleto.')

    const { data: tipo, error: tipoError } = await supabase.from('documento_tipos').select('*').eq('codigo', 'boleto').eq('ativo', true).maybeSingle()
    if (tipoError || !tipo) throw new Error('Tipo documental "boleto" nao encontrado ou inativo.')
    const tipoData = tipo as { id: string; mime_types_aceitos: string[]; extensoes_aceitas: string[]; tamanho_max_bytes: number }
    const validacao = validarArquivoContraTipo(arquivo, tipoData as never)
    if (validacao) throw new Error(validacao)

    const { data: nf, error: nfError } = await supabase.from('notas_fiscais').select('cedente_id').eq('id', notaFiscalId).maybeSingle()
    if (nfError || !nf) throw new Error('Nota fiscal nao encontrada.')

    path = gerarCaminhoDocumento({
      cedenteId: (nf as { cedente_id: string }).cedente_id,
      notaFiscalId,
      tipoCodigo: 'boleto',
      nomeOriginal: arquivo.name,
    })
    await enviarObjetoDocumento(path, arquivo, mimeArquivo(arquivo))

    const { data: resultado, error } = await supabase.rpc('registrar_documento_boleto_parcela', {
      p_nota_fiscal_id: notaFiscalId,
      p_requisito_id: requisitoId,
      p_documento_tipo_id: tipoData.id,
      p_estabelecimento_beneficiario_id: estabelecimentoBeneficiarioId,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: path,
      p_nome_original: arquivo.name,
      p_mime_type: mimeArquivo(arquivo),
      p_tamanho_bytes: arquivo.size,
      p_sha256: await sha256Arquivo(arquivo),
      p_enviado_por: context.user.id,
    })
    if (error) throw new Error(`Nao foi possivel registrar o boleto: ${error.message}`)

    registrarLog({
      tipo_evento: 'BOLETO_PARCELA_ENVIADO',
      entidade_tipo: 'documento_requisito_instancias',
      entidade_id: requisitoId,
      dados_depois: { nota_fiscal_id: notaFiscalId, ...(resultado as Record<string, unknown>) },
    }).catch(() => {})

    revalidatePath(`/cedente/notas-fiscais/${notaFiscalId}`)
    revalidatePath(`/gestor/notas-fiscais/${notaFiscalId}`)
    return { success: true, message: 'Boleto enviado para analise.' }
  } catch (error) {
    if (path) await removerObjetoDocumento(path).catch(() => undefined)
    return falha(error, 'Nao foi possivel enviar o boleto.')
  }
}

export async function analisarBoletoDaParcela(formData: FormData): Promise<ParcelaActionResult> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const notaFiscalId = String(formData.get('nota_fiscal_id') || '')
    const documentoVersaoId = String(formData.get('documento_versao_id') || '')
    const resultado = String(formData.get('resultado') || '') as 'aprovado' | 'rejeitado' | 'requer_ajuste'
    const observacoes = String(formData.get('observacoes') || '').trim() || null
    if (resultado !== 'aprovado' && !observacoes) throw new Error('Motivo obrigatorio para reprovar ou pedir ajuste.')

    const { error } = await context.supabase.rpc('analisar_documento_boleto_gestor', {
      p_documento_versao_id: documentoVersaoId,
      p_resultado: resultado,
      p_observacoes: observacoes,
    })
    if (error) throw new Error(`Nao foi possivel analisar o boleto: ${error.message}`)

    const { data: nf } = await context.supabase.from('notas_fiscais').select('cedente_id').eq('id', notaFiscalId).maybeSingle()
    if (nf) {
      const labelResultado = resultado === 'aprovado' ? 'aprovado' : resultado === 'rejeitado' ? 'reprovado' : 'com ajuste solicitado'
      await notificarCedente(
        (nf as { cedente_id: string }).cedente_id,
        `Boleto de parcela ${labelResultado}`,
        resultado === 'aprovado'
          ? 'O boleto de uma parcela da sua NF foi aprovado.'
          : `O boleto de uma parcela da sua NF foi ${labelResultado}. Motivo: ${observacoes}`,
        `boleto_parcela_${resultado}`,
      )
    }

    revalidatePath(`/gestor/notas-fiscais/${notaFiscalId}`)
    revalidatePath(`/cedente/notas-fiscais/${notaFiscalId}`)
    return { success: true, message: 'Boleto analisado com sucesso.' }
  } catch (error) {
    return falha(error, 'Nao foi possivel analisar o boleto.')
  }
}

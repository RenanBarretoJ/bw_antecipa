'use server'

import { createHash } from 'node:crypto'
import { requireAuthenticated, requireNotaFiscalAccess, type AppSupabaseClient } from '@/lib/auth/authorization'
import { parseNFeXML, type NfParsedItem } from '@/lib/nf-parser'
import { avaliarMatchingRemessaVenda, type ItemComparavel } from '@/lib/logistica/nf-remessa-matching'
import {
  enviarObjetoDocumento,
  gerarCaminhoNotaFiscalRemessa,
  gerarUrlDocumento,
  removerObjetoDocumento,
} from '@/lib/documentos-v2/storage'
import { DOCUMENTO_V2_BUCKET, nomeSeguro } from '@/lib/documentos-v2/tipos'
import { carregarContextoEventoNota, registrarEventoDominio } from '@/lib/eventos-dominio/registrar'
import { registrarLog } from './auditoria'

type ActionResult<T = undefined> = { success: boolean; message: string; data?: T; details?: string }

const MAX_XML_BYTES = 5 * 1024 * 1024

export type RemessaDaNotaRegistro = {
  id: string
  numero: string | null
  serie: string | null
  chave_acesso: string
  emitente_cnpj: string | null
  emitente_razao_social: string | null
  destinatario_cnpj: string | null
  destinatario_razao_social: string | null
  data_emissao: string | null
  valor_total: number
  quantidade_total: number | null
  /** Unidade do primeiro item estruturado (ex.: 'KG'). Null quando indisponivel -- exibicao apenas, nunca usado no matching/satisfacao. */
  unidade_quantidade: string | null
  status_validacao: 'VALIDADA' | 'REVISAO_MANUAL' | 'REJEITADA'
  referencia_nf_venda_confirmada: boolean
  motivos_validacao: string[]
  created_at: string
  /** Decisao documental da gestora, separada do matching (status_validacao). Null = nao aplicavel (matching diferente de VALIDADA, ou a politica nao exige validacao manual/hibrida para este requisito). */
  aprovacao_documental: 'aguardando_analise' | 'aprovado' | 'rejeitado' | null
  aprovacao_analisado_por: string | null
  aprovacao_analisado_em: string | null
  aprovacao_motivo_rejeicao: string | null
  /** Numero da versao vigente em nota_fiscal_remessa_versoes (historico append-only -- ver listarVersoesNotaFiscalRemessa). */
  versao_atual: number
}

export type VersaoNotaFiscalRemessa = {
  id: string
  numero_versao: number
  nome_original: string
  tamanho_bytes: number
  status_validacao: 'VALIDADA' | 'REVISAO_MANUAL' | 'REJEITADA'
  vigente: boolean
  created_at: string
}

type VendaRow = {
  id: string
  chave_acesso: string | null
  cnpj_destinatario: string | null
  valor_bruto: number | null
  quantidade_total: number | null
  itens_estruturados: NfParsedItem[] | null
  status: string
}

async function carregarVenda(supabase: AppSupabaseClient, notaFiscalVendaId: string): Promise<VendaRow> {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('id, chave_acesso, cnpj_destinatario, valor_bruto, quantidade_total, itens_estruturados, status')
    .eq('id', notaFiscalVendaId)
    .maybeSingle()
  if (error || !data) throw new Error(error?.message || 'NF de venda nao encontrada.')
  return data as VendaRow
}

function itensParaComparacao(itens: NfParsedItem[] | null | undefined): ItemComparavel[] {
  return (itens || []).map((item) => ({
    descricao: item.descricao,
    codigo: item.codigo || undefined,
    ncm: item.ncm || undefined,
    unidade: item.unidade || undefined,
    quantidade: item.quantidade,
  }))
}

/** Lista as remessas ja cadastradas para a NF de venda, mais recentes primeiro. */
export async function listarRemessasDaNota(notaFiscalVendaId: string): Promise<ActionResult<RemessaDaNotaRegistro[]>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalVendaId)
    const { data, error } = await context.supabase
      .from('nota_fiscal_remessas')
      .select('id, numero, serie, chave_acesso, emitente_cnpj, emitente_razao_social, destinatario_cnpj, destinatario_razao_social, data_emissao, valor_total, quantidade_total, itens, status_validacao, referencia_nf_venda_confirmada, motivos_validacao, created_at, aprovacao_documental, aprovacao_analisado_por, aprovacao_analisado_em, aprovacao_motivo_rejeicao')
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)

    const remessaIds = (data || []).map((row) => row.id)
    const { data: vigentes, error: vigentesError } = remessaIds.length
      ? await context.supabase
        .from('nota_fiscal_remessa_versoes')
        .select('nota_fiscal_remessa_id, numero_versao')
        .in('nota_fiscal_remessa_id', remessaIds)
        .eq('vigente', true)
      : { data: [], error: null }
    if (vigentesError) throw new Error(vigentesError.message)
    const versaoAtualPorRemessa = new Map((vigentes || []).map((v) => [v.nota_fiscal_remessa_id, v.numero_versao]))

    const remessas = (data || []).map((row) => {
      const primeiroItem = Array.isArray(row.itens) ? (row.itens[0] as { unidade?: string } | undefined) : undefined
      return {
        id: row.id,
        numero: row.numero,
        serie: row.serie,
        chave_acesso: row.chave_acesso,
        emitente_cnpj: row.emitente_cnpj,
        emitente_razao_social: row.emitente_razao_social,
        destinatario_cnpj: row.destinatario_cnpj,
        destinatario_razao_social: row.destinatario_razao_social,
        data_emissao: row.data_emissao,
        status_validacao: row.status_validacao,
        referencia_nf_venda_confirmada: row.referencia_nf_venda_confirmada,
        created_at: row.created_at,
        valor_total: Number(row.valor_total),
        quantidade_total: row.quantidade_total === null ? null : Number(row.quantidade_total),
        unidade_quantidade: primeiroItem?.unidade || null,
        motivos_validacao: Array.isArray(row.motivos_validacao) ? row.motivos_validacao as string[] : [],
        aprovacao_documental: row.aprovacao_documental,
        aprovacao_analisado_por: row.aprovacao_analisado_por,
        aprovacao_analisado_em: row.aprovacao_analisado_em,
        aprovacao_motivo_rejeicao: row.aprovacao_motivo_rejeicao,
        versao_atual: versaoAtualPorRemessa.get(row.id) || 1,
      }
    }) as RemessaDaNotaRegistro[]
    return { success: true, message: 'Remessas carregadas.', data: remessas }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel carregar as NF de remessa desta venda.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

/**
 * Envia uma NF de remessa (XML) vinculada a uma NF de venda. Regra D do
 * ticket NF de Remessa: valida NFref/refNFe, destinatario (sacado),
 * produtos e saldo acumulado antes de persistir. A ausencia de remessa
 * nunca bloqueia nada -- esta action so roda quando o cedente/gestor decide
 * enviar uma.
 */
export async function enviarNotaFiscalRemessa(notaFiscalVendaId: string, formData: FormData): Promise<ActionResult<{ id: string; status_validacao: string }>> {
  let uploadedPath: string | null = null
  try {
    const context = await requireNotaFiscalAccess(notaFiscalVendaId)
    if (!['cedente', 'gestor'].includes(context.profile.role)) {
      throw new Error('Perfil sem permissao para enviar NF de remessa.')
    }
    const venda = await carregarVenda(context.supabase, notaFiscalVendaId)

    const arquivo = formData.get('arquivo')
    if (!(arquivo instanceof File) || arquivo.size <= 0) throw new Error('Selecione o XML da NF de remessa.')
    if (arquivo.size > MAX_XML_BYTES) throw new Error('O XML excede o limite de 5MB.')
    const nomeMinusculo = arquivo.name.toLowerCase()
    if (!nomeMinusculo.endsWith('.xml') && arquivo.type !== 'application/xml' && arquivo.type !== 'text/xml') {
      throw new Error('A NF de remessa deve ser enviada em XML.')
    }

    const xmlContent = await arquivo.text()
    const parsed = parseNFeXML(xmlContent)
    if (!parsed.chave_acesso || !/^\d{44}$/.test(parsed.chave_acesso)) {
      throw new Error('Nao foi possivel extrair a chave de acesso da NF de remessa.')
    }

    // "Enviar nova versao" (mesma remessa, mesma chave) vs "Enviar outra NF
    // de Remessa" (chave nova): o RPC decide isso pela chave, nao pelo botao
    // clicado -- se ja existe uma remessa com esta chave PARA ESTA VENDA, o
    // envio atualiza a linha existente (nunca cria uma segunda). Uma chave
    // repetida de OUTRA venda continua bloqueada (fail-closed, no proprio
    // RPC). Aqui so precisamos saber se e uma atualizacao para excluir a
    // linha sendo substituida do acumulado abaixo -- senao uma remessa que
    // ja era VALIDADA e esta sendo corrigida contaria a propria quantidade
    // em dobro.
    const { data: existente, error: existenteError } = await context.supabase
      .from('nota_fiscal_remessas')
      .select('id, nota_fiscal_venda_id')
      .eq('chave_acesso', parsed.chave_acesso)
      .maybeSingle()
    if (existenteError) throw new Error(`Erro ao verificar remessa existente: ${existenteError.message}`)
    const remessaExistenteId = existente && existente.nota_fiscal_venda_id === notaFiscalVendaId ? existente.id : null

    // Regra 3 dos ajustes finais: o acumulado e SEMPRE por quantidade
    // estruturada das remessas ja VALIDADAs -- nunca por valor monetario.
    // Uma remessa so se torna VALIDADA quando a quantidade e verificavel
    // (ver avaliarMatchingRemessaVenda), logo toda remessa VALIDADA aqui
    // tem quantidade_total preenchida.
    let acumuladoQuery = context.supabase
      .from('nota_fiscal_remessas')
      .select('quantidade_total')
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .eq('status_validacao', 'VALIDADA')
    if (remessaExistenteId) acumuladoQuery = acumuladoQuery.neq('id', remessaExistenteId)
    const { data: acumulado, error: acumuladoError } = await acumuladoQuery
    if (acumuladoError) throw new Error(`Erro ao consultar remessas anteriores: ${acumuladoError.message}`)
    const acumuladoAnterior = (acumulado || []).reduce((total, row) => total + Number(row.quantidade_total || 0), 0)

    const resultado = avaliarMatchingRemessaVenda({
      venda: {
        chave_acesso: venda.chave_acesso,
        cnpj_destinatario: venda.cnpj_destinatario,
        valor_bruto: Number(venda.valor_bruto || 0),
        quantidade_total: venda.quantidade_total === null ? null : Number(venda.quantidade_total),
        itens: itensParaComparacao(venda.itens_estruturados),
      },
      remessa: {
        nf_ref_chaves: parsed.nfRefChaves,
        destinatario_cnpj: parsed.cnpj_destinatario || null,
        valor_total: parsed.valor_bruto,
        quantidade_total: parsed.quantidadeTotal > 0 ? parsed.quantidadeTotal : null,
        itens: itensParaComparacao(parsed.itensEstruturados),
      },
      acumuladoAnterior,
    })

    const safeName = nomeSeguro(arquivo.name)
    uploadedPath = gerarCaminhoNotaFiscalRemessa({ cedenteId: context.notaFiscal.cedente_id, notaFiscalVendaId, nomeOriginal: safeName })
    await enviarObjetoDocumento(uploadedPath, arquivo, 'application/xml')

    const hash = createHash('sha256').update(xmlContent, 'utf8').digest('hex')
    const { data, error } = await context.supabase.rpc('registrar_nota_fiscal_remessa', {
      p_nota_fiscal_venda_id: notaFiscalVendaId,
      p_chave_acesso: parsed.chave_acesso,
      p_numero: parsed.numero_nf || null,
      p_serie: parsed.serie || null,
      p_emitente_cnpj: parsed.cnpj_emitente || null,
      p_emitente_razao_social: parsed.razao_social_emitente || null,
      p_destinatario_cnpj: parsed.cnpj_destinatario || null,
      p_destinatario_razao_social: parsed.razao_social_destinatario || null,
      p_data_emissao: parsed.data_emissao || null,
      p_valor_total: parsed.valor_bruto,
      p_quantidade_total: parsed.quantidadeTotal > 0 ? parsed.quantidadeTotal : null,
      p_itens: parsed.itensEstruturados,
      p_status_validacao: resultado.status,
      p_referencia_nf_venda_confirmada: resultado.referenciaNfVendaConfirmada,
      p_motivos_validacao: resultado.motivos,
      p_bucket: DOCUMENTO_V2_BUCKET,
      p_path: uploadedPath,
      p_nome_original: safeName,
      p_mime_type: 'application/xml',
      p_tamanho_bytes: arquivo.size,
      p_sha256: hash,
    })
    if (error || !data) throw new Error(error?.message || 'A NF de remessa nao foi registrada.')
    uploadedPath = null

    const result = data as { id: string; status_validacao: string; atualizacao?: boolean; numero_versao?: number }
    const ehAtualizacao = Boolean(result.atualizacao)
    const numeroVersao = result.numero_versao || 1

    // Nunca remove o arquivo anterior do Storage -- cada versao enviada
    // fica preservada em nota_fiscal_remessa_versoes (historico append-only,
    // ver migration 20260823150000). O RPC ja persistiu a nova versao
    // vigente; nao ha nenhuma compensacao de Storage a fazer aqui alem da
    // que ja existe no catch (upload que falha antes do RPC responder).

    const eventoContexto = await carregarContextoEventoNota(context.supabase, notaFiscalVendaId)
    await registrarEventoDominio({
      ...eventoContexto,
      tipo_evento: ehAtualizacao ? 'nf_remessa_atualizada' : 'nf_remessa_enviada',
      categoria: 'logistica',
      descricao: `NF de Remessa ${parsed.numero_nf || parsed.chave_acesso} ${ehAtualizacao ? `atualizada (versão ${numeroVersao} da mesma remessa)` : 'enviada'} (${resultado.status}).`,
      metadata: { nota_fiscal_remessa_id: result.id, status_validacao: resultado.status, motivos: resultado.motivos, atualizacao: ehAtualizacao, numero_versao: numeroVersao },
      visibilidade: 'ambos',
    }, context.supabase).catch(() => {})
    await registrarLog({
      tipo_evento: ehAtualizacao ? 'NF_REMESSA_ATUALIZADA' : 'NF_REMESSA_ENVIADA',
      entidade_tipo: 'nota_fiscal_remessas',
      entidade_id: result.id,
      dados_depois: { nota_fiscal_venda_id: notaFiscalVendaId, status_validacao: resultado.status, atualizacao: ehAtualizacao, numero_versao: numeroVersao },
    }).catch(() => {})

    const mensagens: Record<string, string> = ehAtualizacao
      ? {
        VALIDADA: `Versão ${numeroVersao} da NF de remessa registrada e validada com sucesso.`,
        REVISAO_MANUAL: `Versão ${numeroVersao} da NF de remessa registrada, mas requer revisao manual antes de valer como lastro logistico.`,
        REJEITADA: `Versão ${numeroVersao} da NF de remessa registrada, mas rejeitada: ` + resultado.motivos.join(' '),
      }
      : {
        VALIDADA: 'NF de remessa vinculada e validada com sucesso.',
        REVISAO_MANUAL: 'NF de remessa enviada, mas requer revisao manual antes de valer como lastro logistico.',
        REJEITADA: 'NF de remessa enviada, mas rejeitada: ' + resultado.motivos.join(' '),
      }
    return { success: resultado.status !== 'REJEITADA', message: mensagens[resultado.status], data: { id: result.id, status_validacao: resultado.status } }
  } catch (error) {
    let compensationDetails = ''
    if (uploadedPath) {
      try {
        await removerObjetoDocumento(uploadedPath)
      } catch (compensationError) {
        compensationDetails = compensationError instanceof Error
          ? ` Falha adicional na compensacao do Storage: ${compensationError.message}`
          : ' Falha adicional na compensacao do Storage.'
      }
    }
    const details = error instanceof Error ? error.message : 'Erro inesperado.'
    return { success: false, message: 'Nao foi possivel enviar a NF de remessa.', details: `${details}${compensationDetails}` }
  }
}

/** Abre o arquivo da versao VIGENTE da remessa (nota_fiscal_remessas.path e mantido como ponteiro/cache da versao vigente pelo RPC -- ver migration 20260823150000). */
export async function obterUrlNotaFiscalRemessa(notaFiscalVendaId: string, remessaId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalVendaId)
    const { data, error } = await context.supabase
      .from('nota_fiscal_remessas')
      .select('id, path')
      .eq('id', remessaId)
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message || 'NF de remessa nao encontrada.')
    return { success: true, message: 'Acesso temporario gerado.', data: { url: await gerarUrlDocumento(data.path) } }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel abrir a NF de remessa.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

/** Historico append-only de versoes de uma remessa (mais recente primeiro) -- nenhuma versao e apagada ao enviar uma nova. */
export async function listarVersoesNotaFiscalRemessa(notaFiscalVendaId: string, remessaId: string): Promise<ActionResult<VersaoNotaFiscalRemessa[]>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalVendaId)
    const { data: remessa, error: remessaError } = await context.supabase
      .from('nota_fiscal_remessas')
      .select('id')
      .eq('id', remessaId)
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .maybeSingle()
    if (remessaError || !remessa) throw new Error(remessaError?.message || 'NF de remessa nao encontrada.')

    const { data, error } = await context.supabase
      .from('nota_fiscal_remessa_versoes')
      .select('id, numero_versao, nome_original, tamanho_bytes, status_validacao, vigente, created_at')
      .eq('nota_fiscal_remessa_id', remessaId)
      .order('numero_versao', { ascending: false })
    if (error) throw new Error(error.message)

    return {
      success: true,
      message: 'Versoes carregadas.',
      data: (data || []).map((row) => ({ ...row, tamanho_bytes: Number(row.tamanho_bytes) })) as VersaoNotaFiscalRemessa[],
    }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel carregar o historico de versoes.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

/** Abre o arquivo de uma versao ESPECIFICA (inclusive historica, nao vigente) do historico append-only. */
export async function obterUrlVersaoNotaFiscalRemessa(notaFiscalVendaId: string, remessaId: string, versaoId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const context = await requireNotaFiscalAccess(notaFiscalVendaId)
    const { data: remessa, error: remessaError } = await context.supabase
      .from('nota_fiscal_remessas')
      .select('id')
      .eq('id', remessaId)
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .maybeSingle()
    if (remessaError || !remessa) throw new Error(remessaError?.message || 'NF de remessa nao encontrada.')

    const { data, error } = await context.supabase
      .from('nota_fiscal_remessa_versoes')
      .select('id, path')
      .eq('id', versaoId)
      .eq('nota_fiscal_remessa_id', remessaId)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message || 'Versao da NF de remessa nao encontrada.')
    return { success: true, message: 'Acesso temporario gerado.', data: { url: await gerarUrlDocumento(data.path) } }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel abrir a versao da NF de remessa.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

/**
 * Decisao da gestora sobre a aprovacao documental de uma NF de remessa cujo
 * matching tecnico (status_validacao) ja e VALIDADA, mas cuja politica
 * exige validacao manual/hibrida para o requisito nf_remessa (regra nova:
 * separa matching de aprovacao documental). O RPC `analisar_nota_fiscal_
 * remessa` e gestor-only e fail-closed no servidor (so decide remessas em
 * `aguardando_analise`) -- esta action nao duplica essa checagem, apenas
 * resolve autenticacao/perfil para compor o evento de dominio.
 */
export async function analisarNotaFiscalRemessa(
  notaFiscalRemessaId: string,
  resultado: 'aprovado' | 'rejeitado',
  motivo?: string,
): Promise<ActionResult<{ id: string; aprovacao_documental: string }>> {
  try {
    const context = await requireAuthenticated()
    if (context.profile.role !== 'gestor') {
      throw new Error('Perfil sem permissao para analisar NF de remessa.')
    }
    if (resultado === 'rejeitado' && !motivo?.trim()) {
      throw new Error('Informe o motivo da rejeicao.')
    }

    const { data, error } = await context.supabase.rpc('analisar_nota_fiscal_remessa', {
      p_nota_fiscal_remessa_id: notaFiscalRemessaId,
      p_resultado: resultado,
      p_motivo: motivo?.trim() || null,
    })
    if (error || !data) throw new Error(error?.message || 'A analise da NF de remessa nao foi registrada.')

    const result = data as { id: string; aprovacao_documental: string; nota_fiscal_venda_id: string }
    const eventoContexto = await carregarContextoEventoNota(context.supabase, result.nota_fiscal_venda_id)
    await registrarEventoDominio({
      ...eventoContexto,
      tipo_evento: resultado === 'aprovado' ? 'nf_remessa_aprovacao_documental_aprovada' : 'nf_remessa_aprovacao_documental_rejeitada',
      categoria: 'logistica',
      descricao: resultado === 'aprovado'
        ? 'NF de remessa aprovada na analise documental.'
        : `NF de remessa rejeitada na analise documental: ${motivo?.trim() || ''}`,
      metadata: { nota_fiscal_remessa_id: result.id, aprovacao_documental: result.aprovacao_documental },
      visibilidade: 'ambos',
    }, context.supabase).catch(() => {})
    await registrarLog({ tipo_evento: 'NF_REMESSA_ANALISADA', entidade_tipo: 'nota_fiscal_remessas', entidade_id: result.id, dados_depois: { aprovacao_documental: result.aprovacao_documental } }).catch(() => {})

    return {
      success: true,
      message: resultado === 'aprovado' ? 'NF de remessa aprovada.' : 'NF de remessa rejeitada.',
      data: { id: result.id, aprovacao_documental: result.aprovacao_documental },
    }
  } catch (error) {
    return { success: false, message: 'Nao foi possivel registrar a analise da NF de remessa.', details: error instanceof Error ? error.message : 'Erro inesperado.' }
  }
}

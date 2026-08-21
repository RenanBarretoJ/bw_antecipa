'use server'

import { createHash } from 'node:crypto'
import { requireNotaFiscalAccess, type AppSupabaseClient } from '@/lib/auth/authorization'
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
      .select('id, numero, serie, chave_acesso, emitente_cnpj, emitente_razao_social, destinatario_cnpj, destinatario_razao_social, data_emissao, valor_total, quantidade_total, itens, status_validacao, referencia_nf_venda_confirmada, motivos_validacao, created_at')
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
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

    // Regra 3 dos ajustes finais: o acumulado e SEMPRE por quantidade
    // estruturada das remessas ja VALIDADAs -- nunca por valor monetario.
    // Uma remessa so se torna VALIDADA quando a quantidade e verificavel
    // (ver avaliarMatchingRemessaVenda), logo toda remessa VALIDADA aqui
    // tem quantidade_total preenchida.
    const { data: acumulado, error: acumuladoError } = await context.supabase
      .from('nota_fiscal_remessas')
      .select('quantidade_total')
      .eq('nota_fiscal_venda_id', notaFiscalVendaId)
      .eq('status_validacao', 'VALIDADA')
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

    const result = data as { id: string; status_validacao: string }
    const eventoContexto = await carregarContextoEventoNota(context.supabase, notaFiscalVendaId)
    await registrarEventoDominio({
      ...eventoContexto,
      tipo_evento: 'nf_remessa_enviada',
      categoria: 'logistica',
      descricao: `NF de Remessa ${parsed.numero_nf || parsed.chave_acesso} enviada (${resultado.status}).`,
      metadata: { nota_fiscal_remessa_id: result.id, status_validacao: resultado.status, motivos: resultado.motivos },
      visibilidade: 'ambos',
    }, context.supabase).catch(() => {})
    await registrarLog({ tipo_evento: 'NF_REMESSA_ENVIADA', entidade_tipo: 'nota_fiscal_remessas', entidade_id: result.id, dados_depois: { nota_fiscal_venda_id: notaFiscalVendaId, status_validacao: resultado.status } }).catch(() => {})

    const mensagens: Record<string, string> = {
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

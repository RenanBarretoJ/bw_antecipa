'use server'

import {
  listarNfsRecebidasComContextoOperacional,
  vincularNfsComOperacoes,
  type SacadoPortalLink,
  type SacadoPortalNotaFiscal,
  type SacadoPortalNotaFiscalRecebida,
  type SacadoPortalOperacao,
} from '@/lib/sacado/portal-domain'
import { resolverContextoSacado } from '@/lib/sacado/contexto.server'
import { obterUrlArquivoNotaFiscal } from '@/lib/actions/arquivo-nota-fiscal'

type SacadoPortalData = {
  nfs: SacadoPortalNotaFiscal[]
  nfsRecebidas: SacadoPortalNotaFiscalRecebida[]
  operacoes: SacadoPortalOperacao[]
}

export type SacadoPortalResult = {
  success: boolean
  message?: string
  data?: SacadoPortalData
}

function normalizarCnpj(cnpj: string | null | undefined): string {
  return String(cnpj ?? '').replace(/\D/g, '')
}

/**
 * @deprecated Carregador amplo preservado apenas para consumidores ainda não
 * migrados. As quatro rotas do Escopo 4 usam casos de uso específicos.
 */
export async function carregarPortalSacado(): Promise<SacadoPortalResult> {
  try {
    const { auth, cnpj } = await resolverContextoSacado()
    const supabase = auth.supabase

    const { data: nfsRaw, error: nfsError } = await supabase
      .from('notas_fiscais')
      .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_emissao, data_vencimento, status, cedente_id, arquivo_url')
      .eq('cnpj_destinatario', cnpj)
      .order('data_vencimento', { ascending: true })

    if (nfsError) throw new Error(`Erro ao consultar NFs do sacado: ${nfsError.message}`)

    const nfs = ((nfsRaw ?? []) as Array<Record<string, unknown>>).map((nf) => ({
      id: String(nf.id),
      numero_nf: String(nf.numero_nf ?? ''),
      cnpj_emitente: normalizarCnpj(String(nf.cnpj_emitente ?? '')),
      razao_social_emitente: String(nf.razao_social_emitente ?? ''),
      valor_bruto: Number(nf.valor_bruto ?? 0),
      data_emissao: nf.data_emissao ? String(nf.data_emissao) : null,
      data_vencimento: String(nf.data_vencimento ?? ''),
      status: String(nf.status ?? ''),
      cedente_id: String(nf.cedente_id ?? ''),
      arquivo_url: nf.arquivo_url ? String(nf.arquivo_url) : null,
    }))

    if (nfs.length === 0) {
      return { success: true, data: { nfs: [], nfsRecebidas: [], operacoes: [] } }
    }

    const nfIds = nfs.map((nf) => nf.id)
    const { data: linksRaw, error: linksError } = await supabase
      .from('operacoes_nfs')
      .select('operacao_id, nota_fiscal_id')
      .in('nota_fiscal_id', nfIds)

    if (linksError) throw new Error(`Erro ao consultar vínculos operacionais: ${linksError.message}`)

    const links = (linksRaw ?? []) as SacadoPortalLink[]
    const operacaoIds = [...new Set(links.map((link) => link.operacao_id))]

    if (operacaoIds.length === 0) {
      return {
        success: true,
        data: {
          nfs: [],
          nfsRecebidas: listarNfsRecebidasComContextoOperacional({ nfs, links: [], operacoes: [] }),
          operacoes: [],
        },
      }
    }

    const { data: operacoesRaw, error: operacoesError } = await supabase
      .from('operacoes')
      .select('id, cedente_id, valor_bruto_total, valor_liquido_desembolso, data_vencimento, status, aceite_sacado_exigido, aceite_sacado_status, created_at, cedentes(razao_social, cnpj), contas_escrow(identificador)')
      .in('id', operacaoIds)
      .order('data_vencimento', { ascending: true })

    if (operacoesError) throw new Error(`Erro ao consultar operações do sacado: ${operacoesError.message}`)

    const operacoes = ((operacoesRaw ?? []) as Array<Record<string, unknown>>).map((operacao) => {
      const cedente = operacao.cedentes as { razao_social?: string; cnpj?: string } | null
      const conta = operacao.contas_escrow as { identificador?: string } | null
      return {
        id: String(operacao.id),
        cedente_id: String(operacao.cedente_id ?? ''),
        valor_bruto_total: Number(operacao.valor_bruto_total ?? 0),
        valor_liquido_desembolso: Number(operacao.valor_liquido_desembolso ?? 0),
        data_vencimento: String(operacao.data_vencimento ?? ''),
        status: String(operacao.status ?? ''),
        aceite_sacado_exigido: operacao.aceite_sacado_exigido as boolean | null,
        aceite_sacado_status: operacao.aceite_sacado_status ? String(operacao.aceite_sacado_status) : null,
        created_at: operacao.created_at ? String(operacao.created_at) : null,
        cedentes: cedente ? { razao_social: String(cedente.razao_social ?? ''), cnpj: normalizarCnpj(cedente.cnpj) } : null,
        contas_escrow: conta ? { identificador: String(conta.identificador ?? '') } : null,
      }
    })

    return {
      success: true,
      data: {
        operacoes,
        nfsRecebidas: listarNfsRecebidasComContextoOperacional({ nfs, links, operacoes }),
        nfs: vincularNfsComOperacoes({ nfs, links, operacoes }),
      },
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Não foi possível carregar o portal do sacado.',
    }
  }
}

export type ArquivoNotaSacadoResult = {
  success: boolean
  message?: string
  url?: string
}

export async function obterUrlArquivoNotaSacado(
  notaFiscalId: string,
): Promise<ArquivoNotaSacadoResult> {
  return obterUrlArquivoNotaFiscal(notaFiscalId)
}

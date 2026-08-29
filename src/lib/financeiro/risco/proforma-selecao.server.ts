import 'server-only'

import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { PoliticaResolvida } from '@/lib/operacoes/politica'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import { calcularCandidatoParcelAware } from './proforma-selecao'
import {
  montarProformaExposicaoSelecao,
  type ProformaExposicaoSelecao,
} from './visao-operacional'
import { carregarVisaoExposicaoFundoCanonica } from './visao-operacional.server'

type ParcelaSelecionadaRow = {
  id: string
  nota_fiscal_id: string
  valor_nominal: number | string
  data_vencimento: string
}

function unicos(ids: string[]) {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

export async function simularExposicaoSelecaoCanonica(input: {
  client: AppSupabaseClient
  cedenteId: string
  cedenteFundoId: string
  fundoId: string
  fundoNome: string
  politica: PoliticaResolvida
  notaFiscalIds: string[]
  parcelaIds: string[]
}): Promise<ProformaExposicaoSelecao | null> {
  const politica = input.politica
  const controleAtivo = politica.versao.controle_exposicao_logistica_ativo === true
    && Number(politica.versao.limite_exposicao_em_transito_pct) > 0
  if (!controleAtivo) return null

  if (
    politica.cedenteFundo.id !== input.cedenteFundoId
    || politica.cedenteFundo.cedente_id !== input.cedenteId
    || politica.fundo.id !== input.fundoId
  ) {
    throw new Error('O contexto da selecao nao corresponde a politica operacional vigente.')
  }

  const notaFiscalIds = unicos(input.notaFiscalIds)
  const parcelaIds = unicos(input.parcelaIds)
  const visaoAtual = await carregarVisaoExposicaoFundoCanonica({
    fundoId: input.fundoId,
    fundoNome: input.fundoNome,
    politicaVersao: politica.versao,
  })
  if (!visaoAtual) return null

  if (notaFiscalIds.length === 0) {
    return montarProformaExposicaoSelecao({
      atual: visaoAtual,
      candidatoValor: 0,
      quantidadeNfs: 0,
      quantidadeParcelas: 0,
    })
  }

  const { data: notas, error: notasError } = await input.client
    .from('notas_fiscais')
    .select('id')
    .in('id', notaFiscalIds)
    .eq('cedente_id', input.cedenteId)
    .eq('cedente_fundo_id', input.cedenteFundoId)
    .eq('fundo_id', input.fundoId)
    .eq('status', 'aprovada')
  if (notasError) throw new Error(`Nao foi possivel validar as NFs selecionadas: ${notasError.message}`)
  if ((notas || []).length !== notaFiscalIds.length) {
    throw new Error('Uma ou mais NFs selecionadas nao estao disponiveis neste fundo.')
  }

  if (parcelaIds.length === 0) {
    return montarProformaExposicaoSelecao({
      atual: visaoAtual,
      candidatoValor: null,
      quantidadeNfs: notaFiscalIds.length,
      quantidadeParcelas: 0,
      motivoCandidato: 'A selecao nao possui parcelas disponiveis para calcular o valor presente candidato.',
    })
  }

  const { data: parcelas, error: parcelasError } = await input.client
    .from('nota_fiscal_parcelas')
    .select('id,nota_fiscal_id,valor_nominal,data_vencimento')
    .in('id', parcelaIds)
    .in('nota_fiscal_id', notaFiscalIds)
    .eq('status', 'disponivel')
  if (parcelasError) throw new Error(`Nao foi possivel validar as parcelas selecionadas: ${parcelasError.message}`)
  const parcelasSelecionadas = (parcelas || []) as ParcelaSelecionadaRow[]
  if (parcelasSelecionadas.length !== parcelaIds.length) {
    throw new Error('Uma ou mais parcelas selecionadas nao pertencem as NFs disponiveis neste fundo.')
  }

  const notasComParcela = new Set(parcelasSelecionadas.map((parcela) => parcela.nota_fiscal_id))
  if (notaFiscalIds.some((notaFiscalId) => !notasComParcela.has(notaFiscalId))) {
    return montarProformaExposicaoSelecao({
      atual: visaoAtual,
      candidatoValor: null,
      quantidadeNfs: notaFiscalIds.length,
      quantidadeParcelas: parcelasSelecionadas.length,
      motivoCandidato: 'Selecione ao menos uma parcela de cada NF para calcular o impacto candidato.',
    })
  }

  const { data: taxas, error: taxasError } = await input.client
    .from('taxas_cedente')
    .select('prazo_min,prazo_max,taxa_percentual')
    .eq('cedente_id', input.cedenteId)
    .order('prazo_min', { ascending: true })
  if (taxasError) throw new Error(`Nao foi possivel carregar as taxas da simulacao: ${taxasError.message}`)

  const candidato = calcularCandidatoParcelAware({
    parcelasSelecionadas: parcelasSelecionadas.map((parcela) => ({
      id: parcela.id,
      notaFiscalId: parcela.nota_fiscal_id,
      valorNominal: Number(parcela.valor_nominal),
      dataVencimento: parcela.data_vencimento,
    })),
    taxas: (taxas || []).map((taxa) => ({
      prazo_min: Number(taxa.prazo_min),
      prazo_max: Number(taxa.prazo_max),
      taxa_percentual: Number(taxa.taxa_percentual),
    })),
    dataBase: obterDataCivilOperacional(),
    metodo: politica.versao.metodo_calculo_financeiro,
  })

  return montarProformaExposicaoSelecao({
    atual: visaoAtual,
    candidatoValor: candidato.valorCandidato,
    quantidadeNfs: notaFiscalIds.length,
    quantidadeParcelas: candidato.quantidadeParcelas,
    motivoCandidato: candidato.valorCandidato === null
      ? 'A taxa aplicavel a selecao ainda nao esta configurada; o impacto permanece indeterminado.'
      : null,
  })
}

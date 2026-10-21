import Decimal from 'decimal.js'
import type { StatusEntradaVortx } from './relatorios-layout'
import { RelatorioVortxError, type RelatorioVortxProcessado } from './relatorios-parser'

const Dinheiro = Decimal.clone({ precision: 40 })
type Linha = RelatorioVortxProcessado['linhas'][number]
export type ParcelaEstoqueVortx = {
  parcela: Linha
  ativo: Linha
  statusEntradaProvedor: StatusEntradaVortx
  fonteStatusEntrada: 'PosicaoAtivo' | 'PosicaoParcela' | 'NAO_INFORMADO'
  // Projecao local para a base canonica, sem persistencia ou decisao logistica.
  financeiro: Record<string, string>
}

function exigirPosicao(relatorio: RelatorioVortxProcessado, tipo: 'PosicaoAtivo' | 'PosicaoParcela') {
  if (relatorio.tipoRelatorio !== tipo || !relatorio.completo || !relatorio.linhas.length
    || relatorio.linhas.some((linha) => linha.status !== 'VALIDA')) {
    throw new RelatorioVortxError('POSICAO_INCOMPLETA', 'Composicao exige posicoes Vortx validas e completas.')
  }
}

function statusEntrada(parcela: Linha, ativo: Linha): Pick<ParcelaEstoqueVortx, 'statusEntradaProvedor' | 'fonteStatusEntrada'> {
  const p = parcela.dadosNormalizados.status_entrada_provedor
  const a = ativo.dadosNormalizados.status_entrada_provedor
  if (p !== 'NAO_INFORMADO' && a !== 'NAO_INFORMADO' && p !== a) {
    throw new RelatorioVortxError('STATUS_ENTRADA_CONFLITANTE', 'Estados de entrada divergentes entre ativo e parcela.')
  }
  if (p === 'ENTREGUE' || p === 'EM_TRANSITO') return { statusEntradaProvedor: p, fonteStatusEntrada: 'PosicaoParcela' }
  if (a === 'ENTREGUE' || a === 'EM_TRANSITO') return { statusEntradaProvedor: a, fonteStatusEntrada: 'PosicaoAtivo' }
  return { statusEntradaProvedor: 'NAO_INFORMADO', fonteStatusEntrada: 'NAO_INFORMADO' }
}

/** Associa granularidades sem somar o ativo novamente nem alterar status gerencial. */
export function comporEstoqueVortx(ativos: RelatorioVortxProcessado, parcelas: RelatorioVortxProcessado) {
  exigirPosicao(ativos, 'PosicaoAtivo')
  exigirPosicao(parcelas, 'PosicaoParcela')
  const camposContexto = ['fundoId', 'ambiente', 'codigoCarteira', 'dataReferencia'] as const
  if (camposContexto.some((campo) => ativos.contexto[campo] !== parcelas.contexto[campo])) {
    throw new RelatorioVortxError('ESCOPO_DIVERGENTE', 'Posicoes Vortx pertencem a contextos diferentes.')
  }
  const porAtivo = new Map<string, Linha>()
  for (const ativo of ativos.linhas) {
    const key = ativo.dadosNormalizados.identidade_ativo
    if (!key || porAtivo.has(key)) throw new RelatorioVortxError('ATIVO_AMBIGUO', 'Ativo Vortx ausente ou ambiguo.')
    porAtivo.set(key, ativo)
  }
  const grupos = new Map<string, ParcelaEstoqueVortx[]>()
  const identidades = new Set<string>()
  const posicoes: ParcelaEstoqueVortx[] = parcelas.linhas.map((parcela) => {
    const dados = parcela.dadosNormalizados
    const ativo = porAtivo.get(dados.identidade_ativo)
    if (!ativo) throw new RelatorioVortxError('PARCELA_SEM_ATIVO', 'Parcela sem ativo no mesmo escopo.')
    if (!dados.external_title_key || identidades.has(dados.external_title_key)) {
      throw new RelatorioVortxError('PARCELA_DUPLICADA', 'Parcela Vortx ausente ou duplicada.')
    }
    identidades.add(dados.external_title_key)
    if (ativo.dadosNormalizados.sacado_documento !== dados.sacado_documento) {
      throw new RelatorioVortxError('SACADO_DIVERGENTE', 'Sacado divergente entre ativo e parcela.')
    }
    const row: ParcelaEstoqueVortx = {
      parcela, ativo, ...statusEntrada(parcela, ativo),
      financeiro: Object.fromEntries([
        ['fundo_id', parcelas.contexto.fundoId], ['data_referencia', parcelas.contexto.dataReferencia],
        ['id_recebivel', dados.external_title_key], ['external_title_key', dados.external_title_key],
        ...['cedente_documento', 'cedente_nome', 'sacado_documento', 'sacado_nome', 'tipo_recebivel',
          'valor_nominal', 'valor_aquisicao', 'valor_presente', 'valor_pdd', 'data_emissao',
          'data_aquisicao', 'data_vencimento', 'data_vencimento_original'].map((campo) => [campo, dados[campo] ?? '']),
      ]),
    }
    const grupo = grupos.get(dados.identidade_ativo) ?? []
    grupo.push(row)
    grupos.set(dados.identidade_ativo, grupo)
    return row
  })
  if (grupos.size !== porAtivo.size) {
    throw new RelatorioVortxError('ATIVO_SEM_PARCELA', 'Posicao de ativo sem cobertura integral de parcelas.')
  }
  const divergencias: { linhaAtivo: number; campo: string; codigo: 'TOTAL_DIVERGENTE' | 'VALOR_AUSENTE' }[] = []
  for (const [key, grupo] of grupos) {
    const ativo = porAtivo.get(key)!
    for (const campo of ['valor_nominal', 'valor_aquisicao', 'valor_presente', 'valor_pdd']) {
      const totalAtivo = ativo.dadosNormalizados[campo]
      const valores = grupo.map((row) => row.parcela.dadosNormalizados[campo])
      if (!totalAtivo || valores.some((value) => !value)) divergencias.push({ linhaAtivo: ativo.numeroLinha, campo, codigo: 'VALOR_AUSENTE' })
      else if (!valores.reduce((sum, value) => sum.plus(value), new Dinheiro(0)).equals(totalAtivo)) {
        divergencias.push({ linhaAtivo: ativo.numeroLinha, campo, codigo: 'TOTAL_DIVERGENTE' })
      }
    }
  }
  const entradas = { EM_TRANSITO: 0, ENTREGUE: 0, NAO_INFORMADO: 0 }
  for (const row of posicoes) entradas[row.statusEntradaProvedor] += 1
  return {
    posicoes, divergencias, reconciliado: divergencias.length === 0,
    // VORTX_PDD_ADVISORY_V1: pending provider semantics, PDD remains an advisory
    // for persistence only. The original full/publication reconciliation is unchanged.
    reconciliadoFinanceiro: divergencias.every(item => item.campo === 'valor_pdd'),
    avisosPdd: divergencias.filter(item => item.campo === 'valor_pdd'),
    resumo: { ativos: grupos.size, parcelas: posicoes.length, statusEntrada: entradas },
    // Eligibility only; the internal publisher revalidates rows and integration scope in SQL.
    publicacaoHabilitada: divergencias.length === 0,
  }
}

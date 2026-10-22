import Decimal from 'decimal.js'
import { z } from 'zod'
import { codigoCotaCarteiraSchema, configuracaoCarteiraConsolidadaSchema, type ConfiguracaoCarteiraConsolidada, type CotaEsperadaVortx as CotaEsperada } from './carteira-configuracao'

export { configuracaoCarteiraConsolidadaSchema, type ConfiguracaoCarteiraConsolidada } from './carteira-configuracao'

const Monetario = Decimal.clone({ precision: 40 })
const MAX_PL = new Monetario('9999999999999999.9999') // carteira_snapshots: numeric(20,4)
export type MotivoRevisaoCarteira =
  | 'CONFIGURACAO_INVALIDA' | 'CONTEXTO_INVALIDO' | 'RESPOSTA_INVALIDA'
  | 'FUNDO_DIVERGENTE' | 'DATA_DIVERGENTE' | 'COTA_INESPERADA'
  | 'COTA_DUPLICADA' | 'COTA_INATIVA' | 'PL_INVALIDO'

export type ResultadoCompletudeCarteira =
  | { estado: 'CONFIGURACAO_PENDENTE' }
  | { estado: 'REVISAO_NECESSARIA'; motivo: MotivoRevisaoCarteira }
  | {
    estado: 'AGUARDANDO_COTAS'
    dataReferencia: string
    cotasDisponiveis: CotaEsperada[]
    cotasPendentes: CotaEsperada[]
  }
  | {
    estado: 'COMPLETA'
    dataReferencia: string
    cnpjFundo: string
    patrimonioLiquidoTotal: string
    configuracaoSnapshot: ConfiguracaoCarteiraConsolidada
    cotas: Array<CotaEsperada & { patrimonioLiquido: string }>
  }

const documento = z.string().regex(/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/)
const dataAtual = z.union([z.iso.date(), z.iso.datetime({ offset: true })])
const cabecalho = z.object({
  carteira: codigoCotaCarteiraSchema,
  cnpjFundo: documento,
  dataAtual,
  status: z.string(),
  pl: z.union([z.string().max(40), z.number()]),
})
const respostaSchema = z.array(z.object({ carteiras: z.array(cabecalho).max(100) })).max(100)
const revisar = (motivo: MotivoRevisaoCarteira): ResultadoCompletudeCarteira => ({ estado: 'REVISAO_NECESSARIA', motivo })
const ordenar = (a: CotaEsperada, b: CotaEsperada) => a.codigoCarteira < b.codigoCarteira ? -1 : a.codigoCarteira > b.codigoCarteira ? 1 : 0

function lerPl(value: string | number): Decimal | null {
  // Nao interpretar separadores locais nem arredondar uma divergencia do provider.
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 10_000)) return null
  if (!/^\d+(?:\.\d{1,4})?$/.test(String(value))) return null
  const decimal = new Monetario(value)
  return decimal.isFinite() && decimal.gte(0) && decimal.lte(MAX_PL) ? decimal : null
}

/**
 * Gate puro anterior a qualquer escrita financeira. Recebe a resposta original
 * validada pelo transporte, nunca o DTO redigido/truncado do diagnostico.
 * O chamador deve obter contexto e roster da versao autorizada no servidor.
 * Nao concede permissao de publicar nem substitui validacoes transacionais/RLS.
 */
export function conferirCompletudeCarteiraVortx(input: {
  cnpjFundo: string
  dataReferencia: string
  configuracao: unknown
  resposta: unknown
}): ResultadoCompletudeCarteira {
  if (!/^\d{14}$/.test(input.cnpjFundo) || !z.iso.date().safeParse(input.dataReferencia).success) return revisar('CONTEXTO_INVALIDO')
  if (input.configuracao === undefined || input.configuracao === null) return { estado: 'CONFIGURACAO_PENDENTE' }
  const config = configuracaoCarteiraConsolidadaSchema.safeParse(input.configuracao)
  if (!config.success) return revisar('CONFIGURACAO_INVALIDA')
  const resposta = respostaSchema.safeParse(input.resposta)
  if (!resposta.success) return revisar('RESPOSTA_INVALIDA')

  const esperadas = [...config.data.cotas].sort(ordenar)
  const codigosEsperados = new Set(esperadas.map(cota => cota.codigoCarteira))
  const recebidas = new Map<string, Decimal>()
  for (const grupo of resposta.data) {
    for (const cota of grupo.carteiras) {
      if (cota.cnpjFundo.replace(/\D/g, '') !== input.cnpjFundo) return revisar('FUNDO_DIVERGENTE')
      // dataAtual representa a data civil da posicao; nao usar o dia/horario da consulta.
      if (!z.iso.date().safeParse(cota.dataAtual.slice(0, 10)).success) return revisar('RESPOSTA_INVALIDA')
      if (cota.dataAtual.slice(0, 10) !== input.dataReferencia) return revisar('DATA_DIVERGENTE')
      if (!codigosEsperados.has(cota.carteira)) return revisar('COTA_INESPERADA')
      if (recebidas.has(cota.carteira)) return revisar('COTA_DUPLICADA')
      if (cota.status !== 'Ativa') return revisar('COTA_INATIVA')
      const pl = lerPl(cota.pl)
      if (pl === null) return revisar('PL_INVALIDO')
      recebidas.set(cota.carteira, pl)
    }
  }

  const pendentes = esperadas.filter(cota => !recebidas.has(cota.codigoCarteira))
  if (pendentes.length) {
    return {
      estado: 'AGUARDANDO_COTAS', dataReferencia: input.dataReferencia,
      cotasDisponiveis: esperadas.filter(cota => recebidas.has(cota.codigoCarteira)),
      cotasPendentes: pendentes,
    }
  }
  // Somente os headers, uma vez por codigo. ativos[].plTotal nao e PL adicional.
  const total = [...recebidas.values()].reduce((sum, pl) => sum.plus(pl), new Monetario(0))
  if (!total.gt(0) || total.gt(MAX_PL)) return revisar('PL_INVALIDO')
  return {
    estado: 'COMPLETA', dataReferencia: input.dataReferencia, cnpjFundo: input.cnpjFundo,
    patrimonioLiquidoTotal: total.toFixed(4),
    configuracaoSnapshot: { versao: 1, cotas: esperadas },
    cotas: esperadas.map(cota => ({ ...cota, patrimonioLiquido: recebidas.get(cota.codigoCarteira)!.toFixed(4) })),
  }
}

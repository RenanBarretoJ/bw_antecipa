export const VALIDACAO_CTE_CONFIG = {
  toleranciaMonetaria: 0.01,
  toleranciaQuantidade: 0.0001,
  versoesSuportadas: ['4.00'],
  modeloCte: '57',
  statusAutorizado: '100',
  bloquearOrigemDivergente: true,
  bloquearDestinoDivergente: true,
} as const

export const TIPOS_DOCUMENTAIS_CTE = ['cte', 'cte_xml'] as const

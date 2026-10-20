export const TIPOS_CSV_VORTX = ['Inclusao', 'PosicaoAtivo', 'PosicaoParcela'] as const
export type TipoCsvVortx = typeof TIPOS_CSV_VORTX[number]
export type StatusEntradaVortx = 'EM_TRANSITO' | 'ENTREGUE' | 'NAO_INFORMADO'
type CampoVortx = { nome: string; header: string; tipo: 'texto' | 'documento' | 'data' | 'dinheiro' | 'status'; obrigatorio?: boolean }
const campo = (nome: string, header: string, tipo: CampoVortx['tipo'] = 'texto', obrigatorio = false): CampoVortx => ({ nome, header, tipo, obrigatorio })

const identidade = [
  campo('codigo_carteira', 'Código da Carteira', 'texto', true),
  campo('cedente_documento', 'CPF/CNPJ do Cedente', 'documento', true),
  campo('chave_ativo', 'Chave Única do Ativo', 'texto', true),
  campo('sacado_documento', 'CPF/CNPJ do Devedor', 'documento', true),
  campo('tipo_recebivel', 'Tipo do Ativo', 'texto', true),
  campo('valor_aquisicao', 'Valor de Compra', 'dinheiro', true),
  campo('valor_nominal', 'Valor no Vencimento', 'dinheiro', true),
]
const parcela = campo('chave_parcela', 'Chave Única da Parcela', 'texto', true)
const vencimentoParcela = campo('data_vencimento_original', 'Data de Vencimento Original da Parcela', 'data', true)
const vencimentoAtualParcela = campo('data_vencimento', 'Data de Vencimento da Parcela', 'data', true)
const posicao = [
  campo('emissor_documento', 'CPF/CNPJ Emissor/Bancarizador', 'documento'),
  campo('cedente_nome', 'Nome do Cedente'),
  campo('coobrigacao', 'Coobrigação'),
  campo('sacado_nome', 'Nome do Devedor'),
  campo('valor_presente', 'Valor Presente', 'dinheiro'),
  campo('data_emissao', 'Data de Emissão', 'data'),
  campo('data_aquisicao', 'Data da Compra', 'data', true),
  // Campo preservado literalmente: nao constitui evidencia de liquidacao.
  campo('data_pagamento_informada', 'Data de Pagamento', 'data'),
  campo('perda_esperada', 'Perda Esperada', 'dinheiro'),
  campo('valor_pdd', 'Valor PDD', 'dinheiro'),
  campo('valor_efeito_vagao', 'Valor Efeito Vagão', 'dinheiro'),
  campo('valor_total_informado', 'Valor Total', 'dinheiro'),
  campo('customizado_1', 'Campo Customizado 1'),
  campo('status_entrada_provedor', 'Campo Customizado 2', 'status'),
  campo('customizado_3', 'Campo Customizado 3'),
  campo('customizado_4', 'Campo Customizado 4'),
  campo('customizado_5', 'Campo Customizado 5'),
]

/** Headers observados nos tres arquivos recebidos, nao aliases do layout RLX. */
export const LAYOUTS_CSV_VORTX: Readonly<Record<TipoCsvVortx, readonly CampoVortx[]>> = {
  Inclusao: [
    ...identidade, parcela,
    campo('data_movimento', 'Data de recebimento da remessa de inclusão', 'data', true),
    vencimentoAtualParcela,
  ],
  PosicaoAtivo: [
    ...identidade, ...posicao,
    campo('valor_emissao_total_ativo', 'Valor de Emissão', 'dinheiro'),
    campo('data_vencimento', 'Data de Vencimento', 'data', true),
    campo('data_vencimento_original', 'Data de Vencimento Original', 'data', true),
    campo('id_registradora_ativo', 'Id unico do ativo na entidade registradora'),
  ],
  PosicaoParcela: [
    ...identidade, ...posicao, parcela, vencimentoParcela, vencimentoAtualParcela,
    campo('valor_emissao_total_ativo', 'Valor de Emissão (Total Ativo)', 'dinheiro'),
    campo('id_registradora_parcela', 'Id único da parcela na entidade registradora'),
  ],
}

export function normalizarStatusEntradaVortx(value: string): StatusEntradaVortx {
  const status = value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, '_')
  if (!status) return 'NAO_INFORMADO'
  if (status === 'EM_TRANSITO' || status === 'ENTREGUE') return status
  throw new Error('Status de entrada Vortx nao reconhecido.')
}

import type {
  AgregadoDuplicatasNota,
  CamposDuplicata,
  NotaFiscalParaConfronto,
  ResultadoConfrontoDuplicata,
  ResultadoValidacaoDuplicata,
} from './types'

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

export function confrontarDuplicataComNotaFiscal(
  duplicata: CamposDuplicata,
  nota: NotaFiscalParaConfronto,
): ResultadoValidacaoDuplicata {
  const bloqueios: ResultadoValidacaoDuplicata['bloqueios'] = []
  const avisos: ResultadoValidacaoDuplicata['avisos'] = []
  const informacoes: ResultadoValidacaoDuplicata['informacoes'] = []

  const required: Array<[keyof CamposDuplicata, string]> = [
    ['numero', 'Numero da duplicata'],
    ['data_vencimento', 'Data de vencimento'],
    ['valor_nominal', 'Valor nominal'],
    ['cnpj_cedente_documento', 'CNPJ do cedente'],
    ['cnpj_sacado_documento', 'CNPJ do sacado'],
  ]
  for (const [field, label] of required) {
    if (duplicata[field] === null || duplicata[field] === '') {
      bloqueios.push({ campo: field, nivel: 'blocking', codigo: 'CAMPO_CRITICO_AUSENTE', mensagem: `${label} nao foi identificado.` })
    }
  }

  const cedenteDocumento = digits(duplicata.cnpj_cedente_documento)
  const cedenteNota = digits(nota.cnpj_emitente)
  if (cedenteDocumento && cedenteNota && cedenteDocumento !== cedenteNota) {
    bloqueios.push({ campo: 'cnpj_cedente_documento', nivel: 'blocking', codigo: 'CEDENTE_DIVERGENTE', mensagem: 'O CNPJ do cedente da duplicata diverge do emitente da NF.', valorDuplicata: cedenteDocumento, valorNotaFiscal: cedenteNota })
  }

  const sacadoDocumento = digits(duplicata.cnpj_sacado_documento)
  const sacadoNota = digits(nota.cnpj_destinatario)
  if (sacadoDocumento && sacadoNota && sacadoDocumento !== sacadoNota) {
    bloqueios.push({ campo: 'cnpj_sacado_documento', nivel: 'blocking', codigo: 'SACADO_DIVERGENTE', mensagem: 'O CNPJ do sacado da duplicata diverge do destinatario da NF.', valorDuplicata: sacadoDocumento, valorNotaFiscal: sacadoNota })
  }

  if (duplicata.data_emissao && nota.data_emissao && duplicata.data_emissao < nota.data_emissao) {
    avisos.push({ campo: 'data_emissao', nivel: 'warning', codigo: 'EMISSAO_ANTERIOR_NF', mensagem: 'A duplicata possui emissao anterior a NF.', valorDuplicata: duplicata.data_emissao, valorNotaFiscal: nota.data_emissao })
  }
  if (duplicata.data_vencimento && nota.data_vencimento && duplicata.data_vencimento !== nota.data_vencimento) {
    avisos.push({ campo: 'data_vencimento', nivel: 'warning', codigo: 'VENCIMENTO_DIFERENTE_NF', mensagem: 'O vencimento da duplicata difere do vencimento informado na NF.', valorDuplicata: duplicata.data_vencimento, valorNotaFiscal: nota.data_vencimento })
  }
  if (duplicata.valor_nominal !== null && duplicata.valor_nominal > Number(nota.valor_bruto) + 0.01) {
    bloqueios.push({ campo: 'valor_nominal', nivel: 'blocking', codigo: 'VALOR_SUPERIOR_NF', mensagem: 'O valor nominal desta duplicata supera o valor bruto da NF.', valorDuplicata: duplicata.valor_nominal, valorNotaFiscal: nota.valor_bruto })
  }
  if (!duplicata.aceite_textual) {
    informacoes.push({ campo: 'aceite_textual', nivel: 'info', codigo: 'ACEITE_TEXTUAL_AUSENTE', mensagem: 'Nao foi localizado aceite textual. A ausencia isolada nao invalida juridicamente o titulo.' })
  }
  informacoes.push({ campo: 'numero', nivel: 'info', codigo: 'NUMERACAO_INDEPENDENTE', mensagem: 'O numero da duplicata nao precisa ser igual ao numero da NF.' })

  const resultado: ResultadoConfrontoDuplicata = bloqueios.some((item) => item.codigo !== 'CAMPO_CRITICO_AUSENTE')
    ? 'DIVERGENTE'
    : bloqueios.length > 0
      ? 'INCOMPLETO'
      : 'COERENTE'
  return { resultado, bloqueios, avisos, informacoes }
}

export function agregarDuplicatasDaNota(
  duplicatas: Array<Pick<CamposDuplicata, 'valor_nominal'>>,
  valorNotaFiscal: number,
): AgregadoDuplicatasNota {
  const quantidadeIncompleta = duplicatas.filter((item) => item.valor_nominal === null).length
  const valorNominalTotal = rounded(duplicatas.reduce((sum, item) => sum + Number(item.valor_nominal ?? 0), 0))
  const diferenca = rounded(valorNominalTotal - Number(valorNotaFiscal))
  const resultado: ResultadoConfrontoDuplicata = quantidadeIncompleta > 0 || duplicatas.length === 0
    ? 'INCOMPLETO'
    : Math.abs(diferenca) <= 0.01
      ? 'COERENTE'
      : diferenca < 0
        ? 'INCOMPLETO'
        : 'DIVERGENTE'
  return { resultado, valorNominalTotal, valorNotaFiscal: rounded(valorNotaFiscal), diferenca, quantidade: duplicatas.length, quantidadeIncompleta }
}

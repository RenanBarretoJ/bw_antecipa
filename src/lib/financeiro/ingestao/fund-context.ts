export interface FundoIngestao {
  id: string
  ativo: boolean | null
}

/** Fundo inativo pode ser preparado tecnicamente pelo Super Admin. */
export function validarFundoParaIngestao(fundo: FundoIngestao | null): FundoIngestao {
  if (!fundo) throw new Error('Fundo inexistente.')
  return fundo
}

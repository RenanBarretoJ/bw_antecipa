export interface RlxFundoIngestao {
  id: string
  ativo: boolean | null
}

/** Fundo inativo pode ser preparado tecnicamente pelo Super Admin. */
export function validarFundoParaIngestao(fundo: RlxFundoIngestao | null): RlxFundoIngestao {
  if (!fundo) throw new Error('Fundo inexistente.')
  return fundo
}

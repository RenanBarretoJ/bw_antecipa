/** Filtra a seleção da interface; a validação documental continua no servidor. */
export function selecionarArquivoSolto(arquivos: readonly File[], aceitar: string): File | null {
  if (!arquivos.length) return null
  if (arquivos.length !== 1) throw new Error('Solte apenas um arquivo por documento.')
  const arquivo = arquivos[0]
  const regras = aceitar.toLowerCase().split(',').map(regra => regra.trim()).filter(Boolean)
  const permitido = !regras.length || regras.some(regra => {
    if (regra.startsWith('.')) return arquivo.name.toLowerCase().endsWith(regra)
    if (regra.endsWith('/*')) return arquivo.type.toLowerCase().startsWith(regra.slice(0, -1))
    return arquivo.type.toLowerCase() === regra
  })
  if (!permitido) throw new Error('Formato não aceito. Use o mesmo tipo indicado ao selecionar o arquivo.')
  return arquivo
}

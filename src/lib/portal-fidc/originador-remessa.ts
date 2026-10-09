// Novas integracoes podem ser publicadas antes do CNAB (originador nulo).
// Nesse caso a fonte e a versao CNAB imutavel vinculada a remessa, nunca
// a configuracao viva do fundo. Versoes antigas mantem a comparacao estrita.
export function validarOriginadorRemessa(
  cnab: { codigo_originador: string; status: string } | null,
  originadorIntegracao: string | null,
): void {
  if (!cnab || !/^\d{1,20}$/.test(cnab.codigo_originador)
    || !['publicada', 'substituida'].includes(cnab.status)) {
    throw Object.assign(new Error('A remessa exige uma versao CNAB publicada e um codigo originador valido.'), { categoria: 'configuracao' })
  }
  if (originadorIntegracao && cnab.codigo_originador !== originadorIntegracao) {
    throw Object.assign(new Error('O codigo originador do CNAB diverge da versao da integracao. Revise as configuracoes antes do envio.'), { categoria: 'codigo_originador_divergente' })
  }
}

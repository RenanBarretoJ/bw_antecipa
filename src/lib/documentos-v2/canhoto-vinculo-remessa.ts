/**
 * Vinculo automatico entre um canhoto (comprovante de entrega) e uma NF de
 * remessa VALIDADA da mesma venda -- nunca exposto ao usuario como selecao
 * manual (o card avulso que existia fora do checklist "Requisitos
 * documentais" tinha um dropdown manual; a consolidacao dentro do checklist
 * remove esse dropdown e resolve o vinculo automaticamente).
 *
 * Regra:
 *   0 remessas validadas -> a evidencia comprova a entrega da venda
 *                            diretamente (sem vinculo com remessa).
 *   exatamente 1          -> vincula automaticamente a essa remessa.
 *   2 ou mais             -> vinculo ambiguo: nao se escolhe nenhuma
 *                            (nunca adivinha). A ambiguidade e sinalizada
 *                            via ressalva (possui_ressalva/descricao_
 *                            ressalva em `canhotos`) para revisao manual do
 *                            gestor, nao via selecao no upload.
 */
export function inferirVinculoRemessaCanhoto(
  remessasValidadas: Array<{ id: string }>,
): { notaFiscalRemessaId: string | null; ambiguo: boolean } {
  if (remessasValidadas.length === 0) return { notaFiscalRemessaId: null, ambiguo: false }
  if (remessasValidadas.length === 1) return { notaFiscalRemessaId: remessasValidadas[0].id, ambiguo: false }
  return { notaFiscalRemessaId: null, ambiguo: true }
}

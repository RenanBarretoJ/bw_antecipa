import { z } from 'zod'
import type { BaseFinanceiraDaData } from './base-financeira'

export const diagnosticoEstoquesSchema = z.object({
  regraVersao: z.literal('FIN_RECON_V2'),
  estoqueD2ImportacaoId: z.string().uuid(), estoqueD1ImportacaoId: z.string().uuid(),
  entradas: z.number().int().nonnegative(), saidas: z.number().int().nonnegative(),
  reducoes: z.number().int().nonnegative(), aumentos: z.number().int().nonnegative(),
  invalidas: z.number().int().nonnegative(),
  exigeAquisicoes: z.boolean(), exigeLiquidacoes: z.boolean(), estoquesEquivalentes: z.boolean(),
}).superRefine((d, ctx) => {
  if (d.exigeAquisicoes !== (d.entradas > 0 || d.aumentos > 0)
    || d.exigeLiquidacoes !== (d.saidas > 0 || d.reducoes > 0)
    || d.estoquesEquivalentes !== (d.entradas + d.saidas + d.reducoes + d.aumentos === 0)) {
    ctx.addIssue({ code: 'custom', message: 'Diagnostico de estoques inconsistente' })
  }
})
export type DiagnosticoEstoques = z.infer<typeof diagnosticoEstoquesSchema>
export type ChaveBaseConciliacao = 'estoqueD2' | 'estoque' | 'aquisicoes' | 'liquidacoes'
export const BASES_CONCILIACAO: Array<{ key: ChaveBaseConciliacao; label: string }> = [
  { key: 'estoqueD2', label: 'Estoque D-2' }, { key: 'estoque', label: 'Estoque D-1' },
  { key: 'aquisicoes', label: 'Aquisições D-1' }, { key: 'liquidacoes', label: 'Liquidações D-1' },
]

export function diagnosticoCompativel(base: BaseFinanceiraDaData): DiagnosticoEstoques | null {
  const d = base.diagnosticoEstoques
  if (!d || d.invalidas || d.estoqueD2ImportacaoId !== base.estoqueD2.importacaoId
    || d.estoqueD1ImportacaoId !== base.estoque.importacaoId) return null
  return d
}

export function basesObrigatoriasConciliacao(base: BaseFinanceiraDaData) {
  const d = diagnosticoCompativel(base)
  return BASES_CONCILIACAO.filter(({ key }) => !d
    || key === 'estoqueD2' || key === 'estoque'
    || key === 'aquisicoes' && d.exigeAquisicoes || key === 'liquidacoes' && d.exigeLiquidacoes)
}

export function baseMovimentoDispensada(base: BaseFinanceiraDaData, tipo: string): boolean {
  const d = diagnosticoCompativel(base)
  return Boolean(d && (tipo === 'AQUISICOES' && !d.exigeAquisicoes || tipo === 'LIQUIDACOES' && !d.exigeLiquidacoes))
}

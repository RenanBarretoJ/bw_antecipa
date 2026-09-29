import type { BaseAntecipacaoSnapshot } from '@/lib/operacoes/base-antecipacao'
import { formatCurrency } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function BaseAntecipacaoResumo({ snapshot, notas }: {
  snapshot: BaseAntecipacaoSnapshot | null | undefined
  notas: Array<{ id: string; numero_nf: string }>
}) {
  if (!snapshot) return null
  return <Card>
    <CardHeader><CardTitle className="text-base">Base da antecipação: {snapshot.base === 'LIQUIDO' ? 'Valor líquido' : 'Valor bruto'}</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground">Valores fiscais congelados na solicitação.</p>
      {notas.map((nota) => {
        const fiscal = snapshot.notas.find((entry) => entry.nota_fiscal_id === nota.id)
        if (!fiscal) return <p key={nota.id} role="alert">Base congelada indisponível para NF {nota.numero_nf}.</p>
        return <div key={nota.id} className="space-y-1 border-t pt-2">
          <strong>NF {nota.numero_nf}</strong>
          <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-1">
            <dt>Bruto fiscal</dt><dd className="tabular-nums">{formatCurrency(fiscal.valor_bruto_fiscal)}</dd>
            <dt>Líquido fiscal</dt><dd className="tabular-nums">{fiscal.valor_liquido_fiscal === null ? 'Não informado' : formatCurrency(fiscal.valor_liquido_fiscal)}</dd>
            <dt>Base usada</dt><dd className="font-semibold tabular-nums">{formatCurrency(fiscal.valor_base)}</dd>
          </dl>
        </div>
      })}
    </CardContent>
  </Card>
}

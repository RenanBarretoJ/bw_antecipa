import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'

export function OperacaoResumoCard({ status, statusClassName, valorOperacao, taxa, metodo, dataBase, prazo, valorLiquido, aprovadoEm, previa = false, children }: {
  status: string
  statusClassName?: string
  valorOperacao: number
  taxa: number | null
  metodo: string
  dataBase: string | null
  prazo: number
  valorLiquido: number | null
  aprovadoEm: string | null
  previa?: boolean
  children?: ReactNode
}) {
  return (
    <Card data-operacao-resumo className="gap-0 rounded-xl border border-border/80 py-0 shadow-none ring-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 py-5">
        <CardTitle role="heading" aria-level={2} className="text-sm font-semibold">Resumo</CardTitle>
        <Badge variant="outline" className={`max-w-44 shrink-0 rounded-md px-2 py-1 text-[10px] whitespace-normal ${statusClassName ?? ''}`}>{status}</Badge>
      </CardHeader>
      <dl className="space-y-2.5 px-5 pb-5 text-xs [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted-foreground [&_dd]:text-right [&_dd]:font-medium [&_dd]:tabular-nums">
        <div><dt>Valor da operação</dt><dd>{formatCurrency(valorOperacao)}</dd></div>
        <div className="relative !-mt-1 text-[10px]"><dt>Base nas parcelas cedidas</dt><dd className="sr-only">Soma das bases cedidas, distinta do bruto fiscal das notas.</dd></div>
        <div><dt>Taxa</dt><dd>{taxa === null ? 'Não definida' : `${taxa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}% a.m.`}</dd></div>
        <div><dt>Método</dt><dd>{metodo}</dd></div>
        {dataBase && <div><dt>Data-base</dt><dd>{formatDate(dataBase)}</dd></div>}
        <div><dt>Prazo</dt><dd>{prazo} dias</dd></div>
        <div><dt>Deságio</dt><dd>{valorLiquido === null ? 'Pendente' : formatCurrency(valorOperacao - valorLiquido)}</dd></div>
        <div className="!mt-4 items-center border-t pt-3"><dt className="!font-semibold !text-foreground">Valor líquido</dt><dd className="!text-lg !font-bold tracking-tight text-emerald-700 dark:text-emerald-400">{valorLiquido === null ? 'Pendente' : formatCurrency(valorLiquido)}</dd></div>
        {aprovadoEm && <div className="text-[10px]"><dt>Aprovada em</dt><dd>{formatDate(aprovadoEm)}</dd></div>}
        {previa && <div className="text-[10px]"><dt>Prévia para análise</dt><dd>Condições ainda não aprovadas</dd></div>}
      </dl>
      {children && <div className="space-y-4 border-t px-4 py-4">{children}</div>}
    </Card>
  )
}

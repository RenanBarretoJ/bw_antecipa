import { connection } from 'next/server'
import { BarChart3, DollarSign, TrendingUp, Users } from 'lucide-react'
import { RelatorioFilters, RelatorioPagination } from '@/components/analytics/RelatorioControls'
import { ListNameCell } from '@/components/data-display/primitives'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { parseRelatorioFiltros } from '@/lib/analytics/contracts'
import { carregarRelatorioConsultor } from '@/lib/analytics/loaders.server'
import type { SearchParamsRecord } from '@/lib/pagination'
import { formatCNPJ, formatCurrency } from '@/lib/utils'

export default async function RelatoriosConsultorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>
}) {
  await connection()
  const filtros = parseRelatorioFiltros(await searchParams)
  const data = await carregarRelatorioConsultor(filtros)
  const resumo = data.resumo

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div><h1 className="text-2xl font-bold">Relatórios e comissões</h1><p className="text-muted-foreground">Performance da carteira autenticada por período.</p></div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Volume no mês', value: formatCurrency(resumo.volumeMes), detail: `${resumo.operacoesMes} operação(ões)`, icon: BarChart3 },
          { label: 'Comissão no mês', value: formatCurrency(resumo.comissaoMes), detail: 'estimativa da carteira', icon: DollarSign },
          { label: 'Volume acumulado', value: formatCurrency(resumo.volumeAcumulado), detail: 'em andamento e liquidadas', icon: TrendingUp },
          { label: 'Cedentes ativos', value: String(resumo.cedentesAtivos), detail: 'na carteira', icon: Users },
        ].map((metric) => (
          <Card key={metric.label}><CardContent className="p-4"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><metric.icon className="size-4 text-primary" />{metric.label}</div><p className="text-xl font-bold tabular-nums">{metric.value}</p><p className="text-xs text-muted-foreground">{metric.detail}</p></CardContent></Card>
        ))}
      </div>

      <RelatorioFilters
        filtros={filtros}
        meses={resumo.mesesDisponiveis}
        statusOptions={[
          { value: 'em_andamento', label: 'Em andamento' },
          { value: 'liquidada', label: 'Liquidada' },
        ]}
      />

      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b px-6 py-4">
          <CardTitle>Comissões por cedente</CardTitle>
          <p className="text-sm text-muted-foreground">Volume mensal da linha usa o valor líquido; o indicador superior preserva o volume bruto.</p>
        </CardHeader>
        {data.tabela.items.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">Nenhum cedente na carteira.</CardContent>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Cedente</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Vol. mês</TableHead><TableHead>Ops mês</TableHead><TableHead>%</TableHead><TableHead className="text-right">Comissão</TableHead><TableHead className="text-right">Vol. total</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.tabela.items.map((cedente) => (
                <TableRow key={cedente.cedenteId}>
                  <TableCell className="w-[220px] max-w-[220px]"><ListNameCell name={cedente.razaoSocial} subline={formatCNPJ(cedente.cnpj)} /></TableCell>
                  <TableCell><Badge variant={cedente.status === 'ativo' ? 'default' : 'outline'}>{cedente.status}</Badge></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(cedente.volumeMes)}</TableCell>
                  <TableCell className="tabular-nums">{cedente.operacoesMes}</TableCell>
                  <TableCell className="tabular-nums">{cedente.percentual}%</TableCell>
                  <TableCell className="text-right font-bold text-success-foreground tabular-nums">{formatCurrency(cedente.comissaoMes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(cedente.volumeTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={5}>Totais gerais</TableCell><TableCell className="text-right">{formatCurrency(resumo.comissaoMes)}</TableCell><TableCell className="text-right">{formatCurrency(resumo.volumeAcumulado)}</TableCell></TableRow></TableFooter>
          </Table>
        )}
        <RelatorioPagination pagination={data.tabela.pagination} />
      </Card>

      <div className="rounded-xl border border-warning/40 bg-warning/15 p-4 text-sm">
        <p className="font-medium">Nota</p>
        <p className="text-muted-foreground">As comissões são estimadas com base nas operações em andamento e liquidadas. Os valores finais são confirmados pelo gestor.</p>
      </div>
    </div>
  )
}

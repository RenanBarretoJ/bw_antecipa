import { connection } from 'next/server'
import { AlertTriangle, BarChart3, DollarSign, TrendingUp } from 'lucide-react'
import { RelatorioFilters, RelatorioPagination } from '@/components/analytics/RelatorioControls'
import { ListNameCell } from '@/components/data-display/primitives'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { parseRelatorioFiltros } from '@/lib/analytics/contracts'
import { carregarRelatorioGestor } from '@/lib/analytics/loaders.server'
import type { SearchParamsRecord } from '@/lib/pagination'
import { formatCNPJ, formatCurrency } from '@/lib/utils'

export default async function RelatoriosGestorPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>
}) {
  await connection()
  const filtros = parseRelatorioFiltros(await searchParams)
  const data = await carregarRelatorioGestor(filtros)
  const resumo = data.resumo

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Relatórios — {data.fundo.nome}</h1>
        <p className="text-muted-foreground">Visão gerencial das operações do fundo ativo.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: 'Volume bruto no mês', value: formatCurrency(resumo.volumeBrutoMes), detail: `${resumo.operacoesValidasMes} operação(ões)`, icon: BarChart3 },
          { label: 'Receita no mês', value: formatCurrency(resumo.receitaMes), detail: `Taxa média: ${resumo.taxaMedia.toFixed(2)}% a.m.`, icon: DollarSign },
          { label: 'Volume acumulado', value: formatCurrency(resumo.volumeTotalGeral), detail: `${resumo.operacoesTotalGeral} operações`, icon: TrendingUp },
          { label: 'Inadimplência', value: String(resumo.operacoesInadimplentesMes), detail: `${resumo.operacoesLiquidadasMes} liquidadas no mês`, icon: AlertTriangle },
        ].map((metric) => (
          <Card key={metric.label}><CardContent className="p-4"><div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><metric.icon className="size-4 text-primary" />{metric.label}</div><p className="text-xl font-bold tabular-nums">{metric.value}</p><p className="text-xs text-muted-foreground">{metric.detail}</p></CardContent></Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Aguardando aceite', resumo.operacoesAguardandoAceiteMes],
          ['Prontas para análise', resumo.operacoesProntasAnaliseMes],
          ['Em andamento', resumo.operacoesAtivasMes],
          ['Liquidadas', resumo.operacoesLiquidadasMes],
          ['Reprovadas', resumo.operacoesReprovadasMes],
          ['Canceladas', resumo.operacoesCanceladasMes],
        ].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-card p-3 text-center"><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>)}
      </div>

      <RelatorioFilters
        filtros={filtros}
        meses={resumo.mesesDisponiveis}
        statusOptions={[
          { value: 'solicitada', label: 'Solicitada' },
          { value: 'em_analise', label: 'Em análise' },
          { value: 'aprovada', label: 'Aprovada' },
          { value: 'em_andamento', label: 'Em andamento' },
          { value: 'liquidada', label: 'Liquidada' },
          { value: 'inadimplente', label: 'Inadimplente' },
          { value: 'reprovada', label: 'Reprovada' },
          { value: 'cancelada', label: 'Cancelada' },
        ]}
      />

      <Card className="overflow-hidden py-0">
        <CardHeader className="border-b px-6 py-4">
          <CardTitle>Volume por cedente</CardTitle>
          <p className="text-sm text-muted-foreground">Métricas mensais usam o mês selecionado; o período total pode ser refinado nos filtros.</p>
        </CardHeader>
        {data.tabela.items.length === 0 ? (
          <CardContent className="py-12 text-center text-muted-foreground">Nenhum cedente encontrado.</CardContent>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Cedente</TableHead><TableHead className="text-right">Vol. mês</TableHead><TableHead>Ops mês</TableHead><TableHead className="text-right">Vol. total</TableHead><TableHead>Ops total</TableHead><TableHead>Inadimp.</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.tabela.items.map((cedente) => (
                <TableRow key={cedente.cedenteId}>
                  <TableCell className="w-[240px] max-w-[240px]"><ListNameCell name={cedente.razaoSocial} subline={formatCNPJ(cedente.cnpj)} /></TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatCurrency(cedente.volumeMes)}</TableCell>
                  <TableCell className="tabular-nums">{cedente.operacoesMes}</TableCell>
                  <TableCell className="text-right font-bold tabular-nums">{formatCurrency(cedente.volumeTotal)}</TableCell>
                  <TableCell className="tabular-nums">{cedente.operacoesTotal}</TableCell>
                  <TableCell>{cedente.inadimplentes > 0 ? <Badge variant="destructive">{cedente.inadimplentes}</Badge> : '0'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell>Totais gerais</TableCell><TableCell className="text-right">{formatCurrency(resumo.volumeBrutoMes)}</TableCell><TableCell>{resumo.operacoesValidasMes}</TableCell><TableCell className="text-right">{formatCurrency(resumo.volumeTotalGeral)}</TableCell><TableCell>{resumo.operacoesTotalGeral}</TableCell><TableCell /></TableRow></TableFooter>
          </Table>
        )}
        <RelatorioPagination pagination={data.tabela.pagination} />
      </Card>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, FileText, Search } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { paginarAcompanhamento, type LinhaAcompanhamento } from '@/lib/operacoes/acompanhamento-tabela'
import { totaisLinhasParcelas, type OrdemParcelas } from '@/lib/operacoes/parcelas-tabela'

const valor = (v: number | null) => v === null ? '—' : formatCurrency(v)
const numeric = 'whitespace-nowrap px-3 py-3 text-right tabular-nums'

export function OperacaoAcompanhamentoTabela({ linhas }: { linhas: readonly LinhaAcompanhamento[] }) {
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState('')
  const [ordem, setOrdem] = useState<OrdemParcelas>('vencimento')
  const [pagina, setPagina] = useState(1)
  const resultado = useMemo(() => paginarAcompanhamento({ linhas, busca, status, ordem, pagina }), [linhas, busca, status, ordem, pagina])
  const totais = useMemo(() => totaisLinhasParcelas(linhas), [linhas])
  const subtotal = useMemo(() => totaisLinhasParcelas(resultado.filtradas), [resultado.filtradas])
  const estados = useMemo(() => [...new Map(linhas.map(linha => [linha.statusNf, linha.statusLabel])).entries()], [linhas])

  return (
    <Card className="min-w-0 gap-0 overflow-hidden" aria-label="Parcelas da operação">
      <CardHeader className="gap-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base"><FileText size={18} aria-hidden />Parcelas a antecipar <span className="text-muted-foreground">({linhas.length})</span></CardTitle>
          <div className="grid w-full grid-cols-3 gap-2 text-xs sm:w-auto">
            {([['Bruto fiscal', totais.brutoFiscal], ['Base cedida', totais.baseCedida], ['Antecipado', totais.antecipado]] as const).map(([label, total]) => (
              <div key={label} className={`min-w-0 rounded-lg border px-3 py-2 ${label === 'Antecipado' ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20' : 'bg-background'}`}>
                <p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 font-semibold tabular-nums wrap-anywhere">{valor(total)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input value={busca} onChange={event => { setBusca(event.target.value); setPagina(1) }} placeholder="Buscar NF ou sacado" aria-label="Buscar NF ou sacado" className="pl-9" /></div>
          <select aria-label="Filtrar status da NF" value={status} onChange={event => { setStatus(event.target.value); setPagina(1) }} className="h-8 max-w-full rounded-lg border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">Todos os status</option>{estados.map(([codigo, label]) => <option key={codigo} value={codigo}>{label}</option>)}
          </select>
          <select aria-label="Ordenar parcelas" value={ordem} onChange={event => { setOrdem(event.target.value as OrdemParcelas); setPagina(1) }} className="h-8 max-w-full rounded-lg border bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">
            <option value="vencimento">Vencimento</option><option value="numero">Número da NF</option><option value="sacado">Sacado</option><option value="valor">Maior base cedida</option><option value="status">Status</option>
          </select>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 px-0 pb-0">
        <div className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring" role="region" aria-label="Tabela de parcelas, role horizontalmente em telas pequenas" tabIndex={0}>
          <table className="w-full min-w-[780px] border-collapse text-left text-xs">
            <caption className="sr-only">Uma linha por parcela cedida. O bruto fiscal da NF se repete; o total considera cada NF apenas uma vez. Consulta sem ações de alteração.</caption>
            <thead className="border-y bg-muted/40 text-[11px] text-muted-foreground"><tr>
              <th scope="col" className="px-3 py-3 font-medium">NF</th><th scope="col" className="px-3 py-3 font-medium">Parcela</th><th scope="col" className="px-3 py-3 font-medium">Sacado</th>
              <th scope="col" className={`${numeric} font-medium`}>Bruto fiscal</th><th scope="col" className={`${numeric} bg-blue-50/70 font-medium dark:bg-blue-950/30`}>Base cedida</th><th scope="col" className={`${numeric} bg-emerald-50 font-medium dark:bg-emerald-950/30`}>Antecipado</th>
              <th scope="col" className="px-3 py-3 font-medium">Vencimento</th><th scope="col" className="px-3 py-3 font-medium">Status da NF</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {resultado.itens.map(linha => <tr key={linha.id} className="hover:bg-muted/30" data-parcela-operacao={linha.id}>
                <th scope="row" className="px-3 py-3 font-semibold"><Link prefetch={false} href={linha.href} className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Ver NF ${linha.numeroNf}`}>{linha.numeroNf}</Link><span className="mt-1 block whitespace-nowrap text-[11px] font-normal text-muted-foreground">{linha.totalParcelasNaNf > 0 ? `${linha.parcelasCedidasNaNf}/${linha.totalParcelasNaNf} cedidas` : 'Parcela não cadastrada'}</span></th>
                <td className="px-3 py-3 font-mono tabular-nums">{linha.numeroParcela === null ? '—' : String(linha.numeroParcela).padStart(3, '0')}</td>
                <td className="max-w-44 px-3 py-3"><span className="block truncate" title={linha.sacado}>{linha.sacado}</span><span className="mt-1 block whitespace-nowrap text-[11px] text-muted-foreground">{linha.cnpjSacado ? formatCNPJ(linha.cnpjSacado) : 'CNPJ não informado'}</span></td>
                <td className={numeric}>{valor(linha.brutoFiscal)}</td><td className={`${numeric} bg-blue-50/50 font-medium dark:bg-blue-950/20`}>{valor(linha.baseCedida)}</td>
                <td className={`${numeric} bg-emerald-50/70 font-semibold text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400`}>{valor(linha.antecipado)}{linha.desconto !== null && <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Desconto: {valor(linha.desconto)}</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatDate(linha.vencimento)}{linha.prazoDias !== null && <span className="mt-1 block text-[11px] text-muted-foreground">Prazo: {linha.prazoDias} dias</span>}</td>
                <td className="px-3 py-3"><Badge variant="outline" className="whitespace-nowrap font-normal">{linha.statusLabel}</Badge>{linha.statusFinanceiro && <span className="mt-1 block text-[11px] text-muted-foreground">{linha.statusFinanceiro}</span>}</td>
              </tr>)}
              {!resultado.itens.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{linhas.length ? 'Nenhuma parcela encontrada para estes filtros.' : 'Nenhuma parcela cedida ou NF legada vinculada.'}</td></tr>}
            </tbody>
            {resultado.filtradas.length > 0 && <tfoot className="border-t-2 bg-muted/30 font-semibold"><tr>
              <th scope="row" colSpan={3} className="px-3 py-3">Total filtrado <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{resultado.filtradas.length} item(ns) · {subtotal.notas} NF(s) · todas as páginas</span></th>
              <td className={numeric}>{valor(subtotal.brutoFiscal)}</td><td className={`${numeric} bg-blue-50/70 dark:bg-blue-950/20`}>{valor(subtotal.baseCedida)}</td><td className={`${numeric} bg-emerald-100/60 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400`}>{valor(subtotal.antecipado)}</td>
              <td colSpan={2} className="px-3 py-3 text-right text-[11px] font-normal text-muted-foreground">Bruto sem duplicar NFs</td>
            </tr></tfoot>}
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">Bruto fiscal é o valor integral da NF. Base cedida e antecipado são valores da parcela. “—” indica valor não registrado. Clique no número da NF para abrir seus documentos.</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-xs text-muted-foreground" role="status">{resultado.filtradas.length} de {linhas.length} itens · {subtotal.notas} de {totais.notas} NFs · Página {resultado.atual} de {resultado.paginas}</p>
          {resultado.paginas > 1 && <nav aria-label="Paginação das parcelas" className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={resultado.atual === 1} onClick={() => setPagina(resultado.atual - 1)}><ChevronLeft size={14} aria-hidden />Anterior</Button>
            <Button type="button" variant="outline" size="sm" disabled={resultado.atual === resultado.paginas} onClick={() => setPagina(resultado.atual + 1)}>Próxima<ChevronRight size={14} aria-hidden /></Button>
          </nav>}
        </div>
      </CardContent>
    </Card>
  )
}

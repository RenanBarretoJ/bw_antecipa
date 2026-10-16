'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Clock, FileDown, FileText, Search, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { selecionarLinhasParcelas, totaisLinhasParcelas, type FiltroParcelas, type LinhaParcelaOperacao, type OrdemParcelas } from '@/lib/operacoes/parcelas-tabela'

const valor = (v: number | null) => v === null ? '—' : formatCurrency(v)
const numeric = 'whitespace-nowrap px-3 py-3 text-right tabular-nums'

export function AceiteParcela({ status, exigido }: { status: string; exigido: boolean }) {
  if (!exigido) return <span className="text-xs text-muted-foreground">Não exigido</span>
  if (status === 'aceita') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle size={11} aria-hidden />Aprovado</span>
  if (status === 'contestada') return <span className="rounded-full bg-orange-100 px-2 py-1 text-[11px] text-orange-800 dark:bg-orange-950/40 dark:text-orange-300">Contestado</span>
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><Clock size={11} aria-hidden />Pendente</span>
}

export function OperacaoParcelasTabela({ linhas, aceiteExigido, podeRemover, removendo, onRemover, onExportar, bloqueada = false }: {
  linhas: readonly LinhaParcelaOperacao[]
  aceiteExigido: boolean
  podeRemover: boolean
  removendo: boolean
  bloqueada?: boolean
  onRemover: (linha: LinhaParcelaOperacao) => void
  onExportar: () => void
}) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<FiltroParcelas>('todas')
  const [ordem, setOrdem] = useState<OrdemParcelas>('vencimento')
  const exibidas = useMemo(() => selecionarLinhasParcelas(linhas, busca, filtro, ordem, aceiteExigido), [linhas, busca, filtro, ordem, aceiteExigido])
  const totais = totaisLinhasParcelas(linhas)
  const subtotal = totaisLinhasParcelas(exibidas)
  return (
    <Card className="min-w-0 gap-0 overflow-hidden" aria-label="Parcelas da operação">
      <CardHeader className="gap-4 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base"><FileText size={18} aria-hidden />Parcelas a antecipar <span className="text-muted-foreground">({linhas.length})</span></CardTitle>
          <div className="grid w-full grid-cols-3 gap-2 text-xs sm:w-auto">
            {([['Bruto fiscal', totais.brutoFiscal], ['Base cedida', totais.baseCedida], ['Antecipado', totais.antecipado]] as const).map(([label, total]) => (
              <div key={label} className={`min-w-0 rounded-lg border px-3 py-2 ${label === 'Antecipado' ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20' : 'bg-background'}`}>
                <p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-semibold tabular-nums wrap-anywhere">{valor(total)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden /><Input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar NF ou sacado" aria-label="Buscar NF ou sacado" className="pl-9" /></div>
          <select aria-label="Filtrar aceite" value={filtro} onChange={e => setFiltro(e.target.value as FiltroParcelas)} className="h-8 max-w-full rounded-lg border bg-background px-2 text-xs">
            <option value="todas">Todas as parcelas</option>{aceiteExigido && <option value="pendentes">Aceite pendente</option>}<option value="contestadas">Contestadas</option>
          </select>
          <select aria-label="Ordenar parcelas" value={ordem} onChange={e => setOrdem(e.target.value as OrdemParcelas)} className="h-8 max-w-full rounded-lg border bg-background px-2 text-xs">
            <option value="vencimento">Vencimento</option><option value="numero">Número da NF</option><option value="sacado">Sacado</option><option value="valor">Maior base cedida</option><option value="status">Status</option>
          </select>
          <Button type="button" variant="outline" size="sm" onClick={onExportar} disabled={!linhas.length || bloqueada} className="gap-1.5"><FileDown size={14} aria-hidden />CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 px-0 pb-0">
        <div className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring" role="region" aria-label="Tabela de parcelas, role horizontalmente em telas pequenas" tabIndex={0}>
          <table className="w-full min-w-[780px] border-collapse text-left text-xs">
            <caption className="sr-only">Uma linha por parcela cedida. O bruto fiscal da NF se repete; o total considera cada NF apenas uma vez.</caption>
            <thead className="border-y bg-muted/40 text-[10px] text-muted-foreground"><tr>
              <th scope="col" className="px-3 py-3 font-medium">NF</th><th scope="col" className="px-3 py-3 font-medium">Parcela</th><th scope="col" className="px-3 py-3 font-medium">Sacado</th>
              <th scope="col" className={`${numeric} font-medium`}>Bruto fiscal</th><th scope="col" className={`${numeric} bg-blue-50/70 font-medium dark:bg-blue-950/30`}>Base cedida</th><th scope="col" className={`${numeric} bg-emerald-50 font-medium dark:bg-emerald-950/30`}>Antecipado</th>
              <th scope="col" className="px-3 py-3 font-medium">Vencimento</th><th scope="col" className="px-3 py-3 font-medium">Aceite</th>{podeRemover && <th scope="col" className="sticky right-0 z-10 border-l bg-card"><span className="sr-only">Retirar item</span></th>}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {exibidas.map(linha => <tr key={linha.id} className="group hover:bg-muted/30" data-parcela-operacao={linha.id}>
                <th scope="row" className="px-3 py-3 font-semibold"><Link prefetch={false} href={`/gestor/notas-fiscais/${linha.notaFiscalId}`} className="text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Ver NF ${linha.numeroNf}`}>{linha.numeroNf || '—'}</Link></th>
                <td className="px-3 py-3 tabular-nums" title={linha.parcelaId === null ? 'Nota legada sem parcelas cadastradas' : undefined}>{linha.numeroParcela === null ? '—' : String(linha.numeroParcela).padStart(3, '0')}</td>
                <td className="max-w-44 px-3 py-3"><span className="block truncate" title={`${linha.sacado} · ${formatCNPJ(linha.cnpjSacado)}`}>{linha.sacado || 'Sacado não informado'}</span></td>
                <td className={numeric}>{valor(linha.brutoFiscal)}</td><td className={`${numeric} bg-blue-50/50 font-medium dark:bg-blue-950/20`}>{valor(linha.baseCedida)}</td><td className={`${numeric} bg-emerald-50/70 font-semibold text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400`}>{valor(linha.antecipado)}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatDate(linha.vencimento)}</td><td className="whitespace-nowrap px-3 py-3"><AceiteParcela status={linha.statusNf} exigido={aceiteExigido} /></td>
                {podeRemover && <td className="sticky right-0 z-10 border-l bg-card px-1 py-2"><Button type="button" variant="ghost" size="icon-sm" disabled={removendo || bloqueada} onClick={() => onRemover(linha)} title="Retirar parcela ou NF inteira" aria-label={`Retirar parcela ${linha.numeroParcela ?? 'legada'} ou NF ${linha.numeroNf}`} className="text-destructive hover:bg-destructive/10"><Trash2 size={15} aria-hidden /></Button></td>}
              </tr>)}
              {!exibidas.length && <tr><td colSpan={podeRemover ? 9 : 8} className="px-4 py-10 text-center text-muted-foreground">Nenhuma parcela encontrada.</td></tr>}
            </tbody>
            {exibidas.length > 0 && <tfoot className="border-t-2 bg-muted/30 font-semibold"><tr>
              <th scope="row" colSpan={3} className="px-3 py-3">Total exibido <span className="mt-1 block text-[10px] font-normal text-muted-foreground">{exibidas.length} item(ns) · {subtotal.notas} NF(s)</span></th>
              <td className={numeric}>{valor(subtotal.brutoFiscal)}</td><td className={`${numeric} bg-blue-50/70 dark:bg-blue-950/20`}>{valor(subtotal.baseCedida)}</td><td className={`${numeric} bg-emerald-100/60 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400`}>{valor(subtotal.antecipado)}</td>
              <td colSpan={podeRemover ? 3 : 2} className="px-3 py-3 text-right text-[10px] font-normal text-muted-foreground">Bruto sem duplicar NFs</td>
            </tr></tfoot>}
          </table>
        </div>
        <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">Bruto fiscal é o valor integral da NF. Base cedida e antecipado são valores da parcela. “—” indica valor não registrado. Clique no número da NF para abrir seus documentos.</p>
        <p className="border-t px-4 py-3 text-[11px] text-muted-foreground" aria-live="polite">{exibidas.length} de {linhas.length} itens · {subtotal.notas} de {totais.notas} NFs</p>
      </CardContent>
    </Card>
  )
}

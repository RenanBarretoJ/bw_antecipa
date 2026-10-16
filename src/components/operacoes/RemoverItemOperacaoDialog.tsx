'use client'

import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { LinhaParcelaOperacao } from '@/lib/operacoes/parcelas-tabela'

export function RemoverItemOperacaoDialog({ linha, linhasDaNf, processando, onClose, onConfirm }: {
  linha: LinhaParcelaOperacao
  linhasDaNf: readonly LinhaParcelaOperacao[]
  processando: boolean
  onClose: () => void
  onConfirm: (parcelaId: string | null) => void
}) {
  const [escopo, setEscopo] = useState<'parcela' | 'nf'>(linha.parcelaId ? 'parcela' : 'nf')
  const afetadas = escopo === 'nf' ? linhasDaNf : [linha]
  const ultima = afetadas.length === linhasDaNf.length
  return <Dialog open onOpenChange={open => { if (!open && !processando) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" showCloseButton={!processando}>
      <DialogHeader><DialogTitle>Retirar item da operação</DialogTitle><DialogDescription>NF {linha.numeroNf} · {linha.sacado}</DialogDescription></DialogHeader>
      {linha.parcelaId && <fieldset disabled={processando} className="space-y-2 rounded-lg border p-3 text-sm"><legend className="px-1 text-xs text-muted-foreground">O que deseja retirar?</legend>
        <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="escopo-remocao" value="parcela" checked={escopo === 'parcela'} onChange={() => setEscopo('parcela')} />Apenas a parcela {String(linha.numeroParcela).padStart(3, '0')}</label>
        <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="escopo-remocao" value="nf" checked={escopo === 'nf'} onChange={() => setEscopo('nf')} />NF inteira ({linhasDaNf.length} parcela(s) nesta operação)</label>
      </fieldset>}
      <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-xs"><thead className="bg-muted/50 text-muted-foreground"><tr><th className="p-3">Parcela</th><th className="p-3">Vencimento</th><th className="p-3 text-right">Base cedida</th></tr></thead><tbody className="divide-y">{afetadas.map(p => <tr key={p.id}><td className="p-3">{p.numeroParcela === null ? 'Sem parcela cadastrada' : String(p.numeroParcela).padStart(3, '0')}</td><td className="whitespace-nowrap p-3">{formatDate(p.vencimento)}</td><td className="whitespace-nowrap p-3 text-right tabular-nums">{formatCurrency(p.baseCedida)}</td></tr>)}</tbody></table></div>
      <p className="text-sm text-muted-foreground">{escopo === 'nf' ? 'Todas as parcelas listadas sairão desta operação.' : ultima ? 'A parcela selecionada é a última desta NF na operação.' : 'Somente a parcela selecionada sairá desta operação. As demais permanecem vinculadas.'} O cadastro da NF e seus arquivos serão preservados.</p>
      {ultima && <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><AlertCircle size={16} className="shrink-0" aria-hidden />A NF deixará de compor a operação. Se não restar nenhuma NF, a operação será cancelada.</p>}
      <DialogFooter><Button type="button" variant="outline" disabled={processando} onClick={onClose}>Cancelar</Button><Button type="button" variant="destructive" disabled={processando} onClick={() => onConfirm(escopo === 'nf' ? null : linha.parcelaId)}>{processando && <Loader2 size={14} className="animate-spin" aria-hidden />}{processando ? 'Retirando...' : escopo === 'nf' ? 'Retirar NF inteira' : 'Retirar apenas esta parcela'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

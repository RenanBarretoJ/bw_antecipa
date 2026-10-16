import type { ReactNode } from 'react'
import { Download, Eye, Loader2, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function AcoesArquivoDocumento({ titulo, ocupado, baixando, onVisualizar, onBaixar, children }: {
  titulo: string
  ocupado: boolean
  baixando: boolean
  onVisualizar: () => void
  onBaixar: () => void
  children?: ReactNode
}) {
  return <>
    <Button type="button" variant="outline" size="sm" onClick={onVisualizar} disabled={ocupado} aria-label={`Visualizar ${titulo}`}><Eye size={14} />Ver</Button>
    <Button type="button" variant="outline" size="icon-sm" onClick={onBaixar} disabled={ocupado} aria-label={`Baixar ${titulo}`} title={`Baixar ${titulo}`}>{baixando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}</Button>
    {children}
  </>
}

export function DocumentoArquivoLinha({ titulo, detalhe, acoes, destaquePendente = false, children }: {
  titulo: string
  detalhe: string
  acoes: ReactNode
  destaquePendente?: boolean
  children?: ReactNode
}) {
  return (
    <div data-documento-linha className={cn('min-w-0 px-4 py-3', destaquePendente && 'bg-amber-50/50 dark:bg-amber-950/15')}>
      <div className="flex min-w-0 items-center gap-2.5">
        {destaquePendente && <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded-md border border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300"><Upload size={14} aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] leading-relaxed font-semibold wrap-anywhere">{titulo}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground wrap-anywhere">{detalhe}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 [&_button]:h-8 [&_button]:rounded-md [&_button]:px-2 [&_button]:text-[11px] [&_svg]:size-3.5">{acoes}</div>
      </div>
      {children}
    </div>
  )
}

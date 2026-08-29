'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Search } from 'lucide-react'
import { buscarOpcoesEscopo, type RemoteOption } from '@/lib/actions/selectors'
import { preservarOpcaoSelecionada } from '@/lib/selectors/remote'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function RemoteEntitySelector({ tipo, value, onChange, placeholder, className }: {
  tipo: 'cedente' | 'politica'
  value: string | null
  onChange: (value: string | null) => void
  placeholder: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<RemoteOption[]>([])
  const [selected, setSelected] = useState<RemoteOption | null>(null)
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    if (!open && !value) return
    const current = ++requestId.current
    const timer = window.setTimeout(async () => {
      setLoading(true)
      const result = await buscarOpcoesEscopo({ tipo, q, selectedId: value })
      if (current !== requestId.current) return
      if (result.success) {
        setSelected((previous) => {
          const atual = result.options.find((item) => item.value === value) || previous
          setOptions(preservarOpcaoSelecionada(result.options, atual))
          return atual
        })
      }
      setLoading(false)
    }, open ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [open, q, tipo, value])

  return (
    <div className={cn('relative', className)}>
      <Button type="button" variant="outline" className="w-full justify-between font-normal" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="truncate">{value ? selected?.label || 'Carregando...' : placeholder}</span><ChevronDown className="size-4" />
      </Button>
      {open ? <div className="absolute right-0 z-50 mt-1 w-full min-w-64 rounded-lg border bg-popover p-2 shadow-lg">
        <div className="relative mb-2"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={q} onChange={(event) => setQ(event.target.value)} className="h-9 pl-8" placeholder="Digite para buscar..." /></div>
        <button type="button" className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => { onChange(null); setSelected(null); setOpen(false) }}>Todos</button>
        {loading ? <div className="flex items-center justify-center p-3"><Loader2 className="size-4 animate-spin" /></div> : options.map((option) => <button key={option.value} type="button" title={option.label} className="w-full rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => { setSelected(option); onChange(option.value); setOpen(false) }}><span className="block truncate text-sm font-medium">{option.label}</span>{option.description ? <span className="block truncate text-xs text-muted-foreground">{option.description}</span> : null}</button>)}
      </div> : null}
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Check, Copy, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function TokenOnceDialog({
  open,
  onOpenChange,
  title,
  token,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  token: string
}) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(token)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Clipboard indisponivel (ex.: contexto nao seguro) -- o token
      // continua selecionavel manualmente no campo abaixo.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="flex items-start gap-2 text-amber-600">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Este token so e exibido agora. Copie e guarde em um local seguro -- nao sera possivel recupera-lo depois.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <code className="flex-1 select-all break-all font-mono text-sm">{token}</code>
          <Button type="button" variant="outline" size="sm" onClick={copiar}>
            {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>Ja copiei, fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

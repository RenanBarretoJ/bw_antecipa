'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Bloco de JSON formatado e copiavel para diagnostico tecnico administrativo
 * (P0_Claude_Webhook_Transportadora_Payloads_Auditoria_v2). O conteudo
 * exibido ja deve chegar sanitizado do backend -- este componente nunca
 * filtra nem oculta campos, so formata/apresenta o que recebeu.
 */
export function CopiableJsonBlock({ title, value }: { title: string; value: unknown }) {
  const [copiado, setCopiado] = useState(false)
  const formatado = value == null ? '(vazio)' : JSON.stringify(value, null, 2)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(formatado)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Clipboard indisponivel (ex.: contexto nao seguro) -- o conteudo
      // continua selecionavel manualmente no bloco abaixo.
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{title}</p>
        <Button type="button" variant="outline" size="sm" onClick={copiar} disabled={value == null}>
          {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs">{formatado}</pre>
    </div>
  )
}

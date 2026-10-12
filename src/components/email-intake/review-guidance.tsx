'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function EmailReviewGuidance({ cedenteId }: { cedenteId: string | null }) {
  const [message, setMessage] = useState('')
  return <div className="space-y-2 rounded border p-3 text-sm">
    <p>Vencimento não encontrado no documento. O Cedente ou Consultor autorizado deve abrir <strong>Notas Fiscais → Revisar NFS-e recebida por e-mail</strong> e informar a data.</p>
    <p className="text-muted-foreground">O Gestor acompanha esta pendência. A conclusão ocorre na sessão do responsável, com MFA.</p>
    <div className="flex flex-wrap gap-2">{[
      ['Copiar acesso do Cedente', '/cedente/notas-fiscais'],
      ...(cedenteId ? [['Copiar acesso do Consultor', `/consultor/notas-fiscais?cedente=${cedenteId}`]] : []),
    ].map(([label, path]) => <Button key={path} variant="outline" onClick={async () => {
      try { await navigator.clipboard.writeText(new URL(path, window.location.origin).href); setMessage('Link copiado. Compartilhe com o responsável autorizado para concluir a revisão.') }
      catch { setMessage('Não foi possível copiar. Oriente o responsável a acessar Notas Fiscais na própria sessão.') }
    }}>{label}</Button>)}</div>
    {message && <p role="status">{message}</p>}
  </div>
}

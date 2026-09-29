'use client'

import { useId, useState, useTransition } from 'react'
import { configurarComissaoConsultorFundo } from '@/lib/actions/configuracao-financeira-fundo'

export function ComissaoConsultoriaToggle({ consultorId, fundoId, nome, habilitada }: {
  consultorId: string; fundoId: string; nome: string; habilitada: boolean
}) {
  const id = useId()
  const [ativo, setAtivo] = useState(habilitada)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  return <div className="space-y-2 rounded-lg border p-4">
    <p className="font-medium break-words">{nome}</p>
    <div className="flex items-center gap-3">
      <button type="button" id={id} role="switch" aria-checked={ativo} disabled={pending}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 ${ativo ? 'bg-primary' : 'bg-muted'}`}
        onClick={() => startTransition(async () => {
          setMessage('')
          try {
            const result = await configurarComissaoConsultorFundo(consultorId, fundoId, !ativo)
            if (result.success) setAtivo(!ativo)
            setMessage(result.message)
          } catch { setMessage('Não foi possível salvar. Verifique sua sessão e tente novamente.') }
        })}>
        <span className={`pointer-events-none absolute top-0.5 size-4 rounded-full bg-background transition-transform ${ativo ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
      <label htmlFor={id} className="text-sm">Comissão habilitada</label>
    </div>
    <p className="text-sm text-muted-foreground">Quando desabilitado, informações de comissão não são exibidas ao Consultor.</p>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>
}

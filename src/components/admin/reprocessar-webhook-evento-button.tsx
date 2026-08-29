'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { reprocessarWebhookEventoTransportadoraAdmin } from '@/app/admin/integracoes-transportadoras/actions'

export function ReprocessarWebhookEventoButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [mensagem, setMensagem] = useState<{ tipo: 'success' | 'error'; texto: string } | null>(null)

  function confirmar(mfaCode: string) {
    startTransition(async () => {
      const resultado = await reprocessarWebhookEventoTransportadoraAdmin({ id, mfaCode })
      setMensagem({ tipo: resultado.success ? 'success' : 'error', texto: resultado.notification?.message || resultado.message })
      if (resultado.success) setOpen(false)
    })
  }

  return (
    <div className="space-y-2">
      {mensagem && (
        <p className={`text-sm ${mensagem.tipo === 'success' ? 'text-emerald-600' : 'text-destructive'}`}>{mensagem.texto}</p>
      )}
      <Button type="button" onClick={() => setOpen(true)}>Reprocessar evento</Button>
      <SensitiveConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Reprocessar evento"
        description="Refaz a resolucao de venda/remessa/CT-e e as validacoes cruzadas contra o estado atual do banco, usando o mesmo arquivo original ja retido. Se resolver, cria o canhoto normalmente -- nunca duplica um documento ja processado. So fecha em EVIDENCIA_INDISPONIVEL se este for um evento legado sem arquivo retido."
        confirmLabel="Reprocessar"
        pending={pending}
        onConfirm={confirmar}
      />
    </div>
  )
}

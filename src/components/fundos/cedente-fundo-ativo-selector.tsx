'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { carregarSeletorCedenteFundoAtivo, selecionarCedenteFundoAtivo } from '@/lib/actions/cedente-fundo-ativo'
import { useNotifications } from '@/components/notifications/notification-provider'
import { iniciarTrocaContextoNotificacoes, concluirTrocaContextoNotificacoes } from '@/lib/notificacoes/events'

export function CedenteFundoAtivoSelector() {
  const router = useRouter()
  const notifications = useNotifications()
  const [links, setLinks] = useState<Array<{ id: string; nome: string }>>([])
  const [selected, setSelected] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    void carregarSeletorCedenteFundoAtivo().then((result) => {
      if (active) { setLinks(result.links); setSelected(result.selected) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [])
  if (error) return <span role="alert" className="text-xs text-destructive">Fundo indisponível. Recarregue a página.</span>
  if (!links.length) return null
  function handleChange(value: string) {
    iniciarTrocaContextoNotificacoes()
    startTransition(async () => {
      try {
        const result = await selecionarCedenteFundoAtivo(value)
        notifications.notify({ type: result.success ? 'success' : 'error', message: result.message, dedupeKey: `cedente-fundo:${result.message}` })
        if (result.success) { setSelected(value); router.refresh() }
      } catch {
        notifications.error('Não foi possível alterar o Fundo operacional.')
      } finally {
        concluirTrocaContextoNotificacoes()
      }
    })
  }
  return <select aria-label="Fundo operacional do cedente" className="h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-sm" disabled={isPending} value={selected} onChange={(event) => handleChange(event.target.value)}>
    {!selected && <option value="">Selecione o Fundo operacional</option>}
    {links.map((link) => <option key={link.id} value={link.id}>{link.nome}</option>)}
  </select>
}

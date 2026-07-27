'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { selecionarCedenteFundoAtivo } from '@/lib/actions/cedente-fundo-ativo'
import { useNotifications } from '@/components/notifications/notification-provider'

type LinkRow = {
  id: string
  fundo_id: string
  fundos: { id: string; nome: string; cnpj: string; ativo: boolean | null } | { id: string; nome: string; cnpj: string; ativo: boolean | null }[] | null
}

function extractFundo(row: LinkRow) {
  return Array.isArray(row.fundos) ? row.fundos[0] : row.fundos
}

export function CedenteFundoAtivoSelector() {
  const supabase = useMemo(() => createClient(), [])
  const notifications = useNotifications()
  const [links, setLinks] = useState<LinkRow[]>([])
  const [selected, setSelected] = useState('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) return

      const { data: cedente } = await supabase
        .from('cedentes')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle()
      const cedenteId = (cedente as { id?: string } | null)?.id
      if (!cedenteId) return

      const { data } = await supabase
        .from('cedente_fundos')
        .select('id, fundo_id, fundos(id, nome, cnpj, ativo)')
        .eq('cedente_id', cedenteId)
        .eq('status', 'ativo')
        .order('vigente_desde', { ascending: false })

      const rows = ((data || []) as unknown as LinkRow[]).filter((row) => extractFundo(row)?.ativo === true)
      setLinks(rows)
      setSelected((current) => current || rows[0]?.id || '')
    }

    void load()
  }, [supabase])

  if (links.length <= 1) return null

  function handleChange(value: string) {
    setSelected(value)
    startTransition(async () => {
      const result = await selecionarCedenteFundoAtivo(value)
      notifications.notify({ type: result.success ? 'success' : 'error', message: result.message, dedupeKey: `cedente-fundo:${result.message}` })
      if (result.success) window.location.reload()
    })
  }

  return (
    <select
      aria-label="Fundo operacional do cedente"
      className="h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-sm"
      disabled={isPending}
      value={selected}
      onChange={(event) => handleChange(event.target.value)}
    >
      {links.map((link) => {
        const fundo = extractFundo(link)
        return <option key={link.id} value={link.id}>{fundo?.nome || link.fundo_id}</option>
      })}
    </select>
  )
}

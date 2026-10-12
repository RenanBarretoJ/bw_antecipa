'use client'
import { useState } from 'react'
import { EmailCedentePicker } from './cedente-picker'

export function EmailCedenteFilter({ fundoId, initial }: { fundoId: string; initial?: string | null }) {
  const [ids, setIds] = useState(initial ? [initial] : [])
  return <details className="rounded border p-3 sm:col-span-2 xl:col-span-4"><summary className="cursor-pointer text-sm">Filtrar por cedente identificado{ids.length ? ' · 1 selecionado' : ''}</summary>
    <input type="hidden" name="cedenteId" value={ids[0] ?? ''} /><div className="mt-3"><EmailCedentePicker fundoId={fundoId} selected={ids} onChange={setIds} multiple={false} /></div>
  </details>
}

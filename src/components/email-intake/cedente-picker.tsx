'use client'

import { useState, useTransition } from 'react'
import { buscarCedentesEmail } from '@/app/actions/email-operations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function EmailCedentePicker({ fundoId, selected, onChange, multiple = true }: { fundoId: string; selected: string[]; onChange: (ids: string[]) => void; multiple?: boolean }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [pending, start] = useTransition()
  const [result, setResult] = useState<{ total: number; rows: { id: string; name: string }[] } | null>(null)
  const [names, setNames] = useState<Record<string, string>>({}), [error, setError] = useState('')
  function search(next = 1) {
    start(async () => {
      setError('')
      try { const response = await buscarCedentesEmail(fundoId, query, next); setResult(response); setPage(next)
        setNames(old => ({ ...old, ...Object.fromEntries(response.rows.map(row => [row.id, row.name])) }))
      } catch { setError('Não foi possível consultar os cedentes. Confira sua conexão e tente buscar novamente.') }
    })
  }
  return <section className="space-y-3 rounded-lg border p-3" aria-label="Cedentes permitidos">
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 space-y-1">Buscar cedente<Input value={query} maxLength={100} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }} /></label>
      <Button type="button" variant="outline" disabled={pending} onClick={() => search()}>{pending ? 'Buscando…' : 'Buscar'}</Button></div>
    <p role="status" className="text-sm">{selected.length} cedente(s) selecionado(s). A busca considera somente vínculos ativos deste fundo.</p>
    {selected.length > 0 && <ul className="flex flex-wrap gap-2" aria-label="Selecionados">{selected.map((id, index) => <li key={id} className="max-w-full rounded border px-2 py-1 text-sm break-words">
      {names[id] ?? `Cedente selecionado ${index + 1}`} <button type="button" className="ml-2 underline" aria-label={`Remover ${names[id] ?? `cedente ${index + 1}`}`} onClick={() => onChange(selected.filter(value => value !== id))}>Remover</button>
    </li>)}</ul>}
    {error && <p role="alert">{error}</p>}
    {!result && <p className="text-sm text-muted-foreground">Busque pelo nome ou deixe o campo vazio para consultar os cedentes disponíveis.</p>}
    {result && <>
      {!result.rows.length ? <p>Nenhum cedente encontrado. Confira o nome ou o vínculo com este fundo.</p> : <>
        {multiple && <Button type="button" variant="ghost" onClick={() => onChange([...new Set([...selected, ...result.rows.map(row => row.id)])].slice(0, 1000))}>Selecionar todos desta página</Button>}
        <ul className="space-y-2">{result.rows.map(row => <li key={row.id}><label className="flex items-start gap-3 rounded border p-3"><input type="checkbox" checked={selected.includes(row.id)} onChange={e => onChange(e.target.checked ? multiple ? [...selected, row.id] : [row.id] : selected.filter(id => id !== row.id))} className="mt-1" /><span className="break-words">{row.name}</span></label></li>)}</ul>
      </>}
      <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={page === 1 || pending} onClick={() => search(page - 1)}>Anterior</Button>
        <span className="text-sm">Página {page} · {result.total} encontrado(s)</span><Button type="button" variant="outline" disabled={page * 25 >= result.total || pending} onClick={() => search(page + 1)}>Próxima</Button></div>
    </>}
  </section>
}

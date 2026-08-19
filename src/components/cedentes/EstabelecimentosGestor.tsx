'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { configurarRequisitoEstabelecimento, decidirEstabelecimento } from '@/lib/actions/estabelecimento'
import type { CedenteEstabelecimento, CedenteEstabelecimentoRequisito } from '@/types/database'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Tipo = { id: string; nome: string; codigo: string }

export function EstabelecimentosGestor({ cedenteId }: { cedenteId: string }) {
  const notifications = useNotifications()
  const [rows, setRows] = useState<CedenteEstabelecimento[]>([])
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [requisitos, setRequisitos] = useState<CedenteEstabelecimentoRequisito[]>([])
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data, error }, { data: tipoRows }] = await Promise.all([
      supabase.from('cedente_estabelecimentos').select('*').eq('cedente_id', cedenteId).order('tipo').order('razao_social'),
      supabase.from('documento_tipos').select('id, nome, codigo').eq('ativo', true).eq('dominio', 'cadastro').order('nome').limit(100),
    ])
    if (error) notifications.error(`Nao foi possivel carregar os estabelecimentos: ${error.message}`)
    const estabelecimentos = (data || []) as CedenteEstabelecimento[]
    setRows(estabelecimentos)
    setTipos((tipoRows || []) as Tipo[])

    const ids = estabelecimentos.map((row) => row.id)
    if (ids.length) {
      const { data: requisitoRows } = await supabase
        .from('cedente_estabelecimento_requisitos')
        .select('*')
        .in('estabelecimento_id', ids)
        .order('created_at')
      setRequisitos((requisitoRows || []) as CedenteEstabelecimentoRequisito[])
    } else {
      setRequisitos([])
    }
  }, [cedenteId, notifications])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const run = (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData) => {
    startTransition(async () => {
      const result = await action(form)
      notifications.fromActionResult(result)
      if (result.success) await load()
    })
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b p-4"><span className="rounded-lg bg-muted p-2"><Building2 className="h-4 w-4" /></span><div><h2 className="font-semibold">CNPJs / Estabelecimentos</h2><p className="text-xs text-muted-foreground">A filial herda os fundos do cedente, mas possui aprovação, conta e checklist próprios.</p></div></div>
      <div className="divide-y">
        {rows.map((row) => (
          <div key={row.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="truncate font-medium" title={row.razao_social}>{row.razao_social}</p><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{row.tipo}</span></div><p className="font-mono text-xs text-muted-foreground">{row.cnpj}</p></div><span className="rounded-full border px-2 py-1 text-xs">{row.status}</span></div>
            <div className="flex flex-wrap gap-2">
              {row.status === 'pendente' && <Button size="sm" disabled={pending} onClick={() => { const form = new FormData(); form.set('estabelecimento_id', row.id); form.set('acao', 'aprovar'); run(decidirEstabelecimento, form) }}>Aprovar</Button>}
              {row.status === 'pendente' && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('estabelecimento_id', row.id); form.set('acao', 'rejeitar'); run(decidirEstabelecimento, form) }}><Input className="h-9" name="motivo" placeholder="Motivo da rejeicao" required /><Button type="submit" size="sm" variant="destructive" disabled={pending}>Rejeitar</Button></form>}
              {row.status === 'aprovado' && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('estabelecimento_id', row.id); form.set('acao', 'suspender'); run(decidirEstabelecimento, form) }}><Input className="h-9" name="motivo" placeholder="Motivo da suspensao" required /><Button type="submit" size="sm" variant="destructive" disabled={pending}>Suspender</Button></form>}
              {row.status === 'suspenso' && <Button size="sm" disabled={pending} onClick={() => { const form = new FormData(); form.set('estabelecimento_id', row.id); form.set('acao', 'reativar'); run(decidirEstabelecimento, form) }}>Reativar</Button>}
            </div>
            {requisitos.filter((requisito) => requisito.estabelecimento_id === row.id).length > 0 && (
              <ul className="space-y-1">
                {requisitos.filter((requisito) => requisito.estabelecimento_id === row.id).map((requisito) => {
                  const tipo = tipos.find((item) => item.id === requisito.documento_tipo_id)
                  return (
                    <li key={requisito.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate">{tipo?.nome || 'Tipo documental removido do catalogo'}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-muted px-2 py-0.5">{requisito.obrigatorio ? 'Obrigatorio' : 'Opcional'}</span>
                        <span className={`rounded-full px-2 py-0.5 ${requisito.ativo ? 'bg-success/15 text-success-foreground' : 'bg-muted text-muted-foreground'}`}>{requisito.ativo ? 'Ativo' : 'Inativo'}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          disabled={pending}
                          onClick={() => {
                            const form = new FormData()
                            form.set('estabelecimento_id', row.id)
                            form.set('documento_tipo_id', requisito.documento_tipo_id)
                            form.set('obrigatorio', String(requisito.obrigatorio))
                            form.set('ativo', String(!requisito.ativo))
                            run(configurarRequisitoEstabelecimento, form)
                          }}
                        >
                          {requisito.ativo ? 'Desativar' : 'Reativar'}
                        </Button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('estabelecimento_id', row.id); run(configurarRequisitoEstabelecimento, form) }}>
              <select name="documento_tipo_id" required className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Adicionar documento cadastral obrigatorio...</option>{tipos.map((tipo) => <option key={tipo.id} value={tipo.id}>{tipo.nome}</option>)}</select>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>Configurar requisito</Button>
            </form>
          </div>
        ))}
        {!rows.length && <p className="p-4 text-sm text-muted-foreground">Nenhum estabelecimento visivel no fundo ativo.</p>}
      </div>
    </section>
  )
}

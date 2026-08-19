'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Building2, Landmark, Plus } from 'lucide-react'
import { cadastrarFilial, enviarDocumentoEstabelecimento, listarMeusEstabelecimentos, salvarContaEstabelecimento } from '@/lib/actions/estabelecimento'
import type { CedenteEstabelecimento, CedenteEstabelecimentoContaBancaria, CedenteEstabelecimentoRequisito } from '@/types/database'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type State = {
  estabelecimentos: CedenteEstabelecimento[]
  contas: CedenteEstabelecimentoContaBancaria[]
  requisitos: CedenteEstabelecimentoRequisito[]
  tipos: Array<{ id: string; codigo: string; nome: string }>
}

const statusLabel: Record<CedenteEstabelecimento['status'], string> = {
  rascunho: 'Rascunho', pendente: 'Em analise', aprovado: 'Aprovado', rejeitado: 'Rejeitado', suspenso: 'Suspenso',
}

export function MeusEstabelecimentosClient() {
  const notifications = useNotifications()
  const [state, setState] = useState<State>({ estabelecimentos: [], contas: [], requisitos: [], tipos: [] })
  const [loading, setLoading] = useState(true)
  const [showBranch, setShowBranch] = useState(false)
  const [pending, startTransition] = useTransition()

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listarMeusEstabelecimentos()
    if (result.success && result.data) setState(result.data)
    else notifications.error(result.message)
    setLoading(false)
  }, [notifications])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const submit = (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData, done?: () => void) => {
    startTransition(async () => {
      const result = await action(form)
      notifications.fromActionResult(result)
      if (result.success) {
        done?.()
        await load()
      }
    })
  }

  const matriz = state.estabelecimentos.find((item) => item.tipo === 'matriz')
  const podeCadastrar = matriz?.status === 'aprovado' && matriz.ativo

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Cadastro empresarial</p>
          <h1 className="text-2xl font-bold">Meus CNPJs</h1>
          <p className="text-sm text-muted-foreground">A matriz e suas filiais pertencem ao mesmo relacionamento comercial, com contas e documentos próprios.</p>
        </div>
        <Button disabled={!podeCadastrar} onClick={() => setShowBranch((value) => !value)}><Plus className="mr-2 h-4 w-4" />Cadastrar filial</Button>
      </header>

      {!podeCadastrar && matriz && <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">A matriz precisa estar ativa e aprovada antes do cadastro de novas filiais.</div>}

      {showBranch && (
        <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); submit(cadastrarFilial, new FormData(event.currentTarget), () => setShowBranch(false)) }}>
          <Input name="cnpj" placeholder="CNPJ da filial" required maxLength={18} />
          <Input name="razao_social" placeholder="Razao social" required />
          <Input name="nome_fantasia" placeholder="Nome fantasia (opcional)" />
          <div className="flex gap-2 md:col-span-3 md:justify-end"><Button type="button" variant="outline" onClick={() => setShowBranch(false)}>Cancelar</Button><Button type="submit" disabled={pending}>Enviar para analise</Button></div>
        </form>
      )}

      {loading ? <div className="rounded-xl border p-8 text-center text-muted-foreground">Carregando estabelecimentos...</div> : (
        <div className="space-y-4">
          {state.estabelecimentos.map((item) => {
            const conta = state.contas.find((entry) => entry.estabelecimento_id === item.id && entry.principal)
            const requisitos = state.requisitos.filter((entry) => entry.estabelecimento_id === item.id)
            return (
              <section key={item.id} className="overflow-hidden rounded-xl border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                  <div className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-muted p-2"><Building2 className="h-5 w-5" /></span><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate font-semibold">{item.razao_social}</h2><span className="rounded-full bg-muted px-2 py-0.5 text-xs">{item.tipo === 'matriz' ? 'Matriz' : 'Filial'}</span></div><p className="font-mono text-xs text-muted-foreground">{item.cnpj}</p></div></div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.status === 'aprovado' ? 'bg-success/15 text-success-foreground' : item.status === 'rejeitado' || item.status === 'suspenso' ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning-foreground'}`}>{statusLabel[item.status]}</span>
                </div>
                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  <div className="rounded-lg border p-3"><div className="mb-2 flex items-center gap-2 font-medium"><Landmark className="h-4 w-4" />Conta bancaria própria</div>{conta ? <p className="text-sm">{conta.banco} · Ag. {conta.agencia} · Conta {conta.conta}</p> : <p className="text-sm text-muted-foreground">Nenhuma conta principal cadastrada.</p>}</div>
                  <div className="space-y-2 rounded-lg border p-3"><p className="font-medium">Checklist documental</p>{requisitos.length ? requisitos.map((requisito) => { const tipo = state.tipos.find((entry) => entry.id === requisito.documento_tipo_id); return <form key={requisito.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2" onSubmit={(event) => { event.preventDefault(); submit(enviarDocumentoEstabelecimento, new FormData(event.currentTarget)) }}><input type="hidden" name="estabelecimento_id" value={item.id} /><input type="hidden" name="requisito_id" value={requisito.id} /><input type="hidden" name="documento_tipo_id" value={requisito.documento_tipo_id} /><span className="min-w-0 flex-1 truncate text-sm">{tipo?.nome || 'Documento'} {requisito.obrigatorio ? '(obrigatorio)' : '(opcional)'}</span><Input className="h-8 w-full sm:w-56" type="file" name="arquivo" required /><Button type="submit" size="sm" variant="outline" disabled={pending}>Enviar</Button></form> }) : <p className="text-sm text-muted-foreground">Nenhum requisito configurado.</p>}</div>
                  <form className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-5" onSubmit={(event) => { event.preventDefault(); submit(salvarContaEstabelecimento, new FormData(event.currentTarget)) }}>
                    <input type="hidden" name="estabelecimento_id" value={item.id} />
                    <Input name="banco" placeholder="Banco" required defaultValue={conta?.banco || ''} />
                    <Input name="agencia" placeholder="Agencia" required defaultValue={conta?.agencia || ''} />
                    <Input name="conta" placeholder="Conta" required defaultValue={conta?.conta || ''} />
                    <Input name="tipo_conta" placeholder="Tipo de conta" required defaultValue={conta?.tipo_conta || 'corrente'} />
                    <Button type="submit" disabled={pending}>Salvar conta</Button>
                  </form>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}

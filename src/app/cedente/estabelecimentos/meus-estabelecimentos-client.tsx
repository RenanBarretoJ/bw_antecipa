'use client'

import { Fragment, useEffect, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, ExternalLink, Landmark, Plus, Search } from 'lucide-react'
import {
  cadastrarFilial,
  carregarDetalheEstabelecimento,
  enviarDocumentoEstabelecimento,
  obterStatusMatriz,
  obterUrlDocumentoRequisito,
  salvarContaEstabelecimento,
} from '@/lib/actions/estabelecimento'
import type { CedenteEstabelecimentoContaBancaria, EstabelecimentoRequisitoStatus } from '@/types/database'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DataTableContainer, EmptyState, ListNameCell, StatusBadge } from '@/components/data-display/primitives'
import { ListPagination } from '@/components/pagination'
import { buildListUrl } from '@/lib/pagination'
import {
  PENDENCIA_LABEL,
  type FiltrosEstabelecimentos,
  type ResultadoEstabelecimentos,
} from '@/lib/cedentes/estabelecimentos-listagem'

const statusLabel: Record<string, string> = {
  rascunho: 'Rascunho', pendente: 'Em analise', aprovado: 'Aprovado', rejeitado: 'Rejeitado', suspenso: 'Suspenso',
}
const requisitoStatusLabel: Record<string, string> = {
  pendente: 'Pendente', enviado: 'Enviado', em_analise: 'Em analise', aprovado: 'Aprovado',
  rejeitado: 'Rejeitado', substituido: 'Substituido', cancelado: 'Cancelado',
}

type Detalhe = { requisitos: EstabelecimentoRequisitoStatus[]; contas: CedenteEstabelecimentoContaBancaria[] }

export function MeusEstabelecimentosClient({ filtros, resultado }: {
  filtros: FiltrosEstabelecimentos
  resultado: ResultadoEstabelecimentos
}) {
  const notifications = useNotifications()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [pendingAction, startActionTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.q)
  const [showBranch, setShowBranch] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<Record<string, Detalhe>>({})
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null)
  const [matriz, setMatriz] = useState<{ id: string; status: string; ativo: boolean } | null>(null)
  const [permiteCadastroFiliais, setPermiteCadastroFiliais] = useState(false)

  useEffect(() => {
    void obterStatusMatriz().then((result) => {
      if (result.success && result.data) {
        setMatriz(result.data.matriz)
        setPermiteCadastroFiliais(result.data.permiteCadastroFiliais)
      }
    })
  }, [])

  const current = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, current, updates)))
  }

  useEffect(() => {
    if (busca === filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.q])

  const matrizAprovada = matriz?.status === 'aprovado' && matriz.ativo
  const podeCadastrar = matrizAprovada && permiteCadastroFiliais

  const alternarExpansao = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!detalhes[id]) {
      setCarregandoDetalhe(id)
      void carregarDetalheEstabelecimento(id).then((result) => {
        if (result.success && result.data) setDetalhes((prev) => ({ ...prev, [id]: result.data as Detalhe }))
        else notifications.error(result.message)
        setCarregandoDetalhe(null)
      })
    }
  }

  const recarregarDetalhe = (id: string) => {
    void carregarDetalheEstabelecimento(id).then((result) => {
      if (result.success && result.data) setDetalhes((prev) => ({ ...prev, [id]: result.data as Detalhe }))
    })
  }

  const submit = (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData, done?: () => void) => {
    startActionTransition(async () => {
      const result = await action(form)
      notifications.fromActionResult(result)
      if (result.success) {
        done?.()
        router.refresh()
        if (expandedId) recarregarDetalhe(expandedId)
        void obterStatusMatriz().then((r) => {
          if (r.success && r.data) {
            setMatriz(r.data.matriz)
            setPermiteCadastroFiliais(r.data.permiteCadastroFiliais)
          }
        })
      }
    })
  }

  const verDocumento = (estabelecimentoId: string, requisito: EstabelecimentoRequisitoStatus) => {
    void obterUrlDocumentoRequisito({
      estabelecimentoId,
      documentoVersaoId: requisito.documento_versao_id,
      documentoLegadoId: requisito.documento_legado_id,
    }).then((result) => {
      if (result.success && result.data) window.open(result.data.url, '_blank', 'noopener,noreferrer')
      else notifications.error(result.message)
    })
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Cadastro empresarial</p>
          <h1 className="text-2xl font-bold">Meus CNPJs</h1>
          <p className="text-sm text-muted-foreground">A matriz e suas filiais pertencem ao mesmo relacionamento comercial, com contas e documentos proprios.</p>
        </div>
        {podeCadastrar && <Button onClick={() => setShowBranch((value) => !value)}><Plus className="mr-2 h-4 w-4" />Cadastrar filial</Button>}
      </header>

      {!matrizAprovada && matriz && <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">A matriz precisa estar ativa e aprovada antes do cadastro de novas filiais.</div>}
      {matrizAprovada && !permiteCadastroFiliais && <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">O cadastro de novas Filiais esta desabilitado pela Gestora.</div>}

      {showBranch && (
        <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); submit(cadastrarFilial, new FormData(event.currentTarget), () => setShowBranch(false)) }}>
          <Input name="cnpj" placeholder="CNPJ da filial" required maxLength={18} />
          <Input name="razao_social" placeholder="Razao social" required />
          <Input name="nome_fantasia" placeholder="Nome fantasia (opcional)" />
          <div className="flex gap-2 md:col-span-3 md:justify-end"><Button type="button" variant="outline" onClick={() => setShowBranch(false)}>Cancelar</Button><Button type="submit" disabled={pendingAction}>Enviar para analise</Button></div>
        </form>
      )}

      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(event) => setBusca(event.target.value)} className="pl-9" placeholder="Buscar por CNPJ ou razao social..." />
        </div>
        <Select value={filtros.tipo || 'todos'} onValueChange={(value) => navegar({ tipo: value === 'todos' ? null : value, page: 1 })}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            <SelectItem value="matriz">Matriz</SelectItem>
            <SelectItem value="filial">Filial</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtros.status || 'todos'} onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="rascunho">Rascunho</SelectItem>
            <SelectItem value="pendente">Em analise</SelectItem>
            <SelectItem value="aprovado">Aprovado</SelectItem>
            <SelectItem value="rejeitado">Rejeitado</SelectItem>
            <SelectItem value="suspenso">Suspenso</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtros.pendencia || 'todos'} onValueChange={(value) => navegar({ pendencia: value === 'todos' ? null : value, page: 1 })}>
          <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Pendencia documental: Todos</SelectItem>
            {Object.entries(PENDENCIA_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <DataTableContainer className={isPending ? 'opacity-70' : undefined}>
        {resultado.items.length === 0 ? (
          <EmptyState title="Nenhum estabelecimento encontrado" description="Ajuste os filtros ou cadastre uma nova filial." />
        ) : (
          <Table className="table-fixed">
            <TableHeader><TableRow>
              <TableHead className="w-[26%]">Estabelecimento</TableHead><TableHead className="w-[9%]">Tipo</TableHead><TableHead className="w-[11%]">Status</TableHead>
              <TableHead className="w-[13%]">Documentos</TableHead><TableHead className="w-[9%]">Conta</TableHead><TableHead className="w-[18%]">Pendencia</TableHead><TableHead className="w-[14%] text-right">Detalhes</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {resultado.items.map((item) => (
                <Fragment key={item.id}>
                  <TableRow>
                    <TableCell className="truncate"><ListNameCell name={item.razaoSocial} subline={item.cnpj} /></TableCell>
                    <TableCell>{item.tipo === 'matriz' ? 'Matriz' : 'Filial'}</TableCell>
                    <TableCell><StatusBadge status={item.status} label={statusLabel[item.status]} /></TableCell>
                    <TableCell className="tabular-nums">{item.aprovadosObrigatorios}/{item.totalObrigatorios} aprovados</TableCell>
                    <TableCell>{item.temContaPrincipal ? <span className="text-success-foreground">OK</span> : <span className="text-warning-foreground">Pendente</span>}</TableCell>
                    <TableCell className="truncate">{item.pendencia !== 'completo' && <StatusBadge status={item.pendencia} label={PENDENCIA_LABEL[item.pendencia]} />}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => alternarExpansao(item.id)} aria-expanded={expandedId === item.id}>
                        Ver detalhes{expandedId === item.id ? <ChevronUp className="ml-1 size-4" /> : <ChevronDown className="ml-1 size-4" />}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedId === item.id && (
                    <TableRow>
                      <TableCell colSpan={7} className="whitespace-normal bg-muted/30 p-4 align-top">
                        {carregandoDetalhe === item.id ? (
                          <p className="text-sm text-muted-foreground">Carregando detalhes...</p>
                        ) : detalhes[item.id] ? (
                          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                            <ContaBancariaSection estabelecimentoId={item.id} conta={detalhes[item.id].contas.find((c) => c.principal)} pending={pendingAction} onSubmit={submit} />
                            <ChecklistSection estabelecimentoId={item.id} requisitos={detalhes[item.id].requisitos} pending={pendingAction} onSubmit={submit} onVerDocumento={verDocumento} />
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
        <ListPagination className="border-t px-4 py-3" pagination={resultado.pagination} disabled={isPending} onPageChange={(page) => navegar({ page })} onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })} />
      </DataTableContainer>
    </main>
  )
}

function ContaBancariaSection({ estabelecimentoId, conta, pending, onSubmit }: {
  estabelecimentoId: string
  conta: CedenteEstabelecimentoContaBancaria | undefined
  pending: boolean
  onSubmit: (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData) => void
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center gap-2 font-medium"><Landmark className="h-4 w-4" />Conta bancaria propria</div>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(salvarContaEstabelecimento, new FormData(event.currentTarget)) }}>
        <input type="hidden" name="estabelecimento_id" value={estabelecimentoId} />
        <Input name="banco" placeholder="Banco" required defaultValue={conta?.banco || ''} />
        <Input name="agencia" placeholder="Agencia" required defaultValue={conta?.agencia || ''} />
        <Input name="conta" placeholder="Conta" required defaultValue={conta?.conta || ''} />
        <Input name="tipo_conta" placeholder="Tipo de conta" required defaultValue={conta?.tipo_conta || 'corrente'} />
        <Button type="submit" className="sm:col-span-2" disabled={pending}>Salvar conta</Button>
      </form>
    </div>
  )
}

function ChecklistSection({ estabelecimentoId, requisitos, pending, onSubmit, onVerDocumento }: {
  estabelecimentoId: string
  requisitos: EstabelecimentoRequisitoStatus[]
  pending: boolean
  onSubmit: (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData) => void
  onVerDocumento: (estabelecimentoId: string, requisito: EstabelecimentoRequisitoStatus) => void
}) {
  const requisitosAtivos = requisitos.filter((requisito) => requisito.ativo)
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">Checklist documental</p>
      {requisitosAtivos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum requisito configurado.</p> : requisitosAtivos.map((requisito) => (
        <div key={requisito.requisito_id} className="space-y-2 rounded-md bg-muted/40 p-3">
          <p className="text-sm font-medium">{requisito.documento_tipo_nome} {requisito.obrigatorio ? '(obrigatorio)' : '(opcional)'}</p>
          {requisito.origem === 'cadastro_inicial' && <p className="text-xs text-info-foreground">Aprovado - Origem: Cadastro inicial</p>}
          {requisito.motivo && <p className="text-xs text-destructive">Motivo: {requisito.motivo}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={requisito.status} label={requisitoStatusLabel[requisito.status] || requisito.status} />
            {(requisito.documento_versao_id || requisito.documento_legado_id) && (
              <Button type="button" size="sm" variant="outline" onClick={() => onVerDocumento(estabelecimentoId, requisito)}>
                Ver documento<ExternalLink className="ml-1 size-3" />
              </Button>
            )}
          </div>
          {requisito.status !== 'aprovado' && (
            <form className="flex flex-wrap items-center gap-2 border-t pt-2" onSubmit={(event) => { event.preventDefault(); onSubmit(enviarDocumentoEstabelecimento, new FormData(event.currentTarget)) }}>
              <input type="hidden" name="estabelecimento_id" value={estabelecimentoId} />
              <input type="hidden" name="requisito_id" value={requisito.requisito_id} />
              <input type="hidden" name="documento_tipo_id" value={requisito.documento_tipo_id} />
              <Input className="h-8 w-full sm:w-56" type="file" name="arquivo" required />
              <Button type="submit" size="sm" variant="outline" disabled={pending}>Enviar</Button>
            </form>
          )}
        </div>
      ))}
    </div>
  )
}

'use client'

import { Fragment, useEffect, useState, useTransition } from 'react'
import { Building2, ChevronDown, ChevronUp, ExternalLink, Search } from 'lucide-react'
import {
  analisarDocumentoEstabelecimento,
  carregarDetalheEstabelecimento,
  configurarRequisitoEstabelecimento,
  decidirEstabelecimento,
  listarEstabelecimentosGestor,
  obterUrlDocumentoRequisito,
} from '@/lib/actions/estabelecimento'
import { createClient } from '@/lib/supabase/client'
import type { CedenteEstabelecimentoContaBancaria, EstabelecimentoRequisitoStatus } from '@/types/database'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DataTableContainer, EmptyState, ListNameCell, LoadingState, StatusBadge } from '@/components/data-display/primitives'
import { ListPagination } from '@/components/pagination'
import { buildPaginatedResult, DEFAULT_PAGE, DEFAULT_PAGE_SIZE, type AllowedPageSize } from '@/lib/pagination'
import {
  PENDENCIA_LABEL,
  type EstabelecimentoPendenciaFiltro,
  type EstabelecimentoStatusFiltro,
  type EstabelecimentoTipoFiltro,
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
type Tipo = { id: string; nome: string; codigo: string }
type Detalhe = { requisitos: EstabelecimentoRequisitoStatus[]; contas: CedenteEstabelecimentoContaBancaria[] }

const RESULTADO_VAZIO: ResultadoEstabelecimentos = buildPaginatedResult([], { page: DEFAULT_PAGE, pageSize: DEFAULT_PAGE_SIZE, total: 0 })

export function EstabelecimentosGestor({ cedenteId }: { cedenteId: string }) {
  const notifications = useNotifications()
  const [resultado, setResultado] = useState<ResultadoEstabelecimentos>(RESULTADO_VAZIO)
  const [loading, setLoading] = useState(true)
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [pending, startTransition] = useTransition()
  const [filtros, setFiltros] = useState<FiltrosEstabelecimentos>({ page: 1, pageSize: 10, q: '', tipo: null, status: null, pendencia: null })
  const [busca, setBusca] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detalhes, setDetalhes] = useState<Record<string, Detalhe>>({})
  const [carregandoDetalhe, setCarregandoDetalhe] = useState<string | null>(null)

  const carregar = (novosFiltros: FiltrosEstabelecimentos) => {
    void listarEstabelecimentosGestor(cedenteId, novosFiltros).then((result) => {
      if (result.success && result.data) setResultado(result.data)
      else notifications.error(result.message)
      setLoading(false)
    })
  }

  useEffect(() => {
    carregar(filtros)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros])

  useEffect(() => {
    const supabase = createClient()
    void supabase.from('documento_tipos').select('id, nome, codigo').eq('ativo', true).eq('dominio', 'cadastro').order('nome').limit(100)
      .then(({ data }) => setTipos((data || []) as Tipo[]))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      setFiltros((prev) => ({ ...prev, q: busca, page: 1 }))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [busca])

  const alterarFiltros = (updates: Partial<FiltrosEstabelecimentos>) => {
    setLoading(true)
    setFiltros((prev) => ({ ...prev, ...updates }))
  }

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

  const run = (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData, estabelecimentoId?: string) => {
    startTransition(async () => {
      const result = await action(form)
      notifications.fromActionResult(result)
      if (result.success) {
        carregar(filtros)
        if (estabelecimentoId) recarregarDetalhe(estabelecimentoId)
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
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b p-4">
        <span className="rounded-lg bg-muted p-2"><Building2 className="h-4 w-4" /></span>
        <div><h2 className="font-semibold">CNPJs / Estabelecimentos</h2><p className="text-xs text-muted-foreground">A filial herda os fundos do cedente, mas possui aprovacao, conta e checklist proprios.</p></div>
      </div>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(event) => setBusca(event.target.value)} className="h-9 pl-9" placeholder="Buscar por CNPJ ou razao social..." />
        </div>
        <Select value={filtros.tipo || 'todos'} onValueChange={(value) => alterarFiltros({ tipo: value === 'todos' ? null : (value as EstabelecimentoTipoFiltro), page: 1 })}>
          <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos os tipos</SelectItem><SelectItem value="matriz">Matriz</SelectItem><SelectItem value="filial">Filial</SelectItem></SelectContent>
        </Select>
        <Select value={filtros.status || 'todos'} onValueChange={(value) => alterarFiltros({ status: value === 'todos' ? null : (value as EstabelecimentoStatusFiltro), page: 1 })}>
          <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="rascunho">Rascunho</SelectItem><SelectItem value="pendente">Em analise</SelectItem>
            <SelectItem value="aprovado">Aprovado</SelectItem><SelectItem value="rejeitado">Rejeitado</SelectItem><SelectItem value="suspenso">Suspenso</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtros.pendencia || 'todos'} onValueChange={(value) => alterarFiltros({ pendencia: value === 'todos' ? null : (value as EstabelecimentoPendenciaFiltro), page: 1 })}>
          <SelectTrigger className="h-9 w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Documentacao: Todos</SelectItem>
            {Object.entries(PENDENCIA_LABEL).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? <LoadingState label="Carregando estabelecimentos..." /> : (
        <DataTableContainer>
          {resultado.items.length === 0 ? (
            <EmptyState title="Nenhum estabelecimento encontrado" description="Ajuste os filtros para este cedente." />
          ) : (
            <Table className="table-fixed">
              <TableHeader><TableRow>
                <TableHead className="w-[26%]">Estabelecimento</TableHead><TableHead className="w-[9%]">Tipo</TableHead><TableHead className="w-[11%]">Status</TableHead>
                <TableHead className="w-[13%]">Documentos</TableHead><TableHead className="w-[9%]">Conta</TableHead><TableHead className="w-[18%]">Pendencia</TableHead><TableHead className="w-[14%] text-right">Detalhes</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {resultado.items.map((row) => (
                  <Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="truncate"><ListNameCell name={row.razaoSocial} subline={row.cnpj} /></TableCell>
                      <TableCell>{row.tipo === 'matriz' ? 'Matriz' : 'Filial'}</TableCell>
                      <TableCell><StatusBadge status={row.status} label={statusLabel[row.status]} /></TableCell>
                      <TableCell className="tabular-nums">{row.aprovadosObrigatorios}/{row.totalObrigatorios} aprovados</TableCell>
                      <TableCell>{row.temContaPrincipal ? <span className="text-success-foreground">OK</span> : <span className="text-warning-foreground">Pendente</span>}</TableCell>
                      <TableCell className="truncate">{row.pendencia !== 'completo' && <StatusBadge status={row.pendencia} label={PENDENCIA_LABEL[row.pendencia]} />}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => alternarExpansao(row.id)} aria-expanded={expandedId === row.id}>
                          Ver detalhes{expandedId === row.id ? <ChevronUp className="ml-1 size-4" /> : <ChevronDown className="ml-1 size-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedId === row.id && (
                      <TableRow>
                        <TableCell colSpan={7} className="whitespace-normal bg-muted/30 p-4 align-top">
                          {carregandoDetalhe === row.id ? (
                            <p className="text-sm text-muted-foreground">Carregando detalhes...</p>
                          ) : detalhes[row.id] ? (
                            <div className="space-y-4">
                              <DecisaoSection estabelecimentoId={row.id} status={row.status} pending={pending} onRun={run} />
                              <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                                <ContaSection contas={detalhes[row.id].contas} />
                                <ChecklistGestorSection
                                  estabelecimentoId={row.id}
                                  requisitos={detalhes[row.id].requisitos}
                                  tipos={tipos}
                                  pending={pending}
                                  onRun={run}
                                  onVerDocumento={verDocumento}
                                />
                              </div>
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
          <ListPagination
            className="border-t px-4 py-3"
            pagination={resultado.pagination}
            disabled={loading}
            onPageChange={(page) => alterarFiltros({ page })}
            onPageSizeChange={(pageSize) => alterarFiltros({ pageSize: pageSize as AllowedPageSize, page: 1 })}
          />
        </DataTableContainer>
      )}
    </section>
  )
}

function DecisaoSection({ estabelecimentoId, status, pending, onRun }: {
  estabelecimentoId: string
  status: string
  pending: boolean
  onRun: (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData, estabelecimentoId?: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'pendente' && <Button size="sm" disabled={pending} onClick={() => { const form = new FormData(); form.set('estabelecimento_id', estabelecimentoId); form.set('acao', 'aprovar'); onRun(decidirEstabelecimento, form, estabelecimentoId) }}>Aprovar</Button>}
      {status === 'pendente' && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('estabelecimento_id', estabelecimentoId); form.set('acao', 'rejeitar'); onRun(decidirEstabelecimento, form, estabelecimentoId) }}><Input className="h-9" name="motivo" placeholder="Motivo da rejeicao" required /><Button type="submit" size="sm" variant="destructive" disabled={pending}>Rejeitar</Button></form>}
      {status === 'aprovado' && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('estabelecimento_id', estabelecimentoId); form.set('acao', 'suspender'); onRun(decidirEstabelecimento, form, estabelecimentoId) }}><Input className="h-9" name="motivo" placeholder="Motivo da suspensao" required /><Button type="submit" size="sm" variant="destructive" disabled={pending}>Suspender</Button></form>}
      {status === 'suspenso' && <Button size="sm" disabled={pending} onClick={() => { const form = new FormData(); form.set('estabelecimento_id', estabelecimentoId); form.set('acao', 'reativar'); onRun(decidirEstabelecimento, form, estabelecimentoId) }}>Reativar</Button>}
    </div>
  )
}

function ContaSection({ contas }: { contas: CedenteEstabelecimentoContaBancaria[] }) {
  const principal = contas.find((conta) => conta.principal)
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 font-medium">Conta bancaria</p>
      {principal ? <p className="text-sm">{principal.banco} - Ag. {principal.agencia} - Conta {principal.conta}</p> : <p className="text-sm text-warning-foreground">Nenhuma conta principal cadastrada.</p>}
    </div>
  )
}

function ChecklistGestorSection({ estabelecimentoId, requisitos, tipos, pending, onRun, onVerDocumento }: {
  estabelecimentoId: string
  requisitos: EstabelecimentoRequisitoStatus[]
  tipos: Tipo[]
  pending: boolean
  onRun: (action: (form: FormData) => Promise<{ success: boolean; message: string }>, form: FormData, estabelecimentoId?: string) => void
  onVerDocumento: (estabelecimentoId: string, requisito: EstabelecimentoRequisitoStatus) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="font-medium">Checklist documental</p>
      {requisitos.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum requisito configurado.</p> : requisitos.map((requisito) => (
        <div key={requisito.requisito_id} className="space-y-2 rounded-md bg-muted/40 p-3">
          <p className="text-sm font-medium">{requisito.documento_tipo_nome}</p>
          {requisito.origem === 'cadastro_inicial' && <p className="text-xs text-info-foreground">Aprovado - Origem: Cadastro inicial</p>}
          {requisito.motivo && <p className="text-xs text-destructive">Motivo: {requisito.motivo}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{requisito.obrigatorio ? 'Obrigatorio' : 'Opcional'}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${requisito.ativo ? 'bg-success/15 text-success-foreground' : 'bg-muted text-muted-foreground'}`}>{requisito.ativo ? 'Ativo' : 'Inativo'}</span>
            <StatusBadge status={requisito.status} label={requisitoStatusLabel[requisito.status] || requisito.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(requisito.documento_versao_id || requisito.documento_legado_id) && (
              <Button type="button" size="sm" variant="outline" onClick={() => onVerDocumento(estabelecimentoId, requisito)}>Ver documento<ExternalLink className="ml-1 size-3" /></Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                const form = new FormData()
                form.set('estabelecimento_id', estabelecimentoId)
                form.set('documento_tipo_id', requisito.documento_tipo_id)
                form.set('obrigatorio', String(requisito.obrigatorio))
                form.set('ativo', String(!requisito.ativo))
                onRun(configurarRequisitoEstabelecimento, form, estabelecimentoId)
              }}
            >
              {requisito.ativo ? 'Desativar' : 'Reativar'}
            </Button>
          </div>
          {requisito.documento_versao_id && requisito.status !== 'aprovado' && requisito.origem === 'estabelecimento' && (
            <form
              className="flex flex-wrap items-center gap-2 border-t pt-2"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                form.set('documento_versao_id', requisito.documento_versao_id as string)
                onRun(analisarDocumentoEstabelecimento, form, estabelecimentoId)
              }}
            >
              <Input className="h-8 w-full sm:w-64" name="observacoes" placeholder="Motivo (obrigatorio para reprovar/ajuste)" />
              <Button type="button" size="sm" disabled={pending} onClick={(event) => submeterAnalise(event, 'aprovado')}>Aprovar</Button>
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={(event) => submeterAnalise(event, 'requer_ajuste')}>Pedir ajuste</Button>
              <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={(event) => submeterAnalise(event, 'rejeitado')}>Reprovar</Button>
            </form>
          )}
        </div>
      ))}
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); form.set('estabelecimento_id', estabelecimentoId); onRun(configurarRequisitoEstabelecimento, form, estabelecimentoId) }}>
        <select name="documento_tipo_id" required className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="">Adicionar documento cadastral obrigatorio...</option>
          {tipos.map((tipo) => <option key={tipo.id} value={tipo.id}>{tipo.nome}</option>)}
        </select>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>Configurar requisito</Button>
      </form>
    </div>
  )
}

function submeterAnalise(event: { currentTarget: HTMLButtonElement }, resultado: 'aprovado' | 'rejeitado' | 'requer_ajuste') {
  const form = event.currentTarget.form
  if (!form) return
  const hiddenResultado = form.querySelector<HTMLInputElement>('input[name="resultado"]') || document.createElement('input')
  hiddenResultado.type = 'hidden'
  hiddenResultado.name = 'resultado'
  hiddenResultado.value = resultado
  if (!hiddenResultado.isConnected) form.appendChild(hiddenResultado)
  form.requestSubmit()
}

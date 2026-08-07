'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'
import {
  AlertTriangle, CheckCircle2, Clock3, Download, Eye, FileText,
  PackageCheck, Search, Truck, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import type {
  CentralLogisticaData, CteLogisticoResumo, DocumentoLogisticoCentral,
  LogisticaNfResumo, PendenciaLogistica,
} from '@/lib/logistica/central/tipos'

const STATUS_LABEL = {
  ENTREGUE: 'Entregue', EM_TRANSITO: 'Em trânsito', INDETERMINADA: 'Indeterminada',
  NAO_ENVIADO: 'Não enviado', AGUARDANDO_ANALISE: 'Aguardando análise',
  APROVADO: 'Aprovado', REJEITADO: 'Rejeitado',
} as const

const MOMENTO_LABEL = {
  ANTECIPADO: 'Antecipado', POS_CESSAO: 'Pós-cessão', INDETERMINADO: 'Indeterminado', MISTO: 'Misto',
} as const

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'success' | 'info' | 'warning' | 'danger' | 'neutral' }) {
  const cores = {
    success: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
    info: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
    warning: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300',
    danger: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
    neutral: 'bg-muted text-muted-foreground',
  }
  return <span className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-xs font-medium ${cores[tone]}`}>{children}</span>
}

function toneStatus(status: string) {
  if (status === 'ENTREGUE' || status === 'APROVADO') return 'success' as const
  if (status === 'EM_TRANSITO' || status === 'AGUARDANDO_ANALISE') return 'info' as const
  if (status === 'REJEITADO') return 'danger' as const
  return 'warning' as const
}

function statusDocumento(documento: DocumentoLogisticoCentral) {
  return <Badge tone={toneStatus(documento.status)}>{STATUS_LABEL[documento.status]}</Badge>
}

function queryHref(data: CentralLogisticaData, updates: Record<string, string | null>) {
  const filtros = data.filtros
  const params = new URLSearchParams()
  const atuais: Record<string, string | number | null> = {
    tab: filtros.tab, page: filtros.pagina, pageSize: filtros.limite, q: filtros.busca,
    cedente: filtros.cedente, sacado: filtros.sacado, operacao: filtros.operacao,
    statusLogistico: filtros.statusLogistico, statusCte: filtros.statusCte,
    statusComprovante: filtros.statusComprovante, momentoCte: filtros.momentoCte,
    momentoComprovante: filtros.momentoComprovante, pendencia: filtros.pendencia,
    statusOperacao: filtros.statusOperacao, periodo: filtros.periodo,
    dataDe: filtros.dataDe, dataAte: filtros.dataAte, visao: filtros.visao,
  }
  for (const [key, value] of Object.entries({ ...atuais, ...updates })) {
    if (value !== null && value !== '') params.set(key, String(value))
  }
  return `/gestor/logistica?${params.toString()}`
}

function Metrica({ titulo, quantidade, valor, icon: Icon, tone }: {
  titulo: string; quantidade: number; valor: number; icon: typeof Truck; tone: string
}) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{titulo}</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{quantidade}</p>
          <p className="truncate text-xs font-medium text-muted-foreground tabular-nums">{formatCurrency(valor)}</p>
        </div>
        <span className={`rounded-lg p-2 ${tone}`}><Icon className="size-4" aria-hidden="true" /></span>
      </CardContent>
    </Card>
  )
}

function Filtros({ data }: { data: CentralLogisticaData }) {
  const f = data.filtros
  const router = useRouter()
  const [navegando, iniciarNavegacao] = useTransition()

  function aplicarFiltros(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const params = new URLSearchParams()

    for (const [chave, valor] of new FormData(event.currentTarget).entries()) {
      if (typeof valor === 'string' && valor.trim()) params.set(chave, valor.trim())
    }

    params.set('page', '1')
    params.set('pageSize', String(f.limite))
    iniciarNavegacao(() => router.push(`/gestor/logistica?${params.toString()}`))
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form
          key={queryHref(data, {})}
          action="/gestor/logistica"
          method="get"
          onSubmit={aplicarFiltros}
          className="grid gap-3 lg:grid-cols-12"
        >
          <input type="hidden" name="tab" value={f.tab} />
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="pageSize" value={f.limite} />
          <label className="relative lg:col-span-4">
            <span className="sr-only">Buscar</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input name="q" defaultValue={f.busca} placeholder="NF, chave, cedente, sacado, operação ou CT-e" className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm" />
          </label>
          <select name="cedente" defaultValue={f.cedente || ''} aria-label="Cedente" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Todos os cedentes</option>{data.opcoes.cedentes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select name="sacado" defaultValue={f.sacado || ''} aria-label="Sacado" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Todos os sacados</option>{data.opcoes.sacados.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select name="statusLogistico" defaultValue={f.statusLogistico || ''} aria-label="Status logístico" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Status logístico</option><option value="ENTREGUE">Entregue</option><option value="EM_TRANSITO">Em trânsito</option><option value="INDETERMINADA">Indeterminada</option>
          </select>
          <select name="pendencia" defaultValue={f.pendencia || ''} aria-label="Pendência" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Todas as pendências</option><option value="rejeitada">Rejeitadas</option><option value="vencida">Vencidas</option><option value="vence_hoje">Vence hoje</option><option value="proximos_3_dias">Próximos 3 dias</option><option value="proximos_7_dias">Próximos 7 dias</option><option value="aguardando_envio">Aguardando envio</option><option value="em_analise">Em análise</option><option value="sem_pendencia">Sem pendência</option>
          </select>
          <select name="statusCte" defaultValue={f.statusCte || ''} aria-label="Status CT-e" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Status CT-e</option><option value="NAO_ENVIADO">Não enviado</option><option value="AGUARDANDO_ANALISE">Aguardando análise</option><option value="APROVADO">Aprovado</option><option value="REJEITADO">Rejeitado</option>
          </select>
          <select name="statusComprovante" defaultValue={f.statusComprovante || ''} aria-label="Status comprovante" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Status comprovante</option><option value="NAO_ENVIADO">Não enviado</option><option value="AGUARDANDO_ANALISE">Aguardando análise</option><option value="APROVADO">Aprovado</option><option value="REJEITADO">Rejeitado</option>
          </select>
          <select name="operacao" defaultValue={f.operacao || ''} aria-label="Operação" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Todas as operações</option>{data.opcoes.operacoes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select name="statusOperacao" defaultValue={f.statusOperacao || ''} aria-label="Status da operação" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Status da operação</option><option value="sem_operacao">Sem operação</option><option value="solicitada">Solicitada</option><option value="em_analise">Em análise</option><option value="aprovada">Aprovada</option><option value="em_andamento">Em andamento</option><option value="liquidada">Liquidada</option><option value="inadimplente">Inadimplente</option><option value="reprovada">Reprovada</option><option value="cancelada">Cancelada</option>
          </select>
          <select name="momentoCte" defaultValue={f.momentoCte || ''} aria-label="Momento do CT-e" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Momento do CT-e</option><option value="ANTECIPADO">Antecipado</option><option value="POS_CESSAO">Pós-cessão</option><option value="INDETERMINADO">Indeterminado</option>
          </select>
          <select name="momentoComprovante" defaultValue={f.momentoComprovante || ''} aria-label="Momento do comprovante" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="">Momento do comprovante</option><option value="ANTECIPADO">Antecipado</option><option value="POS_CESSAO">Pós-cessão</option><option value="INDETERMINADO">Indeterminado</option>
          </select>
          <select name="periodo" defaultValue={f.periodo} aria-label="Tipo de período" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2">
            <option value="emissao">Emissão</option><option value="operacao">Operação</option><option value="cessao">Cessão</option><option value="desembolso">Desembolso</option><option value="vencimento">Vencimento</option>
          </select>
          <input type="date" name="dataDe" defaultValue={f.dataDe} aria-label="Data inicial" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2" />
          <input type="date" name="dataAte" defaultValue={f.dataAte} aria-label="Data final" className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm lg:col-span-2" />
          <div className="flex flex-wrap justify-end gap-2 lg:col-span-4">
            <Link href="/gestor/logistica" className="inline-flex h-9 items-center rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted">Limpar</Link>
            <Button type="submit" size="lg" disabled={navegando}>{navegando ? 'Aplicando...' : 'Aplicar filtros'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function TabelaNotas({ notas }: { notas: LogisticaNfResumo[] }) {
  if (!notas.length) return <EstadoVazio texto="Nenhuma NF encontrada com os filtros informados." />
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>
          <th className="p-3">NF / Cedente</th><th className="p-3">Sacado</th><th className="p-3">Valor</th><th className="p-3">Operação</th><th className="p-3">Atual</th><th className="p-3">Criação / aprovação</th><th className="p-3">CT-e</th><th className="p-3">Comprovante</th><th className="p-3">Prazo</th><th className="p-3 text-right">Ação</th>
        </tr></thead>
        <tbody className="divide-y">{notas.map((nota) => <tr key={nota.notaFiscalId} className="hover:bg-muted/30">
          <td className="max-w-56 p-3"><p className="font-semibold">NF {nota.numeroNf}</p><p className="truncate text-xs" title={nota.cedente}>{nota.cedente}</p><p className="text-xs text-muted-foreground">{formatCNPJ(nota.cedenteCnpj)}</p></td>
          <td className="max-w-48 p-3"><p className="truncate" title={nota.sacado}>{nota.sacado}</p><p className="text-xs text-muted-foreground">{formatCNPJ(nota.sacadoCnpj)}</p></td>
          <td className="p-3 font-medium tabular-nums">{formatCurrency(nota.valor)}</td>
          <td className="p-3">{nota.operacao ? <><p>#{nota.operacao.id.slice(0, 8)}</p><p className="text-xs text-muted-foreground">{nota.operacao.status}</p></> : '—'}</td>
          <td className="p-3"><Badge tone={toneStatus(nota.statusAtual)}>{STATUS_LABEL[nota.statusAtual]}</Badge></td>
          <td className="p-3 text-xs"><p>{nota.statusCriacao ? STATUS_LABEL[nota.statusCriacao] : '—'}</p><p className="text-muted-foreground">{nota.statusAprovacao ? STATUS_LABEL[nota.statusAprovacao] : '—'}</p></td>
          <td className="p-3">{statusDocumento(nota.cte)}<p className="mt-1 text-xs text-muted-foreground">{MOMENTO_LABEL[nota.cte.momento]}</p></td>
          <td className="p-3">{statusDocumento(nota.comprovante)}<p className="mt-1 text-xs text-muted-foreground">{MOMENTO_LABEL[nota.comprovante.momento]}</p></td>
          <td className="p-3 text-xs"><p>{nota.prazoRelevante.data ? formatDate(nota.prazoRelevante.data) : '—'}</p><p className="text-muted-foreground">{nota.prazoRelevante.situacao.replaceAll('_', ' ')}</p></td>
          <td className="p-3 text-right"><Link href={`/gestor/notas-fiscais/${nota.notaFiscalId}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-input px-2.5 font-medium hover:bg-muted"><Eye className="size-4" />Ver NF</Link></td>
        </tr>)}</tbody>
      </table>
    </div>
  )
}

function TabelaPendencias({ pendencias }: { pendencias: PendenciaLogistica[] }) {
  if (!pendencias.length) return <EstadoVazio texto="Nenhuma pendência logística encontrada." />
  return <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[850px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">NF</th><th className="p-3">Cedente</th><th className="p-3">Documento</th><th className="p-3">Status</th><th className="p-3">Prazo</th><th className="p-3">Criticidade</th><th className="p-3 text-right">Ação</th></tr></thead><tbody className="divide-y">
    {pendencias.map((item) => <tr key={item.id}><td className="p-3 font-semibold">NF {item.numeroNf}</td><td className="max-w-56 truncate p-3" title={item.cedente}>{item.cedente}</td><td className="p-3">{item.documento}</td><td className="p-3"><Badge tone={toneStatus(item.status)}>{STATUS_LABEL[item.status]}</Badge></td><td className="p-3">{item.prazoEfetivo ? formatDate(item.prazoEfetivo) : '—'}<p className="text-xs text-muted-foreground">{item.dias === null ? 'Sem prazo' : item.dias < 0 ? `${Math.abs(item.dias)} dia(s) em atraso` : `${item.dias} dia(s)`}</p></td><td className="p-3"><Badge tone={item.criticidade === 'CRITICA' ? 'danger' : item.criticidade === 'ALTA' ? 'warning' : 'neutral'}>{item.criticidade}</Badge></td><td className="p-3 text-right"><Link href={`/gestor/notas-fiscais/${item.notaFiscalId}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-input px-2.5 font-medium hover:bg-muted"><Eye className="size-4" />Ver NF</Link></td></tr>)}
  </tbody></table></div>
}

function TabelaCtes({ ctes, onOpen }: { ctes: CteLogisticoResumo[]; onOpen: (cte: CteLogisticoResumo) => void }) {
  if (!ctes.length) return <EstadoVazio texto="Nenhum CT-e relacionado às NFs acompanhadas foi encontrado." />
  return <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[900px] text-sm"><thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="p-3">CT-e</th><th className="p-3">Cedente</th><th className="p-3">NFs</th><th className="p-3">Valor relacionado</th><th className="p-3">Status</th><th className="p-3">Momento</th><th className="p-3">Primeiro envio</th><th className="p-3 text-right">Detalhes</th></tr></thead><tbody className="divide-y">
    {ctes.map((cte) => <tr key={cte.cteId}><td className="p-3"><p className="font-semibold">{cte.numero || 'Sem número'}</p><p className="max-w-52 truncate text-xs text-muted-foreground" title={cte.chave || ''}>{cte.chave || 'Chave não informada'}</p></td><td className="max-w-56 p-3"><p className="truncate" title={cte.cedente}>{cte.cedente}</p><p className="text-xs text-muted-foreground">{formatCNPJ(cte.cedenteCnpj)}</p></td><td className="p-3">{cte.quantidadeNfs}</td><td className="p-3 font-medium tabular-nums">{formatCurrency(cte.valorRelacionado)}</td><td className="p-3"><Badge tone={toneStatus(cte.status)}>{STATUS_LABEL[cte.status]}</Badge></td><td className="p-3">{MOMENTO_LABEL[cte.momento]}</td><td className="p-3">{cte.primeiroUploadEm ? formatDate(cte.primeiroUploadEm) : '—'}</td><td className="p-3 text-right"><Button variant="outline" onClick={() => onOpen(cte)}>Ver relações</Button></td></tr>)}
  </tbody></table></div>
}

function EstadoVazio({ texto }: { texto: string }) {
  return <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center"><FileText className="mb-2 size-7 text-muted-foreground" /><p className="font-medium">{texto}</p><p className="mt-1 text-sm text-muted-foreground">Revise os filtros ou aguarde a materialização do acompanhamento logístico.</p></div>
}

export function CentralLogisticaView({ data }: { data: CentralLogisticaData }) {
  const [cteAberto, setCteAberto] = useState<CteLogisticoResumo | null>(null)
  const r = data.resumo
  const tabs = [['geral', 'Visão geral'], ['notas', 'Notas fiscais'], ['pendencias', 'Pendências'], ['ctes', 'CT-es']] as const
  return (
    <main className="mx-auto w-full max-w-[1540px] space-y-4 px-4 py-6 lg:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Fundo ativo · {data.fundo.nome}</p><h1 className="mt-1 text-2xl font-bold">Central de Acompanhamento Logístico</h1><p className="text-sm text-muted-foreground">Visão consolidada por NF, sem alterar o fluxo documental ou operacional.</p></div>
        <a href={`${queryHref(data, {}).replace('/gestor/logistica?', '/gestor/logistica/exportar?')}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" />Exportar CSV</a>
      </header>

      <section aria-label="Resumo logístico" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Metrica titulo="NFs acompanhadas" {...r.acompanhadas} icon={FileText} tone="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" />
        <Metrica titulo="Entregues" {...r.entregues} icon={PackageCheck} tone="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" />
        <Metrica titulo="Em trânsito" {...r.emTransito} icon={Truck} tone="bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300" />
        <Metrica titulo="Indeterminadas" {...r.indeterminadas} icon={Clock3} tone="bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300" />
        <Metrica titulo="Pendências vencidas" {...r.pendenciasVencidas} icon={AlertTriangle} tone="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" />
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Aguardando análise</p><p className="mt-1 text-xl font-bold">{r.aguardandoAnalise}</p><Clock3 className="mt-2 size-4 text-blue-600" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Rejeitados</p><p className="mt-1 text-xl font-bold">{r.rejeitados}</p><XCircle className="mt-2 size-4 text-red-600" /></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Envio antecipado</p><p className="mt-1 text-xl font-bold">{r.enviadosAntecipadamente.percentual}%</p><p className="text-xs text-muted-foreground">{r.enviadosAntecipadamente.quantidade} NF(s)</p></CardContent></Card>
      </section>

      <div className="flex flex-wrap gap-2" aria-label="Visões rápidas">
        {[['atencao_imediata', 'Atenção imediata'], ['aguardando_gestor', 'Aguardando gestor'], ['enviados_antecipadamente', 'Envio antecipado'], ['entregues_na_cessao', 'Entregues na criação'], ['em_transito_na_cessao', 'Em trânsito na criação'], ['indeterminadas', 'Indeterminadas']].map(([value, label]) => <Link key={value} href={queryHref(data, { visao: value, page: '1' })} className={`rounded-full border px-3 py-1 text-xs font-medium ${data.filtros.visao === value ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-muted'}`}>{label}</Link>)}
      </div>
      <Filtros data={data} />

      <nav className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1" aria-label="Seções da central logística">
        {tabs.map(([value, label]) => <Link key={value} href={queryHref(data, { tab: value, page: '1' })} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${data.filtros.tab === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{label}</Link>)}
      </nav>

      <Card><CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{tabs.find(([value]) => value === data.filtros.tab)?.[1]}</h2><p className="text-xs text-muted-foreground">{data.paginacao.total} registro(s) no filtro · {data.totalUniverso} NF(s) no universo logístico do fundo</p></div>{data.filtros.tab === 'geral' && <div className="flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1"><CheckCircle2 className="size-4 text-green-600" />{data.indicadores.entreguesNaCriacaoPercentual ?? '—'}% entregues na criação</span><span>{data.indicadores.postergacoes} postergação(ões)</span></div>}</div>
        {data.filtros.tab === 'pendencias' ? <TabelaPendencias pendencias={data.pendencias} /> : data.filtros.tab === 'ctes' ? <TabelaCtes ctes={data.ctes} onOpen={setCteAberto} /> : <TabelaNotas notas={data.notas} />}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <span className="text-muted-foreground">Página {data.paginacao.pagina} de {data.paginacao.totalPaginas}</span>
          <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Itens</span>{([20, 50, 100] as const).map((limite) => <Link key={limite} href={queryHref(data, { pageSize: String(limite), page: '1' })} className={`rounded-md px-2 py-1 text-xs ${data.paginacao.limite === limite ? 'bg-primary text-primary-foreground' : 'border'}`}>{limite}</Link>)}<Link aria-disabled={data.paginacao.pagina <= 1} href={queryHref(data, { page: String(Math.max(1, data.paginacao.pagina - 1)) })} className="rounded-lg border px-3 py-1.5 aria-disabled:pointer-events-none aria-disabled:opacity-50">Anterior</Link><Link aria-disabled={data.paginacao.pagina >= data.paginacao.totalPaginas} href={queryHref(data, { page: String(Math.min(data.paginacao.totalPaginas, data.paginacao.pagina + 1)) })} className="rounded-lg border px-3 py-1.5 aria-disabled:pointer-events-none aria-disabled:opacity-50">Próxima</Link></div>
        </div>
      </CardContent></Card>

      <Dialog open={Boolean(cteAberto)} onOpenChange={(open) => !open && setCteAberto(null)}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>CT-e {cteAberto?.numero || 'sem número'}</DialogTitle><DialogDescription>{cteAberto?.chave || 'Chave não informada'} · relações N:N consolidadas sem duplicar valor por NF.</DialogDescription></DialogHeader><div className="max-h-[55vh] space-y-2 overflow-y-auto">{cteAberto?.nfs.map((nf) => <div key={nf.notaFiscalId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="font-semibold">NF {nf.numeroNf}</p><p className="text-xs text-muted-foreground">{nf.operacaoId ? `Operação #${nf.operacaoId.slice(0, 8)}` : 'Sem operação'}</p></div><div className="text-right"><p className="font-medium tabular-nums">{formatCurrency(nf.valor)}</p><Link href={`/gestor/notas-fiscais/${nf.notaFiscalId}`} className="text-xs font-medium text-primary hover:underline">Ver NF</Link></div></div>)}</div></DialogContent></Dialog>
    </main>
  )
}

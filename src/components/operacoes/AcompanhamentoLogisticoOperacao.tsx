import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Search, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils'
import {
  carregarAcompanhamentoLogisticoOperacao,
  type AcompanhamentoLogisticoQuery,
} from '@/lib/logistica/acompanhamento-operacao.server'
import type {
  CriticidadePrazoLogistico,
  DocumentoLogisticoResumo,
  FiltroAcompanhamentoLogistico,
  LinhaAcompanhamentoLogistico,
  StatusConsolidadoLogistico,
} from '@/lib/logistica/acompanhamento-operacao'

const linkButtonClass = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

const statusLinha: Record<StatusConsolidadoLogistico, { label: string; className: string }> = {
  preparando: { label: 'Preparando', className: 'bg-muted text-muted-foreground' },
  rejeitado: { label: 'Documento rejeitado', className: 'bg-destructive/10 text-destructive' },
  prazo_vencido: { label: 'Prazo vencido', className: 'bg-destructive/10 text-destructive' },
  vence_hoje: { label: 'Vence hoje', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  prazo_proximo: { label: 'Prazo próximo', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  aguardando_upload: { label: 'Aguardando upload', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  em_analise: { label: 'Em análise', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300' },
  em_andamento: { label: 'Em andamento', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300' },
  concluido: { label: 'Concluído', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
}

const statusDocumento: Record<DocumentoLogisticoResumo['status'], string> = {
  nao_exigido: 'Não exigido',
  aguardando_upload: 'Aguardando upload',
  enviado: 'Enviado',
  em_analise: 'Em análise',
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  prazo_vencido: 'Prazo vencido',
}

function hrefComQuery(
  operacaoId: string,
  current: AcompanhamentoLogisticoQuery,
  changes: Record<string, string | number | boolean | null>,
  returnTo?: string,
) {
  const params = new URLSearchParams()
  if (returnTo) params.set('returnTo', returnTo)
  if (current.expandido) params.set('logisticaExpandida', '1')
  if (current.pagina && current.pagina > 1) params.set('logisticaPagina', String(current.pagina))
  if (current.filtro && current.filtro !== 'todos') params.set('logisticaFiltro', current.filtro)
  if (current.busca) params.set('logisticaBusca', current.busca)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === false || value === '') params.delete(key)
    else params.set(key, value === true ? '1' : String(value))
  }
  const query = params.toString()
  return `/gestor/operacoes/${operacaoId}${query ? `?${query}` : ''}`
}

function prazoLabel(documento: DocumentoLogisticoResumo) {
  if (!documento.prazoEfetivo) return null
  if (documento.novaPrevisao) return `Nova previsão ${formatDate(documento.novaPrevisao)}`
  return `Até ${formatDate(documento.prazoEfetivo)}`
}

function DocumentoCell({ documento }: { documento: DocumentoLogisticoResumo }) {
  if (!documento.aplicavel) return <span className="text-sm text-muted-foreground">Não exigido</span>
  const prazo = prazoLabel(documento)
  const status = documento.novaPrevisao
    && documento.criticidadePrazoOriginal === 'vencido'
    && documento.prazoEfetivo !== documento.prazoOriginal
    ? 'Nova previsão vigente'
    : statusDocumento[documento.status]
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{status}</p>
      {prazo && <p className="truncate text-xs text-muted-foreground" title={prazo}>{prazo}</p>}
    </div>
  )
}

function criticidadeLabel(criticidade: CriticidadePrazoLogistico) {
  if (criticidade === 'vencido') return 'Prazo vencido'
  if (criticidade === 'vence_hoje') return 'Vence hoje'
  if (criticidade === 'proximo') return 'Prazo próximo'
  return null
}

function LinhaLogistica({
  linha,
  exibeCte,
  exibeComprovante,
  returnHref,
}: {
  linha: LinhaAcompanhamentoLogistico
  exibeCte: boolean
  exibeComprovante: boolean
  returnHref: string
}) {
  const status = statusLinha[linha.status]
  const alertaPrazo = criticidadeLabel(linha.criticidadePrazo)
  const gridColumns = exibeCte && exibeComprovante
    ? 'sm:grid-cols-[minmax(90px,0.8fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(130px,1.1fr)_auto]'
    : exibeCte || exibeComprovante
      ? 'sm:grid-cols-[minmax(90px,0.8fr)_minmax(120px,1fr)_minmax(130px,1.1fr)_auto]'
      : 'sm:grid-cols-[minmax(90px,0.8fr)_minmax(130px,1.1fr)_auto]'
  return (
    <div className={`grid min-w-0 gap-3 px-4 py-3 sm:items-center ${gridColumns}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold" title={`NF ${linha.numeroNf}`}>NF {linha.numeroNf}</p>
        {linha.entregaId ? (
          <p className="truncate text-xs text-muted-foreground">{linha.statusEntrega?.replaceAll('_', ' ')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Acompanhamento sendo preparado.</p>
        )}
      </div>
      {exibeCte && <DocumentoCell documento={linha.cte} />}
      {exibeComprovante && <DocumentoCell documento={linha.comprovanteEntrega} />}
      <div className="min-w-0">
        <Badge className={status.className} variant="secondary">{status.label}</Badge>
        {alertaPrazo && <p className="mt-1 truncate text-xs text-muted-foreground">{alertaPrazo}</p>}
        {linha.motivoPendencia && <p className="mt-1 truncate text-xs text-destructive" title={linha.motivoPendencia}>{linha.motivoPendencia}</p>}
      </div>
      <Link href={`/gestor/notas-fiscais/${linha.notaFiscalId}?returnTo=${encodeURIComponent(returnHref)}`} className={linkButtonClass}>
        Ver NF
      </Link>
    </div>
  )
}

function ErrorCard({ operacaoId, returnTo }: { operacaoId: string; returnTo?: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 text-destructive" aria-hidden="true" />
          <div>
            <p className="font-medium">Não foi possível carregar o acompanhamento logístico.</p>
            <p className="text-sm text-muted-foreground">Tente novamente. Nenhuma informação operacional foi alterada.</p>
          </div>
        </div>
        <a href={hrefComQuery(operacaoId, {}, { logisticaRetry: 1 }, returnTo)} className={linkButtonClass}>
          Tentar novamente
        </a>
      </CardContent>
    </Card>
  )
}

export async function AcompanhamentoLogisticoOperacao({
  operacaoId,
  query,
  returnTo,
}: {
  operacaoId: string
  query: AcompanhamentoLogisticoQuery
  returnTo?: string
}) {
  let data
  try {
    data = await carregarAcompanhamentoLogisticoOperacao(operacaoId, query)
  } catch (error) {
    console.error('[acompanhamento-logistico-operacao]', {
      operacaoId,
      erro: error instanceof Error ? error.message : 'Erro inesperado',
    })
    return <ErrorCard operacaoId={operacaoId} returnTo={returnTo} />
  }

  if (data.estado === 'oculto') return null

  if (data.estado === 'aguardando_desembolso') {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Clock3 className="size-4" /></span>
          <div className="min-w-0">
            <p className="font-semibold">Aguardando desembolso</p>
            <p className="text-sm text-muted-foreground">
              {data.totalNotas === 1
                ? 'O acompanhamento logístico da NF será iniciado após o desembolso.'
                : `O acompanhamento logístico das ${data.totalNotas} NFs será iniciado após o desembolso.`}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const geral = data.resumo.statusGeral === 'atencao'
    ? { label: 'Atenção necessária', className: 'bg-destructive/10 text-destructive', icon: AlertTriangle }
    : data.resumo.statusGeral === 'concluido'
      ? { label: 'Concluído', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300', icon: CheckCircle2 }
      : { label: 'Em andamento', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300', icon: Truck }
  const GeralIcon = geral.icon
  const currentQuery: AcompanhamentoLogisticoQuery = {
    expandido: data.expandido,
    pagina: data.pagina,
    filtro: data.filtro,
    busca: data.busca,
  }
  const returnHref = hrefComQuery(operacaoId, currentQuery, {}, returnTo)

  return (
    <Card>
      <CardHeader className="gap-3 pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Truck className="size-4" /> Acompanhamento logístico</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Visão consolidada por nota fiscal.</p>
          </div>
          <Badge className={geral.className} variant="secondary"><GeralIcon /> {geral.label}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[
            ['Total', data.resumo.total],
            ['Concluídas', data.resumo.concluidas],
            ['Em análise', data.resumo.emAnalise],
            ['Pendentes', data.resumo.pendentes],
            ['Atenção', data.resumo.atencao],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-muted/20 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-lg font-semibold leading-tight">{value}</p>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Progresso</span><span>{data.resumo.percentualConclusao}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Conclusão do acompanhamento logístico" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.resumo.percentualConclusao}>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${data.resumo.percentualConclusao}%` }} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {data.expandido && (
          <form method="get" className="grid gap-2 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[minmax(0,1fr)_180px_auto_auto]">
            {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
            <input type="hidden" name="logisticaExpandida" value="1" />
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="logisticaBusca" defaultValue={data.busca} placeholder="Buscar NF" className="pl-9" />
            </div>
            <select name="logisticaFiltro" defaultValue={data.filtro} className="h-8 rounded-lg border border-border bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Filtrar acompanhamento">
              <option value="todos">Todos</option>
              <option value="atencao">Atenção</option>
              <option value="pendentes">Pendentes</option>
              <option value="em_analise">Em análise</option>
              <option value="concluidos">Concluídos</option>
            </select>
            <Button type="submit">Aplicar</Button>
            <Link href={hrefComQuery(operacaoId, currentQuery, { logisticaFiltro: null, logisticaBusca: null, logisticaPagina: null }, returnTo)} className={linkButtonClass}>Limpar</Link>
          </form>
        )}

        <div className="overflow-hidden rounded-xl border divide-y">
          {data.linhas.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhuma NF encontrada para os filtros informados.</p>
          ) : data.linhas.map((linha) => (
            <LinhaLogistica key={linha.notaFiscalId} linha={linha} exibeCte={data.exibeCte} exibeComprovante={data.exibeComprovante} returnHref={returnHref} />
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {data.expandido ? `${data.totalFiltrado} NF(s) no filtro` : `Exibindo ${data.linhas.length} de ${data.resumo.total} NF(s)`}
          </p>
          <div className="flex items-center justify-end gap-2">
            {!data.expandido && data.possuiMais && (
              <Link href={hrefComQuery(operacaoId, currentQuery, { logisticaExpandida: true, logisticaPagina: 1 }, returnTo)} className={linkButtonClass}>Ver todas</Link>
            )}
            {data.expandido && (
              <>
                <Link href={hrefComQuery(operacaoId, currentQuery, { logisticaExpandida: null, logisticaPagina: null, logisticaFiltro: null, logisticaBusca: null }, returnTo)} className={linkButtonClass}>Recolher</Link>
                <Link aria-disabled={data.pagina <= 1} href={hrefComQuery(operacaoId, currentQuery, { logisticaPagina: Math.max(1, data.pagina - 1) }, returnTo)} className={`${linkButtonClass} ${data.pagina <= 1 ? 'pointer-events-none opacity-50' : ''}`} aria-label="Página anterior"><ChevronLeft /></Link>
                <span className="text-xs text-muted-foreground">{data.pagina} de {data.totalPaginas}</span>
                <Link aria-disabled={data.pagina >= data.totalPaginas} href={hrefComQuery(operacaoId, currentQuery, { logisticaPagina: Math.min(data.totalPaginas, data.pagina + 1) }, returnTo)} className={`${linkButtonClass} ${data.pagina >= data.totalPaginas ? 'pointer-events-none opacity-50' : ''}`} aria-label="Próxima página"><ChevronRight /></Link>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function normalizarFiltroLogistico(value: string | string[] | undefined): FiltroAcompanhamentoLogistico {
  const raw = Array.isArray(value) ? value[0] : value
  return ['atencao', 'pendentes', 'em_analise', 'concluidos'].includes(raw || '')
    ? raw as FiltroAcompanhamentoLogistico
    : 'todos'
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, FileText, Truck } from 'lucide-react'
import { AuthorizationError } from '@/lib/auth/authorization'
import { carregarDetalheOperacaoCedente } from '@/lib/operacoes/cedente-detalhe.server'
import { construirLinhasAcompanhamento } from '@/lib/operacoes/acompanhamento-tabela'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/data-display/primitives'
import { BotaoDownloadArquivoOperacao } from '@/components/contratos/BotaoDownloadArquivoOperacao'
import { HistoricoTimelineCard } from '@/components/historico/HistoricoTimelineCard'
import { AndamentoOperacaoCard } from '@/components/operacoes/AndamentoOperacaoCard'
import { ExposicaoLogisticaOperacaoServer } from '@/components/operacoes/ExposicaoLogisticaOperacaoServer'
import { BaseAntecipacaoResumo } from '@/components/operacoes/BaseAntecipacaoResumo'
import { OperacaoAcompanhamentoTabela } from '@/components/operacoes/OperacaoAcompanhamentoTabela'

const statusClasses: Record<string, string> = {
  solicitada: 'bg-blue-100 text-blue-700 border-transparent dark:bg-blue-500/15 dark:text-blue-200',
  em_analise: 'bg-yellow-100 text-yellow-700 border-transparent dark:bg-yellow-500/15 dark:text-yellow-200',
  aprovada: 'bg-teal-100 text-teal-700 border-transparent dark:bg-teal-500/15 dark:text-teal-200',
  em_andamento: 'bg-purple-100 text-purple-700 border-transparent dark:bg-purple-500/15 dark:text-purple-200',
  liquidada: 'bg-emerald-100 text-emerald-700 border-transparent dark:bg-emerald-500/15 dark:text-emerald-200',
  inadimplente: 'bg-red-100 text-red-700 border-transparent dark:bg-red-500/15 dark:text-red-200',
  reprovada: 'bg-red-100 text-red-700 border-transparent dark:bg-red-500/15 dark:text-red-200',
  cancelada: 'bg-muted text-muted-foreground border-transparent',
}

function formatDateOrDash(value: string | null) {
  return value ? formatDate(value) : '—'
}

function formatDateTimeOrDash(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
}

function prazoTexto(dias: number | null) {
  if (dias === null) return 'Sem prazo definido'
  if (dias < 0) return `${Math.abs(dias)} dia(s) em atraso`
  if (dias === 0) return 'Vence hoje'
  return `Restam ${dias} dia(s)`
}

export default async function OperacaoAcompanhamentoPage({
  params,
  searchParams,
  perfil = 'cedente',
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ returnTo?: string | string[] }>
  perfil?: 'cedente' | 'consultor'
}) {
  const { id } = await params
  const rawReturnTo = (await searchParams).returnTo
  const returnToParam = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo
  const basePath = `/${perfil}/operacoes`
  const returnTo = returnToParam === basePath || returnToParam?.startsWith(`${basePath}?`)
    ? returnToParam
    : basePath
  let detalhe

  try {
    detalhe = await carregarDetalheOperacaoCedente(id, { perfil })
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === 'NOT_FOUND') notFound()
    if (error instanceof AuthorizationError) {
      return (
        <div className="mx-auto max-w-4xl py-16">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 pt-6 text-destructive">
              <AlertCircle className="mt-0.5 shrink-0" size={20} aria-hidden />
              <div>
                <p className="font-semibold">Acesso não permitido.</p>
                <p className="mt-1 text-sm">{error.message}</p>
                <Link href={returnTo} className="mt-4 inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted">Voltar para operações</Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }
    throw error
  }

  const linhas = construirLinhasAcompanhamento(detalhe)
  const financeiro = detalhe.financeiro

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 pb-10">
      <div className="flex items-start gap-3">
        <Link href={returnTo} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label="Voltar para operações"><ArrowLeft size={20} aria-hidden /></Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Operação #{detalhe.codigoCurto}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge className={statusClasses[detalhe.status] || 'bg-muted text-muted-foreground'}>{detalhe.statusLabel}</Badge>
            <span className="min-w-0 text-sm text-muted-foreground wrap-anywhere">{detalhe.cedente.razaoSocial}{detalhe.cedente.cnpj && ` (${formatCNPJ(detalhe.cedente.cnpj)})`}</span>
            {detalhe.possuiPendenciaCedente && <Badge className="border-warning/30 bg-warning/20 text-warning-foreground"><AlertCircle size={12} aria-hidden />{perfil === 'consultor' ? 'Pendência do cedente' : 'Pendência para você'}</Badge>}
          </div>
          {detalhe.mensagemAceite && <p className="mt-2 text-sm text-muted-foreground">{detalhe.mensagemAceite}</p>}
          {perfil === 'consultor' && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Eye size={14} aria-hidden />Acompanhamento em somente leitura. Alterações e aprovações são realizadas pelos responsáveis da operação.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          {perfil === 'cedente' && <ExposicaoLogisticaOperacaoServer operacaoId={id} variante="cedente-operacao" />}
          <OperacaoAcompanhamentoTabela linhas={linhas} />

          {detalhe.baseAntecipacaoSnapshot && <details className="rounded-xl border border-border bg-card">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Conferir base fiscal congelada na solicitação</summary>
            <div className="border-t p-4"><BaseAntecipacaoResumo snapshot={detalhe.baseAntecipacaoSnapshot} notas={detalhe.notasFiscais.map(nota => ({ id: nota.id, numero_nf: nota.numero }))} /></div>
          </details>}

          <AndamentoOperacaoCard etapas={detalhe.timeline} compact />

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertCircle size={18} aria-hidden />{perfil === 'consultor' ? 'Pendências do cedente' : 'Pendências para você'}</CardTitle></CardHeader>
            <CardContent>
              {detalhe.pendenciasCedente.length === 0 ? (
                <EmptyState title={perfil === 'consultor' ? 'Nenhuma pendência do cedente' : 'Nenhuma pendência sua'} description="Quando houver documento ou informação pendente de envio, aparecerá aqui." icon={CheckCircle2} />
              ) : (
                <div className="space-y-3">
                  {detalhe.pendenciasCedente.map(pendencia => (
                    <div key={pendencia.id} className="rounded-xl border border-warning/35 bg-warning/10 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-warning-foreground">{pendencia.descricao}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{pendencia.notaFiscalNumero ? `NF ${pendencia.notaFiscalNumero}` : 'Operação'} · {pendencia.prazo ? `${formatDate(pendencia.prazo)} · ${prazoTexto(pendencia.dias)}` : 'Sem prazo definido'}</p>
                        </div>
                        {perfil === 'cedente' && pendencia.acaoHref && <Link href={pendencia.acaoHref} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/85">Resolver na NF</Link>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <HistoricoTimelineCard entidade="operacao" entidadeId={id} compacto />
        </div>

        <aside className="min-w-0 space-y-5 xl:self-start" aria-label="Resumo e acompanhamento da operação">
          <Card className="gap-0 overflow-hidden rounded-xl py-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-3 px-5 py-5">
              <CardTitle role="heading" aria-level={2} className="text-sm font-semibold">Resumo</CardTitle>
              <Badge className={`max-w-44 whitespace-normal text-[11px] ${statusClasses[detalhe.status] || 'bg-muted text-muted-foreground'}`}>{detalhe.statusLabel}</Badge>
            </CardHeader>
            <dl className="space-y-3 px-5 pb-5 text-xs [&>div]:flex [&>div]:justify-between [&>div]:gap-3 [&_dt]:text-muted-foreground [&_dd]:text-right [&_dd]:font-medium [&_dd]:tabular-nums">
              <div><dt>Valor da operação</dt><dd>{formatCurrency(financeiro.valorBrutoSolicitado)}</dd></div>
              <div><dt>Taxa aplicada</dt><dd>{financeiro.taxaAplicada === null ? 'A definir' : `${financeiro.taxaAplicada.toLocaleString('pt-BR')}% a.m.`}</dd></div>
              <div><dt>Prazo</dt><dd>{financeiro.prazoDias} dias</dd></div>
              <div><dt>Vencimento</dt><dd>{formatDateOrDash(financeiro.vencimento)}</dd></div>
              <div><dt>Solicitada em</dt><dd>{formatDateTimeOrDash(detalhe.solicitadaEm)}</dd></div>
              <div className="!mt-4 items-center border-t pt-4"><dt className="!font-semibold !text-foreground">Líquido aprovado</dt><dd className="!text-lg !font-bold tracking-tight text-emerald-700 dark:text-emerald-400">{financeiro.valorLiquidoAprovado === null ? 'Pendente' : formatCurrency(financeiro.valorLiquidoAprovado)}</dd></div>
              <div><dt>Aprovação</dt><dd>{formatDateTimeOrDash(financeiro.aprovadoEm)}</dd></div>
              <div><dt>Valor desembolsado</dt><dd>{financeiro.valorEfetivamenteDesembolsado === null ? 'Ainda não desembolsado' : formatCurrency(financeiro.valorEfetivamenteDesembolsado)}</dd></div>
              <div><dt>Desembolso</dt><dd>{formatDateTimeOrDash(financeiro.desembolsadoEm)}</dd></div>
              <div><dt>Liquidação</dt><dd>{formatDateTimeOrDash(financeiro.liquidadaEm)}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><FileText size={16} aria-hidden />Comprovantes disponíveis</CardTitle></CardHeader>
            <CardContent>
              {detalhe.comprovantes.length === 0 ? <p className="text-xs leading-relaxed text-muted-foreground">Nenhum comprovante disponível. Os documentos aparecerão aqui quando forem anexados ou liberados.</p> : (
                <div className="flex flex-col gap-2">{detalhe.comprovantes.map(comprovante => <BotaoDownloadArquivoOperacao key={comprovante.key} operacaoId={detalhe.id} tipoDocumento={comprovante.tipoDocumento} label={comprovante.label} />)}</div>
              )}
            </CardContent>
          </Card>

          {detalhe.logistica.habilitada && <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Truck size={16} aria-hidden />Status logístico</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm font-semibold">{detalhe.logistica.statusLabel}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border p-2"><p className="text-lg font-bold tabular-nums">{detalhe.logistica.emTransito}</p><p className="text-[11px] text-muted-foreground">Em trânsito</p></div>
                <div className="rounded-lg border p-2"><p className="text-lg font-bold tabular-nums">{detalhe.logistica.comPendencia}</p><p className="text-[11px] text-muted-foreground">Pendência</p></div>
                <div className="rounded-lg border p-2"><p className="text-lg font-bold tabular-nums">{detalhe.logistica.concluidas}</p><p className="text-[11px] text-muted-foreground">Concluídas</p></div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3 text-xs"><p className="text-muted-foreground">Prazo mais próximo</p><p className="mt-1 font-medium">{detalhe.logistica.prazoMaisProximo ? `${formatDate(detalhe.logistica.prazoMaisProximo)} · ${prazoTexto(detalhe.logistica.diasPrazoMaisProximo)}` : 'Sem prazo aberto'}</p></div>
            </CardContent>
          </Card>}
        </aside>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertCircle, ArrowLeft, Banknote, CheckCircle2, FileText, ReceiptText, Truck } from 'lucide-react'
import { AuthorizationError } from '@/lib/auth/authorization'
import { carregarDetalheOperacaoCedente } from '@/lib/operacoes/cedente-detalhe.server'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DataTableContainer, DetailField, EmptyState, ListNameCell } from '@/components/data-display/primitives'
import { BotaoDownloadArquivoOperacao } from '@/components/contratos/BotaoDownloadArquivoOperacao'
import { HistoricoTimelineCard } from '@/components/historico/HistoricoTimelineCard'
import { AndamentoOperacaoCard } from '@/components/operacoes/AndamentoOperacaoCard'

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

export default async function CedenteOperacaoDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let detalhe

  try {
    detalhe = await carregarDetalheOperacaoCedente(id)
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === 'NOT_FOUND') notFound()
    if (error instanceof AuthorizationError) {
      return (
        <div className="mx-auto max-w-4xl py-16">
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 pt-6 text-destructive">
              <AlertCircle className="mt-0.5 shrink-0" size={20} />
              <div>
                <p className="font-semibold">Acesso não permitido.</p>
                <p className="mt-1 text-sm">{error.message}</p>
                <Link
                  href="/cedente/operacoes"
                  className="mt-4 inline-flex h-10 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
                >
                  Voltar para operações
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }
    throw error
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/cedente/operacoes" className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted" aria-label="Voltar para operações">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Detalhe da operação</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Operação #{detalhe.codigoCurto}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className={statusClasses[detalhe.status] || 'bg-muted text-muted-foreground'}>{detalhe.statusLabel}</Badge>
              <span className="text-sm text-muted-foreground">Solicitada em {formatDateTimeOrDash(detalhe.solicitadaEm)}</span>
              {detalhe.possuiPendenciaCedente && (
                <Badge className="bg-warning/20 text-warning-foreground border-warning/30">
                  <AlertCircle size={12} />
                  Pendência para você
                </Badge>
              )}
            </div>
            {detalhe.mensagemAceite && <p className="mt-2 text-sm text-muted-foreground">{detalhe.mensagemAceite}</p>}
          </div>
        </div>
        <Card className="md:min-w-80">
          <CardContent className="pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Cedente</p>
            <p className="mt-1 truncate font-semibold text-foreground" title={detalhe.cedente.razaoSocial}>{detalhe.cedente.razaoSocial}</p>
            <p className="font-mono text-xs text-muted-foreground">{detalhe.cedente.cnpj ? formatCNPJ(detalhe.cedente.cnpj) : '—'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="pt-5"><DetailField label="Valor bruto solicitado" value={formatCurrency(detalhe.financeiro.valorBrutoSolicitado)} /></CardContent></Card>
        <Card><CardContent className="pt-5"><DetailField label="Valor líquido aprovado" value={formatCurrency(detalhe.financeiro.valorLiquidoAprovado)} /></CardContent></Card>
        <Card><CardContent className="pt-5"><DetailField label="Valor desembolsado" value={detalhe.financeiro.valorEfetivamenteDesembolsado !== null ? formatCurrency(detalhe.financeiro.valorEfetivamenteDesembolsado) : 'Ainda não desembolsado'} /></CardContent></Card>
        <Card><CardContent className="pt-5"><DetailField label="Vencimento" value={formatDateOrDash(detalhe.financeiro.vencimento)} /></CardContent></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Banknote size={18} /> Resumo financeiro</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label="Taxa aplicada" value={detalhe.financeiro.taxaAplicada > 0 ? `${detalhe.financeiro.taxaAplicada}% a.m.` : 'A definir'} />
              <DetailField label="Prazo" value={`${detalhe.financeiro.prazoDias} dias`} />
              <DetailField label="Aprovação" value={formatDateTimeOrDash(detalhe.financeiro.aprovadoEm)} />
              <DetailField label="Desembolso" value={formatDateTimeOrDash(detalhe.financeiro.desembolsadoEm)} />
              <DetailField label="Liquidação" value={formatDateTimeOrDash(detalhe.financeiro.liquidadaEm)} />
            </dl>
          </CardContent>
        </Card>

        {detalhe.logistica.habilitada && <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Truck size={18} /> Status logístico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-semibold">{detalhe.logistica.statusLabel}</p>
              <p className="text-xs text-muted-foreground">
                {detalhe.logistica.habilitada ? 'Acompanhamento de entrega ativo para esta operação.' : 'Ainda não há acompanhamento logístico para esta operação.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-lg border border-border p-3"><p className="text-lg font-bold tabular-nums">{detalhe.logistica.emTransito}</p><p className="text-xs text-muted-foreground">Em trânsito</p></div>
              <div className="rounded-lg border border-border p-3"><p className="text-lg font-bold tabular-nums">{detalhe.logistica.comPendencia}</p><p className="text-xs text-muted-foreground">Pendência</p></div>
              <div className="rounded-lg border border-border p-3"><p className="text-lg font-bold tabular-nums">{detalhe.logistica.concluidas}</p><p className="text-xs text-muted-foreground">Concluídas</p></div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="text-xs text-muted-foreground">Prazo mais próximo</p>
              <p className="font-medium">{detalhe.logistica.prazoMaisProximo ? `${formatDate(detalhe.logistica.prazoMaisProximo)} · ${prazoTexto(detalhe.logistica.diasPrazoMaisProximo)}` : 'Sem prazo aberto'}</p>
            </div>
          </CardContent>
        </Card>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ReceiptText size={18} /> Notas fiscais</CardTitle>
        </CardHeader>
        <CardContent>
          {detalhe.notasFiscais.length === 0 ? (
            <EmptyState title="Nenhuma NF vinculada" description="As notas fiscais da operação aparecerão aqui." icon={ReceiptText} />
          ) : (
            <DataTableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>NF</TableHead>
                    <TableHead>Sacado</TableHead>
                    <TableHead className="text-right">Valor bruto</TableHead>
                    <TableHead className="text-right">Valor antecipado</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detalhe.notasFiscais.map((nf) => (
                    <TableRow key={nf.id}>
                      <TableCell className="font-medium tabular-nums">{nf.numero}</TableCell>
                      <TableCell className="w-[220px] max-w-[220px]">
                        <ListNameCell name={nf.sacado} subline={nf.cnpjSacado ? formatCNPJ(nf.cnpjSacado) : '—'} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatCurrency(nf.valorBruto)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{nf.valorAntecipado !== null ? formatCurrency(nf.valorAntecipado) : '—'}</TableCell>
                      <TableCell className="tabular-nums">{formatDate(nf.vencimento)}</TableCell>
                      <TableCell><Badge variant="outline">{nf.statusLabel}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Link href={nf.href} className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted">Ver NF</Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTableContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <AndamentoOperacaoCard etapas={detalhe.timeline} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><AlertCircle size={18} /> Pendências para você</CardTitle>
          </CardHeader>
          <CardContent>
            {detalhe.pendenciasCedente.length === 0 ? (
              <EmptyState title="Nenhuma pendência sua" description="Quando houver documento ou informação pendente de envio, aparecerá aqui." icon={CheckCircle2} />
            ) : (
              <div className="space-y-3">
                {detalhe.pendenciasCedente.map((pendencia) => (
                  <div key={pendencia.id} className="rounded-xl border border-warning/35 bg-warning/10 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-warning-foreground">{pendencia.descricao}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {pendencia.notaFiscalNumero ? `NF ${pendencia.notaFiscalNumero}` : 'Operação'}
                          {' · '}
                          {pendencia.prazo ? `${formatDate(pendencia.prazo)} · ${prazoTexto(pendencia.dias)}` : 'Sem prazo definido'}
                        </p>
                      </div>
                      {pendencia.acaoHref && <Link href={pendencia.acaoHref} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/85">Resolver na NF</Link>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText size={18} /> Comprovantes disponíveis</CardTitle>
        </CardHeader>
        <CardContent>
          {detalhe.comprovantes.length === 0 ? (
            <EmptyState title="Nenhum comprovante disponível" description="Comprovantes úteis ao cedente aparecerão aqui quando forem anexados ou liberados." icon={FileText} />
          ) : (
            <div className="flex flex-wrap gap-2">
              {detalhe.comprovantes.map((comprovante) => (
                <BotaoDownloadArquivoOperacao key={comprovante.key} operacaoId={detalhe.id} tipoDocumento={comprovante.tipoDocumento} label={comprovante.label} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <HistoricoTimelineCard entidade="operacao" entidadeId={id} />
    </div>
  )
}

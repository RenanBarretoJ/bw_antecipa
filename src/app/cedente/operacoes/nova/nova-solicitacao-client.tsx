'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Calculator, CheckSquare, Loader2, Receipt, Search, Send, Square } from 'lucide-react'
import { solicitarAntecipacao } from '@/lib/actions/operacao'
import { simularExposicaoSelecao } from '@/lib/actions/exposicao'
import type { NfCandidataOperacao, ResultadoNovaSolicitacao } from '@/lib/operacoes/nova-solicitacao.server'
import { buildListUrl } from '@/lib/pagination'
import { CalculoFinanceiroError, calcularAntecipacaoEmLote } from '@/lib/operacoes/calculo'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { ListPagination } from '@/components/pagination'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExposicaoLogisticaCard } from '@/components/operacoes/ExposicaoLogisticaCard'

export default function NovaSolicitacaoClient({ resultado }: { resultado: ResultadoNovaSolicitacao }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState<Map<string, NfCandidataOperacao>>(new Map())
  const [parcelasSelecionadas, setParcelasSelecionadas] = useState<Map<string, Set<string>>>(new Map())
  const [proformaExposicao, setProformaExposicao] = useState(resultado.proformaExposicao)
  const [atualizandoImpacto, setAtualizandoImpacto] = useState(false)
  const [erroImpacto, setErroImpacto] = useState<string | null>(null)
  const simulacaoAtual = useRef(0)
  const [busca, setBusca] = useState(resultado.filtros.q)
  const params = useMemo(() => Object.fromEntries(searchParams.entries()), [searchParams])
  const pagina = resultado.candidatas.items
  const elegiveisPagina = pagina.filter((item) => item.elegibilidade.elegivel)
  const selecaoProforma = useMemo(() => ({
    notaFiscalIds: [...selected.keys()].sort(),
    parcelaIds: [...selected.values()].flatMap((nf) => {
      if (!nf.parcelas.length) return []
      const selecionadasDaNf = parcelasSelecionadas.get(nf.id)
        || new Set(nf.parcelas.map((parcela) => parcela.id))
      return [...selecionadasDaNf]
    }).sort(),
  }), [selected, parcelasSelecionadas])

  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, params, updates)))
  }
  useEffect(() => {
    if (busca === resultado.filtros.q) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // navegar depende dos search params atuais e nao deve reiniciar o debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, resultado.filtros.q])
  useEffect(() => {
    const inelegiveisAtuais = new Set(
      pagina.filter((item) => !item.elegibilidade.elegivel).map((item) => item.id),
    )
    if (!inelegiveisAtuais.size) return
    setSelected((atual) => {
      if (![...inelegiveisAtuais].some((id) => atual.has(id))) return atual
      const proximo = new Map(atual)
      for (const id of inelegiveisAtuais) proximo.delete(id)
      return proximo
    })
    setParcelasSelecionadas((atual) => {
      if (![...inelegiveisAtuais].some((id) => atual.has(id))) return atual
      const proximo = new Map(atual)
      for (const id of inelegiveisAtuais) proximo.delete(id)
      return proximo
    })
  }, [pagina])
  useEffect(() => {
    if (!resultado.proformaExposicao) return
    const requisicao = ++simulacaoAtual.current
    if (selecaoProforma.notaFiscalIds.length === 0) {
      setProformaExposicao(resultado.proformaExposicao)
      setErroImpacto(null)
      setAtualizandoImpacto(false)
      return
    }

    setAtualizandoImpacto(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await simularExposicaoSelecao(selecaoProforma)
          if (simulacaoAtual.current !== requisicao) return
          if (result.success) {
            setProformaExposicao(result.data)
            setErroImpacto(null)
          } else {
            setErroImpacto(result.message)
          }
        } catch {
          if (simulacaoAtual.current !== requisicao) return
          setErroImpacto('Nao foi possivel atualizar o impacto estimado da selecao.')
        } finally {
          if (simulacaoAtual.current === requisicao) setAtualizandoImpacto(false)
        }
      })()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [resultado.proformaExposicao, selecaoProforma])
  const toggle = (nf: NfCandidataOperacao) => {
    if (!nf.elegibilidade.elegivel) return
    setSelected((atual) => {
      const proximo = new Map(atual)
      if (proximo.has(nf.id)) proximo.delete(nf.id)
      else proximo.set(nf.id, nf)
      return proximo
    })
    setParcelasSelecionadas((atual) => {
      const proximo = new Map(atual)
      if (selected.has(nf.id)) proximo.delete(nf.id)
      else if (nf.parcelas.length > 0) proximo.set(nf.id, new Set(nf.parcelas.map((parcela) => parcela.id)))
      return proximo
    })
  }
  // Todas as parcelas selecionadas por padrao; desmarcar mantem ao menos uma
  // (uma NF com parcelas precisa ceder pelo menos uma para ser enviada).
  const toggleParcela = (nf: NfCandidataOperacao, parcelaId: string) => {
    setParcelasSelecionadas((atual) => {
      const atuaisDaNf = atual.get(nf.id) || new Set(nf.parcelas.map((parcela) => parcela.id))
      if (atuaisDaNf.has(parcelaId) && atuaisDaNf.size === 1) return atual
      const proximasDaNf = new Set(atuaisDaNf)
      if (proximasDaNf.has(parcelaId)) proximasDaNf.delete(parcelaId)
      else proximasDaNf.add(parcelaId)
      const proximo = new Map(atual)
      proximo.set(nf.id, proximasDaNf)
      return proximo
    })
  }
  const todasDaPagina = elegiveisPagina.length > 0 && elegiveisPagina.every((item) => selected.has(item.id))
  const togglePagina = () => {
    setSelected((atual) => {
      const proximo = new Map(atual)
      for (const item of elegiveisPagina) {
        if (todasDaPagina) proximo.delete(item.id)
        else proximo.set(item.id, item)
      }
      return proximo
    })
    setParcelasSelecionadas((atual) => {
      const proximo = new Map(atual)
      for (const item of elegiveisPagina) {
        if (todasDaPagina) proximo.delete(item.id)
        else if (item.parcelas.length > 0) proximo.set(item.id, new Set(item.parcelas.map((parcela) => parcela.id)))
      }
      return proximo
    })
  }

  const itensCalculo = [...selected.values()].flatMap((nf) => {
    if (nf.parcelas.length > 0) {
      const selecionadasDaNf = parcelasSelecionadas.get(nf.id) || new Set(nf.parcelas.map((parcela) => parcela.id))
      return nf.parcelas
        .filter((parcela) => selecionadasDaNf.has(parcela.id))
        .map((parcela) => ({ id: parcela.id, valorBruto: parcela.valorNominal, vencimento: parcela.dataVencimento }))
    }
    return [{ id: nf.id, valorBruto: nf.valorBruto, vencimento: nf.vencimento }]
  })
  // O calculo pode falhar (ex.: parcela vencida) mesmo apos a filtragem do
  // servidor -- nunca deixar essa falha quebrar o render inteiro da
  // pagina; mostra um aviso no resumo em vez de derrubar a tela.
  let calculo = null
  let erroCalculo: string | null = null
  try {
    calculo = calcularAntecipacaoEmLote({
      notas: itensCalculo,
      taxas: resultado.taxas,
      dataBase: resultado.dataBase,
      metodo: resultado.metodoCalculo,
    })
  } catch (error) {
    erroCalculo = error instanceof CalculoFinanceiroError
      ? error.message
      : 'Nao foi possivel calcular o resumo para a selecao atual.'
  }
  const valorBruto = calculo?.valorBrutoTotal ?? itensCalculo.reduce((total, item) => total + item.valorBruto, 0)
  const valorLiquido = calculo?.valorLiquidoTotal ?? null

  const enviar = async () => {
    if (!selected.size) return notifications.error('Selecione ao menos uma NF.')
    setSubmitting(true)
    const parcelaIds = [...selected.values()].flatMap((nf) => {
      if (!nf.parcelas.length) return []
      const selecionadasDaNf = parcelasSelecionadas.get(nf.id) || new Set(nf.parcelas.map((parcela) => parcela.id))
      return [...selecionadasDaNf]
    })
    const result = await solicitarAntecipacao([...selected.keys()], parcelaIds.length ? parcelaIds : undefined)
    notifications.fromActionResult(result, 'Solicitacao criada.')
    if (result?.success) router.push('/cedente/operacoes')
    setSubmitting(false)
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/cedente/operacoes"><Button variant="ghost" size="icon"><ArrowLeft /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold">Nova solicitacao de antecipacao</h1>
          <p className="text-muted-foreground">Selecione NFs aprovadas e documentalmente elegiveis.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="mb-4">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(event) => setBusca(event.target.value)}
                  placeholder="Buscar por NF, sacado ou CNPJ..."
                  className="pl-9"
                />
              </div>
              <Select
                value={`${resultado.filtros.sort}:${resultado.filtros.direction}`}
                onValueChange={(value) => {
                  if (!value) return
                  const [sort, direction] = value.split(':')
                  navegar({ sort, direction, page: 1 })
                }}
              >
                <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data_vencimento:asc">Vencimento mais proximo</SelectItem>
                  <SelectItem value="data_vencimento:desc">Vencimento mais distante</SelectItem>
                  <SelectItem value="valor_bruto:desc">Maior valor</SelectItem>
                  <SelectItem value="valor_bruto:asc">Menor valor</SelectItem>
                  <SelectItem value="numero_nf:asc">Numero da NF</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          {!pagina.length ? (
            <Card><CardContent className="p-12 text-center">
              <Receipt size={44} className="mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-muted-foreground">Nenhuma NF aprovada disponivel para antecipacao.</p>
            </CardContent></Card>
          ) : (
            <Card className={isPending ? 'opacity-70' : ''}>
              <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
                <button type="button" onClick={togglePagina} className="flex items-center gap-2 text-sm">
                  {todasDaPagina ? <CheckSquare size={16} className="text-primary" /> : <Square size={16} />}
                  {todasDaPagina ? 'Desmarcar pagina' : 'Selecionar elegiveis da pagina'}
                </button>
                <span className="text-sm text-muted-foreground">{selected.size} selecionada(s)</span>
              </div>
              <div className="divide-y">
                {pagina.map((nf) => {
                  const marcado = selected.has(nf.id)
                  const bloqueado = !nf.elegibilidade.elegivel
                  const selecionadasDaNf = parcelasSelecionadas.get(nf.id) || new Set(nf.parcelas.map((parcela) => parcela.id))
                  return <div key={nf.id} className={marcado ? 'bg-primary/5' : ''}>
                    <button
                      type="button"
                      onClick={() => toggle(nf)}
                      disabled={bloqueado}
                      className={`flex w-full items-center gap-4 px-4 py-3 text-left ${marcado ? '' : 'hover:bg-muted/40'} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {marcado ? <CheckSquare size={18} className="shrink-0 text-primary" /> : <Square size={18} className="shrink-0 text-muted-foreground/40" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={nf.destinatario}>NF {nf.numero} · {nf.destinatario}</p>
                        <p className="text-xs text-muted-foreground">
                          CNPJ {formatCNPJ(nf.cnpjDestinatario)} · Venc. {formatDate(nf.vencimento)}
                          {nf.parcelas.length > 0 && ` · ${nf.parcelas.length} parcela(s)`}
                        </p>
                        {bloqueado && <p className="mt-1 text-xs text-destructive">{nf.elegibilidade.motivos.join(', ')}</p>}
                      </div>
                      <strong className="shrink-0 tabular-nums">{formatCurrency(nf.valorBruto)}</strong>
                    </button>
                    {marcado && nf.parcelas.length > 0 && (
                      <div className="ml-9 mr-4 mb-3 divide-y rounded-md border">
                        {nf.parcelas.map((parcela) => {
                          const parcelaMarcada = selecionadasDaNf.has(parcela.id)
                          return <button
                            type="button"
                            key={parcela.id}
                            onClick={() => toggleParcela(nf, parcela.id)}
                            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40"
                          >
                            {parcelaMarcada ? <CheckSquare size={15} className="shrink-0 text-primary" /> : <Square size={15} className="shrink-0 text-muted-foreground/40" />}
                            <span className="flex-1 text-muted-foreground">Parcela {String(parcela.numeroParcela).padStart(3, '0')} · Venc. {formatDate(parcela.dataVencimento)}</span>
                            <span className="tabular-nums">{formatCurrency(parcela.valorNominal)}</span>
                          </button>
                        })}
                      </div>
                    )}
                  </div>
                })}
              </div>
              <ListPagination
                className="border-t px-4 py-3"
                pagination={resultado.candidatas.pagination}
                disabled={isPending}
                onPageChange={(page) => navegar({ page })}
                onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
              />
            </Card>
          )}
        </div>
        <div className="h-fit space-y-4 lg:sticky lg:top-6">
          {proformaExposicao && (
            <div className="space-y-2">
              <ExposicaoLogisticaCard visao={proformaExposicao} variante="proforma-solicitacao" />
              {atualizandoImpacto && (
                <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground" aria-live="polite">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Atualizando impacto...
                </p>
              )}
              {erroImpacto && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                  {erroImpacto}
                </p>
              )}
            </div>
          )}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Calculator size={18} />Resumo da operacao</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">NFs selecionadas</span><strong>{selected.size}</strong></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Valor bruto</span><strong>{formatCurrency(valorBruto)}</strong></div>
            {erroCalculo ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                <p className="font-medium">Nao foi possivel estimar o valor liquido</p>
                <p className="mt-1 text-xs">{erroCalculo}</p>
              </div>
            ) : valorLiquido === null ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning-foreground">
                <p className="font-medium">Taxa pendente de definicao</p>
                <p className="mt-1 text-xs">A solicitacao pode ser enviada. O valor sera calculado antes da aprovacao.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-muted-foreground">Desconto estimado</span><span className="text-destructive">{formatCurrency(valorBruto - valorLiquido)}</span></div>
                <div className="flex justify-between border-t pt-3"><strong>Valor liquido estimado</strong><strong className="text-lg text-green-700">{formatCurrency(valorLiquido)}</strong></div>
                <p className="text-xs text-muted-foreground">Estimativa pela data da solicitacao. A aprovacao sera recalculada na data da decisao.</p>
              </>
            )}
            <Button className="mt-4 w-full" disabled={!selected.size || submitting} onClick={enviar}>
              {submitting ? <Loader2 className="animate-spin" /> : <Send />}
              {submitting ? 'Solicitando...' : 'Solicitar antecipacao'}
            </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

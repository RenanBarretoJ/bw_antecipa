'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Banknote, Eye, Search, SlidersHorizontal, X, XCircle } from 'lucide-react'
import { cancelarOperacao } from '@/lib/actions/operacao'
import type { ResultadoListagemOperacoes, PerfilListagemOperacoes } from '@/lib/operacoes/listagem.server'
import type { FiltrosOperacoes } from '@/lib/operacoes/listagem'
import { buildListUrl } from '@/lib/pagination'
import { formatCNPJ, formatCurrency, formatDate } from '@/lib/utils'
import { ListPagination } from '@/components/pagination'
import { ListNameCell } from '@/components/data-display/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNotifications } from '@/components/notifications/notification-provider'

const statusConfig: Record<string, { label: string; className: string }> = {
  solicitada: { label: 'Solicitada', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  em_analise: { label: 'Em analise', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  aprovada: { label: 'Aprovada', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  em_andamento: { label: 'Em andamento', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  liquidada: { label: 'Liquidada', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  inadimplente: { label: 'Inadimplente', className: 'bg-destructive/15 text-destructive' },
  reprovada: { label: 'Reprovada', className: 'bg-destructive/15 text-destructive' },
  cancelada: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
}

function metricas(perfil: PerfilListagemOperacoes, resultado: ResultadoListagemOperacoes) {
  if (perfil === 'gestor') return [
    ['Aguardando aceite (pagina)', resultado.metricasPagina.aguardandoAceite, 'warning'],
    ['Prontas para analise (pagina)', resultado.metricasPagina.prontasAnalise, 'purple'],
    ['Volume ativo (pagina)', formatCurrency(resultado.metricasPagina.volumeAtivo), 'success'],
    ['Total no filtro', resultado.pagination.total, 'info'],
  ] as const
  if (perfil === 'cedente') return [
    ['Total no filtro', resultado.pagination.total, 'info'],
    ['Pendentes (pagina)', resultado.metricasPagina.pendentes, 'warning'],
    ['Em andamento (pagina)', resultado.metricasPagina.emAndamento, 'purple'],
    ['Valor ativo (pagina)', formatCurrency(resultado.metricasPagina.volumeAtivo), 'success'],
  ] as const
  return []
}

const tones: Record<string, string> = {
  warning: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300',
  purple: 'bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-300',
  success: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300',
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
}

export function OperacoesPaginadas({
  perfil,
  resultado,
  filtros,
}: {
  perfil: PerfilListagemOperacoes
  resultado: ResultadoListagemOperacoes
  filtros: FiltrosOperacoes
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const notifications = useNotifications()
  const [isPending, startTransition] = useTransition()
  const [busca, setBusca] = useState(filtros.busca)
  const [filtrosAvancadosAbertos, setFiltrosAvancadosAbertos] = useState(
    Boolean(filtros.valorMin !== null || filtros.valorMax !== null || filtros.aprovadoDe || filtros.aprovadoAte),
  )
  const [valorMin, setValorMin] = useState(filtros.valorMin?.toString() ?? '')
  const [valorMax, setValorMax] = useState(filtros.valorMax?.toString() ?? '')
  const [aprovadoDe, setAprovadoDe] = useState(filtros.aprovadoDe)
  const [aprovadoAte, setAprovadoAte] = useState(filtros.aprovadoAte)
  const cards = metricas(perfil, resultado)
  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ''}`

  const currentParams = useMemo(
    () => Object.fromEntries(searchParams.entries()),
    [searchParams],
  )
  const navegar = (updates: Record<string, string | number | null>) => {
    startTransition(() => router.replace(buildListUrl(pathname, currentParams, updates)))
  }

  useEffect(() => {
    if (busca === filtros.busca) return
    const timer = window.setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)
    return () => window.clearTimeout(timer)
    // navegar depende dos search params atuais e nao deve reiniciar o debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, filtros.busca])

  const cancelar = async (id: string) => {
    const result = await cancelarOperacao(id)
    notifications.fromActionResult(result, 'Operacao cancelada.')
    if (result?.success) startTransition(() => router.refresh())
  }

  const aplicarFiltrosAvancados = () => {
    navegar({
      valorMin: valorMin || null,
      valorMax: valorMax || null,
      aprovadoDe: aprovadoDe || null,
      aprovadoAte: aprovadoAte || null,
      page: 1,
    })
  }

  const limparFiltrosAvancados = () => {
    setValorMin('')
    setValorMax('')
    setAprovadoDe('')
    setAprovadoAte('')
    navegar({
      valorMin: null,
      valorMax: null,
      aprovadoDe: null,
      aprovadoAte: null,
      page: 1,
    })
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Operacoes</h1>
          <p className="text-muted-foreground">
            {perfil === 'gestor'
              ? 'Gerencie as solicitacoes de antecipacao.'
              : perfil === 'consultor'
                ? 'Operacoes dos cedentes da sua carteira (somente leitura).'
                : 'Acompanhe suas solicitacoes de antecipacao.'}
          </p>
        </div>
        {perfil === 'cedente' && (
          <Link href="/cedente/operacoes/nova"><Button>Nova solicitacao</Button></Link>
        )}
      </div>

      {cards.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.map(([label, value, tone]) => (
            <div key={label} className={`rounded-xl p-4 ${tones[tone]}`}>
              <p className="text-xs font-medium">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                placeholder={perfil === 'cedente' ? 'Buscar pelo ID completo da operacao...' : 'Buscar por cedente, CNPJ ou ID completo...'}
                className="pl-9"
              />
            </div>
            <Select
              value={filtros.status || 'todos'}
              onValueChange={(value) => navegar({ status: value === 'todos' ? null : value, page: 1 })}
            >
              <SelectTrigger className="w-full lg:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(statusConfig).map(([value, config]) => (
                  <SelectItem key={value} value={value}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={`${filtros.ordenacao}:${filtros.direcao}`}
              onValueChange={(value) => {
                if (!value) return
                const [sort, direction] = value.split(':')
                navegar({ sort, direction, page: 1 })
              }}
            >
              <SelectTrigger className="w-full lg:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="created_at:desc">Mais recentes</SelectItem>
                <SelectItem value="created_at:asc">Mais antigas</SelectItem>
                <SelectItem value="valor_bruto_total:desc">Maior valor</SelectItem>
                <SelectItem value="valor_bruto_total:asc">Menor valor</SelectItem>
                <SelectItem value="data_vencimento:asc">Vencimento mais proximo</SelectItem>
                <SelectItem value="data_vencimento:desc">Vencimento mais distante</SelectItem>
              </SelectContent>
            </Select>
            {perfil === 'gestor' && (
              <Button
                type="button"
                variant={filtrosAvancadosAbertos ? 'secondary' : 'outline'}
                onClick={() => setFiltrosAvancadosAbertos((aberto) => !aberto)}
              >
                <SlidersHorizontal size={16} />
                Mais filtros
              </Button>
            )}
          </div>
          {perfil === 'gestor' && filtrosAvancadosAbertos && (
            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={valorMin}
                onChange={(event) => setValorMin(event.target.value)}
                placeholder="Valor minimo"
                aria-label="Valor minimo"
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                value={valorMax}
                onChange={(event) => setValorMax(event.target.value)}
                placeholder="Valor maximo"
                aria-label="Valor maximo"
              />
              <Input
                type="date"
                value={aprovadoDe}
                onChange={(event) => setAprovadoDe(event.target.value)}
                aria-label="Aprovada a partir de"
              />
              <Input
                type="date"
                value={aprovadoAte}
                onChange={(event) => setAprovadoAte(event.target.value)}
                aria-label="Aprovada ate"
              />
              <Button type="button" onClick={aplicarFiltrosAvancados}>Aplicar</Button>
              <Button type="button" variant="ghost" onClick={limparFiltrosAvancados}>
                <X size={16} />
                Limpar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {resultado.items.length === 0 ? (
        <Card><CardContent className="p-12 text-center">
          <Banknote size={44} className="mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-muted-foreground">Nenhuma operacao encontrada.</p>
        </CardContent></Card>
      ) : (
        <Card className={isPending ? 'opacity-70' : ''}>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px]">
                <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Cedente</th>
                  <th className="px-4 py-3">Valor bruto</th>
                  <th className="px-4 py-3">Taxa</th>
                  <th className="px-4 py-3">Prazo</th>
                  <th className="px-4 py-3">Liquido</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Data</th>
                  {perfil !== 'consultor' && <th className="px-4 py-3">Acoes</th>}
                </tr></thead>
                <tbody className="divide-y">
                  {resultado.items.map((item) => {
                    const status = statusConfig[item.status] || { label: item.status, className: 'bg-muted' }
                    return <tr key={item.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-sm text-muted-foreground">{item.id.slice(0, 8)}</td>
                      <td className="w-[220px] max-w-[220px] px-4 py-3">
                        <ListNameCell name={item.cedenteNome} subline={formatCNPJ(item.cedenteCnpj)} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">{formatCurrency(item.valorBruto)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.taxaDesconto > 0 ? `${item.taxaDesconto}%` : '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.prazoDias}d</td>
                      <td className="whitespace-nowrap px-4 py-3 font-bold text-green-700 tabular-nums dark:text-green-400">{formatCurrency(item.valorLiquido)}</td>
                      <td className="px-4 py-3"><Badge className={status.className}>{status.label}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">{formatDate(item.criadoEm)}</td>
                      {perfil !== 'consultor' && <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Link href={`/${perfil}/operacoes/${item.id}?returnTo=${encodeURIComponent(returnTo)}`}>
                            <Button variant="ghost" size="sm"><Eye size={14} />Ver</Button>
                          </Link>
                          {perfil === 'cedente' && item.status === 'solicitada' && (
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => cancelar(item.id)}>
                              <XCircle size={14} />Cancelar
                            </Button>
                          )}
                        </div>
                      </td>}
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
            <ListPagination
              className="border-t px-4 py-3"
              pagination={resultado.pagination}
              disabled={isPending}
              onPageChange={(page) => navegar({ page })}
              onPageSizeChange={(pageSize) => navegar({ pageSize, page: 1 })}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

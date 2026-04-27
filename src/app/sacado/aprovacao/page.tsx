'use client'

import { useEffect, useState, useMemo, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { aprovarCessao, aprovarCessaoLote, contestarCessao } from '@/lib/actions/sacado'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  Receipt,
  AlertTriangle,
  Wallet,
  Eye,
  X,
  Loader2,
  Search,
  Filter,
  CheckSquare,
  Square,
  ChevronDown,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { buckets } from '@/lib/storage'

interface NfCessao {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_vencimento: string
  status: string
  cedente_id: string
  arquivo_url: string | null
}

interface ContaInfo {
  cedente_id: string
  identificador: string
}

function LoadingSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-20 rounded-xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  )
}

export default function AprovacaoCessaoPage() {
  const [nfs, setNfs] = useState<NfCessao[]>([])
  const [contas, setContas] = useState<ContaInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [processandoLote, setProcessandoLote] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [contestando, setContestando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [preview, setPreview] = useState<{ nf: NfCessao; url: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Seleção em lote
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())

  // Filtros
  const [busca, setBusca] = useState('')
  const [filtroCedente, setFiltroCedente] = useState('')
  const [filtroVencDe, setFiltroVencDe] = useState('')
  const [filtroVencAte, setFiltroVencAte] = useState('')
  const [filtroValorMin, setFiltroValorMin] = useState('')
  const [filtroValorMax, setFiltroValorMax] = useState('')
  const [showFiltros, setShowFiltros] = useState(false)

  const loadData = async () => {
    const supabase = createClient()

    const { data: nfsData } = await supabase
      .from('notas_fiscais')
      .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_vencimento, status, cedente_id, arquivo_url')
      .eq('status', 'em_antecipacao')
      .order('data_vencimento', { ascending: true })

    setNfs((nfsData || []) as NfCessao[])

    const { data: contasData } = await supabase
      .from('contas_escrow')
      .select('cedente_id, identificador')

    setContas((contasData || []) as ContaInfo[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const openPreview = async (nf: NfCessao) => {
    if (!nf.arquivo_url) return
    setLoadingPreview(true)
    const supabase = createClient()
    const { data } = await supabase.storage
      .from(buckets.notasFiscais)
      .createSignedUrl(nf.arquivo_url, 3600)
    setPreview({ nf, url: data?.signedUrl || '' })
    setLoadingPreview(false)
  }

  const getContaEscrow = (cedenteId: string) =>
    contas.find((c) => c.cedente_id === cedenteId)?.identificador || null

  // Lista de cedentes únicos para o filtro
  const cedentesUnicos = useMemo(() => {
    const map = new Map<string, string>()
    nfs.forEach((nf) => map.set(nf.cnpj_emitente, nf.razao_social_emitente))
    return Array.from(map.entries()).map(([cnpj, nome]) => ({ cnpj, nome }))
  }, [nfs])

  // NFs filtradas
  const nfsFiltradas = useMemo(() => {
    return nfs.filter((nf) => {
      if (filtroCedente && nf.cnpj_emitente !== filtroCedente) return false
      if (filtroVencDe && nf.data_vencimento < filtroVencDe) return false
      if (filtroVencAte && nf.data_vencimento > filtroVencAte) return false
      if (filtroValorMin && nf.valor_bruto < parseFloat(filtroValorMin)) return false
      if (filtroValorMax && nf.valor_bruto > parseFloat(filtroValorMax)) return false
      if (busca) {
        const term = busca.toLowerCase()
        return (
          nf.numero_nf.toLowerCase().includes(term) ||
          nf.razao_social_emitente.toLowerCase().includes(term) ||
          nf.cnpj_emitente.includes(term)
        )
      }
      return true
    })
  }, [nfs, filtroCedente, filtroVencDe, filtroVencAte, filtroValorMin, filtroValorMax, busca])

  const todasFiltradaSelecionadas =
    nfsFiltradas.length > 0 && nfsFiltradas.every((nf) => selecionadas.has(nf.id))

  const toggleTodas = () => {
    if (todasFiltradaSelecionadas) {
      setSelecionadas((prev) => {
        const next = new Set(prev)
        nfsFiltradas.forEach((nf) => next.delete(nf.id))
        return next
      })
    } else {
      setSelecionadas((prev) => {
        const next = new Set(prev)
        nfsFiltradas.forEach((nf) => next.add(nf.id))
        return next
      })
    }
  }

  const toggleNf = (id: string) => {
    setSelecionadas((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const limparFiltros = () => {
    setBusca('')
    setFiltroCedente('')
    setFiltroVencDe('')
    setFiltroVencAte('')
    setFiltroValorMin('')
    setFiltroValorMax('')
  }

  const temFiltroAtivo = !!(filtroCedente || filtroVencDe || filtroVencAte || filtroValorMin || filtroValorMax || busca)

  const handleAprovarLote = async () => {
    const ids = Array.from(selecionadas)
    setProcessandoLote(true)
    setMessage('')
    const result = await aprovarCessaoLote(ids)
    if (result?.success) {
      setMessage(result.message || 'Aprovadas!')
      setMessageType('success')
      setSelecionadas(new Set())
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessandoLote(false)
  }

  const handleAprovar = async (nfId: string) => {
    setProcessing(nfId)
    setMessage('')
    const result = await aprovarCessao(nfId)
    if (result?.success) {
      setMessage(result.message || 'Aprovada!')
      setMessageType('success')
      setSelecionadas((prev) => { const next = new Set(prev); next.delete(nfId); return next })
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(null)
  }

  const handleContestar = async (nfId: string) => {
    if (!motivo.trim()) {
      setMessage('Informe o motivo da contestacao.')
      setMessageType('error')
      return
    }
    setProcessing(nfId)
    const result = await contestarCessao(nfId, motivo)
    if (result?.success) {
      setMessage(result.message || 'Contestada.')
      setMessageType('success')
      setContestando(null)
      setMotivo('')
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(null)
  }

  if (loading) return <LoadingSkeleton />

  const totalSelecionado = selecionadas.size
  const valorTotalSelecionado = nfs
    .filter((nf) => selecionadas.has(nf.id))
    .reduce((acc, nf) => acc + nf.valor_bruto, 0)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Aprovação de Cessão</h1>
        <p className="text-muted-foreground">Aprove ou conteste as cessoes de credito das NFs emitidas contra voce.</p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-destructive border-red-200'
        }`}>
          {message}
        </div>
      )}

      {nfs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <CheckCircle size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhuma cessao pendente de aprovação.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filtros */}
          <Card className="mb-4">
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-3 flex-col sm:flex-row">
                <div className="relative flex-1">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por NF, cedente ou CNPJ..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-9 h-10"
                  />
                </div>
                <select
                  value={filtroCedente}
                  onChange={(e) => setFiltroCedente(e.target.value)}
                  className="border border-input rounded-lg px-3 py-2 text-sm bg-background text-foreground min-w-[200px]"
                >
                  <option value="">Todos os cedentes</option>
                  {cedentesUnicos.map((c) => (
                    <option key={c.cnpj} value={c.cnpj}>{c.nome}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFiltros((v) => !v)}
                  className={`gap-2 h-10 ${temFiltroAtivo ? 'border-primary text-primary' : ''}`}
                >
                  <Filter size={14} />
                  Filtros
                  {temFiltroAtivo && (
                    <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center">
                      {[filtroVencDe, filtroVencAte, filtroValorMin, filtroValorMax].filter(Boolean).length}
                    </span>
                  )}
                  <ChevronDown size={14} className={`transition-transform ${showFiltros ? 'rotate-180' : ''}`} />
                </Button>
              </div>

              {showFiltros && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Vencimento de</Label>
                    <Input
                      type="date"
                      value={filtroVencDe}
                      onChange={(e) => setFiltroVencDe(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Vencimento até</Label>
                    <Input
                      type="date"
                      value={filtroVencAte}
                      onChange={(e) => setFiltroVencAte(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Valor mínimo (R$)</Label>
                    <Input
                      type="number"
                      placeholder="0,00"
                      value={filtroValorMin}
                      onChange={(e) => setFiltroValorMin(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Valor máximo (R$)</Label>
                    <Input
                      type="number"
                      placeholder="0,00"
                      value={filtroValorMax}
                      onChange={(e) => setFiltroValorMax(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  {temFiltroAtivo && (
                    <div className="col-span-2 md:col-span-4 flex justify-end">
                      <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-xs text-muted-foreground">
                        Limpar filtros
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Barra de ações em lote */}
          {totalSelecionado > 0 && (
            <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl flex items-center justify-between gap-4 flex-wrap">
              <div className="text-sm font-medium text-foreground">
                <span className="text-primary">{totalSelecionado}</span> NF{totalSelecionado > 1 ? 's' : ''} selecionada{totalSelecionado > 1 ? 's' : ''}{' '}
                <span className="text-muted-foreground font-normal">— Total: {formatCurrency(valorTotalSelecionado)}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelecionadas(new Set())}
                  className="text-xs text-muted-foreground"
                >
                  Desmarcar
                </Button>
                <Button
                  size="sm"
                  onClick={handleAprovarLote}
                  disabled={processandoLote}
                  className="bg-green-600 hover:bg-green-700 text-white gap-2"
                >
                  {processandoLote ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  {processandoLote ? 'Aprovando...' : `Aprovar ${totalSelecionado} NF${totalSelecionado > 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          )}

          {/* Tabela */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 w-10">
                      <button onClick={toggleTodas} className="text-muted-foreground hover:text-foreground">
                        {todasFiltradaSelecionadas
                          ? <CheckSquare size={16} className="text-primary" />
                          : <Square size={16} />
                        }
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">NF</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Cedente (Emitente)</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Valor</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Vencimento</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase">Conta Escrow</th>
                    <th className="px-4 py-3 text-xs font-medium text-muted-foreground uppercase text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {nfsFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground text-sm">
                        Nenhuma NF encontrada com os filtros aplicados.
                      </td>
                    </tr>
                  ) : (
                    nfsFiltradas.map((nf) => {
                      const contaEscrow = getContaEscrow(nf.cedente_id)
                      const isContestando = contestando === nf.id
                      const isProcessing = processing === nf.id
                      const isSelecionada = selecionadas.has(nf.id)

                      return (
                        <Fragment key={nf.id}>
                          <tr className={`hover:bg-muted/30 transition-colors ${isSelecionada ? 'bg-primary/5' : ''}`}>
                            <td className="px-4 py-3">
                              <button onClick={() => toggleNf(nf.id)} className="text-muted-foreground hover:text-foreground">
                                {isSelecionada
                                  ? <CheckSquare size={16} className="text-primary" />
                                  : <Square size={16} />
                                }
                              </button>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium tabular-nums">{nf.numero_nf}</div>
                              <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-xs mt-0.5">Cessão ativa</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <p className="font-medium text-foreground">{nf.razao_social_emitente}</p>
                              <p className="text-xs text-muted-foreground">{formatCNPJ(nf.cnpj_emitente)}</p>
                            </td>
                            <td className="px-4 py-3 text-right font-bold tabular-nums">
                              {formatCurrency(nf.valor_bruto)}
                            </td>
                            <td className="px-4 py-3 tabular-nums">
                              {formatDate(nf.data_vencimento)}
                            </td>
                            <td className="px-4 py-3">
                              {contaEscrow ? (
                                <div className="flex items-center gap-1 text-xs text-blue-700">
                                  <Wallet size={12} />
                                  <span className="font-mono">{contaEscrow}</span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-1">
                                {nf.arquivo_url && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openPreview(nf)}
                                    disabled={loadingPreview}
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                    title="Ver NF"
                                  >
                                    {loadingPreview ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  onClick={() => handleAprovar(nf.id)}
                                  disabled={isProcessing || processandoLote}
                                  className="h-8 bg-green-600 hover:bg-green-700 text-white gap-1 text-xs px-2"
                                >
                                  {isProcessing ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                  Aprovar
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setContestando(isContestando ? null : nf.id)}
                                  disabled={isProcessing || processandoLote}
                                  className="h-8 gap-1 text-xs px-2"
                                >
                                  <XCircle size={12} />
                                  Contestar
                                </Button>
                              </div>
                            </td>
                          </tr>

                          {isContestando && (
                            <tr className="bg-red-50">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="flex items-start gap-2 mb-2">
                                  <AlertTriangle size={15} className="text-destructive mt-0.5 shrink-0" />
                                  <span className="font-medium text-red-800 text-sm">Contestar NF {nf.numero_nf}</span>
                                </div>
                                <textarea
                                  value={motivo}
                                  onChange={(e) => setMotivo(e.target.value)}
                                  placeholder="Descreva o motivo da contestacao (obrigatorio)..."
                                  rows={2}
                                  className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm mb-2 bg-background"
                                />
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => { setContestando(null); setMotivo('') }}
                                  >
                                    Cancelar
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleContestar(nf.id)}
                                    disabled={isProcessing}
                                  >
                                    {isProcessing ? 'Enviando...' : 'Confirmar Contestacao'}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {nfsFiltradas.length > 0 && (
              <div className="px-4 py-3 border-t bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
                <span>{nfsFiltradas.length} NF{nfsFiltradas.length > 1 ? 's' : ''} exibida{nfsFiltradas.length > 1 ? 's' : ''}{nfs.length !== nfsFiltradas.length ? ` de ${nfs.length}` : ''}</span>
                <span className="font-medium tabular-nums">
                  Total: {formatCurrency(nfsFiltradas.reduce((acc, nf) => acc + nf.valor_bruto, 0))}
                </span>
              </div>
            )}
          </Card>
        </>
      )}

      {/* Modal de preview */}
      {preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">NF {preview.nf.numero_nf}</h3>
                <p className="text-xs text-muted-foreground">{preview.nf.razao_social_emitente} — {formatCurrency(preview.nf.valor_bruto)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPreview(null)}>
                <X size={20} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {preview.url ? (
                preview.nf.arquivo_url?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={preview.url} className="w-full h-[600px] border rounded" />
                ) : (
                  <img src={preview.url} alt={`NF ${preview.nf.numero_nf}`} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-muted-foreground text-center py-10">Nao foi possivel carregar o arquivo.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

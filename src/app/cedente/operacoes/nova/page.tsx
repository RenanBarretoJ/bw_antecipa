'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { solicitarAntecipacao } from '@/lib/actions/operacao'
import { formatCurrency, formatCNPJ, formatDate, parseLocalDate } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, CheckSquare, Square, Send, Receipt, Calculator, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface NfAprovada {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_vencimento: string
}

interface TaxaConfig {
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
}

export default function NovaSolicitacaoPage() {
  const router = useRouter()
  const [nfs, setNfs] = useState<NfAprovada[]>([])
  const [taxas, setTaxas] = useState<TaxaConfig[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()

      // Buscar NFs aprovadas
      const { data: nfsData } = await supabase
        .from('notas_fiscais')
        .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_vencimento')
        .eq('status', 'aprovada')
        .order('data_vencimento', { ascending: true })

      setNfs((nfsData || []) as NfAprovada[])

      // Buscar taxas pre-configuradas
      const { data: taxasData } = await supabase
        .from('taxas_cedente')
        .select('prazo_min, prazo_max, taxa_percentual')
        .order('prazo_min', { ascending: true })

      setTaxas((taxasData || []) as TaxaConfig[])
      setLoading(false)
    }
    load()
  }, [])

  const toggleNf = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === nfs.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(nfs.map((n) => n.id)))
    }
  }

  // Calculos
  const nfsSelecionadas = nfs.filter((n) => selected.has(n.id))
  const valorBrutoTotal = nfsSelecionadas.reduce((acc, n) => acc + n.valor_bruto, 0)

  const dataVencimentoMaisDistante = nfsSelecionadas.length > 0
    ? nfsSelecionadas.reduce((max, n) => n.data_vencimento > max ? n.data_vencimento : max, nfsSelecionadas[0].data_vencimento)
    : ''

  const prazoDias = dataVencimentoMaisDistante
    ? Math.max(1, Math.ceil((parseLocalDate(dataVencimentoMaisDistante).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  // Encontrar taxa aplicavel
  const taxaAplicavel = taxas.find((t) => prazoDias >= t.prazo_min && prazoDias <= t.prazo_max)
  const taxaPercentual = taxaAplicavel?.taxa_percentual || 0
  const taxaProporcional = (taxaPercentual / 100) * (prazoDias / 30)
  const valorDesconto = valorBrutoTotal * taxaProporcional
  const valorLiquidoEstimado = valorBrutoTotal - valorDesconto

  const handleSubmit = async () => {
    if (selected.size === 0) {
      setMessage('Selecione ao menos uma NF.')
      setMessageType('error')
      return
    }

    setSubmitting(true)
    setMessage('')

    const result = await solicitarAntecipacao(Array.from(selected))

    if (result?.success) {
      setMessage(result.message || 'Solicitacao criada!')
      setMessageType('success')
      setTimeout(() => router.push('/cedente/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro ao solicitar.')
      setMessageType('error')
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="w-9 h-9 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-2">
            <Skeleton className="h-11 w-full rounded-xl" />
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/cedente/operacoes">
          <Button variant="ghost" size="icon">
            <ArrowLeft size={20} />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nova Solicitacao de Antecipacao</h1>
          <p className="text-muted-foreground">Selecione as NFs aprovadas que deseja antecipar.</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lista de NFs */}
        <div className="lg:col-span-2">
          {nfs.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <Receipt size={48} className="mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground">Nenhuma NF aprovada disponivel para antecipacao.</p>
                <Link href="/cedente/notas-fiscais" className="text-primary hover:text-primary/80 mt-2 inline-block text-sm">
                  Enviar notas fiscais
                </Link>
              </CardContent>
            </Card>
          ) : (
            <Card className="gap-0 py-0">
              <div className="px-4 py-3 border-b border-border bg-muted/50 flex items-center justify-between rounded-t-xl">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {selected.size === nfs.length
                    ? <CheckSquare size={16} className="text-primary" />
                    : <Square size={16} />
                  }
                  {selected.size === nfs.length ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
                <span className="text-sm text-muted-foreground">{selected.size} de {nfs.length} selecionada(s)</span>
              </div>

              <div className="divide-y divide-border">
                {nfs.map((nf) => {
                  const isSelected = selected.has(nf.id)
                  return (
                    <div
                      key={nf.id}
                      onClick={() => toggleNf(nf.id)}
                      className={`px-4 py-3 flex items-center gap-4 cursor-pointer transition-colors ${
                        isSelected ? 'bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                    >
                      {isSelected
                        ? <CheckSquare size={18} className="text-primary shrink-0" />
                        : <Square size={18} className="text-muted-foreground/40 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">NF {nf.numero_nf}</span>
                          <span className="text-xs text-muted-foreground/50">|</span>
                          <span className="text-sm text-muted-foreground truncate">{nf.razao_social_destinatario}</span>
                        </div>
                        <div className="flex gap-4 text-xs text-muted-foreground/70 mt-0.5">
                          <span>CNPJ: {formatCNPJ(nf.cnpj_destinatario)}</span>
                          <span>Venc: {formatDate(nf.data_vencimento)}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-foreground tabular-nums">{formatCurrency(nf.valor_bruto)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Painel de resumo */}
        <div className="space-y-6">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator size={18} className="text-primary" />
                Resumo da Operacao
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">NFs selecionadas</span>
                  <span className="font-medium tabular-nums">{selected.size}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Bruto Total</span>
                  <span className="font-bold text-foreground tabular-nums">{formatCurrency(valorBrutoTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prazo (dias)</span>
                  <span className="font-medium tabular-nums">{prazoDias || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa (% a.m.)</span>
                  <span className="font-medium">
                    {taxaPercentual > 0 ? `${taxaPercentual}%` : 'A definir pelo gestor'}
                  </span>
                </div>

                {taxaPercentual > 0 && (
                  <>
                    <div className="flex justify-between text-destructive">
                      <span>(-) Desconto</span>
                      <span className="tabular-nums">{formatCurrency(valorDesconto)}</span>
                    </div>
                    <div className="border-t border-border pt-3 flex justify-between">
                      <span className="font-semibold text-foreground">Valor Liquido Estimado</span>
                      <span className="font-bold text-green-700 text-lg tabular-nums">{formatCurrency(valorLiquidoEstimado)}</span>
                    </div>
                  </>
                )}

                {taxaPercentual === 0 && selected.size > 0 && (
                  <div className="bg-yellow-50 rounded-lg p-3 text-xs text-yellow-700">
                    Nao ha taxa pre-configurada para este prazo. O gestor definira a taxa ao analisar.
                  </div>
                )}
              </div>

              {/* Taxas pre-configuradas */}
              {taxas.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Taxas pre-configuradas</p>
                  <div className="space-y-1">
                    {taxas.map((t, i) => (
                      <div key={i} className={`flex justify-between text-xs px-2 py-1 rounded tabular-nums ${
                        taxaAplicavel === t ? 'bg-primary/5 text-primary font-medium' : 'text-muted-foreground'
                      }`}>
                        <span>{t.prazo_min}-{t.prazo_max} dias</span>
                        <span>{t.taxa_percentual}% a.m.</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={submitting || selected.size === 0}
                className="mt-6 w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Solicitando...
                  </>
                ) : (
                  <>
                    <Send size={18} />
                    Solicitar Antecipacao
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

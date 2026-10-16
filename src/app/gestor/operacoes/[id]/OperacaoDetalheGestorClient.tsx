'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarOperacao, desembolsarOperacao, listarTestemunhasOperacao, reprovarOperacao, removerNfDaOperacao, removerParcelaDaOperacao, salvarTestemunhasOperacao, salvarQuitacaoAssinada } from '@/lib/actions/operacao'
import { liquidarOperacao, marcarInadimplente } from '@/lib/actions/liquidacao'
import { carregarResumoEntregaPorOperacao } from '@/lib/actions/logistica'
import { formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Banknote,
  FileDown,
  FileText,
  BriefcaseBusiness,
  Calculator,
  Loader2,
  Send,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BotaoDownloadContrato } from '@/components/contratos/BotaoDownloadContrato'
import { UploadDocumentoAssinado } from '@/components/contratos/UploadDocumentoAssinado'
import { UploadDocumentoAssinadoOperacao } from '@/components/contratos/UploadDocumentoAssinadoOperacao'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNotifications } from '@/components/notifications/notification-provider'
import { OperacaoParcelasTabela } from '@/components/operacoes/OperacaoParcelasTabela'
import { RemoverItemOperacaoDialog } from '@/components/operacoes/RemoverItemOperacaoDialog'
import { OperacaoResumoCard } from '@/components/operacoes/OperacaoResumoCard'
import { construirLinhasParcelasOperacao, type LinhaParcelaOperacao } from '@/lib/operacoes/parcelas-tabela'
import { useFundoAtivo } from '@/components/fundos/fundo-ativo-provider'
import { HistoricoTimelineCard } from '@/components/historico/HistoricoTimelineCard'
import { obterCapacidadesOperacao, type CapabilitiesOperacao, type DocumentoOperacaoParaPolitica } from '@/lib/operacoes/politica-operacao'
import { AndamentoOperacaoCard } from '@/components/operacoes/AndamentoOperacaoCard'
import { type ParcelaCedidaOperacao } from '@/components/operacoes/OperacaoParcelaCedidaRow'
import {
  calcularAntecipacaoEmLote,
  METODOS_CALCULO_LABELS,
  resolverMetodoCalculo,
} from '@/lib/operacoes/calculo'
import {
  formatarTaxaOperacaoInput,
  normalizarTaxaOperacao,
  parseTaxaOperacao,
  taxaEstaConfiguradaParaPrazo,
  taxaMantemPropostaConsultor,
} from '@/lib/operacoes/taxa-operacao'
import { valorBaseSnapshot, type BaseAntecipacaoSnapshot } from '@/lib/operacoes/base-antecipacao'

interface Testemunha {
  id: string
  nome: string
  cpf: string
}

interface OperacaoDetalhe {
  base_antecipacao_snapshot: BaseAntecipacaoSnapshot | null
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  conta_escrow_id: string
  valor_bruto_total: number
  taxa_desconto: number | null
  taxa_proposta_consultor: number | null
  taxa_proposta_por: string | null
  taxa_proposta_consultor_id: string | null
  taxa_proposta_em: string | null
  calculo_proposta_memoria: Record<string, unknown> | null
  prazo_dias: number
  valor_liquido_desembolso: number | null
  metodo_calculo_financeiro: string | null
  calculo_data_base: string | null
  calculo_versao_motor: number | null
  calculo_memoria: Record<string, unknown> | null
  data_vencimento: string
  status: string
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: string | null
  aceite_sacado_em: string | null
  motivo_reprovacao: string | null
  aprovado_em: string | null
  cessao_efetivada_em: string | null
  liquidada_em: string | null
  created_at: string
  testemunha_1_id: string | null
  testemunha_2_id: string | null
  termo_url: string | null
  termo_gerado_em: string | null
  notificacao_gerado_em: string | null
  quitacao_gerado_em: string | null
  termo_assinado_url: string | null
  comprovante_pagamento_url: string | null
  notificacao_url: string | null
  notificacao_assinada_url: string | null
  quitacao_url: string | null
  quitacao_assinada_url: string | null
  remessa_url: string | null
  remessa_gerado_em: string | null
  remessa_enviado_em: string | null
  remessa_fromtis_id: string | null
  politica_snapshot: unknown | null
  cedentes: {
    razao_social: string
    cnpj: string
    contrato_url: string | null
    contrato_assinado_url: string | null
  }
}

interface NfDaOperacao {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number
  valor_antecipado: number | null
  data_vencimento: string
  status: string
}

interface TaxaConfig {
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
}

interface RemessaOperacionalUi {
  remessaId: string
  formato: 'CNAB444' | 'VRS_CSV'
  estrategiaAgrupamento: 'POR_LOTE' | 'POR_CEDENTE'
  adapterKey: string
  excelDisponivel: boolean
  envioAutomaticoSuportado: boolean
  motivoBloqueioEnvio: string | null
}

interface LogisticaEntrega {
  id: string
  nota_fiscal_id: string
  status_entrega: string
  data_limite_cte: string | null
  data_limite_canhoto: string | null
  data_entrega: string | null
  entrega_confirmada_em?: string | null
  motivo_pendencia: string | null
}

interface RequisitoOperacao {
  id: string
  tipo_documento_codigo_snapshot: string | null
  escopo_snapshot: string | null
  nota_fiscal_id: string | null
  nota_fiscal_entrega_id: string | null
  operacao_id: string | null
  status: string | null
  versao_aprovada_id: string | null
  obrigatorio: boolean | null
  prazo_limite: string | null
  responsavel_upload_snapshot: string | null
}

interface MemoriaCalculoNf {
  nota_fiscal_id: string
  parcela_id: string | null
  dias_aplicados: number
  vencimento_contratual: string
  vencimento_calculo: string
  valor_nominal: number
  valor_presente: number
  desconto: number
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'

function csvCell(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? '' : String(value)
  const escaped = raw.replace(/"/g, '""')
  return /[;"\n\r]/.test(escaped) ? `"${escaped}"` : escaped
}

function csvCurrency(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  return value.toFixed(2).replace('.', ',')
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = ['sep=;', ...rows.map((row) => row.map(csvCell).join(';'))].join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const statusConfig: Record<string, { label: string; variant: BadgeVariant; className: string; icon: typeof CheckCircle }> = {
  solicitada: { label: 'Solicitada', variant: 'secondary', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock },
  em_analise: { label: 'Em Analise', variant: 'secondary', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: AlertCircle },
  aprovada: { label: 'Aprovada — Aguard. Desembolso', variant: 'secondary', className: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400', icon: CheckCircle },
  em_andamento: { label: 'Em Andamento', variant: 'secondary', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: Banknote },
  liquidada: { label: 'Liquidada', variant: 'secondary', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: CheckCircle },
  inadimplente: { label: 'Inadimplente', variant: 'destructive', className: '', icon: AlertCircle },
  reprovada: { label: 'Reprovada', variant: 'destructive', className: '', icon: XCircle },
  cancelada: { label: 'Cancelada', variant: 'outline', className: 'text-muted-foreground', icon: XCircle },
}

function PageSkeleton() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-40" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-40" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-28" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-5 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function OperacaoDetalheGestorClient({
  opId,
  returnTo,
  dataBaseServidor,
  acompanhamentoLogistico,
  exposicaoLogistica,
}: {
  opId: string
  returnTo: string
  dataBaseServidor: string
  acompanhamentoLogistico: ReactNode
  exposicaoLogistica: ReactNode
}) {
  const router = useRouter()
  const notifications = useNotifications()
  const { loading: loadingFundo, fundoAtivo, bloqueado } = useFundoAtivo()

  const [op, setOp] = useState<OperacaoDetalhe | null>(null)
  const [nfs, setNfs] = useState<NfDaOperacao[]>([])
  const [entregas, setEntregas] = useState<LogisticaEntrega[]>([])
  const [requisitos, setRequisitos] = useState<RequisitoOperacao[]>([])
  const [taxasConfig, setTaxasConfig] = useState<TaxaConfig[]>([])
  const [memoriasCalculo, setMemoriasCalculo] = useState<MemoriaCalculoNf[]>([])
  const [parcelasCedidasPorNf, setParcelasCedidasPorNf] = useState<Map<string, ParcelaCedidaOperacao[]>>(new Map())
  const [totalParcelasPorNf, setTotalParcelasPorNf] = useState<Map<string, number>>(new Map())
  const [remocaoPendente, setRemocaoPendente] = useState<LinhaParcelaOperacao | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [removendoNf, setRemovendoNf] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  useEffect(() => {
    if (!message) return
    notifications.notify({
      type: messageType,
      message,
      dedupeKey: `${messageType}:${message}`,
    })
    queueMicrotask(() => setMessage(''))
  }, [message, messageType, notifications])

  // Campos de aprovacao
  const [taxaInput, setTaxaInput] = useState('')
  const taxaNormalizada = normalizarTaxaOperacao(taxaInput)
  const taxa = taxaNormalizada === null ? null : parseTaxaOperacao(taxaNormalizada)
  const [showReprovar, setShowReprovar] = useState(false)
  const [motivo, setMotivo] = useState('')

  // Testemunhas
  const [testemunhas, setTestemunhas] = useState<Testemunha[]>([])
  const [test1Id, setTest1Id] = useState('')
  const [test2Id, setTest2Id] = useState('')
  const [salvandoTest, setSalvandoTest] = useState(false)
  const [gerandoRemessa, setGerandoRemessa] = useState(false)
  const [enviandoRemessa, setEnviandoRemessa] = useState(false)

  // Estado local para docs (atualizado após upload sem reload da página)
  const [termoAssinadoUrl, setTermoAssinadoUrl] = useState<string | null>(null)
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null)
  const [notificacaoAssinadaUrl, setNotificacaoAssinadaUrl] = useState<string | null>(null)
  const [quitacaoAssinadaUrl, setQuitacaoAssinadaUrl] = useState<string | null>(null)
  const [remessaGeradaEm, setRemessaGeradaEm] = useState<string | null>(null)
  const [remessaEnviadaEm, setRemessaEnviadaEm] = useState<string | null>(null)
  const [remessaFromtisId, setRemessaFromtisId] = useState<string | null>(null)
  const [remessaOperacional, setRemessaOperacional] = useState<RemessaOperacionalUi | null>(null)
  const [desembolsando, setDesembolsando] = useState(false)
  const [loadVersion, setLoadVersion] = useState(0)

  const capacidades = useMemo<CapabilitiesOperacao>(() => obterCapacidadesOperacao(op || {}, {
    documentos: requisitos as DocumentoOperacaoParaPolitica[],
    logistica: entregas,
  }), [op, requisitos, entregas])

  const carregarLogistica = useCallback(async () => {
    const data = await carregarResumoEntregaPorOperacao(opId)
    setEntregas(data as unknown as LogisticaEntrega[])
    return data as unknown as LogisticaEntrega[]
  }, [opId])

  useEffect(() => {
    const load = async () => {
      if (loadingFundo) return
      setLoading(true)
      if (bloqueado || !fundoAtivo?.id) {
        setOp(null)
        setNfs([])
        setEntregas([])
        setTaxasConfig([])
        setLoading(false)
        return
      }
      const supabase = createClient()

      const { data: opData } = await supabase
        .from('operacoes')
        .select('*, cedentes(razao_social, cnpj, contrato_url, contrato_assinado_url)')
        .eq('id', opId)
        .single()

      const testResult = await listarTestemunhasOperacao(opId)
      setTestemunhas((testResult.success ? testResult.data : []) as Testemunha[])

      if (opData) {
        const o = opData as OperacaoDetalhe
        if (!o.cedente_fundo_id) {
          setOp(null)
          setLoading(false)
          return
        }

        const { data: link } = await supabase
          .from('cedente_fundos')
          .select('id, fundo_id')
          .eq('id', o.cedente_fundo_id)
          .eq('fundo_id', fundoAtivo.id)
          .maybeSingle()

        if (!link) {
          setOp(null)
          setLoading(false)
          return
        }

        setOp(o)
        setTaxaInput(formatarTaxaOperacaoInput(o.taxa_proposta_consultor ?? o.taxa_desconto))
        if (o.testemunha_1_id) setTest1Id(o.testemunha_1_id)
        if (o.testemunha_2_id) setTest2Id(o.testemunha_2_id)
        setTermoAssinadoUrl(o.termo_assinado_url)
        setComprovanteUrl(o.comprovante_pagamento_url)
        setNotificacaoAssinadaUrl(o.notificacao_assinada_url)
        setQuitacaoAssinadaUrl(o.quitacao_assinada_url)
        setRemessaGeradaEm(o.remessa_gerado_em)
        setRemessaEnviadaEm(o.remessa_enviado_em)
        setRemessaFromtisId(o.remessa_fromtis_id)
        const remessaResponse = await fetch(`/api/contratos/gerar-remessa?operacao_id=${encodeURIComponent(opId)}`, {
          cache: 'no-store',
        })
        if (remessaResponse.ok) {
          setRemessaOperacional(await remessaResponse.json() as RemessaOperacionalUi | null)
        } else {
          setRemessaOperacional(null)
        }

        const { data: opNfs } = await supabase
          .from('operacoes_nfs')
          .select('nota_fiscal_id')
          .eq('operacao_id', opId)

        const nfIds = (opNfs || []).map((n) => (n as { nota_fiscal_id: string }).nota_fiscal_id)
        if (opNfs) {
          const { data: nfsData } = await supabase
            .from('notas_fiscais')
            .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status')
            .in('id', nfIds)
            .order('data_vencimento', { ascending: true })

          setNfs((nfsData || []) as NfDaOperacao[])
        }

        const { data: taxas } = await supabase
          .from('taxas_cedente')
          .select('prazo_min, prazo_max, taxa_percentual')
          .eq('cedente_id', o.cedente_id)
          .order('prazo_min', { ascending: true })

        setTaxasConfig((taxas || []) as TaxaConfig[])

        const { data: memorias } = await supabase
          .from('operacao_calculo_nfs')
          .select('nota_fiscal_id, parcela_id, dias_aplicados, vencimento_contratual, vencimento_calculo, valor_nominal, valor_presente, desconto')
          .eq('operacao_id', opId)
          .order('vencimento_contratual', { ascending: true })
        const memoriasRows = (memorias || []) as MemoriaCalculoNf[]
        setMemoriasCalculo(memoriasRows)

        // Para NF com parcelas, considerar
        // somente as parcelas efetivamente cedidas NESTA operacao via
        // operacoes_nf_parcelas -- nunca o valor integral da NF. NF sem
        // parcelas (totalParcelasPorNf sem entrada) mantem o legado intacto.
        if (nfIds.length > 0) {
          const { data: totalParcelasData } = await supabase
            .from('nota_fiscal_parcelas')
            .select('nota_fiscal_id')
            .in('nota_fiscal_id', nfIds)
          const totalMap = new Map<string, number>()
          for (const row of (totalParcelasData || []) as Array<{ nota_fiscal_id: string }>) {
            totalMap.set(row.nota_fiscal_id, (totalMap.get(row.nota_fiscal_id) || 0) + 1)
          }
          setTotalParcelasPorNf(totalMap)

          const { data: cedidasData } = await supabase
            .from('operacoes_nf_parcelas')
            .select('nota_fiscal_id, parcela_id, nota_fiscal_parcelas(numero_parcela, valor_nominal, data_vencimento)')
            .eq('operacao_id', opId)
            .in('nota_fiscal_id', nfIds)

          const memoriaPorParcela = new Map(
            memoriasRows.filter((memoria) => memoria.parcela_id).map((memoria) => [memoria.parcela_id as string, memoria]),
          )
          const cedidasMap = new Map<string, ParcelaCedidaOperacao[]>()
          type CedidaRow = {
            nota_fiscal_id: string
            parcela_id: string
            nota_fiscal_parcelas: { numero_parcela: number; valor_nominal: number; data_vencimento: string } | null
          }
          for (const row of ((cedidasData || []) as CedidaRow[])) {
            if (!row.nota_fiscal_parcelas) continue
            const memoria = memoriaPorParcela.get(row.parcela_id)
            const lista = cedidasMap.get(row.nota_fiscal_id) || []
            lista.push({
              parcelaId: row.parcela_id,
              numeroParcela: row.nota_fiscal_parcelas.numero_parcela,
              dataVencimento: row.nota_fiscal_parcelas.data_vencimento,
              valorNominal: Number(row.nota_fiscal_parcelas.valor_nominal),
              diasAplicados: memoria?.dias_aplicados ?? null,
              valorPresente: memoria ? Number(memoria.valor_presente) : null,
              desconto: memoria ? Number(memoria.desconto) : null,
            })
            cedidasMap.set(row.nota_fiscal_id, lista)
          }
          for (const lista of cedidasMap.values()) lista.sort((a, b) => a.numeroParcela - b.numeroParcela)
          setParcelasCedidasPorNf(cedidasMap)
        }
        const loadedEntregas = await carregarLogistica()
        const entregaIds = loadedEntregas.map((entrega) => entrega.id)
        const filtrosRequisitos = [
          `operacao_id.eq.${opId}`,
          nfIds.length ? `nota_fiscal_id.in.(${nfIds.join(',')})` : '',
          entregaIds.length ? `nota_fiscal_entrega_id.in.(${entregaIds.join(',')})` : '',
        ].filter(Boolean)
        const { data: requisitosData } = await supabase
          .from('documento_requisito_instancias')
          .select('id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, nota_fiscal_entrega_id, operacao_id, status, versao_aprovada_id, obrigatorio, prazo_limite, responsavel_upload_snapshot')
          .or(filtrosRequisitos.join(','))
        setRequisitos(Array.from(new Map(
          ((requisitosData || []) as unknown as RequisitoOperacao[]).map((item) => [item.id, item]),
        ).values()))
      }

      setLoading(false)
    }
    load()
  }, [opId, carregarLogistica, loadingFundo, bloqueado, fundoAtivo?.id, loadVersion])

  const metodoCalculo = useMemo(() => {
    const snapshot = op?.politica_snapshot as { calculo_financeiro?: { metodo?: string } } | null
    return resolverMetodoCalculo(op?.metodo_calculo_financeiro ?? snapshot?.calculo_financeiro?.metodo)
  }, [op?.metodo_calculo_financeiro, op?.politica_snapshot])

  // NFs arrive before their ceded parcels. Never resolve the frozen base from
  // that partial state, even though the loading skeleton is rendered below.
  const itensCalculoFinanceiro = useMemo(() => loading ? [] : nfs.flatMap((nf) => {
    const cedidas = parcelasCedidasPorNf.get(nf.id)
    if (cedidas?.length) {
      return cedidas.map((parcela) => ({
        id: `${nf.id}:${parcela.parcelaId}`,
        valorBruto: valorBaseSnapshot(op?.base_antecipacao_snapshot, nf.id, parcela.valorNominal, parcela.parcelaId),
        vencimento: parcela.dataVencimento,
      }))
    }
    return [{ id: nf.id, valorBruto: valorBaseSnapshot(op?.base_antecipacao_snapshot, nf.id, nf.valor_bruto), vencimento: nf.data_vencimento }]
  }), [loading, nfs, parcelasCedidasPorNf, op?.base_antecipacao_snapshot])

  const prazoReferencia = useMemo(() => {
    if (!op || itensCalculoFinanceiro.length === 0) return null
    // Historico deve usar a memoria persistida, nunca a versao atual do motor.
    if (!['solicitada', 'em_analise'].includes(op.status)) return null
    const dataBase = dataBaseServidor
    try {
      const calculo = calcularAntecipacaoEmLote({
        notas: itensCalculoFinanceiro,
        taxaMensal: null,
        dataBase,
        metodo: metodoCalculo,
      })
      return Math.max(...calculo.notas.map((item) => item.dias))
    } catch {
      return null
    }
  }, [dataBaseServidor, itensCalculoFinanceiro, metodoCalculo, op])

  const taxasAplicaveis = useMemo(() => prazoReferencia === null
    ? []
    : taxasConfig.filter((item) => prazoReferencia >= item.prazo_min && prazoReferencia <= item.prazo_max),
  [prazoReferencia, taxasConfig])
  const taxaMantemProposta = taxaNormalizada !== null
    && taxaMantemPropostaConsultor(taxaNormalizada, op?.taxa_proposta_consultor)
  const taxaEhAplicavel = taxaMantemProposta || (
    taxaNormalizada !== null
    && prazoReferencia !== null
    && taxaEstaConfiguradaParaPrazo(taxasAplicaveis, prazoReferencia, taxaNormalizada)
  )

  const calculoFinanceiro = useMemo(() => {
    if (!op || taxa === null || !taxaEhAplicavel || itensCalculoFinanceiro.length === 0) return null
    if (!['solicitada', 'em_analise'].includes(op.status)) return null
    const dataBase = dataBaseServidor
    try {
      return calcularAntecipacaoEmLote({
        notas: itensCalculoFinanceiro,
        taxaMensal: taxa,
        dataBase,
        metodo: metodoCalculo,
      })
    } catch {
      return null
    }
  }, [dataBaseServidor, itensCalculoFinanceiro, metodoCalculo, op, taxa, taxaEhAplicavel])

  const valorLiquido = calculoFinanceiro?.valorLiquidoTotal ?? op?.valor_liquido_desembolso ?? null


  const linhasParcelas = useMemo(() => loading ? [] : construirLinhasParcelasOperacao({
    notas: nfs,
    parcelasPorNf: parcelasCedidasPorNf,
    totalParcelasPorNf,
    snapshot: op?.base_antecipacao_snapshot,
    memoriasLegadas: memoriasCalculo,
    historico: !!op && !['solicitada', 'em_analise'].includes(op.status),
  }), [loading, nfs, parcelasCedidasPorNf, totalParcelasPorNf, op, memoriasCalculo])

  const aceiteDispensado = !capacidades.exigeAceiteSacado || op?.aceite_sacado_status === 'dispensado'
  const todasAceitas = aceiteDispensado || (nfs.length > 0 && nfs.every((nf) => nf.status === 'aceita'))

  const handleExportarNfsCsv = useCallback(() => {
    if (!op || !linhasParcelas.length) return
    const rows: Array<Array<string | number | null | undefined>> = [
      ['Operação', 'Cedente', 'NF', 'Parcela', 'Sacado', 'CNPJ sacado', 'Bruto fiscal da NF', 'Base cedida da parcela', 'Antecipado da parcela', 'Vencimento', 'Aceite'],
      ...linhasParcelas.map(l => [op.id, op.cedentes.razao_social, l.numeroNf, l.numeroParcela,
        l.sacado, formatCNPJ(l.cnpjSacado), csvCurrency(l.brutoFiscal), csvCurrency(l.baseCedida),
        csvCurrency(l.antecipado), formatDate(l.vencimento), aceiteDispensado ? 'Não exigido' : l.statusNf === 'aceita' ? 'Aprovado' : l.statusNf === 'contestada' ? 'Contestado' : 'Pendente']),
    ]
    downloadCsv(`operacao-${op.id.slice(0, 8)}-parcelas.csv`, rows)
    notifications.notify({ type: 'success', message: 'CSV das parcelas exportado.', dedupeKey: `operacao:${op.id}:csv-exportado` })
  }, [aceiteDispensado, linhasParcelas, notifications, op])

  const aplicarTaxaConfig = (t: TaxaConfig) => {
    setTaxaInput(formatarTaxaOperacaoInput(t.taxa_percentual))
  }

  const handleAprovar = async () => {
    if (taxa === null || taxaNormalizada === null || !taxaEhAplicavel) { setMessage('Mantenha a taxa proposta pelo Consultor ou informe uma taxa configurada para o prazo atual.'); setMessageType('error'); return }
    if (valorLiquido === null || valorLiquido <= 0) { setMessage('Valor liquido invalido.'); setMessageType('error'); return }

    setProcessing(true)
    const result = await aprovarOperacao(opId, taxaNormalizada)
    if (result?.success) {
      setMessage(result.message || 'Aprovada!')
      setMessageType('success')
      // Gerar Termo de Cessao automaticamente (non-blocking)
      fetch('/api/contratos/gerar-termo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao_id: opId }),
      }).catch(() => {})
      // Recarregar operacao e NFs para refletir valores salvos
      const supabase = createClient()
      const { data } = await supabase.from('operacoes').select('*, cedentes(razao_social, cnpj, contrato_url, contrato_assinado_url)').eq('id', opId).single()
      if (data) setOp(data as OperacaoDetalhe)
      const { data: opNfsAprov } = await supabase.from('operacoes_nfs').select('nota_fiscal_id').eq('operacao_id', opId)
      if (opNfsAprov) {
        const ids = (opNfsAprov as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
        if (ids.length > 0) {
          const { data: nfsAprov } = await supabase.from('notas_fiscais').select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status').in('id', ids).order('data_vencimento', { ascending: true })
          setNfs((nfsAprov || []) as NfDaOperacao[])
        }
      }
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(false)
  }

  const handleDesembolsar = async () => {
    setDesembolsando(true)
    const result = await desembolsarOperacao(opId)
    if (result?.success) {
      setMessage(result.message || 'Desembolso confirmado!')
      setMessageType('success')
      if (result.data?.riscoAtualizado === false) {
        notifications.warning('O desembolso foi confirmado, mas o risco nao foi atualizado automaticamente. Use "Atualizar risco" na Conciliacao antes de analisar a proxima operacao.')
      }
      setOp((current) => current ? { ...current, status: 'em_andamento' } : current)
      await carregarLogistica()
      setTimeout(() => router.push('/gestor/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setDesembolsando(false)
  }

  const handleRemoverItem = async (parcelaId: string | null) => {
    if (!remocaoPendente || removendoNf) return
    setRemovendoNf(remocaoPendente.notaFiscalId)
    try {
      const result = parcelaId
        ? await removerParcelaDaOperacao(opId, remocaoPendente.notaFiscalId, parcelaId)
        : await removerNfDaOperacao(opId, remocaoPendente.notaFiscalId)
      setMessage(result?.message || 'Não foi possível retirar o item da operação.')
      setMessageType(result?.success ? 'success' : 'error')
      if (result?.success) {
        setRemocaoPendente(null)
        setLoading(true)
        setLoadVersion(v => v + 1)
        router.refresh()
      }
    } catch {
      setMessage('Não foi possível confirmar a retirada. Atualize a operação antes de tentar novamente.')
      setMessageType('error')
    } finally {
      setRemovendoNf(null)
    }
  }

  const handleSalvarTestemunhas = async () => {
    if (!test1Id || !test2Id) { setMessage('Selecione as 2 testemunhas.'); setMessageType('error'); return }
    if (test1Id === test2Id) { setMessage('Selecione testemunhas diferentes.'); setMessageType('error'); return }
    setSalvandoTest(true)
    const result = await salvarTestemunhasOperacao(opId, test1Id, test2Id)
    setMessage(result?.message || '')
    setMessageType(result?.success ? 'success' : 'error')
    setSalvandoTest(false)
  }

  const handleGerarRemessa = async () => {
    if (!op) return
    setGerandoRemessa(true)
    try {
      const res = await fetch('/api/contratos/gerar-remessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao_id: op.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao gerar remessa')
      }
      setRemessaOperacional(data as RemessaOperacionalUi)
      setRemessaGeradaEm(new Date().toISOString())
      setMessage(`Remessa ${data.formato === 'VRS_CSV' ? 'VRS CSV' : 'CNAB'} gerada com agrupamento ${data.estrategiaAgrupamento === 'POR_CEDENTE' ? 'por Cedente' : 'por lote'}.`)
      setMessageType('success')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao gerar remessa.')
      setMessageType('error')
    } finally {
      setGerandoRemessa(false)
    }
  }

  const handleBaixarRemessa = (tipo: 'excel' | 'pacote') => {
    if (!remessaOperacional) return
    const url = `/api/contratos/gerar-remessa?remessa_id=${encodeURIComponent(remessaOperacional.remessaId)}&tipo=${tipo}`
    const a = document.createElement('a')
    a.href = url
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const handleEnviarRemessa = async () => {
    if (!op) return
    setEnviandoRemessa(true)
    try {
      const res = await fetch('/api/contratos/enviar-remessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao_id: op.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar remessa')
      setRemessaEnviadaEm(new Date().toISOString())
      setRemessaFromtisId(data.idArquivo)
      setMessage(`Remessa enviada para a administradora. Protocolo: ${data.idArquivo}`)
      setMessageType('success')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao enviar remessa.')
      setMessageType('error')
    } finally {
      setEnviandoRemessa(false)
    }
  }

  const handleConsultarStatusPortalFidc = async () => {
    if (!op) return
    setEnviandoRemessa(true)
    try {
      const res = await fetch('/api/contratos/consultar-status-remessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacao_id: op.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao consultar status da remessa')
      setMessage(`Status Portal FIDC: ${data.status} - ${data.mensagem}`)
      setMessageType('success')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Erro ao consultar status Portal FIDC.')
      setMessageType('error')
    } finally {
      setEnviandoRemessa(false)
    }
  }

  const handleReprovar = async () => {
    if (!motivo.trim()) { setMessage('Motivo obrigatorio.'); setMessageType('error'); return }
    setProcessing(true)
    const result = await reprovarOperacao(opId, motivo)
    if (result?.success) {
      setMessage(result.message || 'Reprovada.')
      setMessageType('success')
      setTimeout(() => router.push('/gestor/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(false)
  }

  if (loading) {
    return <PageSkeleton />
  }

  if (!op) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Operacao nao encontrada.</p>
        <Link href={returnTo} className="text-primary mt-2 inline-block">Voltar</Link>
      </div>
    )
  }

  const status = statusConfig[op.status] || statusConfig.solicitada
  const StatusIcon = status.icon
  const canAnalyze = op.status === 'solicitada' || op.status === 'em_analise'
  const canDisburse = op.status === 'aprovada'
  const canRemoveNf = ['solicitada', 'em_analise'].includes(op.status)

  // Seção de documentos visível para aprovada, em_andamento, liquidada, inadimplente
  const showDocs = ['aprovada', 'em_andamento', 'liquidada', 'inadimplente'].includes(op.status)

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-10">
      {/* Header */}
      <div className="flex min-w-0 items-start justify-between">
        <div className="flex min-w-0 w-full items-start gap-3">
          <Link href={returnTo} className="shrink-0">
            <Button variant="ghost" size="icon">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-foreground wrap-anywhere">Operacao #{op.id.substring(0, 8)}</h1>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <Badge variant={status.variant} className={status.className}>
                <StatusIcon size={12} />
                {status.label}
              </Badge>
              <span className="min-w-0 max-w-full text-sm text-muted-foreground wrap-anywhere">| {op.cedentes.razao_social} ({formatCNPJ(op.cedentes.cnpj)})</span>
              <Badge variant="outline" className="h-auto max-w-full whitespace-normal text-left wrap-anywhere">
                {op.aceite_sacado_exigido === false || op.aceite_sacado_status === 'dispensado'
                  ? 'Aceite do sacado: dispensado pela política'
                  : `Aceite do sacado: ${op.aceite_sacado_status || 'pendente'}`}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Modal reprovar */}
      {showReprovar && (
        <div className="mb-6 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
          <h3 className="font-semibold text-destructive mb-2">Reprovar Operacao</h3>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo da reprovacao (obrigatorio)..."
            rows={3}
            className="w-full border border-destructive/30 rounded-lg px-3 py-2 text-sm mb-3 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
          />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setShowReprovar(false); setMotivo('') }}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReprovar} disabled={processing}>
              {processing ? <><Loader2 size={14} className="animate-spin" /> Reprovando...</> : 'Confirmar'}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {exposicaoLogistica}
          <OperacaoParcelasTabela
            linhas={linhasParcelas}
            aceiteExigido={!aceiteDispensado}
            podeRemover={canRemoveNf}
            removendo={removendoNf !== null}
            bloqueada={processing}
            onRemover={setRemocaoPendente}
            onExportar={handleExportarNfsCsv}
          />
          {op.motivo_reprovacao && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"><strong>Motivo da reprovação:</strong> {op.motivo_reprovacao}</p>}

          {acompanhamentoLogistico}
          <AndamentoOperacaoCard
            operacao={op}
            capacidades={capacidades}
            documentos={requisitos as DocumentoOperacaoParaPolitica[]}
            logistica={entregas}
            compact
          />
          <HistoricoTimelineCard entidade="operacao" entidadeId={opId} compacto />
        </div>

        {/* Sidebar */}
        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">

          <OperacaoResumoCard
            status={op.status === 'aprovada' ? 'Aprovada' : status.label}
            statusClassName={status.className}
            valorOperacao={op.valor_bruto_total}
            taxa={canAnalyze ? taxa : op.taxa_desconto}
            metodo={METODOS_CALCULO_LABELS[metodoCalculo]}
            dataBase={canAnalyze ? dataBaseServidor : op.calculo_data_base}
            prazo={op.prazo_dias}
            valorLiquido={canAnalyze ? valorLiquido : op.valor_liquido_desembolso}
            aprovadoEm={op.aprovado_em}
            previa={canAnalyze}
          >
            {(canAnalyze || canDisburse || ['em_andamento', 'inadimplente'].includes(op.status)) ? <>
              {canAnalyze && <section className="space-y-4" aria-label="Definir termos">
                <h3 className="flex items-center gap-2 text-xs font-semibold"><Calculator size={15} aria-hidden />Definir termos</h3>

                {op.taxa_proposta_consultor !== null && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <span className="block text-xs text-muted-foreground">Taxa proposta pelo Consultor</span>
                    <strong className="tabular-nums">{op.taxa_proposta_consultor}% a.m.</strong>
                    {op.taxa_proposta_em && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Proposta em {formatDate(op.taxa_proposta_em)}
                      </span>
                    )}
                  </div>
                )}

                {op.taxa_proposta_consultor !== null || taxasAplicaveis.length > 0 ? (
                  <div className="space-y-2">
                    <Label htmlFor="taxa-final-operacao" className="text-xs">Taxa da operacao (% a.m.)</Label>
                    <Input
                      id="taxa-final-operacao"
                      inputMode="decimal"
                      value={taxaInput}
                      onChange={(event) => setTaxaInput(event.target.value)}
                      placeholder="2,50"
                      aria-invalid={Boolean(taxaInput.trim() && !taxaEhAplicavel)}
                    />
                    {taxasAplicaveis.length > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground">Valores configurados para o prazo:</p>
                        <div className="space-y-1">
                          {taxasAplicaveis.map((t, i) => (
                            <button
                              type="button"
                              key={i}
                              onClick={() => aplicarTaxaConfig(t)}
                              className={`w-full flex justify-between text-xs px-3 py-2 rounded-lg transition-colors ${
                                taxa !== null && taxaEstaConfiguradaParaPrazo([t], prazoReferencia ?? -1, taxa)
                                  ? 'bg-primary/10 text-primary font-medium'
                                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
                              }`}
                            >
                              <span className="tabular-nums">{t.prazo_min}-{t.prazo_max} dias</span>
                              <span className="tabular-nums">{t.taxa_percentual}% a.m.</span>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nao ha valores configurados para o prazo. A proposta original do Consultor pode ser mantida.</p>
                    )}
                    {taxaInput.trim() && !taxaEhAplicavel && (
                      <p className="text-xs text-destructive">Mantenha a proposta do Consultor ou selecione um valor configurado para o prazo atual.</p>
                    )}
                    {op.taxa_proposta_consultor !== null && taxa !== null && taxa !== op.taxa_proposta_consultor && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        A taxa final foi alterada em relacao a proposta do Consultor. A proposta original sera preservada.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Nenhuma taxa foi configurada para o prazo desta operacao. A solicitacao permanece registrada, mas a aprovacao fica bloqueada ate a configuracao da faixa correspondente.
                  </div>
                )}

                {testemunhas.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground">Testemunhas do Termo</p>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Testemunha 1</Label>
                        <Select value={test1Id} onValueChange={(v) => setTest1Id(v ?? '')}>
                          <SelectTrigger className="h-9 text-xs w-full">
                            <SelectValue placeholder="Selecionar...">
                              {test1Id ? (
                                <span className="truncate max-w-[160px] block">
                                  {testemunhas.find(t => t.id === test1Id)?.nome ?? test1Id}
                                </span>
                              ) : undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-w-[260px]">
                            {testemunhas.filter(t => t.id !== test2Id).map((t) => (
                              <SelectItem key={t.id} value={t.id} className="text-xs">
                                <span className="truncate">{t.nome} — {t.cpf}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Testemunha 2</Label>
                        <Select value={test2Id} onValueChange={(v) => setTest2Id(v ?? '')}>
                          <SelectTrigger className="h-9 text-xs w-full">
                            <SelectValue placeholder="Selecionar...">
                              {test2Id ? (
                                <span className="truncate max-w-[160px] block">
                                  {testemunhas.find(t => t.id === test2Id)?.nome ?? test2Id}
                                </span>
                              ) : undefined}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-w-[260px]">
                            {testemunhas.filter(t => t.id !== test1Id).map((t) => (
                              <SelectItem key={t.id} value={t.id} className="text-xs">
                                <span className="truncate">{t.nome} — {t.cpf}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSalvarTestemunhas}
                        disabled={salvandoTest}
                        className="w-full text-xs"
                      >
                        {salvandoTest ? <Loader2 size={12} className="animate-spin" /> : null}
                        Salvar Testemunhas
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {!todasAceitas && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                      Aguardando aprovação de todas as NFs pelo sacado antes de aprovar.
                    </p>
                  )}
                  <Button
                    onClick={handleAprovar}
                    disabled={processing || !todasAceitas || taxa === null || !calculoFinanceiro}
                    className="w-full bg-teal-600 hover:bg-teal-700 text-white h-11 disabled:opacity-50"
                  >
                    {processing ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                    {processing ? 'Processando...' : 'Aprovar e Seguir'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => setShowReprovar(true)}
                    disabled={processing}
                    className="w-full"
                  >
                    <XCircle size={16} />
                    Reprovar
                  </Button>
                </div>

              </section>}
              {canDisburse && <div className="space-y-3">
                  {(!termoAssinadoUrl || !comprovanteUrl) && (
                    <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-2">
                      Envie os documentos assinados e o comprovante TED para liberar o desembolso.
                    </p>
                  )}

                  <Button
                    onClick={handleDesembolsar}
                    disabled={desembolsando || !termoAssinadoUrl || !comprovanteUrl}
                    className="w-full bg-green-600 hover:bg-green-700 text-white h-11 disabled:opacity-50"
                  >
                    {desembolsando ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    {desembolsando ? 'Processando...' : 'Desembolsar'}
                  </Button>

              </div>}
                {(op.status === 'em_andamento' || op.status === 'inadimplente') && (
                  <div className="space-y-2">
                    <Button
                      onClick={async () => {
                        setProcessing(true)
                        const result = await liquidarOperacao(op.id)
                        if (result?.success) {
                          setMessage(result.message || 'Liquidada!')
                          setMessageType('success')
                          setTimeout(() => router.push('/gestor/operacoes'), 1500)
                        } else {
                          setMessage(result?.message || 'Erro.')
                          setMessageType('error')
                        }
                        setProcessing(false)
                      }}
                      disabled={processing}
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                    >
                      {processing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      {processing ? 'Processando...' : 'Confirmar Liquidacao'}
                    </Button>
                    {op.status === 'em_andamento' && (
                      <Button
                        variant="destructive"
                        onClick={async () => {
                          setProcessing(true)
                          const result = await marcarInadimplente(op.id)
                          if (result?.success) {
                            setMessage(result.message || 'Marcada.')
                            setMessageType('success')
                            setTimeout(() => router.push('/gestor/operacoes'), 1500)
                          } else {
                            setMessage(result?.message || 'Erro.')
                            setMessageType('error')
                          }
                          setProcessing(false)
                        }}
                        disabled={processing}
                        className="w-full"
                      >
                        <AlertCircle size={14} />
                        Marcar Inadimplente
                      </Button>
                    )}
                  </div>
                )}
            </> : null}
          </OperacaoResumoCard>

          {showDocs && (
            <div className="space-y-5">
              <Card className="gap-0 rounded-xl border border-border/80 py-0 shadow-none ring-0">
                <CardHeader className="px-4 pt-4 pb-1"><CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-[13px] font-semibold"><FileText size={16} aria-hidden />Documentos gerados</CardTitle></CardHeader>
                <CardContent className="px-0 pt-0">
                  <div className="divide-y divide-border/70">
                    <BotaoDownloadContrato
                      tipo="contrato"
                      apresentacao="linha"
                      id={op.cedente_id}
                      storagePath={op.cedentes.contrato_url}
                      hasSignedDoc={!!op.cedentes.contrato_assinado_url}
                      label="Contrato-mãe"
                      className="w-full"
                    />
                    <BotaoDownloadContrato
                      tipo="termo"
                      apresentacao="linha"
                      label="Termo de cessão"
                      geradoEm={op.termo_gerado_em}
                      id={op.id}
                      storagePath={op.termo_url}
                      hasSignedDoc={!!termoAssinadoUrl}
                      className="w-full"
                    />
                    <BotaoDownloadContrato
                      tipo="notificacao"
                      apresentacao="linha"
                      geradoEm={op.notificacao_gerado_em}
                      id={op.id}
                      storagePath={op.notificacao_url}
                      hasSignedDoc={!!notificacaoAssinadaUrl}
                      label="Notificação ao sacado"
                      className="w-full"
                    />
                    {op.status === 'liquidada' && (
                      <BotaoDownloadContrato
                        tipo="quitacao"
                        apresentacao="linha"
                        geradoEm={op.quitacao_gerado_em}
                        id={op.id}
                        storagePath={op.quitacao_url}
                        hasSignedDoc={!!quitacaoAssinadaUrl}
                        label="Termo de quitação"
                        className="w-full"
                      />
                    )}
                  </div>

                </CardContent>
              </Card>
              <Card className="gap-0 rounded-xl border border-border/80 py-0 shadow-none ring-0">
                <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pt-4 pb-1"><CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-[13px] font-semibold"><CheckCircle size={16} aria-hidden />Assinados e comprovantes</CardTitle><span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground" aria-label="Arquivos recebidos entre os itens exibidos">{[termoAssinadoUrl, notificacaoAssinadaUrl, comprovanteUrl, ...(op.status === 'liquidada' ? [quitacaoAssinadaUrl] : [])].filter(Boolean).length}/{op.status === 'liquidada' ? 4 : 3}</span></CardHeader>
                <CardContent className="px-0 pt-0">
                  <div className="divide-y divide-border/70">
                    <UploadDocumentoAssinadoOperacao
                      apresentacao="linha"
                      label="Termo de cessão assinado"
                      storagePath={termoAssinadoUrl}
                      operacaoId={op.id}
                      tipoDocumento="TERMO_CESSAO_ASSINADO"
                      onSuccess={() => setTermoAssinadoUrl('registrado')}
                    />
                    <UploadDocumentoAssinadoOperacao
                      apresentacao="linha"
                      label="Notificação assinada"
                      storagePath={notificacaoAssinadaUrl}
                      operacaoId={op.id}
                      tipoDocumento="NOTIFICACAO_SACADO_ASSINADA"
                      onSuccess={() => setNotificacaoAssinadaUrl('registrado')}
                    />
                    <UploadDocumentoAssinadoOperacao
                      apresentacao="linha"
                      label="Comprovante TED"
                      storagePath={comprovanteUrl}
                      operacaoId={op.id}
                      tipoDocumento="COMPROVANTE_DESEMBOLSO_TED"
                      destaquePendente={canDisburse}
                      onSuccess={() => setComprovanteUrl('registrado')}
                    />
                    {op.status === 'liquidada' && (
                      <UploadDocumentoAssinado
                        apresentacao="linha"
                        label="Termo de quitação assinado"
                        storagePath={quitacaoAssinadaUrl}
                        uploadPath={`operacoes/${op.id}/termo-quitacao-assinado.pdf`}
                        tipoEntidade="operacao"
                        entidadeId={op.id}
                        tipoDocumento="quitacao_assinada"
                        onSuccess={async (path) => {
                          await salvarQuitacaoAssinada(op.id, path)
                          setQuitacaoAssinadaUrl(path)
                        }}
                      />
                    )}
                  </div>

                </CardContent>
              </Card>
              <Card className="gap-0 rounded-xl border border-border/80 py-0 shadow-none ring-0">
                <CardHeader className="flex flex-row items-center justify-between gap-2 px-4 pt-4 pb-2"><CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-[13px] font-semibold"><BriefcaseBusiness size={16} aria-hidden />Remessa</CardTitle><Badge variant="outline" className="rounded-md text-[10px]">{remessaEnviadaEm ? 'Enviada' : remessaGeradaEm ? 'Gerada' : 'Não enviada'}</Badge></CardHeader>
                <CardContent className="space-y-2 px-4 pt-0 pb-4">
                  <p className="text-xs text-muted-foreground">Arquivo e envio para a administradora.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGerarRemessa}
                    disabled={gerandoRemessa}
                    className="w-full gap-2"
                  >
                    {gerandoRemessa ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
                    {gerandoRemessa ? 'Gerando...' : 'Gerar Remessa'}
                  </Button>
                  {remessaOperacional && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button variant="outline" size="sm" onClick={() => handleBaixarRemessa('excel')} className="w-full gap-2"><FileDown size={14} />Baixar Excel</Button>
                      <Button variant="outline" size="sm" onClick={() => handleBaixarRemessa('pacote')} className="w-full gap-2"><FileDown size={14} />Baixar pacote</Button>
                      <p className="sm:col-span-2 text-xs text-muted-foreground">Formato: {remessaOperacional.formato === 'VRS_CSV' ? 'VRS CSV' : 'CNAB'} · Agrupamento: {remessaOperacional.estrategiaAgrupamento === 'POR_CEDENTE' ? 'por Cedente' : 'por lote'}</p>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnviarRemessa}
                    disabled={enviandoRemessa || !remessaGeradaEm || !remessaOperacional?.envioAutomaticoSuportado}
                    title={remessaOperacional?.motivoBloqueioEnvio ?? undefined}
                    className="w-full gap-2"
                  >
                    {enviandoRemessa ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {enviandoRemessa ? 'Enviando...' : remessaEnviadaEm ? 'Reenviar para ADM' : 'Enviar para ADM'}
                  </Button>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">{remessaEnviadaEm ? `Último envio em ${formatDate(remessaEnviadaEm)}.` : !remessaGeradaEm ? 'Disponível após a geração do arquivo.' : remessaOperacional?.motivoBloqueioEnvio ?? 'Arquivo gerado. Confira os dados antes do envio.'}</p>
                  {remessaFromtisId && (
                    <p className="text-xs text-muted-foreground">Protocolo Portal FIDC: {remessaFromtisId}</p>
                  )}
                  {remessaFromtisId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleConsultarStatusPortalFidc}
                      disabled={enviandoRemessa}
                      className="w-full gap-2"
                    >
                      Consultar status Portal FIDC
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {canAnalyze && (
            <Link
              href={`/gestor/cedentes/${op.cedente_id}`}
              className="block text-center text-sm text-primary hover:underline"
            >
              Gerenciar taxas deste cedente
            </Link>
          )}
        </aside>
      </div>

      {remocaoPendente && canRemoveNf && (
        <RemoverItemOperacaoDialog
          key={remocaoPendente.id}
          linha={remocaoPendente}
          linhasDaNf={linhasParcelas.filter(l => l.notaFiscalId === remocaoPendente.notaFiscalId)}
          processando={removendoNf !== null}
          onClose={() => setRemocaoPendente(null)}
          onConfirm={handleRemoverItem}
        />
      )}
    </div>
  )
}

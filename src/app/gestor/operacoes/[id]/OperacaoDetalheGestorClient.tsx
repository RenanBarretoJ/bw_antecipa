'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { aprovarOperacao, desembolsarOperacao, listarTestemunhasOperacao, reprovarOperacao, removerNfDaOperacao, salvarTestemunhasOperacao, salvarQuitacaoAssinada } from '@/lib/actions/operacao'
import { liquidarOperacao, marcarInadimplente } from '@/lib/actions/liquidacao'
import { carregarResumoEntregaPorOperacao } from '@/lib/actions/logistica'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  XCircle,
  Clock,
  AlertCircle,
  Banknote,
  FileText,
  FileDown,
  Calculator,
  Loader2,
  Send,
  Truck,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BotaoDownloadContrato } from '@/components/contratos/BotaoDownloadContrato'
import { UploadDocumentoAssinado } from '@/components/contratos/UploadDocumentoAssinado'
import { UploadDocumentoAssinadoOperacao } from '@/components/contratos/UploadDocumentoAssinadoOperacao'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useNotifications } from '@/components/notifications/notification-provider'
import {
  OperacaoNotaFiscalCard,
  buildOperacaoNotaFiscalView,
  resolveStatusCurtoDaNota,
  type OperacaoNotaFiscalView,
} from '@/components/operacoes/OperacaoNotaFiscalCard'
import { useFundoAtivo } from '@/components/fundos/fundo-ativo-provider'
import { HistoricoTimelineCard } from '@/components/historico/HistoricoTimelineCard'
import { obterCapacidadesOperacao, type CapabilitiesOperacao, type DocumentoOperacaoParaPolitica } from '@/lib/operacoes/politica-operacao'
import { AndamentoOperacaoCard } from '@/components/operacoes/AndamentoOperacaoCard'
import {
  calcularAntecipacaoEmLote,
  METODOS_CALCULO_LABELS,
  resolverMetodoCalculo,
} from '@/lib/operacoes/calculo'

interface Testemunha {
  id: string
  nome: string
  cpf: string
}

interface OperacaoDetalhe {
  id: string
  cedente_id: string
  cedente_fundo_id: string | null
  conta_escrow_id: string
  valor_bruto_total: number
  taxa_desconto: number | null
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

interface ParcelaCedidaOperacao {
  parcelaId: string
  numeroParcela: number
  dataVencimento: string
  valorNominal: number
  diasAplicados: number | null
  valorPresente: number | null
  desconto: number | null
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'
type NotaFiscalSort = 'vencimento' | 'numero' | 'sacado' | 'valor' | 'status'

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

const entregaStatusConfig: Record<string, { label: string; className: string }> = {
  nao_aplicavel: { label: 'Nao aplicavel', className: 'bg-muted text-muted-foreground' },
  em_transito: { label: 'Em transito', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  aguardando_validacao: { label: 'Aguard. validacao', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  entregue: { label: 'Entregue', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  entrega_com_pendencia: { label: 'Com pendencia', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  devolvida: { label: 'Devolvida', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  cancelada: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
}

function NfStatusBadge({
  status,
  aceiteDispensado,
  operacaoAprovada,
  entregaStatus,
}: {
  status: string
  aceiteDispensado: boolean
  operacaoAprovada: boolean
  entregaStatus?: string | null
}) {
  if (entregaStatus === 'em_transito') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 whitespace-nowrap">
        <Truck size={11} /> Em trânsito
      </span>
    )
  }

  if (entregaStatus === 'aguardando_validacao') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 whitespace-nowrap">
        <Clock size={11} /> Aguard. validação
      </span>
    )
  }

  if (entregaStatus === 'entregue') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 whitespace-nowrap">
        <CheckCircle size={11} /> Entregue
      </span>
    )
  }

  if (entregaStatus === 'entrega_com_pendencia') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 whitespace-nowrap">
        <AlertCircle size={11} /> Pendência entrega
      </span>
    )
  }

  if (status === 'aceita') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 whitespace-nowrap">
        <CheckCircle size={11} /> Aprov. Sacado
      </span>
    )
  }

  if (status === 'contestada') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 whitespace-nowrap">
        Contestada
      </span>
    )
  }

  if (status === 'em_antecipacao' && aceiteDispensado) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 whitespace-nowrap">
        <CheckCircle size={11} /> Aceite dispensado
      </span>
    )
  }

  if (status === 'em_antecipacao' && operacaoAprovada) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 whitespace-nowrap">
        <CheckCircle size={11} /> Aprov. gestor
      </span>
    )
  }

  if (status === 'em_antecipacao') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 whitespace-nowrap">
        Aguard. aprovação
      </span>
    )
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground whitespace-nowrap">
      {status}
    </span>
  )
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
  const [nfsExpandidas, setNfsExpandidas] = useState<Set<string>>(new Set())
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
  const [taxa, setTaxa] = useState<number | null>(null)
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
  const [nfSort, setNfSort] = useState<NotaFiscalSort>('vencimento')

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
        setTaxa(o.taxa_desconto)
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

        // Detalhe por parcela (Objetivo A): NF continua agrupadora visual,
        // mas para NF com parcelas os totais/expand devem representar
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
  }, [opId, carregarLogistica, loadingFundo, bloqueado, fundoAtivo?.id])

  const metodoCalculo = useMemo(() => {
    const snapshot = op?.politica_snapshot as { calculo_financeiro?: { metodo?: string } } | null
    return resolverMetodoCalculo(op?.metodo_calculo_financeiro ?? snapshot?.calculo_financeiro?.metodo)
  }, [op?.metodo_calculo_financeiro, op?.politica_snapshot])

  const itensCalculoFinanceiro = useMemo(() => nfs.flatMap((nf) => {
    const cedidas = parcelasCedidasPorNf.get(nf.id)
    if (cedidas?.length) {
      return cedidas.map((parcela) => ({
        id: `${nf.id}:${parcela.parcelaId}`,
        valorBruto: parcela.valorNominal,
        vencimento: parcela.dataVencimento,
      }))
    }
    return [{ id: nf.id, valorBruto: nf.valor_bruto, vencimento: nf.data_vencimento }]
  }), [nfs, parcelasCedidasPorNf])

  const prazoReferencia = useMemo(() => {
    if (!op || itensCalculoFinanceiro.length === 0) return null
    const dataBase = ['solicitada', 'em_analise'].includes(op.status)
      ? dataBaseServidor
      : op.calculo_data_base || dataBaseServidor
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
  const taxaEhAplicavel = taxa !== null && taxasAplicaveis.some((item) => item.taxa_percentual === taxa)

  const calculoFinanceiro = useMemo(() => {
    if (!op || taxa === null || !taxaEhAplicavel || itensCalculoFinanceiro.length === 0) return null
    const dataBase = ['solicitada', 'em_analise'].includes(op.status)
      ? dataBaseServidor
      : op.calculo_data_base || dataBaseServidor
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

  const entregaPorNfId = useMemo(() => new Map(entregas.map((entrega) => [entrega.nota_fiscal_id, entrega])), [entregas])

  const notasFiscaisView = useMemo<OperacaoNotaFiscalView[]>(() => {
    const views = nfs.map((nf) => {
      // Objetivo A: para NF com parcelas cedidas nesta operacao (subset da
      // NF), o bruto/antecipado exibidos representam so as parcelas
      // cedidas, nunca o valor integral da NF. NF sem parcela (nenhuma
      // linha em operacoes_nf_parcelas para ela) mantem o legado intacto.
      const cedidas = parcelasCedidasPorNf.get(nf.id)
      const brutoCedido = cedidas?.length ? cedidas.reduce((soma, item) => soma + item.valorNominal, 0) : null
      const antecipadoMemoria = cedidas?.length && cedidas.every((item) => item.valorPresente !== null)
        ? cedidas.reduce((soma, item) => soma + (item.valorPresente ?? 0), 0)
        : null
      const memoriasDaNf = memoriasCalculo.filter((item) => item.nota_fiscal_id === nf.id)
      const antecipadoLegadoPersistido = memoriasDaNf.length > 0
        ? memoriasDaNf.reduce((soma, item) => soma + Number(item.valor_presente), 0)
        : null
      const operacaoEmPreparacao = op?.status === 'solicitada' || op?.status === 'em_analise'
      const antecipadoPersistido = cedidas?.length
        ? antecipadoMemoria
        : antecipadoLegadoPersistido
          ?? (!operacaoEmPreparacao ? (nf.valor_antecipado ?? nf.valor_liquido) : null)
          ?? (!operacaoEmPreparacao && nfs.length === 1 ? op?.valor_liquido_desembolso ?? null : null)

      return buildOperacaoNotaFiscalView({
        notaFiscal: {
          id: nf.id,
          numero_nf: nf.numero_nf,
          cnpj_destinatario: nf.cnpj_destinatario,
          razao_social_destinatario: nf.razao_social_destinatario,
          valor_bruto: brutoCedido ?? nf.valor_bruto,
          data_vencimento: nf.data_vencimento,
          status: nf.status,
        },
        // O card exibe somente memoria/valor persistido. A simulacao local
        // permanece restrita ao formulario de decisao e nao vira fonte de
        // verdade da NF antes da aprovacao.
        valorAntecipado: antecipadoPersistido,
      })
    })

    return views.sort((a, b) => {
      if (nfSort === 'numero') return a.numero_nf.localeCompare(b.numero_nf, 'pt-BR', { numeric: true })
      if (nfSort === 'sacado') return a.razao_social_destinatario.localeCompare(b.razao_social_destinatario, 'pt-BR')
      if (nfSort === 'valor') return b.valor_bruto - a.valor_bruto
      if (nfSort === 'status') return a.status.localeCompare(b.status, 'pt-BR')
      return new Date(a.data_vencimento).getTime() - new Date(b.data_vencimento).getTime()
    })
  }, [memoriasCalculo, nfs, nfSort, op?.status, op?.valor_liquido_desembolso, parcelasCedidasPorNf])

  const totaisNfs = useMemo(() => ({
    bruto: op?.valor_bruto_total ?? notasFiscaisView.reduce((acc, nf) => acc + nf.valor_bruto, 0),
    antecipado: op?.valor_liquido_desembolso ?? null,
  }), [notasFiscaisView, op?.valor_bruto_total, op?.valor_liquido_desembolso])

  const aceiteDispensado = !!op && (op.aceite_sacado_exigido === false || op.aceite_sacado_status === 'dispensado')
  const todasAceitas = aceiteDispensado || (nfs.length > 0 && nfs.every((nf) => nf.status === 'aceita'))

  const handleExportarNfsCsv = useCallback(() => {
    if (!op || notasFiscaisView.length === 0) {
      notifications.notify({
        type: 'info',
        message: 'Esta operacao ainda nao possui NFs para exportar.',
        dedupeKey: `operacao:${opId}:csv-vazio`,
      })
      return
    }

    const rows: Array<Array<string | number | null | undefined>> = [
      [
        'Operacao',
        'Cedente',
        'CNPJ cedente',
        'Numero NF',
        'Sacado',
        'CNPJ sacado',
        'Valor bruto',
        'Valor antecipado',
        'Prazo dias',
        'Vencimento',
        'Status NF',
        'Status logistico',
      ],
      ...notasFiscaisView.map((nf) => {
        const entregaStatus = entregaPorNfId.get(nf.id)?.status_entrega ?? null
        return [
          op.id,
          op.cedentes.razao_social,
          formatCNPJ(op.cedentes.cnpj),
          nf.numero_nf,
          nf.razao_social_destinatario,
          formatCNPJ(nf.cnpj_destinatario),
          csvCurrency(nf.valor_bruto),
          csvCurrency(nf.valor_antecipado),
          nf.prazo_dias,
          formatDate(nf.data_vencimento),
          resolveStatusCurtoDaNota(nf.status, entregaStatus, aceiteDispensado),
          entregaStatus ? entregaStatusConfig[entregaStatus]?.label ?? entregaStatus : '',
        ]
      }),
    ]

    downloadCsv(`operacao-${op.id.slice(0, 8)}-notas-fiscais.csv`, rows)
    notifications.notify({
      type: 'success',
      message: 'CSV das NFs exportado.',
      dedupeKey: `operacao:${op.id}:csv-exportado`,
    })
  }, [aceiteDispensado, entregaPorNfId, notasFiscaisView, notifications, op, opId])

  const aplicarTaxaConfig = (t: TaxaConfig) => {
    setTaxa(t.taxa_percentual)
  }

  const handleAprovar = async () => {
    if (taxa === null || taxa < 0 || !taxaEhAplicavel) { setMessage('Selecione uma taxa configurada para o prazo atual da operacao.'); setMessageType('error'); return }
    if (valorLiquido === null || valorLiquido <= 0) { setMessage('Valor liquido invalido.'); setMessageType('error'); return }

    setProcessing(true)
    const result = await aprovarOperacao(opId, taxa)
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
      setOp((current) => current ? { ...current, status: 'em_andamento' } : current)
      await carregarLogistica()
      setTimeout(() => router.push('/gestor/operacoes'), 2000)
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setDesembolsando(false)
  }

  const handleRemoverNf = async (nfId: string) => {
    setRemovendoNf(nfId)
    const result = await removerNfDaOperacao(opId, nfId)
    setMessage(result?.message || 'Erro.')
    setMessageType(result?.success ? 'success' : 'error')
    if (result?.success) {
      const supabase = createClient()
      const { data: opAtual } = await supabase.from('operacoes').select('*, cedentes(razao_social, cnpj, contrato_url, contrato_assinado_url)').eq('id', opId).single()
      if (opAtual) setOp(opAtual as OperacaoDetalhe)
      const { data: opNfs } = await supabase.from('operacoes_nfs').select('nota_fiscal_id').eq('operacao_id', opId)
      if (opNfs) {
        const ids = (opNfs as Array<{ nota_fiscal_id: string }>).map((n) => n.nota_fiscal_id)
        if (ids.length > 0) {
          const { data: nfsAtt } = await supabase.from('notas_fiscais').select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status').in('id', ids).order('data_vencimento', { ascending: true })
          setNfs((nfsAtt || []) as NfDaOperacao[])
        } else {
          setNfs([])
        }
      }
    }
    setRemovendoNf(null)
  }

  const toggleNfExpandida = (nfId: string) => {
    setNfsExpandidas((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(nfId)) proximo.delete(nfId)
      else proximo.add(nfId)
      return proximo
    })
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={returnTo}>
            <Button variant="ghost" size="icon">
              <ArrowLeft size={20} />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Operacao #{op.id.substring(0, 8)}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={status.variant} className={status.className}>
                <StatusIcon size={12} />
                {status.label}
              </Badge>
              <span className="text-sm text-muted-foreground">| {op.cedentes.razao_social} ({formatCNPJ(op.cedentes.cnpj)})</span>
              <Badge variant="outline" className="ml-2">
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
          {/* NFs da operacao */}
          <Card className="overflow-visible">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText size={18} />
                    Notas Fiscais ({notasFiscaisView.length})
                  </CardTitle>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:min-w-[420px]">
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Total bruto</p>
                    <p className="font-semibold tabular-nums">{formatCurrency(totaisNfs.bruto)}</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Antecipado</p>
                    <p className="font-semibold text-success-foreground tabular-nums">{totaisNfs.antecipado === null ? '—' : formatCurrency(totaisNfs.antecipado)}</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Diferença</p>
                    <p className="font-semibold tabular-nums">{totaisNfs.antecipado === null ? '—' : formatCurrency(Math.max(0, totaisNfs.bruto - totaisNfs.antecipado))}</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {notasFiscaisView.length === 1 ? '1 NF vinculada' : `${notasFiscaisView.length} NFs vinculadas`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExportarNfsCsv}
                    disabled={notasFiscaisView.length === 0}
                    className="h-9 gap-2"
                  >
                    <FileDown size={14} />
                    Exportar CSV
                  </Button>
                  <span className="text-sm text-muted-foreground">Ordenar por</span>
                  <Select value={nfSort} onValueChange={(value) => setNfSort(value as NotaFiscalSort)}>
                    <SelectTrigger className="h-9 w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vencimento">Vencimento</SelectItem>
                      <SelectItem value="numero">Número</SelectItem>
                      <SelectItem value="sacado">Sacado</SelectItem>
                      <SelectItem value="valor">Valor</SelectItem>
                      <SelectItem value="status">Status</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-3">
                {notasFiscaisView.map((nf, index) => {
                  const totalParcelas = totalParcelasPorNf.get(nf.id) || 0
                  const cedidas = parcelasCedidasPorNf.get(nf.id) || []
                  const expandido = nfsExpandidas.has(nf.id)
                  return (
                    <div key={nf.id}>
                      <OperacaoNotaFiscalCard
                        notaFiscal={nf}
                        href={`/gestor/notas-fiscais/${nf.id}`}
                        menuPlacement={index === notasFiscaisView.length - 1 ? 'top' : 'bottom'}
                        canRemove={canRemoveNf}
                        removing={removendoNf === nf.id}
                        onRemove={() => handleRemoverNf(nf.id)}
                        statusNode={(
                          <NfStatusBadge
                            status={nf.status}
                            aceiteDispensado={aceiteDispensado}
                            operacaoAprovada={['aprovada', 'em_andamento', 'liquidada'].includes(op.status)}
                            entregaStatus={entregaPorNfId.get(nf.id)?.status_entrega}
                          />
                        )}
                      />
                      {/* Objetivo A: NF continua agrupadora visual; NF sem
                          parcelas (totalParcelas === 0) nao mostra nada
                          extra -- legado intacto. */}
                      {totalParcelas > 0 && (
                        <div className="mt-1 rounded-lg border bg-muted/20">
                          <button
                            type="button"
                            onClick={() => toggleNfExpandida(nf.id)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-muted-foreground"
                            aria-expanded={expandido}
                          >
                            <span>{cedidas.length}/{totalParcelas} parcelas cedidas</span>
                            {expandido ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                          </button>
                          {expandido && (
                            <div className="divide-y divide-border border-t">
                              <div className="hidden grid-cols-[3.5rem_6rem_7rem_5rem_7rem_7rem] gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground sm:grid">
                                <span>Parcela</span>
                                <span>Vencimento</span>
                                <span>Valor nominal</span>
                                <span>Prazo</span>
                                <span>Antecipado (VP)</span>
                                <span>Desconto</span>
                              </div>
                              {cedidas.map((parcela) => (
                                <div key={parcela.parcelaId} className="grid grid-cols-2 gap-2 px-3 py-2 text-xs sm:grid-cols-[3.5rem_6rem_7rem_5rem_7rem_7rem]">
                                  <span className="font-mono tabular-nums">{String(parcela.numeroParcela).padStart(3, '0')}</span>
                                  <span className="tabular-nums">{formatDate(parcela.dataVencimento)}</span>
                                  <span className="tabular-nums">{formatCurrency(parcela.valorNominal)}</span>
                                  <span>{parcela.diasAplicados !== null ? `${parcela.diasAplicados} dias` : '—'}</span>
                                  <span className="tabular-nums">{parcela.valorPresente !== null ? formatCurrency(parcela.valorPresente) : '—'}</span>
                                  <span className="tabular-nums">{parcela.desconto !== null ? formatCurrency(parcela.desconto) : '—'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>

            {op.motivo_reprovacao && (
              <div className="p-3 bg-destructive/10 rounded-lg text-sm text-destructive">
                <strong>Motivo da reprovacao:</strong> {op.motivo_reprovacao}
              </div>
            )}
          </Card>

          {acompanhamentoLogistico}
          <AndamentoOperacaoCard
            operacao={op}
            capacidades={capacidades}
            documentos={requisitos as DocumentoOperacaoParaPolitica[]}
            logistica={entregas}
            compact
          />
        </div>

        {/* Sidebar */}
        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">

          {/* ETAPA 1: Definir termos (solicitada / em_analise) */}
          {canAnalyze && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator size={18} className="text-primary" />
                  Definir Termos
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-4">
                {taxasAplicaveis.length > 0 ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-2">Selecione uma taxa configurada</p>
                    <div className="space-y-1">
                      {taxasAplicaveis.map((t, i) => (
                        <button
                          key={i}
                          onClick={() => aplicarTaxaConfig(t)}
                          className={`w-full flex justify-between text-xs px-3 py-2 rounded-lg transition-colors ${
                            taxa === t.taxa_percentual
                              ? 'bg-primary/10 text-primary font-medium'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <span className="tabular-nums">{t.prazo_min}-{t.prazo_max} dias</span>
                          <span className="tabular-nums">{t.taxa_percentual}% a.m.</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    Nenhuma taxa foi configurada para o prazo desta operacao. A solicitacao permanece registrada, mas a aprovacao fica bloqueada ate a configuracao da faixa correspondente.
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                  <div>
                    <span className="block text-xs text-muted-foreground">Metodo de calculo</span>
                    <strong>{METODOS_CALCULO_LABELS[metodoCalculo]}</strong>
                  </div>
                  <div>
                    <span className="block text-xs text-muted-foreground">Taxa mensal</span>
                    <strong className="tabular-nums">{taxa === null ? 'Nao configurada' : `${taxa}% a.m.`}</strong>
                  </div>
                </div>

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

                <div className="p-3 bg-muted/50 rounded-lg space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Bruto</span>
                    <span className="font-medium tabular-nums">{formatCurrency(op.valor_bruto_total)}</span>
                  </div>
                  <div className="flex justify-between text-destructive">
                    <span className="tabular-nums">(-) Desconto ({taxa === null ? 'sem taxa' : `${taxa}% a.m.`}, prazo por NF)</span>
                    <span className="tabular-nums">{valorLiquido === null ? 'Pendente' : formatCurrency(op.valor_bruto_total - valorLiquido)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-semibold">Liquido</span>
                    <span className="font-bold text-green-700 dark:text-green-400 text-lg tabular-nums">{valorLiquido === null ? 'Pendente' : formatCurrency(valorLiquido)}</span>
                  </div>
                </div>

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
              </CardContent>
            </Card>
          )}

          {/* ETAPA 2: Documentos e desembolso (status aprovada) */}
          {canDisburse && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Bruto</span>
                  <span className="font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa</span>
                  <span className="font-medium tabular-nums">{op.taxa_desconto === null ? 'Nao definida' : `${op.taxa_desconto}% a.m.`}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Metodo</span>
                  <span className="text-right font-medium">{METODOS_CALCULO_LABELS[metodoCalculo]}</span>
                </div>
                {op.calculo_data_base && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Data-base</span>
                    <span className="font-medium">{formatDate(op.calculo_data_base)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prazo</span>
                  <span className="font-medium tabular-nums">{op.prazo_dias} dias</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Valor Liquido</span>
                  <span className="font-bold text-green-700 dark:text-green-400 tabular-nums">{op.valor_liquido_desembolso === null ? 'Pendente' : formatCurrency(op.valor_liquido_desembolso)}</span>
                </div>
                {op.aprovado_em && (
                  <div className="flex justify-between text-muted-foreground text-xs mt-2">
                    <span>Aprovada em</span>
                    <span>{formatDate(op.aprovado_em)}</span>
                  </div>
                )}
                {memoriasCalculo.length > 0 && (
                  <details className="rounded-lg border p-3 text-xs">
                    <summary className="cursor-pointer font-medium">Ver memoria de calculo por NF</summary>
                    <div className="mt-3 space-y-2">
                      {memoriasCalculo.map((memoria) => (
                        <div key={`${memoria.nota_fiscal_id}:${memoria.parcela_id || 'nf'}`} className="rounded-md bg-muted/50 p-2">
                          <strong>NF {nfs.find((nf) => nf.id === memoria.nota_fiscal_id)?.numero_nf || memoria.nota_fiscal_id.slice(0, 8)}</strong>
                          <div className="mt-1 grid grid-cols-2 gap-1 text-muted-foreground">
                            <span>{memoria.dias_aplicados} dia(s)</span>
                            <span className="text-right">VP {formatCurrency(memoria.valor_presente)}</span>
                            <span>Nominal {formatCurrency(memoria.valor_nominal)}</span>
                            <span className="text-right">Desconto {formatCurrency(memoria.desconto)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="border-t pt-4 mt-2 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">Documentos gerados</p>
                  <div className="flex flex-col gap-2">
                    <BotaoDownloadContrato
                      tipo="contrato"
                      id={op.cedente_id}
                      storagePath={op.cedentes.contrato_url}
                      hasSignedDoc={!!op.cedentes.contrato_assinado_url}
                      label="Contrato Mae"
                      className="w-full"
                    />
                    <BotaoDownloadContrato
                      tipo="termo"
                      id={op.id}
                      storagePath={(op as unknown as Record<string, unknown>).termo_url as string | null}
                      hasSignedDoc={!!termoAssinadoUrl}
                      className="w-full"
                    />
                    <BotaoDownloadContrato
                      tipo="notificacao"
                      id={op.id}
                      storagePath={(op as unknown as Record<string, unknown>).notificacao_url as string | null}
                      hasSignedDoc={!!notificacaoAssinadaUrl}
                      label="Notificacao ao Sacado"
                      className="w-full"
                    />
                  </div>
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
                    {enviandoRemessa ? 'Enviando...' : remessaEnviadaEm ? `Reenviado ${formatDate(remessaEnviadaEm)}` : 'Enviar Remessa para ADM'}
                  </Button>
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

                  <p className="text-xs font-medium text-muted-foreground border-t pt-3">Documentos assinados</p>
                  <div className="flex flex-col gap-2">
                    <UploadDocumentoAssinadoOperacao
                      label="Termo de Cessao Assinado"
                      storagePath={termoAssinadoUrl}
                      operacaoId={op.id}
                      tipoDocumento="TERMO_CESSAO_ASSINADO"
                      onSuccess={() => setTermoAssinadoUrl('registrado')}
                    />
                    <UploadDocumentoAssinadoOperacao
                      label="Notificacao ao Sacado Assinada"
                      storagePath={notificacaoAssinadaUrl}
                      operacaoId={op.id}
                      tipoDocumento="NOTIFICACAO_SACADO_ASSINADA"
                      onSuccess={() => setNotificacaoAssinadaUrl('registrado')}
                    />
                    <UploadDocumentoAssinadoOperacao
                      label="Comprovante de Desembolso (TED)"
                      storagePath={comprovanteUrl}
                      operacaoId={op.id}
                      tipoDocumento="COMPROVANTE_DESEMBOLSO_TED"
                      onSuccess={() => setComprovanteUrl('registrado')}
                    />
                  </div>

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
                </div>
              </CardContent>
            </Card>
          )}

          {/* ETAPA 3: Em andamento / liquidação */}
          {!canAnalyze && !canDisburse && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Bruto</span>
                  <span className="font-bold tabular-nums">{formatCurrency(op.valor_bruto_total)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Taxa</span>
                  <span className="font-medium tabular-nums">{op.taxa_desconto === null ? 'Nao definida' : `${op.taxa_desconto}% a.m.`}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Metodo</span>
                  <span className="text-right font-medium">{METODOS_CALCULO_LABELS[metodoCalculo]}</span>
                </div>
                {op.calculo_data_base && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Data-base</span>
                    <span className="font-medium">{formatDate(op.calculo_data_base)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prazo</span>
                  <span className="font-medium tabular-nums">{op.prazo_dias} dias</span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span className="font-semibold">Valor Liquido</span>
                  <span className="font-bold text-green-700 dark:text-green-400 tabular-nums">{op.valor_liquido_desembolso === null ? 'Pendente' : formatCurrency(op.valor_liquido_desembolso)}</span>
                </div>
                {op.aprovado_em && (
                  <div className="flex justify-between text-muted-foreground text-xs mt-2">
                    <span>Aprovada em</span>
                    <span>{formatDate(op.aprovado_em)}</span>
                  </div>
                )}
                {memoriasCalculo.length > 0 && (
                  <details className="rounded-lg border p-3 text-xs">
                    <summary className="cursor-pointer font-medium">Ver memoria de calculo por NF</summary>
                    <div className="mt-3 space-y-2">
                      {memoriasCalculo.map((memoria) => (
                        <div key={`${memoria.nota_fiscal_id}:${memoria.parcela_id || 'nf'}`} className="rounded-md bg-muted/50 p-2">
                          <strong>NF {nfs.find((nf) => nf.id === memoria.nota_fiscal_id)?.numero_nf || memoria.nota_fiscal_id.slice(0, 8)}</strong>
                          <div className="mt-1 grid grid-cols-2 gap-1 text-muted-foreground">
                            <span>{memoria.dias_aplicados} dia(s)</span>
                            <span className="text-right">VP {formatCurrency(memoria.valor_presente)}</span>
                            <span>Nominal {formatCurrency(memoria.valor_nominal)}</span>
                            <span className="text-right">Desconto {formatCurrency(memoria.desconto)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {(op.status === 'em_andamento' || op.status === 'inadimplente') && (
                  <div className="space-y-2 border-t pt-4 mt-2">
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

                {/* Documentos para operacoes legadas (em_andamento sem docs ainda) */}
                {showDocs && !canDisburse && (
                  <div className="border-t pt-4 mt-2 space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Documentos gerados</p>
                    <div className="flex flex-col gap-2">
                      <BotaoDownloadContrato
                        tipo="contrato"
                        id={op.cedente_id}
                        storagePath={op.cedentes.contrato_url}
                        hasSignedDoc={!!op.cedentes.contrato_assinado_url}
                        label="Contrato Mae"
                        className="w-full"
                      />
                      <BotaoDownloadContrato
                        tipo="termo"
                        id={op.id}
                        storagePath={(op as unknown as Record<string, unknown>).termo_url as string | null}
                        hasSignedDoc={!!termoAssinadoUrl}
                        className="w-full"
                      />
                      <BotaoDownloadContrato
                        tipo="notificacao"
                        id={op.id}
                        storagePath={(op as unknown as Record<string, unknown>).notificacao_url as string | null}
                        hasSignedDoc={!!notificacaoAssinadaUrl}
                        label="Notificacao ao Sacado"
                        className="w-full"
                      />
                      {op.status === 'liquidada' && (
                        <BotaoDownloadContrato
                          tipo="quitacao"
                          id={op.id}
                          storagePath={op.quitacao_url}
                          hasSignedDoc={!!quitacaoAssinadaUrl}
                          label="Termo de Quitacao"
                          className="w-full"
                        />
                      )}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground border-t pt-3">Documentos assinados</p>
                    <div className="flex flex-col gap-2">
                      <UploadDocumentoAssinadoOperacao
                        label="Termo de Cessao Assinado"
                        storagePath={termoAssinadoUrl}
                        operacaoId={op.id}
                        tipoDocumento="TERMO_CESSAO_ASSINADO"
                        onSuccess={() => setTermoAssinadoUrl('registrado')}
                      />
                      <UploadDocumentoAssinadoOperacao
                        label="Notificacao ao Sacado Assinada"
                        storagePath={notificacaoAssinadaUrl}
                        operacaoId={op.id}
                        tipoDocumento="NOTIFICACAO_SACADO_ASSINADA"
                        onSuccess={() => setNotificacaoAssinadaUrl('registrado')}
                      />
                      <UploadDocumentoAssinadoOperacao
                        label="Comprovante de Pagamento"
                        storagePath={comprovanteUrl}
                        operacaoId={op.id}
                        tipoDocumento="COMPROVANTE_DESEMBOLSO_TED"
                        onSuccess={() => setComprovanteUrl('registrado')}
                      />
                      {op.status === 'liquidada' && (
                        <UploadDocumentoAssinado
                          label="Termo de Quitacao Assinado"
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
                      {enviandoRemessa ? 'Enviando...' : remessaEnviadaEm ? `Reenviado ${formatDate(remessaEnviadaEm)}` : 'Enviar Remessa para ADM'}
                    </Button>
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
                  </div>
                )}
              </CardContent>
            </Card>
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

      <HistoricoTimelineCard entidade="operacao" entidadeId={opId} />
    </div>
  )
}

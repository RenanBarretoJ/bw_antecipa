'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { uploadNFs, excluirRascunho, excluirRascunhos } from '@/lib/actions/nota-fiscal'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import {
  LIMITES_LISTAGEM_NF,
  type CampoOrdenacaoListagemNf,
} from '@/lib/notas-fiscais/listagem'
import type {
  FiltrosListagemNotasFiscais,
  ResultadoListagemNotasFiscais,
} from '@/lib/notas-fiscais/listagem.server'
import Link from 'next/link'
import {
  Upload,
  FileText,
  FileUp,
  X,
  CheckCircle,
  AlertCircle,
  XCircle,
  Search,
  Filter,
  Eye,
  Banknote,
  Loader2,
  Trash2,
  Wrench,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Truck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { useNotifications } from '@/components/notifications/notification-provider'
import { ListNameCell } from '@/components/data-display/primitives'

interface NfRecord {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: string
  entrega_status?: string | null
  pronta_para_submissao?: boolean
}

type Props = {
  resultado: ResultadoListagemNotasFiscais
  filtros: Required<Omit<FiltrosListagemNotasFiscais, 'valorMin' | 'valorMax'>> & {
    valorMin: number | null
    valorMax: number | null
  }
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string; icon: typeof CheckCircle }> = {
  rascunho:      { label: 'Rascunho',       variant: 'outline',     className: 'bg-muted text-muted-foreground border-border',    icon: FileText },
  submetida:     { label: 'Submetida',      variant: 'secondary',   className: 'bg-blue-100 text-blue-700 border-blue-200',       icon: Upload },
  em_analise:    { label: 'Em Analise',     variant: 'secondary',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: AlertCircle },
  aprovada:      { label: 'Validada',       variant: 'secondary',   className: 'bg-green-100 text-green-700 border-green-200',    icon: CheckCircle },
  em_antecipacao:{ label: 'Em Antecipacao', variant: 'secondary',   className: 'bg-purple-100 text-purple-700 border-purple-200', icon: Banknote },
  liquidada:     { label: 'Liquidada',      variant: 'secondary',   className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
  aceita:        { label: 'Antecipada',         variant: 'secondary',   className: 'bg-green-100 text-green-700 border-green-200',     icon: CheckCircle },
  contestada:    { label: 'Contestada',         variant: 'outline',     className: 'bg-orange-100 text-orange-700 border-orange-200',  icon: AlertCircle },
  cancelada:     { label: 'Cancelada',          variant: 'destructive', className: 'bg-red-100 text-red-700 border-red-200',           icon: XCircle },
  requer_ajuste: { label: 'Requer Ajuste',      variant: 'outline',     className: 'bg-orange-100 text-orange-700 border-orange-200',  icon: Wrench },
  pronta_para_submissao: { label: 'Pronta para submissao', variant: 'secondary', className: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: CheckCircle },
}

const entregaStatusConfig: Record<string, { label: string; className: string; icon: typeof CheckCircle }> = {
  em_transito: { label: 'Em trânsito', className: 'bg-blue-100 text-blue-700 border-blue-200', icon: Truck },
  aguardando_validacao: { label: 'Aguard. validação', className: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: AlertCircle },
  entregue: { label: 'Entregue', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle },
  entrega_com_pendencia: { label: 'Pendência entrega', className: 'bg-orange-100 text-orange-700 border-orange-200', icon: AlertCircle },
}

function mapearNfs(resultado: ResultadoListagemNotasFiscais): NfRecord[] {
  return resultado.itens.map((nf) => ({
    id: nf.id,
    numero_nf: nf.numero,
    cnpj_destinatario: nf.cnpjDestinatario,
    razao_social_destinatario: nf.destinatario,
    valor_bruto: nf.valorBruto,
    data_emissao: nf.emissao,
    data_vencimento: nf.vencimento,
    status: nf.status,
    entrega_status: nf.entregaStatus,
    pronta_para_submissao: nf.estadoSubmissao === 'pronta_para_submissao',
  }))
}

export default function NotasFiscaisListagem({ resultado, filtros }: Props) {
  const router = useRouter()
  const notifications = useNotifications()
  const nfs = mapearNfs(resultado)
  const [uploading, setUploading] = useState(false)
  const [filtroStatus, setFiltroStatus] = useState<string>(filtros.status)
  const [busca, setBusca] = useState(filtros.busca)
  const [valorMin, setValorMin] = useState(filtros.valorMin?.toString() || '')
  const [valorMax, setValorMax] = useState(filtros.valorMax?.toString() || '')
  const [emissaoDe, setEmissaoDe] = useState(filtros.emissaoDe)
  const [emissaoAte, setEmissaoAte] = useState(filtros.emissaoAte)
  const [vencimentoDe, setVencimentoDe] = useState(filtros.vencimentoDe)
  const [vencimentoAte, setVencimentoAte] = useState(filtros.vencimentoAte)
  const [filtrosExpandidos, setFiltrosExpandidos] = useState(Boolean(
    filtros.valorMin
    || filtros.valorMax
    || filtros.emissaoDe
    || filtros.emissaoAte
    || filtros.vencimentoDe
    || filtros.vencimentoAte
  ))
  const [ordenacao, setOrdenacao] = useState<{ campo: CampoOrdenacaoListagemNf; direcao: 'asc' | 'desc' }>({
    campo: filtros.ordenacao as CampoOrdenacaoListagemNf,
    direcao: filtros.direcao === 'asc' ? 'asc' : 'desc',
  })
  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [excluindoLote, setExcluindoLote] = useState(false)

  // IDs dos rascunhos que passam no filtro atual — calculado em tempo de render (abaixo de nfsFiltradas)
  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTodos = () => {
    if (todosSelecionados) {
      setSelecionados((prev) => {
        const next = new Set(prev)
        rascunhosVisiveis.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelecionados((prev) => new Set([...prev, ...rascunhosVisiveis]))
    }
  }

  const handleExcluir = async (id: string) => {
    if (!confirm('Excluir este rascunho? Esta acao nao pode ser desfeita.')) return
    setExcluindo(id)
    const result = await excluirRascunho(id)
    if (result?.success) {
      setSelecionados((prev) => { const next = new Set(prev); next.delete(id); return next })
      router.refresh()
    } else {
      notifications.fromActionResult(result, 'Erro ao excluir.')
    }
    setExcluindo(null)
  }

  const handleExcluirLote = async () => {
    const ids = [...selecionados]
    if (!ids.length) return
    if (!confirm(`Excluir ${ids.length} rascunho(s)? Esta acao nao pode ser desfeita.`)) return
    setExcluindoLote(true)
    const result = await excluirRascunhos(ids)
    if (result?.success) {
      setSelecionados(new Set())
      router.refresh()
      notifications.fromActionResult(result, 'Rascunhos excluídos.')
    } else {
      notifications.fromActionResult(result, 'Erro ao excluir.')
    }
    setExcluindoLote(false)
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }, [])

  const addFiles = useCallback((files: File[]) => {
    const validExtensions = ['.xml', '.pdf', '.jpg', '.jpeg', '.png']
    const validFiles = files.filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      return validExtensions.includes(ext)
    })
    if (validFiles.length < files.length) {
      notifications.warning(`${files.length - validFiles.length} arquivo(s) ignorado(s) — formato inválido.`)
    }
    setSelectedFiles((prev) => [...prev, ...validFiles])
  }, [notifications])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    addFiles(Array.from(e.dataTransfer.files))
  }, [addFiles])

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return

    setUploading(true)

    const formData = new FormData()
    selectedFiles.forEach((file) => formData.append('arquivos', file))

    const result = await uploadNFs(formData)

    if (result?.success) {
      setSelectedFiles([])

      // PDFs viram rascunho — se for só 1, redirecionar para preencher
      if (result.rascunhos && result.rascunhos.length === 1 && (result.ids?.length ?? 0) === 1) {
        router.push(`/cedente/notas-fiscais/${result.rascunhos[0]}`)
        return
      }

      // Multiplos PDFs: mostrar aviso para preencher cada um
      if (result.rascunhos && result.rascunhos.length > 0) {
        const xmlCount = (result.ids?.length ?? 0) - result.rascunhos.length
        const parts: string[] = []
        if (xmlCount > 0) parts.push(`${xmlCount} NF(s) salva(s) como rascunho — revise os dados e submeta manualmente`)
        if (result.rascunhos.length > 0) parts.push(`${result.rascunhos.length} NF(s) salva(s) como rascunho — clique em "Preencher" em cada uma para revisar os dados`)
        notifications.success(parts.join('. ') + '.')
      } else {
        notifications.fromActionResult(result, 'NFs enviadas com sucesso!')
      }

      router.refresh()
    } else {
      notifications.fromActionResult(result, 'Erro no envio.')
    }

    setUploading(false)
  }

  const navegarComFiltros = (overrides: {
    pagina?: number
    limite?: number
    ordenacao?: CampoOrdenacaoListagemNf
    direcao?: 'asc' | 'desc'
  } = {}) => {
    const params = new URLSearchParams()
    const adicionar = (nome: string, valor: string) => {
      if (valor.trim()) params.set(nome, valor.trim())
    }

    adicionar('busca', busca)
    if (filtroStatus !== 'todos') params.set('status', filtroStatus)
    adicionar('valorMin', valorMin)
    adicionar('valorMax', valorMax)
    adicionar('emissaoDe', emissaoDe)
    adicionar('emissaoAte', emissaoAte)
    adicionar('vencimentoDe', vencimentoDe)
    adicionar('vencimentoAte', vencimentoAte)
    params.set('ordenacao', overrides.ordenacao ?? ordenacao.campo)
    params.set('direcao', overrides.direcao ?? ordenacao.direcao)
    params.set('limite', String(overrides.limite ?? resultado.limite))
    params.set('pagina', String(overrides.pagina ?? 1))
    router.push(`/cedente/notas-fiscais?${params.toString()}`)
  }

  const handleOrdenar = (campo: CampoOrdenacaoListagemNf) => {
    const direcao = ordenacao.campo === campo && ordenacao.direcao === 'asc' ? 'desc' : 'asc'
    setOrdenacao({ campo, direcao })
    navegarComFiltros({ pagina: 1, ordenacao: campo, direcao })
  }

  const temFiltrosExtras = valorMin || valorMax || emissaoDe || emissaoAte || vencimentoDe || vencimentoAte

  const limparFiltrosExtras = () => {
    setValorMin(''); setValorMax('')
    setEmissaoDe(''); setEmissaoAte('')
    setVencimentoDe(''); setVencimentoAte('')
  }

  const nfsFiltradas = nfs

  const rascunhosVisiveis = nfsFiltradas
    .filter((nf) => nf.status === 'rascunho')
    .map((nf) => nf.id)
  const todosSelecionados = rascunhosVisiveis.length > 0 && rascunhosVisiveis.every((id) => selecionados.has(id))

  const getFileIcon = (name: string) => {
    if (name.endsWith('.xml')) return 'text-green-600'
    if (name.endsWith('.pdf')) return 'text-red-600'
    return 'text-blue-600'
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Minhas Notas Fiscais</h1>
        <p className="text-muted-foreground">Envie XMLs de NF-e para leitura automatica ou PDFs para preenchimento manual.</p>
      </div>

      {/* Upload */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Enviar Notas Fiscais</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-muted-foreground bg-muted/30'
            }`}
          >
            <input
              type="file"
              multiple
              accept=".xml,.pdf,.jpg,.jpeg,.png"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(e) => {
                if (e.target.files) addFiles(Array.from(e.target.files))
                e.target.value = ''
              }}
            />
            <FileUp size={48} className={`mx-auto mb-3 ${dragActive ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className="text-lg font-medium text-foreground">
              {dragActive ? 'Solte os arquivos aqui' : 'Arraste e solte seus arquivos aqui'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              ou clique para selecionar — XML (leitura automatica), PDF (extracao automatica), JPG/PNG (preenchimento manual)
            </p>
            <p className="text-xs text-muted-foreground/70 mt-2">Maximo 20MB por arquivo. Multiplos arquivos permitidos.</p>
          </div>

          {selectedFiles.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">
                  {selectedFiles.length} arquivo(s) selecionado(s)
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setSelectedFiles([])}
                  className="text-destructive hover:text-destructive"
                >
                  Limpar todos
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={16} className={getFileIcon(file.name)} />
                      <span className="text-sm text-foreground truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        ({(file.size / 1024 / 1024).toFixed(1)} MB)
                      </span>
                      {file.name.endsWith('.xml') ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-1.5 py-0.5">
                          Leitura automatica
                        </Badge>
                      ) : file.name.endsWith('.pdf') ? (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs px-1.5 py-0.5">
                          Extracao automatica
                        </Badge>
                      ) : (
                        <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 text-xs px-1.5 py-0.5">
                          Preenchimento manual
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeFile(index)}
                      className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                onClick={handleUpload}
                disabled={uploading}
                size="lg"
                className="mt-4 w-full"
              >
                {uploading ? (
                  <><Loader2 className="animate-spin" /> Enviando...</>
                ) : (
                  <><Upload /> Enviar {selectedFiles.length} arquivo(s)</>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4 space-y-3">
          {/* Linha 1: busca + status + botão expandir */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Buscar por numero, CNPJ ou razao social do sacado..."
                 value={busca}
                 onChange={(e) => setBusca(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') navegarComFiltros({ pagina: 1 })
                 }}
                 className="pl-9"
              />
            </div>
            <div className="relative">
              <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="h-9 pl-9 pr-8 border border-input rounded-lg text-sm bg-transparent text-foreground focus:outline-none focus:ring-3 focus:ring-ring/50 focus:border-ring appearance-none transition-colors"
              >
                <option value="todos">Todos os status</option>
                <option value="rascunho">Rascunho</option>
                <option value="submetida">Submetida</option>
                <option value="em_analise">Em Analise</option>
                <option value="aprovada">Aprovada</option>
                <option value="em_antecipacao">Em Antecipacao</option>
                <option value="aceita">Antecipada</option>
                <option value="contestada">Contestada</option>
                <option value="requer_ajuste">Requer Ajuste</option>
                <option value="liquidada">Liquidada</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFiltrosExpandidos((v) => !v)}
              className={`gap-1 shrink-0 ${temFiltrosExtras ? 'border-primary text-primary' : ''}`}
            >
              <Filter size={14} />
              Mais filtros
              {temFiltrosExtras && <span className="ml-1 w-2 h-2 rounded-full bg-primary inline-block" />}
              {filtrosExpandidos ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </Button>
            <Button
              size="sm"
              onClick={() => navegarComFiltros({ pagina: 1 })}
              className="shrink-0"
            >
              Aplicar filtros
            </Button>
          </div>

          {/* Linha 2: filtros avançados (expansível) */}
          {filtrosExpandidos && (
            <div className="flex flex-wrap gap-4 pt-2 border-t border-border items-end">
              {/* Valor Bruto */}
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Valor Bruto — mínimo</p>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={valorMin}
                    onChange={(e) => setValorMin(e.target.value)}
                    className="h-8 text-sm w-32"
                    min={0}
                  />
                </div>
                <span className="text-xs text-muted-foreground mb-2">—</span>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">máximo</p>
                  <Input
                    type="number"
                    placeholder="0,00"
                    value={valorMax}
                    onChange={(e) => setValorMax(e.target.value)}
                    className="h-8 text-sm w-32"
                    min={0}
                  />
                </div>
              </div>

              <div className="w-px h-10 bg-border self-end mb-0.5 hidden sm:block" />

              {/* Emissão */}
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Emissão — de</p>
                  <Input
                    type="date"
                    value={emissaoDe}
                    onChange={(e) => setEmissaoDe(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
                <span className="text-xs text-muted-foreground mb-2">até</span>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium invisible">até</p>
                  <Input
                    type="date"
                    value={emissaoAte}
                    onChange={(e) => setEmissaoAte(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
              </div>

              <div className="w-px h-10 bg-border self-end mb-0.5 hidden sm:block" />

              {/* Vencimento */}
              <div className="flex items-end gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium">Vencimento — de</p>
                  <Input
                    type="date"
                    value={vencimentoDe}
                    onChange={(e) => setVencimentoDe(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
                <span className="text-xs text-muted-foreground mb-2">até</span>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-medium invisible">até</p>
                  <Input
                    type="date"
                    value={vencimentoAte}
                    onChange={(e) => setVencimentoAte(e.target.value)}
                    className="h-8 text-sm w-36"
                  />
                </div>
              </div>

              {temFiltrosExtras && (
                <Button variant="ghost" size="xs" onClick={limparFiltrosExtras} className="text-muted-foreground self-end mb-0.5">
                  <X size={13} className="mr-1" /> Limpar
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total no filtro', count: resultado.total, valor: undefined },
          { label: 'Rascunhos na página', count: resultado.metricasPagina.rascunhos, valor: undefined },
          { label: 'Aprovadas na página', count: resultado.metricasPagina.aprovadas, valor: undefined },
          { label: 'Valor da página', count: undefined, valor: resultado.metricasPagina.valor },
        ].map((item) => (
          <Card key={item.label} size="sm">
            <CardContent className="pt-3 pb-3">
              <p className="text-xs font-medium text-muted-foreground">{item.label}</p>
              <p className="text-xl font-bold tabular-nums text-foreground mt-1">
                {item.valor !== undefined ? formatCurrency(item.valor) : item.count}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lista de NFs */}
      {nfsFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText size={48} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">
              {resultado.total === 0
                ? 'Nenhuma nota fiscal enviada ainda.'
                : 'Nenhuma NF encontrada com os filtros aplicados.'}
            </p>
            {resultado.pagina > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => navegarComFiltros({ pagina: resultado.pagina - 1 })}
              >
                Voltar à página anterior
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {selecionados.size > 0 && (
            <div className="flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-border">
              <span className="text-sm text-foreground font-medium">
                {selecionados.size} rascunho(s) selecionado(s)
              </span>
              <Button
                variant="destructive"
                size="sm"
                disabled={excluindoLote}
                onClick={handleExcluirLote}
              >
                {excluindoLote ? <Loader2 size={14} className="animate-spin mr-1" /> : <Trash2 size={14} className="mr-1" />}
                Excluir selecionados
              </Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="px-4 py-3 w-8">
                  {rascunhosVisiveis.length > 0 && (
                    <input
                      type="checkbox"
                      checked={todosSelecionados}
                      onChange={toggleTodos}
                      className="cursor-pointer"
                      title="Selecionar todos os rascunhos"
                    />
                  )}
                </TableHead>
                {(() => {
                  const SortIcon = ({ campo }: { campo: CampoOrdenacaoListagemNf }) => {
                    if (ordenacao.campo !== campo) return <ArrowUpDown size={12} className="ml-1 text-muted-foreground/50 inline" />
                    return ordenacao.direcao === 'asc'
                      ? <ArrowUp size={12} className="ml-1 text-primary inline" />
                      : <ArrowDown size={12} className="ml-1 text-primary inline" />
                  }
                  const Th = ({ campo, children }: { campo: CampoOrdenacaoListagemNf; children: React.ReactNode }) => (
                    <TableHead
                      className="text-xs uppercase tracking-wide px-4 py-3 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                      onClick={() => handleOrdenar(campo)}
                    >
                      {children}<SortIcon campo={campo} />
                    </TableHead>
                  )
                  return (
                    <>
                      <Th campo="numero_nf">NF</Th>
                      <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Sacado (Destinatario)</TableHead>
                      <Th campo="valor_bruto">Valor Bruto</Th>
                      <Th campo="data_emissao">Emissao</Th>
                      <Th campo="data_vencimento">Vencimento</Th>
                      <Th campo="status">Status</Th>
                      <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Acoes</TableHead>
                    </>
                  )
                })()}
              </TableRow>
            </TableHeader>
            <TableBody>
              {nfsFiltradas.map((nf) => {
                const entregaStatus = nf.entrega_status
                const status = entregaStatus && entregaStatusConfig[entregaStatus]
                  ? entregaStatusConfig[entregaStatus]
                  : nf.status === 'rascunho' && nf.pronta_para_submissao
                    ? statusConfig.pronta_para_submissao
                  : statusConfig[nf.status] || statusConfig.rascunho
                const StatusIcon = status.icon
                return (
                  <TableRow key={nf.id}>
                    <TableCell className="px-4 py-3 w-8">
                      {nf.status === 'rascunho' && (
                        <input
                          type="checkbox"
                          checked={selecionados.has(nf.id)}
                          onChange={() => toggleSelecionado(nf.id)}
                          className="cursor-pointer"
                        />
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <span className="font-medium text-foreground">{nf.numero_nf || '—'}</span>
                    </TableCell>
                    <TableCell className="w-[220px] max-w-[220px] px-4 py-3">
                      <ListNameCell
                        name={nf.razao_social_destinatario}
                        subline={nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}
                      />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm font-medium tabular-nums text-foreground">
                      {nf.valor_bruto > 0 ? formatCurrency(nf.valor_bruto) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {nf.data_emissao ? formatDate(nf.data_emissao) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {nf.data_vencimento ? formatDate(nf.data_vencimento) : '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge className={`inline-flex items-center gap-1 ${status.className}`}>
                        <StatusIcon size={12} />
                        {status.label}
                      </Badge>
                      {nf.status === 'rascunho' && (
                        <span className={`text-xs block mt-1 ${
                          nf.numero_nf || nf.valor_bruto > 0 || nf.cnpj_destinatario
                            ? 'text-blue-600'
                            : 'text-amber-600'
                        }`}>
                          {nf.numero_nf || nf.valor_bruto > 0 || nf.cnpj_destinatario
                            ? 'Pré-preenchido'
                            : 'Preencher manualmente'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Link
                          href={`/cedente/notas-fiscais/${nf.id}`}
                          className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium"
                        >
                          <Eye size={14} />
                          {nf.status === 'rascunho' ? 'Preencher' : 'Ver'}
                        </Link>
                        {nf.status === 'rascunho' && (
                          <button
                            onClick={() => handleExcluir(nf.id)}
                            disabled={excluindo === nf.id}
                            className="inline-flex items-center gap-1 text-sm text-destructive hover:text-destructive/80 disabled:opacity-50"
                            title="Excluir rascunho"
                          >
                            {excluindo === nf.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Trash2 size={14} />
                            }
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Página {resultado.pagina} de {resultado.totalPaginas} · {resultado.total} nota(s)
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="limite-notas-fiscais" className="text-sm text-muted-foreground">
                Itens por página
              </label>
              <select
                id="limite-notas-fiscais"
                value={resultado.limite}
                onChange={(event) => navegarComFiltros({
                  pagina: 1,
                  limite: Number(event.target.value),
                })}
                className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm text-foreground"
              >
                {LIMITES_LISTAGEM_NF.map((limite) => (
                  <option key={limite} value={limite}>{limite}</option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={resultado.pagina <= 1}
                onClick={() => navegarComFiltros({ pagina: resultado.pagina - 1 })}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={resultado.pagina >= resultado.totalPaginas}
                onClick={() => navegarComFiltros({ pagina: resultado.pagina + 1 })}
              >
                Próxima
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

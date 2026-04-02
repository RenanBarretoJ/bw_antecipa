'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadNFs, excluirRascunho, excluirRascunhos } from '@/lib/actions/nota-fiscal'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
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
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'

interface NfRecord {
  id: string
  numero_nf: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  data_emissao: string
  data_vencimento: string
  status: string
  arquivo_url: string | null
  created_at: string
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string; icon: typeof CheckCircle }> = {
  rascunho:      { label: 'Rascunho',       variant: 'outline',     className: 'bg-muted text-muted-foreground border-border',                   icon: FileText },
  submetida:     { label: 'Submetida',      variant: 'secondary',   className: 'bg-blue-100 text-blue-700 border-blue-200',                      icon: Upload },
  em_analise:    { label: 'Em Analise',     variant: 'secondary',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200',                icon: AlertCircle },
  aprovada:      { label: 'Aprovada',       variant: 'secondary',   className: 'bg-green-100 text-green-700 border-green-200',                   icon: CheckCircle },
  em_antecipacao:{ label: 'Em Antecipacao', variant: 'secondary',   className: 'bg-purple-100 text-purple-700 border-purple-200',                icon: Banknote },
  liquidada:     { label: 'Liquidada',      variant: 'secondary',   className: 'bg-emerald-100 text-emerald-700 border-emerald-200',             icon: CheckCircle },
  cancelada:     { label: 'Cancelada',      variant: 'destructive', className: 'bg-red-100 text-red-700 border-red-200',                         icon: XCircle },
}

export default function NotasFiscaisCedentePage() {
  const [nfs, setNfs] = useState<NfRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [excluindo, setExcluindo] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [excluindoLote, setExcluindoLote] = useState(false)

  // IDs dos rascunhos que passam no filtro atual — calculado em tempo de render (abaixo de nfsFiltradas)
  const rascunhosVisiveis: string[] = []
  const todosSelecionados = rascunhosVisiveis.length > 0 && rascunhosVisiveis.every((id) => selecionados.has(id))

  const toggleSelecionado = (id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
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
      setNfs((prev) => prev.filter((n) => n.id !== id))
      setSelecionados((prev) => { const next = new Set(prev); next.delete(id); return next })
    } else {
      setMessage(result?.message || 'Erro ao excluir.')
      setMessageType('error')
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
      setNfs((prev) => prev.filter((n) => !ids.includes(n.id)))
      setSelecionados(new Set())
      setMessage(result.message || 'Rascunhos excluidos.')
      setMessageType('success')
    } else {
      setMessage(result?.message || 'Erro ao excluir.')
      setMessageType('error')
    }
    setExcluindoLote(false)
  }

  const loadNFs = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('notas_fiscais')
      .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, data_emissao, data_vencimento, status, arquivo_url, created_at')
      .order('created_at', { ascending: false })

    setNfs((data || []) as NfRecord[])
    setLoading(false)
  }

  useEffect(() => { loadNFs() }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = Array.from(e.dataTransfer.files)
    addFiles(files)
  }, [])

  const addFiles = (files: File[]) => {
    const validExtensions = ['.xml', '.pdf', '.jpg', '.jpeg', '.png']
    const validFiles = files.filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase()
      return validExtensions.includes(ext)
    })

    if (validFiles.length < files.length) {
      setMessage(`${files.length - validFiles.length} arquivo(s) ignorado(s) — formato invalido.`)
      setMessageType('error')
    }

    setSelectedFiles((prev) => [...prev, ...validFiles])
  }

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return

    setUploading(true)
    setMessage('')

    const formData = new FormData()
    selectedFiles.forEach((file) => {
      formData.append('arquivos', file)
    })

    const result = await uploadNFs(formData)

    if (result?.success) {
      setMessage(result.message || 'NFs enviadas!')
      setMessageType('success')
      setSelectedFiles([])
      await loadNFs()
    } else {
      setMessage(result?.message || 'Erro no envio.')
      setMessageType('error')
    }

    setUploading(false)
  }

  // Filtrar NFs
  const nfsFiltradas = nfs.filter((nf) => {
    if (filtroStatus !== 'todos' && nf.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return (
        nf.numero_nf.toLowerCase().includes(term) ||
        nf.razao_social_destinatario.toLowerCase().includes(term) ||
        nf.cnpj_destinatario.includes(term)
      )
    }
    return true
  })

  // Preencher lista de rascunhos visíveis para seleção em lote
  rascunhosVisiveis.splice(0, rascunhosVisiveis.length, ...nfsFiltradas.filter((n) => n.status === 'rascunho').map((n) => n.id))

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

      {/* Zona de upload drag-and-drop */}
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

          {/* Arquivos selecionados */}
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
                  <>
                    <Loader2 className="animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Upload />
                    Enviar {selectedFiles.length} arquivo(s)
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mensagem */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm whitespace-pre-line border ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {message}
        </div>
      )}

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Buscar por numero, CNPJ ou razao social do sacado..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="relative">
              <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value)}
                className="h-8 pl-9 pr-8 border border-input rounded-lg text-sm bg-transparent text-foreground focus:outline-none focus:ring-3 focus:ring-ring/50 focus:border-ring appearance-none transition-colors"
              >
                <option value="todos">Todos os status</option>
                <option value="rascunho">Rascunho</option>
                <option value="submetida">Submetida</option>
                <option value="em_analise">Em Analise</option>
                <option value="aprovada">Aprovada</option>
                <option value="em_antecipacao">Em Antecipacao</option>
                <option value="liquidada">Liquidada</option>
                <option value="cancelada">Cancelada</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total',     count: nfs.length,                                             valor: undefined },
          { label: 'Rascunho',  count: nfs.filter((n) => n.status === 'rascunho').length,      valor: undefined },
          { label: 'Aprovadas', count: nfs.filter((n) => n.status === 'aprovada').length,      valor: undefined },
          { label: 'Valor Total', count: undefined, valor: nfs.reduce((acc, n) => acc + n.valor_bruto, 0) },
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
      {loading ? (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 flex-1" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : nfsFiltradas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText size={48} className="mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">
              {nfs.length === 0
                ? 'Nenhuma nota fiscal enviada ainda.'
                : 'Nenhuma NF encontrada com os filtros aplicados.'}
            </p>
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
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">NF</TableHead>
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Sacado (Destinatario)</TableHead>
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Valor Bruto</TableHead>
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Emissao</TableHead>
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Vencimento</TableHead>
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Status</TableHead>
                <TableHead className="text-xs uppercase tracking-wide px-4 py-3">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nfsFiltradas.map((nf) => {
                const status = statusConfig[nf.status] || statusConfig.rascunho
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
                      <span className="font-medium text-foreground">
                        {nf.numero_nf || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div>
                        <p className="text-sm text-foreground">{nf.razao_social_destinatario || '—'}</p>
                        <p className="text-xs text-muted-foreground">
                          {nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}
                        </p>
                      </div>
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
        </Card>
      )}
    </div>
  )
}

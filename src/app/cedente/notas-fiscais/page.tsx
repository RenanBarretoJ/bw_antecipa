'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadNFs, criarNFManual } from '@/lib/actions/nota-fiscal'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import Link from 'next/link'
import {
  Upload,
  FileText,
  FileUp,
  X,
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Search,
  Filter,
  Eye,
  Banknote,
  Loader2,
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

interface PdfForm {
  numero_nf: string
  data_emissao: string
  data_vencimento: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: string
  descricao_itens: string
  condicao_pagamento: string
}

const defaultPdfForm = (): PdfForm => ({
  numero_nf: '',
  data_emissao: new Date().toISOString().split('T')[0],
  data_vencimento: '',
  cnpj_destinatario: '',
  razao_social_destinatario: '',
  valor_bruto: '',
  descricao_itens: '',
  condicao_pagamento: '',
})

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string; icon: typeof CheckCircle }> = {
  rascunho:      { label: 'Rascunho',       variant: 'outline',     className: 'bg-muted text-muted-foreground border-border',                   icon: FileText },
  submetida:     { label: 'Submetida',      variant: 'secondary',   className: 'bg-blue-100 text-blue-700 border-blue-200',                      icon: Upload },
  em_analise:    { label: 'Em Analise',     variant: 'secondary',   className: 'bg-yellow-100 text-yellow-700 border-yellow-200',                icon: AlertCircle },
  aprovada:      { label: 'Aprovada',       variant: 'secondary',   className: 'bg-green-100 text-green-700 border-green-200',                   icon: CheckCircle },
  em_antecipacao:{ label: 'Em Antecipacao', variant: 'secondary',   className: 'bg-purple-100 text-purple-700 border-purple-200',                icon: Banknote },
  liquidada:     { label: 'Liquidada',      variant: 'secondary',   className: 'bg-emerald-100 text-emerald-700 border-emerald-200',             icon: CheckCircle },
  cancelada:     { label: 'Cancelada',      variant: 'destructive', className: 'bg-red-100 text-red-700 border-red-200',                         icon: XCircle },
}

function isNonXml(file: File) {
  return !file.name.toLowerCase().endsWith('.xml')
}

export default function NotasFiscaisCedentePage() {
  const router = useRouter()
  const [nfs, setNfs] = useState<NfRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  // pdfForms: keyed by file name, holds manual form data for each non-XML file
  const [pdfForms, setPdfForms] = useState<Record<string, PdfForm>>({})

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
    addFiles(Array.from(e.dataTransfer.files))
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
    setPdfForms((prev) => {
      const next = { ...prev }
      validFiles.filter(isNonXml).forEach((f) => {
        if (!next[f.name]) next[f.name] = defaultPdfForm()
      })
      return next
    })
  }

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => {
      const removed = prev[index]
      const next = prev.filter((_, i) => i !== index)
      if (removed && isNonXml(removed)) {
        setPdfForms((forms) => {
          const updated = { ...forms }
          delete updated[removed.name]
          return updated
        })
      }
      return next
    })
  }

  const updatePdfForm = (fileName: string, field: keyof PdfForm, value: string) => {
    setPdfForms((prev) => ({
      ...prev,
      [fileName]: { ...prev[fileName], [field]: value },
    }))
  }

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return

    // Validate PDF forms before sending
    const nonXmlFiles = selectedFiles.filter(isNonXml)
    for (const file of nonXmlFiles) {
      const form = pdfForms[file.name]
      if (!form) continue
      if (!form.numero_nf.trim()) {
        setMessage(`Preencha o Numero da NF para "${file.name}".`)
        setMessageType('error')
        return
      }
      if (!form.data_emissao) {
        setMessage(`Preencha a Data de Emissao para "${file.name}".`)
        setMessageType('error')
        return
      }
      if (!form.data_vencimento) {
        setMessage(`Preencha a Data de Vencimento para "${file.name}".`)
        setMessageType('error')
        return
      }
      if (!form.cnpj_destinatario.replace(/\D/g, '') || form.cnpj_destinatario.replace(/\D/g, '').length < 14) {
        setMessage(`CNPJ do destinatario invalido para "${file.name}".`)
        setMessageType('error')
        return
      }
      if (!form.razao_social_destinatario.trim()) {
        setMessage(`Preencha a Razao Social do destinatario para "${file.name}".`)
        setMessageType('error')
        return
      }
      if (!form.valor_bruto || parseFloat(form.valor_bruto) <= 0) {
        setMessage(`Valor Bruto deve ser maior que zero para "${file.name}".`)
        setMessageType('error')
        return
      }
    }

    setUploading(true)
    setMessage('')

    const xmlFiles = selectedFiles.filter((f) => f.name.toLowerCase().endsWith('.xml'))
    const errors: string[] = []
    const createdIds: string[] = []

    // Upload XMLs via existing action
    if (xmlFiles.length > 0) {
      const fd = new FormData()
      xmlFiles.forEach((f) => fd.append('arquivos', f))
      const result = await uploadNFs(fd)
      if (result?.success) {
        createdIds.push(...(result.ids || []))
      } else if (result?.message) {
        errors.push(result.message)
      }
    }

    // Upload PDFs/images via criarNFManual with form data
    for (const file of nonXmlFiles) {
      const form = pdfForms[file.name]
      const fd = new FormData()
      fd.append('arquivo', file)
      fd.append('numero_nf', form.numero_nf)
      fd.append('data_emissao', form.data_emissao)
      fd.append('data_vencimento', form.data_vencimento)
      fd.append('cnpj_destinatario', form.cnpj_destinatario)
      fd.append('razao_social_destinatario', form.razao_social_destinatario)
      fd.append('valor_bruto', form.valor_bruto)
      fd.append('descricao_itens', form.descricao_itens)
      fd.append('condicao_pagamento', form.condicao_pagamento)

      const result = await criarNFManual(fd)
      if (result?.success) {
        createdIds.push(...(result.ids || []))
      } else {
        errors.push(result?.message || `Erro ao enviar "${file.name}".`)
      }
    }

    setUploading(false)

    if (errors.length > 0 && createdIds.length === 0) {
      setMessage(errors.join('\n'))
      setMessageType('error')
      return
    }

    setSelectedFiles([])
    setPdfForms({})

    if (errors.length > 0) {
      setMessage(`${createdIds.length} NF(s) enviada(s) com sucesso. Erros: ${errors.join('; ')}`)
      setMessageType('error')
      await loadNFs()
    } else if (createdIds.length === 1 && nonXmlFiles.length === 1 && xmlFiles.length === 0) {
      // Single PDF: redirect to detail page
      router.push(`/cedente/notas-fiscais/${createdIds[0]}`)
    } else {
      setMessage(`${createdIds.length} nota(s) fiscal(is) enviada(s) com sucesso!`)
      setMessageType('success')
      await loadNFs()
    }
  }

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
              ou clique para selecionar — XML (leitura automatica), PDF, JPG, PNG (preenchimento manual)
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
                  onClick={() => { setSelectedFiles([]); setPdfForms({}) }}
                  className="text-destructive hover:text-destructive"
                >
                  Limpar todos
                </Button>
              </div>

              <div className="space-y-4">
                {selectedFiles.map((file, index) => (
                  <div key={index}>
                    {/* File row */}
                    <div className="flex items-center justify-between bg-muted/40 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText size={16} className={getFileIcon(file.name)} />
                        <span className="text-sm text-foreground truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          ({(file.size / 1024 / 1024).toFixed(1)} MB)
                        </span>
                        {!isNonXml(file) ? (
                          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-1.5 py-0.5">
                            Leitura automatica
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

                    {/* Manual form for PDF/image files */}
                    {isNonXml(file) && pdfForms[file.name] && (
                      <div className="mt-2 ml-4 border border-border rounded-lg p-4 bg-background space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Dados da Nota Fiscal
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Numero da NF *</label>
                            <input
                              type="text"
                              value={pdfForms[file.name].numero_nf}
                              onChange={(e) => updatePdfForm(file.name, 'numero_nf', e.target.value)}
                              placeholder="Ex: 1234"
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Data de Emissao *</label>
                            <input
                              type="date"
                              value={pdfForms[file.name].data_emissao}
                              onChange={(e) => updatePdfForm(file.name, 'data_emissao', e.target.value)}
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Data de Vencimento *</label>
                            <input
                              type="date"
                              value={pdfForms[file.name].data_vencimento}
                              onChange={(e) => updatePdfForm(file.name, 'data_vencimento', e.target.value)}
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">CNPJ do Sacado (Destinatario) *</label>
                            <input
                              type="text"
                              value={pdfForms[file.name].cnpj_destinatario}
                              onChange={(e) => updatePdfForm(file.name, 'cnpj_destinatario', e.target.value)}
                              placeholder="00.000.000/0001-00"
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Razao Social do Sacado *</label>
                            <input
                              type="text"
                              value={pdfForms[file.name].razao_social_destinatario}
                              onChange={(e) => updatePdfForm(file.name, 'razao_social_destinatario', e.target.value)}
                              placeholder="Nome da empresa"
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Valor Bruto (R$) *</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={pdfForms[file.name].valor_bruto}
                              onChange={(e) => updatePdfForm(file.name, 'valor_bruto', e.target.value)}
                              placeholder="0,00"
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Condicao de Pagamento</label>
                            <input
                              type="text"
                              value={pdfForms[file.name].condicao_pagamento}
                              onChange={(e) => updatePdfForm(file.name, 'condicao_pagamento', e.target.value)}
                              placeholder="Ex: 30 dias, boleto"
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Descricao dos Itens</label>
                            <input
                              type="text"
                              value={pdfForms[file.name].descricao_itens}
                              onChange={(e) => updatePdfForm(file.name, 'descricao_itens', e.target.value)}
                              placeholder="Servicos / produtos"
                              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                        </div>
                      </div>
                    )}
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
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
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
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <Link
                        href={`/cedente/notas-fiscais/${nf.id}`}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium"
                      >
                        <Eye size={14} />
                        {nf.status === 'rascunho' ? 'Preencher' : 'Ver'}
                      </Link>
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

'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { analisarDocumento } from '@/lib/actions/gestor'
import { formatCNPJ, formatDate } from '@/lib/utils'
import { buckets } from '@/lib/storage'
import {
  FileText,
  Search,
  Filter,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  X,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface DocGestor {
  id: string
  tipo: string
  versao: number
  status: string
  nome_arquivo: string | null
  url_arquivo: string | null
  motivo_reprovacao: string | null
  created_at: string
  cedentes: { razao_social: string; cnpj: string }
}

const tipoLabels: Record<string, string> = {
  contrato_social: 'Contrato Social',
  cartao_cnpj: 'Cartao CNPJ',
  rg_cpf: 'RG e CPF',
  comprovante_endereco: 'Comprovante de Endereco',
  extrato_bancario: 'Comprovante de Renda',
  balanco_patrimonial: 'Balanco Patrimonial',
  dre: 'DRE',
  procuracao: 'Procuracao',
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  aguardando_envio: { label: 'Aguardando', color: 'bg-gray-100 text-gray-600', icon: Clock },
  enviado: { label: 'Enviado', color: 'bg-blue-100 text-blue-700', icon: FileText },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovado: { label: 'Aprovado', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  reprovado: { label: 'Reprovado', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function DocumentosGestorPage() {
  const [docs, setDocs] = useState<DocGestor[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<{ doc: DocGestor; previewUrl: string } | null>(null)
  const [motivo, setMotivo] = useState('')
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState('')

  const loadDocs = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('documentos')
      .select('id, tipo, versao, status, nome_arquivo, url_arquivo, motivo_reprovacao, created_at, cedentes(razao_social, cnpj)')
      .order('created_at', { ascending: false })

    setDocs((data || []) as DocGestor[])
    setLoading(false)
  }

  useEffect(() => { loadDocs() }, [])

  const openPreview = async (doc: DocGestor) => {
    if (!doc.url_arquivo) return
    const supabase = createClient()
    const { data } = await supabase.storage
      .from(buckets.documentos)
      .createSignedUrl(doc.url_arquivo, 3600)
    setModal({ doc, previewUrl: data?.signedUrl || '' })
    setMotivo('')
  }

  const handleAnalise = async (decisao: 'aprovado' | 'reprovado') => {
    if (!modal) return
    if (decisao === 'reprovado' && !motivo.trim()) {
      setMessage('Motivo obrigatorio para reprovar.')
      return
    }
    setProcessing(true)
    const result = await analisarDocumento(modal.doc.id, decisao, motivo || undefined)
    setMessage(result?.message || '')
    if (result?.success) {
      setModal(null)
      await loadDocs()
    }
    setProcessing(false)
  }

  const docsFiltrados = docs.filter((d) => {
    if (filtroStatus !== 'todos' && d.status !== filtroStatus) return false
    if (busca) {
      const term = busca.toLowerCase()
      return (
        d.cedentes.razao_social.toLowerCase().includes(term) ||
        d.cedentes.cnpj.includes(term) ||
        (tipoLabels[d.tipo] || d.tipo).toLowerCase().includes(term)
      )
    }
    return true
  })

  const pendentes = docs.filter((d) => d.status === 'enviado' || d.status === 'em_analise').length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Documentos</h1>
        <p className="text-muted-foreground">Fila de documentos para analise.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes</p>
          <p className="text-2xl font-bold text-yellow-700 tabular-nums">{pendentes}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Aprovados</p>
          <p className="text-2xl font-bold text-green-700 tabular-nums">{docs.filter((d) => d.status === 'aprovado').length}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs font-medium text-red-600">Reprovados</p>
          <p className="text-2xl font-bold text-red-700 tabular-nums">{docs.filter((d) => d.status === 'reprovado').length}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total</p>
          <p className="text-2xl font-bold text-blue-700 tabular-nums">{docs.length}</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.includes('sucesso') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-destructive border border-red-200'
        }`}>{message}</div>
      )}

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Buscar por cedente, CNPJ ou tipo..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-11"
              />
            </div>
            <div className="relative flex items-center">
              <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <Select value={filtroStatus} onValueChange={(v) => { if (v) setFiltroStatus(v) }}>
                <SelectTrigger className="pl-9 h-11 w-full sm:w-52">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="enviado">Enviados (pendentes)</SelectItem>
                  <SelectItem value="em_analise">Em Analise</SelectItem>
                  <SelectItem value="aprovado">Aprovados</SelectItem>
                  <SelectItem value="reprovado">Reprovados</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      {loading ? (
        <Card>
          <CardContent className="pt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : docsFiltrados.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum documento encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase px-4 py-3">Cedente</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Tipo</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Arquivo</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Versao</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Status</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Data</TableHead>
                <TableHead className="text-xs uppercase px-4 py-3">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docsFiltrados.map((doc) => {
                const st = statusConfig[doc.status]
                const StIcon = st?.icon || Clock
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{doc.cedentes.razao_social}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">{formatCNPJ(doc.cedentes.cnpj)}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm">{tipoLabels[doc.tipo] || doc.tipo}</TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[150px]">{doc.nome_arquivo || '—'}</TableCell>
                    <TableCell className="px-4 py-3 text-sm tabular-nums">v{doc.versao}</TableCell>
                    <TableCell className="px-4 py-3">
                      <Badge className={`inline-flex items-center gap-1 rounded-full text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                        <StIcon size={12} />
                        {st?.label || doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm text-muted-foreground">{formatDate(doc.created_at)}</TableCell>
                    <TableCell className="px-4 py-3">
                      {(doc.status === 'enviado' || doc.status === 'em_analise') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openPreview(doc)}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          <Eye size={14} /> Analisar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Modal de analise */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground">{tipoLabels[modal.doc.tipo] || modal.doc.tipo} — v{modal.doc.versao}</h3>
                <p className="text-sm text-muted-foreground">{modal.doc.cedentes.razao_social}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setModal(null)}>
                <X size={20} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {modal.previewUrl ? (
                modal.doc.nome_arquivo?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={modal.previewUrl} className="w-full h-[500px] border rounded" />
                ) : (
                  <img src={modal.previewUrl} alt={modal.doc.nome_arquivo || ''} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-muted-foreground text-center py-10">Nao foi possivel carregar o preview.</p>
              )}
            </div>
            <div className="p-4 border-t border-border space-y-3">
              <div className="flex gap-3">
                <Button
                  onClick={() => handleAnalise('aprovado')}
                  disabled={processing}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                >
                  {processing ? 'Processando...' : 'Aprovar'}
                </Button>
                <Button
                  onClick={() => { if (motivo.trim()) handleAnalise('reprovado'); else setMessage('Preencha o motivo.') }}
                  disabled={processing}
                  variant="destructive"
                  className="flex-1"
                >
                  Reprovar
                </Button>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground mb-1 block">
                  Motivo da reprovacao (obrigatorio para reprovar)
                </Label>
                <textarea
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-ring"
                  rows={2}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Descreva o motivo..."
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

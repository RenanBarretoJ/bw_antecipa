'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadNFs } from '@/lib/actions/nota-fiscal'
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
} from 'lucide-react'

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

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  rascunho: { label: 'Rascunho', color: 'bg-gray-100 text-gray-600', icon: FileText },
  submetida: { label: 'Submetida', color: 'bg-blue-100 text-blue-700', icon: Upload },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovada: { label: 'Aprovada', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  em_antecipacao: { label: 'Em Antecipacao', color: 'bg-purple-100 text-purple-700', icon: Banknote },
  liquidada: { label: 'Liquidada', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  cancelada: { label: 'Cancelada', color: 'bg-red-100 text-red-700', icon: XCircle },
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

  const getFileIcon = (name: string) => {
    if (name.endsWith('.xml')) return 'text-green-600'
    if (name.endsWith('.pdf')) return 'text-red-600'
    return 'text-blue-600'
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Minhas Notas Fiscais</h1>
        <p className="text-gray-500">Envie XMLs de NF-e para leitura automatica ou PDFs para preenchimento manual.</p>
      </div>

      {/* Zona de upload drag-and-drop */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Enviar Notas Fiscais</h2>

        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400 bg-gray-50'
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
          <FileUp size={48} className={`mx-auto mb-3 ${dragActive ? 'text-blue-500' : 'text-gray-400'}`} />
          <p className="text-lg font-medium text-gray-700">
            {dragActive ? 'Solte os arquivos aqui' : 'Arraste e solte seus arquivos aqui'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            ou clique para selecionar — XML (leitura automatica), PDF, JPG, PNG (preenchimento manual)
          </p>
          <p className="text-xs text-gray-400 mt-2">Maximo 20MB por arquivo. Multiplos arquivos permitidos.</p>
        </div>

        {/* Arquivos selecionados */}
        {selectedFiles.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {selectedFiles.length} arquivo(s) selecionado(s)
              </span>
              <button
                onClick={() => setSelectedFiles([])}
                className="text-xs text-red-600 hover:text-red-700"
              >
                Limpar todos
              </button>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={16} className={getFileIcon(file.name)} />
                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">
                      ({(file.size / 1024 / 1024).toFixed(1)} MB)
                    </span>
                    {file.name.endsWith('.xml') && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                        Leitura automatica
                      </span>
                    )}
                    {!file.name.endsWith('.xml') && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                        Preenchimento manual
                      </span>
                    )}
                  </div>
                  <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-500 ml-2">
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleUpload}
              disabled={uploading}
              className="mt-4 w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  Enviar {selectedFiles.length} arquivo(s)
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Mensagem */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm whitespace-pre-line ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por numero, CNPJ ou razao social do sacado..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none"
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
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total', count: nfs.length, color: 'bg-gray-50 text-gray-900' },
          { label: 'Rascunho', count: nfs.filter((n) => n.status === 'rascunho').length, color: 'bg-yellow-50 text-yellow-700' },
          { label: 'Aprovadas', count: nfs.filter((n) => n.status === 'aprovada').length, color: 'bg-green-50 text-green-700' },
          { label: 'Valor Total', count: -1, valor: nfs.reduce((acc, n) => acc + n.valor_bruto, 0), color: 'bg-blue-50 text-blue-700' },
        ].map((item) => (
          <div key={item.label} className={`rounded-xl p-4 ${item.color}`}>
            <p className="text-xs font-medium opacity-70">{item.label}</p>
            <p className="text-xl font-bold mt-1">
              {item.count === -1 ? formatCurrency(item.valor!) : item.count}
            </p>
          </div>
        ))}
      </div>

      {/* Lista de NFs */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : nfsFiltradas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">
            {nfs.length === 0 ? 'Nenhuma nota fiscal enviada ainda.' : 'Nenhuma NF encontrada com os filtros aplicados.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">NF</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Sacado (Destinatario)</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Valor Bruto</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Emissao</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Vencimento</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nfsFiltradas.map((nf) => {
                  const status = statusConfig[nf.status] || statusConfig.rascunho
                  const StatusIcon = status.icon
                  return (
                    <tr key={nf.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900">
                          {nf.numero_nf || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm text-gray-900">{nf.razao_social_destinatario || '—'}</p>
                          <p className="text-xs text-gray-400">
                            {nf.cnpj_destinatario ? formatCNPJ(nf.cnpj_destinatario) : '—'}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {nf.valor_bruto > 0 ? formatCurrency(nf.valor_bruto) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {nf.data_emissao ? formatDate(nf.data_emissao) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {nf.data_vencimento ? formatDate(nf.data_vencimento) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                          <StatusIcon size={12} />
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/cedente/notas-fiscais/${nf.id}`}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                        >
                          <Eye size={14} />
                          {nf.status === 'rascunho' ? 'Preencher' : 'Ver'}
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

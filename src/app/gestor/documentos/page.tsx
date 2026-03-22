'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { analisarDocumento } from '@/lib/actions/gestor'
import { formatCNPJ, formatDate } from '@/lib/utils'
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
  extrato_bancario: 'Extrato Bancario',
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
  const [filtroStatus, setFiltroStatus] = useState('enviado')
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
      .from('documentos-cedentes')
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
        <h1 className="text-2xl font-bold text-gray-900">Documentos</h1>
        <p className="text-gray-500">Fila de documentos para analise.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-yellow-50 rounded-xl p-4">
          <p className="text-xs font-medium text-yellow-600">Pendentes</p>
          <p className="text-2xl font-bold text-yellow-700">{pendentes}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600">Aprovados</p>
          <p className="text-2xl font-bold text-green-700">{docs.filter((d) => d.status === 'aprovado').length}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs font-medium text-red-600">Reprovados</p>
          <p className="text-2xl font-bold text-red-700">{docs.filter((d) => d.status === 'reprovado').length}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600">Total</p>
          <p className="text-2xl font-bold text-blue-700">{docs.length}</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.includes('sucesso') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>{message}</div>
      )}

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar por cedente, CNPJ ou tipo..." value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}
              className="pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white appearance-none">
              <option value="todos">Todos</option>
              <option value="enviado">Enviados (pendentes)</option>
              <option value="em_analise">Em Analise</option>
              <option value="aprovado">Aprovados</option>
              <option value="reprovado">Reprovados</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : docsFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhum documento encontrado.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Cedente</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Tipo</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Arquivo</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Versao</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Data</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-3">Acoes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docsFiltrados.map((doc) => {
                  const st = statusConfig[doc.status]
                  const StIcon = st?.icon || Clock
                  return (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{doc.cedentes.razao_social}</p>
                        <p className="text-xs text-gray-400">{formatCNPJ(doc.cedentes.cnpj)}</p>
                      </td>
                      <td className="px-4 py-3 text-sm">{tipoLabels[doc.tipo] || doc.tipo}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-[150px]">{doc.nome_arquivo || '—'}</td>
                      <td className="px-4 py-3 text-sm">v{doc.versao}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${st?.color || 'bg-gray-100'}`}>
                          <StIcon size={12} />
                          {st?.label || doc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(doc.created_at)}</td>
                      <td className="px-4 py-3">
                        {(doc.status === 'enviado' || doc.status === 'em_analise') && (
                          <button onClick={() => openPreview(doc)}
                            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
                            <Eye size={14} /> Analisar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de analise */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold text-gray-900">{tipoLabels[modal.doc.tipo] || modal.doc.tipo} — v{modal.doc.versao}</h3>
                <p className="text-sm text-gray-500">{modal.doc.cedentes.razao_social}</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {modal.previewUrl ? (
                modal.doc.nome_arquivo?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={modal.previewUrl} className="w-full h-[500px] border rounded" />
                ) : (
                  <img src={modal.previewUrl} alt={modal.doc.nome_arquivo || ''} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-gray-500 text-center py-10">Nao foi possivel carregar o preview.</p>
              )}
            </div>
            <div className="p-4 border-t space-y-3">
              <div className="flex gap-3">
                <button onClick={() => handleAnalise('aprovado')} disabled={processing}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                  {processing ? 'Processando...' : 'Aprovar'}
                </button>
                <button onClick={() => { if (motivo.trim()) handleAnalise('reprovado'); else setMessage('Preencha o motivo.') }} disabled={processing}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium">
                  Reprovar
                </button>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Motivo da reprovacao (obrigatorio para reprovar)</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2}
                  value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Descreva o motivo..." />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

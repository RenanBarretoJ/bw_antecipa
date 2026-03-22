'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadDocumento } from '@/lib/actions/cedente'
import { Upload, CheckCircle, XCircle, Clock, AlertCircle, FileText } from 'lucide-react'

interface DocInfo {
  key: string
  label: string
  obrigatorio: boolean
}

const documentosConfig: DocInfo[] = [
  { key: 'contrato_social', label: 'Contrato Social Atualizado', obrigatorio: true },
  { key: 'cartao_cnpj', label: 'Cartao CNPJ', obrigatorio: true },
  { key: 'rg_cpf', label: 'RG e CPF do Representante Legal', obrigatorio: true },
  { key: 'comprovante_endereco', label: 'Comprovante de Endereco (ultimos 90 dias)', obrigatorio: true },
  { key: 'extrato_bancario', label: 'Extrato Bancario (ultimos 3 meses)', obrigatorio: true },
  { key: 'balanco_patrimonial', label: 'Balanco Patrimonial (ultimo exercicio)', obrigatorio: true },
  { key: 'dre', label: 'DRE - Demonstracao de Resultado', obrigatorio: true },
  { key: 'procuracao', label: 'Procuracao', obrigatorio: false },
]

interface DocRecord {
  id: string
  tipo: string
  versao: number
  status: string
  nome_arquivo: string | null
  motivo_reprovacao: string | null
  created_at: string
}

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  aguardando_envio: { label: 'Aguardando Envio', color: 'bg-gray-100 text-gray-600', icon: Clock },
  enviado: { label: 'Enviado', color: 'bg-blue-100 text-blue-700', icon: Upload },
  em_analise: { label: 'Em Analise', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  aprovado: { label: 'Aprovado', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  reprovado: { label: 'Reprovado', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function DocumentosCedentePage() {
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const loadDocs = async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('documentos')
      .select('id, tipo, versao, status, nome_arquivo, motivo_reprovacao, created_at')
      .order('created_at', { ascending: false })

    setDocs((data || []) as DocRecord[])
    setLoading(false)
  }

  useEffect(() => { loadDocs() }, [])

  const getLatestDoc = (tipo: string): DocRecord | null => {
    return docs.filter((d) => d.tipo === tipo)[0] || null
  }

  const handleUpload = async (tipo: string, file: File) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowedTypes.includes(file.type)) {
      setMessage('Formato invalido. Aceitos: PDF, JPG, PNG.')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage('Arquivo muito grande. Maximo: 20MB.')
      return
    }

    setUploading(tipo)
    setMessage('')

    const formData = new FormData()
    formData.set('arquivo', file)
    formData.set('tipo', tipo)

    const result = await uploadDocumento(formData)

    if (result?.success) {
      setMessage(result.message || 'Documento enviado!')
      await loadDocs()
    } else {
      setMessage(result?.message || 'Erro no upload.')
    }
    setUploading(null)
  }

  const obrigatorios = documentosConfig.filter((d) => d.obrigatorio)
  const aprovados = obrigatorios.filter((d) => {
    const doc = getLatestDoc(d.key)
    return doc?.status === 'aprovado'
  })

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Documentos</h1>
          <p className="text-gray-500">Envie os documentos necessarios para habilitacao.</p>
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Progresso de aprovacao</span>
          <span className="text-sm font-bold text-gray-900">{aprovados.length} de {obrigatorios.length} documentos aprovados</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div className="bg-green-500 h-2.5 rounded-full transition-all" style={{ width: `${(aprovados.length / obrigatorios.length) * 100}%` }} />
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.includes('sucesso') || message.includes('enviado') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>{message}</div>
      )}

      {/* Cards de documentos */}
      <div className="space-y-3">
        {documentosConfig.map((docConfig) => {
          const latestDoc = getLatestDoc(docConfig.key)
          const status = latestDoc?.status || 'aguardando_envio'
          const config = statusConfig[status]
          const Icon = config.icon
          const isUploading = uploading === docConfig.key
          const canUpload = !latestDoc || status === 'aguardando_envio' || status === 'reprovado'

          return (
            <div key={docConfig.key} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <FileText size={20} className="text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">
                      {docConfig.label}
                      {!docConfig.obrigatorio && <span className="text-gray-400 text-sm ml-2">(opcional)</span>}
                    </p>
                    {latestDoc?.nome_arquivo && (
                      <p className="text-xs text-gray-400 mt-0.5">{latestDoc.nome_arquivo} (v{latestDoc.versao})</p>
                    )}
                    {status === 'reprovado' && latestDoc?.motivo_reprovacao && (
                      <p className="text-xs text-red-600 mt-1">Motivo: {latestDoc.motivo_reprovacao}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}>
                    <Icon size={14} />
                    {config.label}
                  </span>

                  {canUpload && (
                    <>
                      <input
                        ref={(el) => { fileInputRefs.current[docConfig.key] = el }}
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) handleUpload(docConfig.key, file)
                          e.target.value = ''
                        }}
                      />
                      <button
                        onClick={() => fileInputRefs.current[docConfig.key]?.click()}
                        disabled={isUploading}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                          status === 'reprovado'
                            ? 'bg-red-600 text-white hover:bg-red-700'
                            : 'bg-blue-600 text-white hover:bg-blue-700'
                        } disabled:opacity-50`}
                      >
                        {isUploading ? 'Enviando...' : status === 'reprovado' ? 'Reenviar' : 'Enviar'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {loading && (
        <div className="text-center py-8">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      )}
    </div>
  )
}

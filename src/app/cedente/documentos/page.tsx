'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadDocumento } from '@/lib/actions/cedente'
import { Upload, CheckCircle, XCircle, Clock, AlertCircle, FileText, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

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

const statusConfig: Record<string, { label: string; variant: 'secondary' | 'outline' | 'destructive' | 'default'; icon: typeof CheckCircle }> = {
  aguardando_envio: { label: 'Aguardando Envio', variant: 'outline', icon: Clock },
  enviado: { label: 'Enviado', variant: 'secondary', icon: Upload },
  em_analise: { label: 'Em Analise', variant: 'secondary', icon: AlertCircle },
  aprovado: { label: 'Aprovado', variant: 'default', icon: CheckCircle },
  reprovado: { label: 'Reprovado', variant: 'destructive', icon: XCircle },
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

  const isSuccess = message.includes('sucesso') || message.includes('enviado')

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Meus Documentos</h1>
          <p className="text-muted-foreground">Envie os documentos necessarios para habilitacao.</p>
        </div>
      </div>

      {/* Barra de progresso */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">Progresso de aprovacao</span>
            <span className="text-sm font-bold text-foreground tabular-nums">{aprovados.length} de {obrigatorios.length} documentos aprovados</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div className="bg-emerald-500 h-2.5 rounded-full transition-all" style={{ width: `${(aprovados.length / obrigatorios.length) * 100}%` }} />
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          isSuccess
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-destructive/10 text-destructive border-destructive/20'
        }`}>{message}</div>
      )}

      {/* Cards de documentos */}
      {loading ? (
        <div className="space-y-3">
          {documentosConfig.map((docConfig) => (
            <Card key={docConfig.key}>
              <CardContent className="py-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {documentosConfig.map((docConfig) => {
            const latestDoc = getLatestDoc(docConfig.key)
            const status = latestDoc?.status || 'aguardando_envio'
            const config = statusConfig[status]
            const Icon = config.icon
            const isUploading = uploading === docConfig.key
            const canUpload = !latestDoc || status === 'aguardando_envio' || status === 'reprovado'

            return (
              <Card key={docConfig.key}>
                <CardContent className="py-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <FileText size={20} className="text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">
                          {docConfig.label}
                          {!docConfig.obrigatorio && <span className="text-muted-foreground text-sm ml-2">(opcional)</span>}
                        </p>
                        {latestDoc?.nome_arquivo && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {latestDoc.nome_arquivo} <span className="tabular-nums">(v{latestDoc.versao})</span>
                          </p>
                        )}
                        {status === 'reprovado' && latestDoc?.motivo_reprovacao && (
                          <p className="text-xs text-destructive mt-1">Motivo: {latestDoc.motivo_reprovacao}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant={config.variant}>
                        <Icon size={14} />
                        {config.label}
                      </Badge>

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
                          <Button
                            variant={status === 'reprovado' ? 'destructive' : 'default'}
                            size="sm"
                            onClick={() => fileInputRefs.current[docConfig.key]?.click()}
                            disabled={isUploading}
                          >
                            {isUploading ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                Enviando...
                              </>
                            ) : status === 'reprovado' ? 'Reenviar' : 'Enviar'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

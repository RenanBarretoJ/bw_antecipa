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

const docsEmpresa: DocInfo[] = [
  { key: 'contrato_social', label: 'Contrato Social Atualizado', obrigatorio: true },
  { key: 'cartao_cnpj', label: 'Cartao CNPJ', obrigatorio: true },
  { key: 'comprovante_endereco', label: 'Comprovante de Endereco (ultimos 90 dias)', obrigatorio: true },
  { key: 'extrato_bancario', label: 'Comprovante de Faturamento', obrigatorio: true },
  { key: 'balanco_patrimonial', label: 'Balanco Patrimonial (ultimo exercicio)', obrigatorio: true },
  { key: 'dre', label: 'DRE - Demonstracao de Resultado', obrigatorio: true },
]

const docsRepresentante: DocInfo[] = [
  { key: 'rg_cpf', label: 'RG e CPF', obrigatorio: true },
  { key: 'comprovante_de_renda', label: 'Comprovante de Renda', obrigatorio: false },
  { key: 'comprovante_endereco', label: 'Comprovante de Residencia (ultimos 90 dias)', obrigatorio: true },
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
  representante_id: string | null
}

interface RepresentanteRecord {
  id: string
  nome: string
  principal: boolean
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
  const [representantes, setRepresentantes] = useState<RepresentanteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const loadDocs = async () => {
    const supabase = createClient()
    try {
      const { data: repsData } = await supabase
        .from('representantes')
        .select('id, nome, principal')
        .order('principal', { ascending: false })

      setRepresentantes((repsData || []) as RepresentanteRecord[])

      const { data } = await supabase
        .from('documentos')
        .select('id, tipo, versao, status, nome_arquivo, motivo_reprovacao, created_at, representante_id')
        .order('created_at', { ascending: false })

      setDocs((data || []) as DocRecord[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDocs() }, [])

  const getLatestDocByRep = (tipo: string, representanteId: string | null): DocRecord | null => {
    return docs.find((d) => d.tipo === tipo && d.representante_id === representanteId) || null
  }

  const handleUpload = async (tipo: string, file: File, representanteId?: string) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowedTypes.includes(file.type)) {
      setMessage('Formato invalido. Aceitos: PDF, JPG, PNG.')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setMessage('Arquivo muito grande. Maximo: 20MB.')
      return
    }

    const uploadKey = representanteId ? `${tipo}_${representanteId}` : tipo
    setUploading(uploadKey)
    setMessage('')

    const formData = new FormData()
    formData.set('arquivo', file)
    formData.set('tipo', tipo)
    if (representanteId) formData.set('representante_id', representanteId)

    const result = await uploadDocumento(formData)

    if (result?.success) {
      setMessage(result.message || 'Documento enviado!')
      await loadDocs()
    } else {
      setMessage(result?.message || 'Erro no upload.')
    }
    setUploading(null)
  }

  // Calcular progresso: docs empresa + docs obrigatórios por representante
  const docsRepObrig = docsRepresentante.filter((d) => d.obrigatorio)
  const totalObrig = docsEmpresa.filter((d) => d.obrigatorio).length + representantes.length * docsRepObrig.length
  const aprovadosEmpresa = docsEmpresa.filter((d) => d.obrigatorio && getLatestDocByRep(d.key, null)?.status === 'aprovado').length
  const aprovadosReps = representantes.reduce((acc, rep) =>
    acc + docsRepObrig.filter((d) => getLatestDocByRep(d.key, rep.id)?.status === 'aprovado').length, 0
  )
  const totalAprovados = aprovadosEmpresa + aprovadosReps
  const totalObrigFinal = totalObrig > 0 ? totalObrig : docsEmpresa.filter((d) => d.obrigatorio).length + docsRepObrig.length

  const isSuccess = message.includes('sucesso') || message.includes('enviado')

  const renderDocCard = (docConfig: DocInfo, representanteId: string | null = null, keyPrefix = '') => {
    const uploadKey = representanteId
      ? `${docConfig.key}_${representanteId}`
      : keyPrefix ? `${keyPrefix}_${docConfig.key}` : docConfig.key
    const latestDoc = getLatestDocByRep(docConfig.key, representanteId)
    const status = latestDoc?.status || 'aguardando_envio'
    const config = statusConfig[status]
    const Icon = config.icon
    const isUploading = uploading === uploadKey
    const canUpload = !latestDoc || status === 'aguardando_envio' || status === 'reprovado'

    return (
      <Card key={uploadKey}>
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
                    ref={(el) => { fileInputRefs.current[uploadKey] = el }}
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleUpload(docConfig.key, file, representanteId || undefined)
                      e.target.value = ''
                    }}
                  />
                  <Button
                    variant={status === 'reprovado' ? 'destructive' : 'default'}
                    size="sm"
                    onClick={() => fileInputRefs.current[uploadKey]?.click()}
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
  }

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
            <span className="text-sm font-bold text-foreground tabular-nums">{totalAprovados} de {totalObrigFinal} documentos aprovados</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className="bg-emerald-500 h-2.5 rounded-full transition-all"
              style={{ width: totalObrigFinal > 0 ? `${(totalAprovados / totalObrigFinal) * 100}%` : '0%' }}
            />
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

      {loading ? (
        <div className="space-y-3">
          {[...docsEmpresa, ...docsRepresentante].map((_, idx) => (
            <Card key={idx}>
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
        <div className="space-y-6">
          {/* Documentos da Empresa */}
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">Documentos da Empresa</h2>
            <div className="space-y-3">
              {docsEmpresa.map((docConfig) => renderDocCard(docConfig, null))}
            </div>
          </div>

          {/* Documentos por Representante */}
          {representantes.map((rep) => (
            <div key={rep.id}>
              <h2 className="text-lg font-semibold text-foreground mb-3">
                Documentos — {rep.nome}
                {rep.principal && (
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-2">(principal)</span>
                )}
              </h2>
              <div className="space-y-3">
                {docsRepresentante.map((docConfig) => renderDocCard(docConfig, rep.id))}
              </div>
            </div>
          ))}

          {/* Fallback: sem representantes na tabela nova */}
          {representantes.length === 0 && (
            <div>
              <h2 className="text-lg font-semibold text-foreground mb-3">Documentos do Representante Legal</h2>
              <div className="space-y-3">
                {docsRepresentante.map((docConfig) => renderDocCard(docConfig, null, 'legado'))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

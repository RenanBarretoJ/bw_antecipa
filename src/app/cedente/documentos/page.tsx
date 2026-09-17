'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prepararUploadDocumentoCadastral, finalizarUploadDocumentoCadastral, reconciliarUploadDocumentoCadastral } from '@/lib/actions/cedente-documento-upload'
import { DOCUMENTO_CADASTRAL_BUCKET, validarArquivoDocumentoCadastral } from '@/lib/documentos-cadastrais/upload'
import { aguardarUploadComPrazo, UploadTimeoutError } from '@/lib/documentos-cadastrais/upload-timeout'
import { Upload, CheckCircle, XCircle, Clock, AlertCircle, FileText, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useNotifications } from '@/components/notifications/notification-provider'

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
  { key: 'representante_comprovante_residencia', label: 'Comprovante de Residencia (ultimos 90 dias)', obrigatorio: true },
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
  atualizacao_solicitada_em: string | null
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
  const notifications = useNotifications()
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [representantes, setRepresentantes] = useState<RepresentanteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadStage, setUploadStage] = useState<'preparando' | 'enviando' | 'finalizando' | 'confirmando' | null>(null)
  const [message, setMessage] = useState('')
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const uploadInFlightRef = useRef(false)

  useEffect(() => {
    if (!message) return
    const isSuccess = message.includes('sucesso') || message.includes('enviado')
    notifications.notify({ type: isSuccess ? 'success' : 'error', message, dedupeKey: `${isSuccess ? 'success' : 'error'}:${message}` })
    queueMicrotask(() => setMessage(''))
  }, [message, notifications])

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
        .select('id, tipo, versao, status, nome_arquivo, motivo_reprovacao, created_at, representante_id, atualizacao_solicitada_em')
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
    const invalidFile = validarArquivoDocumentoCadastral(file)
    if (invalidFile) { setMessage(invalidFile); return }
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true

    const uploadKey = representanteId ? `${tipo}_${representanteId}` : tipo
    setUploading(uploadKey)
    setUploadStage('preparando')
    setMessage('')
    let stage: 'preparando' | 'enviando' | 'finalizando' = 'preparando'
    let finalizado = false
    const correlationId = crypto.randomUUID()
    const reconcile = async (token: string) => {
      for (const delay of [500, 1500, 3000]) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        const state = await aguardarUploadComPrazo(reconciliarUploadDocumentoCadastral(token), 30_000, 'RECONCILE', correlationId)
        if (state !== 'NOT_UPLOADED') return state
      }
      return 'NOT_UPLOADED'
    }
    try {
      const prepared = await aguardarUploadComPrazo(
        prepararUploadDocumentoCadastral({
          tipo, nomeArquivo: file.name, mime: file.type, tamanho: file.size, representanteId,
        }), 30_000, 'PREPARE', correlationId,
      )
      if (!prepared.success) { setMessage(prepared.message); return }
      const intentTag = prepared.storagePath.match(/[0-9a-f]{8}-[0-9a-f-]{27}_[^/]+$/i)?.[0].slice(0, 8) || 'unknown'
      console.info('document-upload-intent', { correlationId, intentTag })
      stage = 'enviando'
      setUploadStage(stage)
      const supabase = createClient()
      const transfer = supabase.storage.from(DOCUMENTO_CADASTRAL_BUCKET)
        .uploadToSignedUrl(prepared.storagePath, prepared.uploadToken, file, { contentType: file.type, upsert: false })
      let uploadResult: Awaited<typeof transfer> | null = null
      try {
        uploadResult = await aguardarUploadComPrazo(transfer, 120_000, 'UPLOAD', correlationId)
      } catch (error) {
        setUploadStage('confirmando')
        const state = await reconcile(prepared.intent)
        if (state !== 'UPLOADED_NOT_FINALIZED' && state !== 'FINALIZED') throw error
        // A resposta do Storage pode chegar depois do prazo local: o estado canonico prevalece.
        void transfer.catch(() => {})
      }
      const uploadError = uploadResult?.error
      if (uploadError) {
        setUploadStage('confirmando')
        const state = await reconcile(prepared.intent)
        if (state !== 'UPLOADED_NOT_FINALIZED' && state !== 'FINALIZED') {
          console.info('document-upload-result', { correlationId, phase: 'enviando', outcome: 'SUPABASE_STORAGE_ERROR', errorCode: uploadError.name })
          setMessage('Nao foi possivel enviar o arquivo. Tente novamente.')
          return
        }
      }
      stage = 'finalizando'
      setUploadStage(stage)
      let result: Awaited<ReturnType<typeof finalizarUploadDocumentoCadastral>>
      try {
        result = await aguardarUploadComPrazo(finalizarUploadDocumentoCadastral(prepared.intent), 30_000, 'FINALIZE', correlationId)
      } catch (error) {
        setUploadStage('confirmando')
        const state = await reconcile(prepared.intent)
        if (state === 'FINALIZED') result = { success: true, message: 'Documento enviado com sucesso!' }
        else if (state === 'UPLOADED_NOT_FINALIZED') {
          result = await aguardarUploadComPrazo(finalizarUploadDocumentoCadastral(prepared.intent), 30_000, 'FINALIZE', correlationId)
        } else throw error
      }
      if (!result.success) {
        const state = await reconcile(prepared.intent)
        if (state === 'FINALIZED') result = { success: true, message: 'Documento enviado com sucesso!' }
      }
      setMessage(result.message)
      if (result.success) {
        finalizado = true
        await loadDocs()
      }
    } catch (error) {
      console.info('document-upload-result', { correlationId, phase: stage, outcome: error instanceof UploadTimeoutError ? `${error.phase}_TIMEOUT` : 'NETWORK_FAILURE' })
      setMessage(finalizado
        ? 'Documento registrado, mas a lista nao foi atualizada. Recarregue a pagina.'
        : stage === 'finalizando'
        ? 'O arquivo foi enviado, mas nao foi possivel concluir o registro do documento. Tente novamente.'
        : 'Nao foi possivel enviar o arquivo. Tente novamente.')
    } finally {
      // The intent and cleanup are durable; no browser timer can own deletion.
      setUploadStage(null)
      setUploading(null)
      uploadInFlightRef.current = false
    }
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

  const renderDocCard = (docConfig: DocInfo, representanteId: string | null = null, keyPrefix = '') => {
    const uploadKey = representanteId
      ? `${docConfig.key}_${representanteId}`
      : keyPrefix ? `${keyPrefix}_${docConfig.key}` : docConfig.key
    const latestDoc = getLatestDocByRep(docConfig.key, representanteId)
    const status = latestDoc?.status || 'aguardando_envio'
    const config = statusConfig[status]
    const Icon = config.icon
    const isUploading = uploading === uploadKey
    const atualizacaoSolicitada = !!latestDoc?.atualizacao_solicitada_em
    const canUpload = !latestDoc || status === 'aguardando_envio' || status === 'reprovado' || atualizacaoSolicitada

    const uploadButtonLabel = isUploading
      ? uploadStage === 'preparando' ? 'Preparando...' : uploadStage === 'finalizando' ? 'Finalizando...' : uploadStage === 'confirmando' ? 'Estamos confirmando o envio...' : 'Enviando arquivo...'
      : status === 'reprovado'
      ? 'Reenviar'
      : atualizacaoSolicitada && status !== 'aguardando_envio'
      ? 'Atualizar'
      : 'Enviar'

    const uploadButtonVariant = status === 'reprovado'
      ? 'destructive'
      : atualizacaoSolicitada && status !== 'aguardando_envio'
      ? 'outline'
      : 'default'

    return (
      <Card key={uploadKey} className={atualizacaoSolicitada ? 'border-amber-300' : ''}>
        <CardContent className="py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <FileText size={20} className="text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {docConfig.label}
                  {!docConfig.obrigatorio && <span className="text-muted-foreground text-sm ml-2">(opcional)</span>}
                </p>
                {latestDoc?.nome_arquivo && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {latestDoc.nome_arquivo} <span className="tabular-nums">(v{latestDoc.versao})</span>
                  </p>
                )}
                {status === 'reprovado' && latestDoc?.motivo_reprovacao && (
                  <p className="text-xs text-destructive mt-1">Motivo: {latestDoc.motivo_reprovacao}</p>
                )}
                {atualizacaoSolicitada && (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <RefreshCw size={11} />
                    Atualização solicitada em {new Date(latestDoc!.atualizacao_solicitada_em!).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
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
                    variant={uploadButtonVariant as 'destructive' | 'outline' | 'default'}
                    size="sm"
                    onClick={() => fileInputRefs.current[uploadKey]?.click()}
                    disabled={!!uploading}
                    className={atualizacaoSolicitada && status !== 'reprovado' ? 'text-amber-600 border-amber-300 hover:bg-amber-50' : ''}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {uploadButtonLabel}
                      </>
                    ) : (
                      <>
                        {atualizacaoSolicitada && status !== 'reprovado' && status !== 'aguardando_envio' && <RefreshCw size={14} />}
                        {uploadButtonLabel}
                      </>
                    )}
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

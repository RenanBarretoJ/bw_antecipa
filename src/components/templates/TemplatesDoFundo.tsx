'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Archive, CheckCircle2, Circle, Code2, FileCog, FileText, History, Loader2, UploadCloud } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarTemplateDocumento,
  criarVersaoTemplate,
  criarVersaoTemplateNoFundo,
  importarTemplatesLocaisParaFundo,
  previewTemplateHtml,
  publicarVersaoTemplate,
  publicarVersaoTemplateNoFundo,
} from '@/lib/actions/templates'
import type { TemplateDocumentType } from '@/lib/types/domain'
import type { Fundo, TemplateDocumento, TemplateVersao } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DetailField, DetailSection, EmptyState, LoadingState, StatusBadge } from '@/components/data-display/primitives'

type TemplateWithVersions = TemplateDocumento & { template_versoes?: TemplateVersao[] }

type LegalDocumentCatalogItem = {
  key: string
  tipo: TemplateDocumentType | null
  label: string
  required: boolean
  description: string
}

type DocumentState = {
  item: LegalDocumentCatalogItem
  template: TemplateWithVersions | null
  published: TemplateVersao | null
  draft: TemplateVersao | null
  latest: TemplateVersao | null
  status: 'Publicado' | 'Pendente' | 'Não configurado' | 'Desativado'
}

type EditorContext = {
  item: LegalDocumentCatalogItem
  template: TemplateWithVersions
  mode: 'view' | 'draft' | 'new-version' | 'history'
}

const legalDocuments: LegalDocumentCatalogItem[] = [
  {
    key: 'contrato_mae',
    tipo: 'contrato_mae',
    label: 'Contrato-mãe',
    required: true,
    description: 'Contrato principal utilizado como base jurídica do relacionamento.',
  },
  {
    key: 'termo_cessao',
    tipo: 'termo_cessao',
    label: 'Termo de cessão',
    required: true,
    description: 'Documento gerado para formalizar a cessão de recebíveis da operação.',
  },
  {
    key: 'notificacao_sacado',
    tipo: 'notificacao_sacado',
    label: 'Notificação ao sacado',
    required: false,
    description: 'Comunicação jurídica enviada ao sacado quando aplicável ao fluxo.',
  },
  {
    key: 'termo_quitacao',
    tipo: 'termo_quitacao',
    label: 'Termo de quitação',
    required: false,
    description: 'Documento usado para registrar quitação conforme o ciclo da operação.',
  },
  {
    key: 'contrato_mae_sem_coobrigacao',
    tipo: 'contrato_mae_sem_coobrigacao',
    label: 'Contrato-mãe sem coobrigação',
    required: false,
    description: 'Contrato principal usado quando o fluxo jurídico dispensa coobrigação.',
  },
]

const friendlyVariables = [
  { label: 'Nome do fundo', handle: '{{fundo.nome}}' },
  { label: 'CNPJ do fundo', handle: '{{fundo.cnpj}}' },
  { label: 'Cedente', handle: '{{cedente.razao_social}}' },
  { label: 'Representantes', handle: '{{representantes}}' },
  { label: 'Valor da operação', handle: '{{operacao.valor_bruto}}' },
  { label: 'Notas fiscais', handle: '{{notas_fiscais}}' },
  { label: 'Datas', handle: '{{datas}}' },
  { label: 'Testemunhas', handle: '{{testemunhas}}' },
]

const initialTemplateDescription = 'Template jurídico controlado pelo cadastro do fundo.'

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function findPublishedVersion(template?: TemplateWithVersions | null) {
  return template?.template_versoes?.find((version) => version.status === 'publicada') || null
}

function findDraftVersion(template?: TemplateWithVersions | null) {
  return template?.template_versoes?.find((version) => version.status === 'rascunho') || null
}

function findLatestVersion(template?: TemplateWithVersions | null) {
  return template?.template_versoes?.[0] || null
}

function checklistIcon(ok: boolean) {
  const Icon = ok ? CheckCircle2 : Circle
  return <Icon size={16} className={ok ? 'text-success' : 'text-muted-foreground'} aria-hidden="true" />
}

export function TemplatesDoFundo({ fundoId, showFundoSelector = !fundoId }: { fundoId?: string; showFundoSelector?: boolean }) {
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [templates, setTemplates] = useState<TemplateWithVersions[]>([])
  const [selectedFundoId, setSelectedFundoId] = useState(fundoId || '')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [isPending, startTransition] = useTransition()
  const [editorContext, setEditorContext] = useState<EditorContext | null>(null)
  const [editorTab, setEditorTab] = useState<'conteudo' | 'preview' | 'variaveis' | 'historico'>('conteudo')
  const [conteudoHtml, setConteudoHtml] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')
  const [publishVersion, setPublishVersion] = useState<TemplateVersao | null>(null)
  const [arquivadosVisiveis, setArquivadosVisiveis] = useState(false)

  const loadData = useCallback(async (nextFundoId = selectedFundoId) => {
    const supabase = createClient()
    const fundosPromise = showFundoSelector ? supabase.from('fundos').select('*').order('nome') : Promise.resolve({ data: [] })
    const templatesQuery = supabase
      .from('templates_documentos')
      .select('*, template_versoes(*)')
      .order('created_at', { ascending: false })
    if (fundoId) templatesQuery.eq('fundo_id', fundoId)
    const [{ data: fundosData }, { data: templatesData }] = await Promise.all([fundosPromise, templatesQuery])

    const fundosList = (fundosData || []) as Fundo[]
    setFundos(fundosList)
    setTemplates(((templatesData || []) as TemplateWithVersions[]).map((template) => ({
      ...template,
      template_versoes: [...(template.template_versoes || [])].sort((a, b) => b.versao - a.versao),
    })))
    if (!fundoId && !nextFundoId && fundosList[0]) setSelectedFundoId(fundosList[0].id)
    setLoading(false)
  }, [fundoId, selectedFundoId, showFundoSelector])

  // Carga inicial dos templates jurídicos.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const contextFundoId = fundoId || selectedFundoId
  const visibleTemplates = useMemo(
    () => templates.filter((template) => !contextFundoId || template.fundo_id === contextFundoId),
    [templates, contextFundoId],
  )

  const activeTemplates = useMemo(
    () => visibleTemplates.filter((template) => template.status !== 'desativado'),
    [visibleTemplates],
  )

  const archivedTemplates = useMemo(
    () => visibleTemplates.filter((template) => template.status === 'desativado'),
    [visibleTemplates],
  )

  const documentStates = useMemo<DocumentState[]>(() => legalDocuments.map((item) => {
    const template = item.tipo ? activeTemplates.find((candidate) => candidate.tipo_documento === item.tipo) || null : null
    const published = findPublishedVersion(template)
    const draft = findDraftVersion(template)
    const latest = findLatestVersion(template)
    const status: DocumentState['status'] = !template
      ? 'Não configurado'
      : template.status === 'desativado'
        ? 'Desativado'
        : published
          ? 'Publicado'
          : 'Pendente'
    return { item, template, published, draft, latest, status }
  }), [activeTemplates])

  const requiredDocuments = documentStates.filter((state) => state.item.required)
  const publishedRequired = requiredDocuments.filter((state) => !!state.published)
  const optionalDocuments = documentStates.filter((state) => !state.item.required)
  const configuredOptional = optionalDocuments.filter((state) => !!state.template).length
  const draftCount = documentStates.filter((state) => state.draft).length
  const pendingRequired = requiredDocuments.length - publishedRequired.length
  const lastPublication = documentStates
    .map((state) => state.published?.publicada_em)
    .filter(Boolean)
    .sort()
    .at(-1)
  const importFinished = legalDocuments
    .every((item) => visibleTemplates.some((template) => template.tipo_documento === item.tipo && (template.template_versoes || []).length > 0))
  const importCreatedAt = visibleTemplates
    .filter((template) => legalDocuments.some((item) => item.tipo === template.tipo_documento))
    .map((template) => template.created_at)
    .sort()
    .at(-1)

  function notify(result: { success: boolean; message: string }) {
    setMessage(result.message)
    setMessageType(result.success ? 'success' : 'error')
  }

  function runAction(action: () => Promise<{ success: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action()
      notify(result)
      if (result.success) await loadData(contextFundoId)
    })
  }

  function openEditor(item: LegalDocumentCatalogItem, template: TemplateWithVersions, mode: EditorContext['mode'], baseVersion?: TemplateVersao | null) {
    setEditorContext({ item, template, mode })
    setEditorTab(mode === 'history' ? 'historico' : 'conteudo')
    setConteudoHtml(baseVersion?.conteudo_html || '')
    setPreviewHtml('')
  }

  function configureDocument(item: LegalDocumentCatalogItem) {
    if (!contextFundoId) return notify({ success: false, message: 'Selecione um fundo.' })
    if (!item.tipo) return notify({ success: false, message: 'Tipo jurídico indisponível no catálogo técnico.' })
    const tipoDocumento = item.tipo
    startTransition(async () => {
      const result = await criarTemplateDocumento({
        fundoId: contextFundoId,
        codigo: item.key,
        tipoDocumento,
        nome: item.label,
        descricao: initialTemplateDescription,
      })
      notify(result)
      if (!result.success || !result.data?.id) return
      const newTemplate: TemplateWithVersions = {
        id: result.data.id,
        fundo_id: contextFundoId,
        codigo: item.key,
        tipo_documento: tipoDocumento,
        nome: item.label,
        descricao: initialTemplateDescription,
        status: 'rascunho',
        created_by: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        template_versoes: [],
      }
      await loadData(contextFundoId)
      openEditor(item, newTemplate, 'draft')
    })
  }

  function handleCreateVersion() {
    if (!editorContext || !conteudoHtml.trim()) return notify({ success: false, message: 'Informe o HTML da versão.' })
    runAction(async () => {
      const result = fundoId
        ? await criarVersaoTemplateNoFundo(fundoId, { templateId: editorContext.template.id, conteudoHtml })
        : await criarVersaoTemplate({ templateId: editorContext.template.id, conteudoHtml })
      if (result.success) {
        setConteudoHtml('')
        setPreviewHtml('')
        setEditorContext(null)
      }
      return result
    })
  }

  function handlePreview(version?: TemplateVersao | null) {
    const html = version?.conteudo_html || conteudoHtml
    if (!editorContext || !html.trim()) return notify({ success: false, message: 'Informe o HTML para preview.' })
    startTransition(async () => {
      const result = await previewTemplateHtml({ tipoDocumento: editorContext.template.tipo_documento, conteudoHtml: html })
      notify(result)
      setPreviewHtml(result.success ? result.data?.html || '' : '')
      if (result.success) setEditorTab('preview')
    })
  }

  function openEditorWithPreview(item: LegalDocumentCatalogItem, template: TemplateWithVersions, version: TemplateVersao) {
    setEditorContext({ item, template, mode: 'view' })
    setEditorTab('preview')
    setConteudoHtml(version.conteudo_html)
    setPreviewHtml('')
    startTransition(async () => {
      const result = await previewTemplateHtml({ tipoDocumento: template.tipo_documento, conteudoHtml: version.conteudo_html })
      notify(result)
      setPreviewHtml(result.success ? result.data?.html || '' : '')
    })
  }

  function confirmPublish() {
    if (!publishVersion) return
    runAction(() => fundoId ? publicarVersaoTemplateNoFundo(fundoId, publishVersion.id) : publicarVersaoTemplate(publishVersion.id))
    setPublishVersion(null)
  }

  if (loading) return <LoadingState label="Carregando templates jurídicos..." />

  return (
    <div className="space-y-5">
      {message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${messageType === 'success' ? 'border-success/30 bg-success/10 text-success-foreground' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}>
          {message}
        </div>
      )}

      {showFundoSelector && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <Label htmlFor="fundo-template">Fundo</Label>
          <select id="fundo-template" value={selectedFundoId} onChange={(event) => setSelectedFundoId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
            {fundos.map((fundo) => <option key={fundo.id} value={fundo.id}>{fundo.nome}</option>)}
          </select>
        </div>
      )}

      <DetailSection title="Templates jurídicos" icon={FileCog}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-3 md:grid-cols-2">
            {documentStates.map((state) => (
              <div key={state.item.key} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                {checklistIcon(!!state.published || (!state.item.required && state.status === 'Não configurado'))}
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{state.item.label}</p>
                  <p className="text-xs text-muted-foreground">{state.item.required ? 'Obrigatório' : 'Opcional'} · {state.published ? `Publicado · v${state.published.versao}` : state.status}</p>
                </div>
              </div>
            ))}
          </div>
          <dl className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
            <DetailField label="Documentos obrigatórios" value={`${requiredDocuments.length}`} />
            <DetailField label="Documentos obrigatórios publicados" value={`${publishedRequired.length}`} />
            <DetailField label="Rascunhos" value={`${draftCount}`} />
            <DetailField label="Pendências obrigatórias" value={`${pendingRequired}`} />
            <DetailField label="Templates opcionais configurados" value={`${configuredOptional} de ${optionalDocuments.length}`} />
            <DetailField label="Última publicação" value={formatDateTime(lastPublication)} />
          </dl>
        </div>
      </DetailSection>

      <DetailSection title="Documentos jurídicos" icon={FileText}>
        <div className="rounded-xl border border-border">
          <div className="hidden grid-cols-[minmax(260px,1.4fr)_130px_160px_120px_170px_150px] gap-4 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground xl:grid">
            <span>Documento</span>
            <span>Obrigação</span>
            <span>Status</span>
            <span>Versão</span>
            <span>Publicação</span>
            <span>Responsável</span>
          </div>
          <div className="divide-y divide-border">
            {documentStates.map((state) => (
              <div key={state.item.key} className="space-y-4 px-4 py-4 text-sm">
                <div className="grid gap-4 xl:grid-cols-[minmax(260px,1.4fr)_130px_160px_120px_170px_150px] xl:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{state.item.label}</p>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">{state.item.description}</p>
                  </div>
                  <div><StatusBadge status={state.item.required ? 'Obrigatório' : 'Opcional'} /></div>
                  <div><StatusBadge status={state.status} /></div>
                  <span className="text-muted-foreground">{state.published ? `v${state.published.versao}` : '—'}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(state.published?.publicada_em)}</span>
                  <span className="text-xs text-muted-foreground">{state.published?.publicada_por ? 'Registrado' : 'Não informado'}</span>
                </div>
                <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-2 sm:bg-transparent sm:p-0 xl:justify-end xl:border-0">
                  {!state.template && (
                    <Button type="button" size="sm" onClick={() => configureDocument(state.item)} disabled={isPending}>
                      Configurar
                    </Button>
                  )}
                  {state.template && state.draft && (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => openEditor(state.item, state.template!, 'draft', state.draft)}>Continuar edição</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => openEditorWithPreview(state.item, state.template!, state.draft!)}>Preview</Button>
                      <Button type="button" size="sm" onClick={() => setPublishVersion(state.draft)}>Publicar</Button>
                    </>
                  )}
                  {state.template && !state.draft && state.published && (
                    <>
                      <Button type="button" size="sm" variant="outline" onClick={() => openEditor(state.item, state.template!, 'view', state.published)}>Visualizar</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => openEditorWithPreview(state.item, state.template!, state.published!)}>Gerar preview</Button>
                      <Button type="button" size="sm" onClick={() => openEditor(state.item, state.template!, 'new-version', state.published)}>Criar nova versão</Button>
                    </>
                  )}
                  {state.template && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => openEditor(state.item, state.template!, 'history', state.latest)}>
                      Histórico
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DetailSection>

      <DetailSection
        title="Templates arquivados"
        icon={Archive}
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setArquivadosVisiveis((value) => !value)}>
            {arquivadosVisiveis ? 'Ocultar' : 'Mostrar'} arquivados
          </Button>
        }
      >
        {!arquivadosVisiveis ? (
          <p className="text-sm text-muted-foreground">Templates desativados ficam separados para não poluir a configuração operacional do fundo.</p>
        ) : archivedTemplates.length === 0 ? (
          <EmptyState title="Nenhum template arquivado" description="Templates desativados aparecerão aqui." icon={Archive} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="hidden grid-cols-[minmax(180px,1fr)_120px_170px_150px_160px] gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
              <span>Documento</span>
              <span>Última versão</span>
              <span>Data de desativação</span>
              <span>Responsável</span>
              <span className="text-right">Ações</span>
            </div>
            <div className="divide-y divide-border">
              {archivedTemplates.map((template) => {
                const latest = findLatestVersion(template)
                const item = legalDocuments.find((doc) => doc.tipo === template.tipo_documento) || {
                  key: template.codigo,
                  tipo: template.tipo_documento,
                  label: template.nome,
                  required: false,
                  description: template.descricao || '',
                }
                return (
                  <div key={template.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(180px,1fr)_120px_170px_150px_160px] lg:items-center">
                    <div>
                      <p className="font-semibold">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{template.descricao || 'Template arquivado.'}</p>
                    </div>
                    <span className="text-muted-foreground">{latest ? `v${latest.versao}` : '—'}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(template.updated_at)}</span>
                    <span className="text-xs text-muted-foreground">Não informado</span>
                    <div className="flex justify-start lg:justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEditor(item, template, 'history', latest)}>
                        Ver histórico
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </DetailSection>

      <DetailSection title="Importação inicial" icon={UploadCloud}>
        {importFinished ? (
          <div className="rounded-xl border border-success/30 bg-success/10 p-4 text-sm">
            <p className="font-semibold text-success-foreground">Templates locais importados</p>
            <p className="mt-1 text-muted-foreground">
              {legalDocuments.length} documentos do catálogo técnico cadastrados{importCreatedAt ? ` em ${formatDateTime(importCreatedAt)}` : ''}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold">Importar modelos locais versionados</p>
              <p className="mt-1 text-sm text-muted-foreground">A ação é idempotente: importa apenas documentos ainda não cadastrados para este fundo.</p>
            </div>
            <Button type="button" onClick={() => contextFundoId && runAction(() => importarTemplatesLocaisParaFundo(contextFundoId))} disabled={isPending || !contextFundoId}>
              {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UploadCloud className="mr-2 size-4" />} Importar templates locais
            </Button>
          </div>
        )}
      </DetailSection>

      <Dialog open={!!editorContext} onOpenChange={(open) => { if (!open) { setEditorContext(null); setPreviewHtml(''); setConteudoHtml('') } }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          {editorContext && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Code2 size={20} aria-hidden="true" /></div>
                  <div>
                    <DialogTitle>{editorContext.item.label}</DialogTitle>
                    <DialogDescription>
                      Editor avançado. Alterações neste conteúdo afetam os documentos jurídicos gerados pelo fundo.
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex flex-wrap gap-2">
                {(['conteudo', 'preview', 'variaveis', 'historico'] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setEditorTab(tab)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${editorTab === tab ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                    {tab === 'conteudo' ? 'Conteúdo' : tab === 'preview' ? 'Preview' : tab === 'variaveis' ? 'Variáveis' : 'Histórico'}
                  </button>
                ))}
              </div>

              {editorTab === 'conteudo' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
                    Revise com cuidado: versão publicada não é editada diretamente. Ao salvar, será criada uma nova versão em rascunho.
                  </div>
                  <div>
                    <Label>Conteúdo HTML / Handlebars</Label>
                    <textarea
                      value={conteudoHtml}
                      onChange={(event) => setConteudoHtml(event.target.value)}
                      readOnly={editorContext.mode === 'view' || editorContext.mode === 'history'}
                      className="mt-2 min-h-[520px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Use preview antes de publicar. Variáveis inválidas serão rejeitadas pelas validações do servidor.
                    </p>
                  </div>
                </div>
              )}

              {editorTab === 'preview' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">Prévia segura com marca d’água para revisar paginação, cabeçalho, rodapé, variáveis e dados de exemplo.</p>
                    <Button type="button" variant="outline" onClick={() => handlePreview()} disabled={isPending}>Gerar preview</Button>
                  </div>
                  {previewHtml ? (
                    <iframe title="Preview do template jurídico" srcDoc={previewHtml} className="h-[720px] w-full rounded-lg border border-border bg-white" />
                  ) : (
                    <EmptyState title="Preview ainda não gerado" description="Clique em Gerar preview para visualizar o documento." icon={FileText} />
                  )}
                </div>
              )}

              {editorTab === 'variaveis' && (
                <div className="grid gap-3 md:grid-cols-2">
                  {friendlyVariables.map((variable) => (
                    <div key={variable.handle} className="rounded-xl border border-border bg-background p-4">
                      <p className="font-semibold">{variable.label}</p>
                      <p className="mt-2 font-mono text-xs text-muted-foreground">{variable.handle}</p>
                    </div>
                  ))}
                </div>
              )}

              {editorTab === 'historico' && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="hidden grid-cols-[80px_120px_160px_160px_140px_minmax(140px,1fr)_220px] gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground xl:grid">
                    <span>Versão</span>
                    <span>Status</span>
                    <span>Criada em</span>
                    <span>Publicada em</span>
                    <span>Responsável</span>
                    <span>Hash</span>
                    <span className="text-right">Ações</span>
                  </div>
                  <div className="divide-y divide-border">
                    {(editorContext.template.template_versoes || []).map((version) => (
                      <div key={version.id} className="grid gap-3 px-4 py-4 text-sm xl:grid-cols-[80px_120px_160px_160px_140px_minmax(140px,1fr)_220px] xl:items-center">
                        <span className="font-medium">v{version.versao}</span>
                        <StatusBadge status={version.status} />
                        <span className="text-xs text-muted-foreground">{formatDateTime(version.created_at)}</span>
                        <span className="text-xs text-muted-foreground">{formatDateTime(version.publicada_em)}</span>
                        <span className="text-xs text-muted-foreground">{version.publicada_por ? 'Registrado' : 'Não informado'}</span>
                        <span className="break-all font-mono text-xs text-muted-foreground">{version.sha256}</span>
                        <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
                          <Button type="button" size="sm" variant="outline" onClick={() => { setConteudoHtml(version.conteudo_html); setEditorTab('conteudo') }}>Visualizar</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => handlePreview(version)}>Preview</Button>
                          {version.status !== 'publicada' && version.status !== 'substituida' && version.status !== 'cancelada' && (
                            <Button type="button" size="sm" onClick={() => setPublishVersion(version)}>Publicar</Button>
                          )}
                          <Button type="button" size="sm" variant="ghost" onClick={() => { setConteudoHtml(version.conteudo_html); setEditorTab('conteudo') }}>Duplicar</Button>
                        </div>
                      </div>
                    ))}
                    {(editorContext.template.template_versoes || []).length === 0 && (
                      <div className="p-4"><EmptyState title="Nenhuma versão criada" description="Salve a primeira versão para iniciar o histórico." icon={History} /></div>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditorContext(null)}>Fechar</Button>
                <Button type="button" variant="outline" onClick={() => handlePreview()} disabled={isPending || !conteudoHtml.trim()}>Gerar preview</Button>
                {editorContext.mode !== 'view' && editorContext.mode !== 'history' && (
                  <Button type="button" onClick={handleCreateVersion} disabled={isPending || !conteudoHtml.trim()}>
                    Criar versão em rascunho
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!publishVersion} onOpenChange={(open) => { if (!open) setPublishVersion(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publicar versão do template</DialogTitle>
            <DialogDescription>Confirme a publicação. A versão anterior publicada será substituída e documentos já gerados permanecerão preservados.</DialogDescription>
          </DialogHeader>
          {publishVersion && (
            <div className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
              <DetailField label="Documento" value={editorContext?.item.label || 'Template jurídico'} />
              <DetailField label="Nova versão" value={`v${publishVersion.versao}`} />
              <DetailField label="Vigência" value="A partir da publicação" />
              <DetailField label="Responsável" value="Usuário autenticado" />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishVersion(null)}>Cancelar</Button>
            <Button type="button" onClick={confirmPublish} disabled={isPending}>Confirmar publicação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

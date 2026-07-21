'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { FileCog, FileText, Loader2, Plus, UploadCloud } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarTemplateDocumento,
  criarVersaoTemplate,
  criarVersaoTemplateNoFundo,
  desativarTemplateDocumento,
  desativarTemplateDocumentoNoFundo,
  importarTemplatesLocaisParaFundo,
  previewTemplateHtml,
  publicarVersaoTemplate,
  publicarVersaoTemplateNoFundo,
} from '@/lib/actions/templates'
import { TEMPLATE_DOCUMENT_TYPES, type TemplateDocumentType } from '@/lib/types/domain'
import type { Fundo, TemplateDocumento, TemplateVersao } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DetailSection, EmptyState, LoadingState, StatusBadge } from '@/components/data-display/primitives'

type TemplateWithVersions = TemplateDocumento & { template_versoes?: TemplateVersao[] }

const tipoLabels: Record<TemplateDocumentType, string> = {
  contrato_mae: 'Contrato mãe',
  termo_cessao: 'Termo de cessão',
  notificacao_sacado: 'Notificação ao sacado',
  termo_quitacao: 'Termo de quitação',
}

const initialTemplateForm = {
  codigo: '',
  tipoDocumento: 'contrato_mae' as TemplateDocumentType,
  nome: '',
  descricao: '',
}

export function TemplatesDoFundo({ fundoId, showFundoSelector = !fundoId }: { fundoId?: string; showFundoSelector?: boolean }) {
  const [fundos, setFundos] = useState<Fundo[]>([])
  const [templates, setTemplates] = useState<TemplateWithVersions[]>([])
  const [selectedFundoId, setSelectedFundoId] = useState(fundoId || '')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [isPending, startTransition] = useTransition()
  const [templateForm, setTemplateForm] = useState(initialTemplateForm)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [conteudoHtml, setConteudoHtml] = useState('')
  const [previewHtml, setPreviewHtml] = useState('')

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  )

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

  // Carga inicial dos templates juridicos.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const contextFundoId = fundoId || selectedFundoId
  const visibleTemplates = useMemo(
    () => templates.filter((template) => !contextFundoId || template.fundo_id === contextFundoId),
    [templates, contextFundoId],
  )

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

  function handleCreateTemplate() {
    if (!contextFundoId) return notify({ success: false, message: 'Selecione um fundo.' })
    runAction(async () => {
      const result = await criarTemplateDocumento({ fundoId: contextFundoId, ...templateForm })
      if (result.success) setTemplateForm(initialTemplateForm)
      return result
    })
  }

  function handleCreateVersion() {
    if (!selectedTemplate || !conteudoHtml.trim()) return notify({ success: false, message: 'Selecione um template e informe o HTML da versao.' })
    runAction(async () => {
      const result = fundoId
        ? await criarVersaoTemplateNoFundo(fundoId, { templateId: selectedTemplate.id, conteudoHtml })
        : await criarVersaoTemplate({ templateId: selectedTemplate.id, conteudoHtml })
      if (result.success) {
        setConteudoHtml('')
        setPreviewHtml('')
      }
      return result
    })
  }

  function handlePreview() {
    if (!selectedTemplate || !conteudoHtml.trim()) return notify({ success: false, message: 'Selecione um template e informe o HTML para preview.' })
    startTransition(async () => {
      const result = await previewTemplateHtml({ tipoDocumento: selectedTemplate.tipo_documento, conteudoHtml })
      notify(result)
      setPreviewHtml(result.success ? result.data?.html || '' : '')
    })
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

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <DetailSection title="Templates jurídicos" icon={FileCog} action={<Button type="button" onClick={() => contextFundoId && runAction(() => importarTemplatesLocaisParaFundo(contextFundoId))} disabled={isPending || !contextFundoId}>{isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <UploadCloud className="mr-2 size-4" />} Importar locais</Button>}>
          {visibleTemplates.length === 0 ? (
            <EmptyState title="Nenhum template cadastrado" description="Importe os templates locais ou crie um template manualmente para este fundo." icon={FileText} />
          ) : (
            <div className="space-y-3">
              {visibleTemplates.map((template) => (
                <article key={template.id} className="rounded-xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">{template.nome}</h3>
                        <StatusBadge status={template.status} />
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{tipoLabels[template.tipo_documento]}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Código: {template.codigo}</p>
                      {template.descricao && <p className="mt-2 text-sm text-muted-foreground">{template.descricao}</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setSelectedTemplateId(template.id)}>Nova versão</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => runAction(() => fundoId ? desativarTemplateDocumentoNoFundo(fundoId, template.id) : desativarTemplateDocumento(template.id))}>Desativar</Button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {(template.template_versoes || []).length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma versão criada.</p> : template.template_versoes!.map((versao) => (
                      <div key={versao.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm md:flex-row md:items-center md:justify-between">
                        <div>
                          <span className="font-medium">v{versao.versao}</span>
                          <span className="ml-2 text-xs text-muted-foreground">hash {versao.sha256.slice(0, 12)}...</span>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <StatusBadge status={versao.status} />
                            <span className="text-xs text-muted-foreground">vigente desde {new Date(versao.vigente_desde).toLocaleString('pt-BR')}</span>
                          </div>
                        </div>
                        {versao.status !== 'publicada' && <Button type="button" size="sm" onClick={() => runAction(() => fundoId ? publicarVersaoTemplateNoFundo(fundoId, versao.id) : publicarVersaoTemplate(versao.id))}>Publicar</Button>}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </DetailSection>

        <div className="space-y-5">
          <DetailSection title="Criar template" icon={Plus}>
            <div className="space-y-3">
              <div><Label>Código</Label><Input value={templateForm.codigo} onChange={(event) => setTemplateForm((prev) => ({ ...prev, codigo: event.target.value }))} /></div>
              <div>
                <Label>Tipo</Label>
                <select value={templateForm.tipoDocumento} onChange={(event) => setTemplateForm((prev) => ({ ...prev, tipoDocumento: event.target.value as TemplateDocumentType }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  {TEMPLATE_DOCUMENT_TYPES.map((tipo) => <option key={tipo} value={tipo}>{tipoLabels[tipo]}</option>)}
                </select>
              </div>
              <div><Label>Nome</Label><Input value={templateForm.nome} onChange={(event) => setTemplateForm((prev) => ({ ...prev, nome: event.target.value }))} /></div>
              <div><Label>Descrição</Label><Input value={templateForm.descricao} onChange={(event) => setTemplateForm((prev) => ({ ...prev, descricao: event.target.value }))} /></div>
              <Button type="button" onClick={handleCreateTemplate} disabled={isPending || !contextFundoId} className="w-full">Criar template</Button>
            </div>
          </DetailSection>

          <DetailSection title="Nova versão HTML" icon={FileText}>
            <div className="space-y-3">
              <div>
                <Label>Template</Label>
                <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="">Selecione</option>
                  {visibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.nome} ({template.codigo})</option>)}
                </select>
              </div>
              <div>
                <Label>Conteúdo HTML / Handlebars</Label>
                <textarea value={conteudoHtml} onChange={(event) => setConteudoHtml(event.target.value)} className="mt-2 min-h-64 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={handlePreview} disabled={isPending}>Preview</Button>
                <Button type="button" onClick={handleCreateVersion} disabled={isPending}>Criar versão</Button>
              </div>
            </div>
          </DetailSection>
        </div>
      </div>

      {previewHtml && <DetailSection title="Preview" icon={FileText}><iframe title="Preview do template jurídico" srcDoc={previewHtml} className="h-[720px] w-full rounded-lg border border-border bg-white" /></DetailSection>}
    </div>
  )
}

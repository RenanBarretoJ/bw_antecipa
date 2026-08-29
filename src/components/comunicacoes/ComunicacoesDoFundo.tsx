'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, Circle, Clock3, Mail, PauseCircle, PlayCircle } from 'lucide-react'
import {
  alterarPausaComunicacoes,
  carregarComunicacoesDoFundo,
  criarRascunhoComunicacoes,
  enviarEmailTesteComunicacoes,
  executarDryRunComunicacoes,
  gerarPreviewComunicacao,
  publicarRascunhoComunicacoes,
  salvarRascunhoComunicacoes,
  type ComunicacaoConfiguracaoForm,
  type ComunicacaoTemplateForm,
} from '@/lib/actions/comunicacoes'
import { COMUNICACAO_CATEGORIAS, type ComunicacaoCategoria, type ReguaComunicacao } from '@/lib/comunicacoes/tipos'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DetailSection, EmptyState, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'

type Loaded = Awaited<ReturnType<typeof carregarComunicacoesDoFundo>>

const CATEGORY_LABELS: Record<ComunicacaoCategoria, string> = {
  LOGISTICA_LEMBRETE: 'Logística · lembrete',
  LOGISTICA_VENCE_HOJE: 'Logística · vence hoje',
  LOGISTICA_VENCIDO: 'Logística · vencido',
  LOGISTICA_REJEITADO: 'Logística · documento rejeitado',
  FINANCEIRO_LEMBRETE: 'Financeiro · lembrete',
  FINANCEIRO_VENCE_HOJE: 'Financeiro · vence hoje',
  FINANCEIRO_VENCIDO: 'Financeiro · vencido',
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Não registrado'
}

function parseRule(value: unknown, fallback: ReguaComunicacao): ReguaComunicacao {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    offsets: Array.isArray(row.offsets) ? row.offsets.map(Number) : fallback.offsets,
    recorrenciaApos: Number(row.recorrencia_apos ?? row.recorrenciaApos ?? fallback.recorrenciaApos),
    recorrenciaDias: Number(row.recorrencia_dias ?? row.recorrenciaDias ?? fallback.recorrenciaDias),
  }
}

function offsetsLabel(offsets: number[]) {
  return offsets.map((offset) => offset === 0 ? 'D0' : offset < 0 ? `D${offset}` : `D+${offset}`).join(', ')
}

function ConfigCheck({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : Circle
  return <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm"><Icon className={`size-4 ${ok ? 'text-success' : 'text-muted-foreground'}`} /><span>{children}</span></div>
}

export function ComunicacoesDoFundo({ fundoId }: { fundoId: string }) {
  const notifications = useNotifications()
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<ComunicacaoConfiguracaoForm | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<ComunicacaoCategoria>('LOGISTICA_LEMBRETE')
  const [preview, setPreview] = useState<{ assunto: string; html: string; texto: string } | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await carregarComunicacoesDoFundo(fundoId)
      setData(loaded)
      const draft = loaded.versions.find((version) => version.status === 'rascunho')
      if (!draft) {
        setForm(null)
        return
      }
      const templates = COMUNICACAO_CATEGORIAS.map((categoria): ComunicacaoTemplateForm => {
        const row = loaded.templates.find((item) => item.configuracao_versao_id === draft.id && item.categoria === categoria)
        const standard = loaded.templateDefaults[categoria]
        return {
          categoria,
          modo: row?.modo === 'personalizado' ? 'personalizado' : 'padrao',
          assunto: row?.assunto || standard.assunto,
          corpoHtml: row?.corpo_html || standard.html,
          corpoTexto: row?.corpo_texto || standard.texto,
        }
      })
      setForm({
        versaoId: draft.id,
        logisticaHabilitada: draft.logistica_habilitada,
        cteHabilitado: draft.cte_habilitado,
        comprovanteHabilitado: draft.comprovante_habilitado,
        financeiroHabilitado: draft.financeiro_habilitado,
        reguaLogistica: parseRule(draft.regua_logistica, { offsets: [-5, -3, -1, 0, 1, 3], recorrenciaApos: 3, recorrenciaDias: 3 }),
        reguaFinanceira: parseRule(draft.regua_financeira, { offsets: [-7, -3, -1, 0, 1, 3, 5, 7], recorrenciaApos: 7, recorrenciaDias: 3 }),
        templates,
      })
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : 'Não foi possível carregar as comunicações.')
    } finally {
      setLoading(false)
    }
  }, [fundoId, notifications])

  useEffect(() => { void load() }, [load])

  const published = data?.versions.find((version) => version.status === 'publicada') || null
  const draft = data?.versions.find((version) => version.status === 'rascunho') || null
  const selectedTemplate = form?.templates.find((item) => item.categoria === selectedCategory) || null

  function run(action: () => Promise<{ success: boolean; message: string }>, reload = true) {
    startTransition(async () => {
      const result = await action()
      if (result.success) {
        notifications.success(result.message)
        if (reload) await load()
      } else notifications.error(result.message)
    })
  }

  function updateRule(family: 'logistica' | 'financeira', key: 'offsets' | 'recorrenciaApos' | 'recorrenciaDias', value: string) {
    setForm((current) => {
      if (!current) return current
      const field = family === 'logistica' ? 'reguaLogistica' : 'reguaFinanceira'
      const rule = current[field]
      return {
        ...current,
        [field]: {
          ...rule,
          [key]: key === 'offsets' ? value.split(',').map((item) => Number(item.trim())).filter(Number.isFinite) : Number(value),
        },
      }
    })
  }

  function updateTemplate(patch: Partial<ComunicacaoTemplateForm>) {
    setForm((current) => current ? {
      ...current,
      templates: current.templates.map((template) => template.categoria === selectedCategory ? { ...template, ...patch } : template),
    } : current)
  }

  async function openPreview() {
    if (!form) return
    try {
      const result = await gerarPreviewComunicacao(fundoId, form.versaoId, selectedCategory)
      setPreview(result)
    } catch (error) {
      notifications.error(error instanceof Error ? error.message : 'Não foi possível gerar o preview.')
    }
  }

  const readiness = useMemo(() => ({
    publicada: Boolean(published),
    modulo: Boolean(published?.logistica_habilitada || published?.financeiro_habilitado),
    pausada: Boolean(data?.root?.pausada),
  }), [data?.root?.pausada, published])

  if (loading) return <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Carregando configuração de comunicações...</div>
  if (!data) return null

  return (
    <div className="space-y-5">
      <DetailSection
        title="Status das comunicações"
        icon={BellRing}
        action={<div className="flex flex-wrap gap-2">
          {data.root && <Button variant="outline" onClick={() => run(() => alterarPausaComunicacoes(fundoId, !data.root?.pausada))} disabled={isPending}>{data.root.pausada ? <PlayCircle className="mr-2 size-4" /> : <PauseCircle className="mr-2 size-4" />}{data.root.pausada ? 'Retomar' : 'Pausar'}</Button>}
          <Button variant="outline" onClick={() => run(() => executarDryRunComunicacoes(fundoId), false)} disabled={isPending || !published}>Simular agora</Button>
          {!draft && <Button onClick={() => run(() => criarRascunhoComunicacoes(fundoId, published?.id))} disabled={isPending}>{published ? 'Criar nova versão' : 'Configurar comunicações'}</Button>}
        </div>}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigCheck ok={readiness.publicada}>Configuração publicada</ConfigCheck>
            <ConfigCheck ok={readiness.modulo}>Ao menos um módulo habilitado</ConfigCheck>
            <ConfigCheck ok={!readiness.pausada}>{readiness.pausada ? 'Envios pausados' : 'Processamento liberado'}</ConfigCheck>
            <ConfigCheck ok>Somente dias úteis ANBIMA · 08:00</ConfigCheck>
          </div>
          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Pronto para operar</p>
            <p className="mt-2 text-2xl font-semibold">{readiness.publicada && readiness.modulo && !readiness.pausada ? 'Sim' : 'Não'}</p>
            <p className="mt-2 text-sm text-muted-foreground">{published ? `Versão vigente: v${published.numero_versao} · publicada em ${formatDate(published.publicada_em)}` : 'Nenhuma versão publicada. O rollout permanece opt-in.'}</p>
          </div>
        </div>
      </DetailSection>

      {!form ? (
        <EmptyState title="Nenhum rascunho em preparação" description={published ? 'A configuração vigente é somente leitura. Crie uma nova versão para alterar regras ou templates.' : 'Crie a primeira versão para escolher os módulos que serão habilitados para este fundo.'} icon={Mail} />
      ) : (
        <>
          <DetailSection title={`Configuração em preparação · v${draft?.numero_versao}`} icon={Clock3} action={<div className="flex gap-2"><Button variant="outline" onClick={() => run(() => salvarRascunhoComunicacoes(fundoId, form))} disabled={isPending}>Salvar rascunho</Button><Button onClick={() => setConfirmPublish(true)} disabled={isPending}>Revisar e publicar</Button></div>}>
            <div className="grid gap-4 lg:grid-cols-2">
              <RuleEditor title="Logística" enabled={form.logisticaHabilitada} onEnabled={(checked) => setForm({ ...form, logisticaHabilitada: checked })} rule={form.reguaLogistica} onChange={(key, value) => updateRule('logistica', key, value)} extras={<div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.cteHabilitado} onChange={(event) => setForm({ ...form, cteHabilitado: event.target.checked })} />CT-e / DACTE</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.comprovanteHabilitado} onChange={(event) => setForm({ ...form, comprovanteHabilitado: event.target.checked })} />Comprovante de entrega</label></div>} />
              <RuleEditor title="Financeiro" enabled={form.financeiroHabilitado} onEnabled={(checked) => setForm({ ...form, financeiroHabilitado: checked })} rule={form.reguaFinanceira} onChange={(key, value) => updateRule('financeira', key, value)} />
            </div>
            <div className="mt-4 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-muted-foreground"><AlertTriangle className="mr-2 inline size-4 text-info" />Offsets negativos são ajustados ao dia útil anterior; D0 e positivos, ao próximo dia útil. Colisões geram apenas a mensagem mais crítica.</div>
          </DetailSection>

          <DetailSection title="Templates de e-mail" icon={Mail}>
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="space-y-2">{COMUNICACAO_CATEGORIAS.map((category) => <button type="button" key={category} onClick={() => setSelectedCategory(category)} className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${selectedCategory === category ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border bg-background hover:bg-muted'}`}>{CATEGORY_LABELS[category]}</button>)}</div>
              {selectedTemplate && <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{CATEGORY_LABELS[selectedCategory]}</h3><p className="text-sm text-muted-foreground">Use o padrão seguro ou personalize somente variáveis permitidas.</p></div><select className="h-9 rounded-lg border border-input bg-background px-3 text-sm" value={selectedTemplate.modo} onChange={(event) => updateTemplate({ modo: event.target.value as 'padrao' | 'personalizado' })}><option value="padrao">Template padrão</option><option value="personalizado">Personalizado</option></select></div>
                <div><Label>Assunto</Label><Input value={selectedTemplate.assunto} disabled={selectedTemplate.modo === 'padrao'} onChange={(event) => updateTemplate({ assunto: event.target.value })} /></div>
                <div><Label>HTML</Label><textarea className="mt-1 min-h-36 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs disabled:opacity-60" value={selectedTemplate.corpoHtml} disabled={selectedTemplate.modo === 'padrao'} onChange={(event) => updateTemplate({ corpoHtml: event.target.value })} /></div>
                <div><Label>Texto alternativo</Label><textarea className="mt-1 min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm disabled:opacity-60" value={selectedTemplate.corpoTexto} disabled={selectedTemplate.modo === 'padrao'} onChange={(event) => updateTemplate({ corpoTexto: event.target.value })} /></div>
                <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void openPreview()}>Preview sintético</Button><Button variant="outline" onClick={() => run(() => enviarEmailTesteComunicacoes(fundoId, selectedCategory.startsWith('LOGISTICA') ? 'LOGISTICA' : 'FINANCEIRO'), false)} disabled={isPending}>Enviar teste para meu e-mail</Button></div>
              </div>}
            </div>
          </DetailSection>
        </>
      )}

      <DetailSection title="Histórico" icon={Clock3}>
        <div className="space-y-5">
          <div><h3 className="mb-2 text-sm font-semibold">Versões</h3><div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{data.versions.length ? data.versions.map((version) => <div key={version.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[90px_130px_1fr]"><strong>v{version.numero_versao}</strong><StatusBadge status={version.status} /><span className="text-muted-foreground">{version.publicada_em ? `Publicada em ${formatDate(version.publicada_em)}` : `Atualizada em ${formatDate(version.atualizada_em)}`}</span></div>) : <p className="p-4 text-sm text-muted-foreground">Nenhuma versão registrada.</p>}</div></div>
          <div><h3 className="mb-2 text-sm font-semibold">Últimas comunicações</h3><div className="divide-y divide-border overflow-hidden rounded-xl border border-border">{data.history.length ? data.history.map((item) => <div key={item.id} className="grid items-center gap-2 px-4 py-3 text-sm lg:grid-cols-[120px_130px_minmax(0,1fr)_170px]"><span className="font-medium">{item.familia === 'LOGISTICA' ? 'Logística' : 'Financeiro'}</span><StatusBadge status={item.status} /><span className="min-w-0 truncate" title={item.assunto}>{item.assunto}</span><span className="text-xs text-muted-foreground">{formatDate(item.enviada_em || item.criada_em)}</span>{item.bloqueio_motivo && <p className="lg:col-span-4 text-xs text-destructive">{item.bloqueio_motivo}</p>}</div>) : <p className="p-4 text-sm text-muted-foreground">Nenhuma comunicação operacional registrada.</p>}</div></div>
        </div>
      </DetailSection>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null) }}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>{preview?.assunto}</DialogTitle><DialogDescription>Preview com dados exclusivamente sintéticos.</DialogDescription></DialogHeader>{preview && <iframe title="Preview do e-mail" sandbox="" srcDoc={preview.html} className="h-[520px] w-full rounded-lg border border-border bg-white" />}<DialogFooter><Button variant="outline" onClick={() => setPreview(null)}>Fechar</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}><DialogContent><DialogHeader><DialogTitle>Publicar configuração?</DialogTitle><DialogDescription>A nova versão substituirá a configuração publicada. Comunicações já registradas preservarão seu conteúdo, destinatário, template e regra originais.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmPublish(false)}>Cancelar</Button><Button onClick={() => { setConfirmPublish(false); if (form) run(async () => { const saved = await salvarRascunhoComunicacoes(fundoId, form); return saved.success ? publicarRascunhoComunicacoes(fundoId, form.versaoId) : saved }) }}>Confirmar publicação</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}

function RuleEditor({ title, enabled, onEnabled, rule, onChange, extras }: { title: string; enabled: boolean; onEnabled: (checked: boolean) => void; rule: ReguaComunicacao; onChange: (key: 'offsets' | 'recorrenciaApos' | 'recorrenciaDias', value: string) => void; extras?: React.ReactNode }) {
  return <div className="space-y-4 rounded-xl border border-border bg-background p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{enabled ? `Etapas: ${offsetsLabel(rule.offsets)}` : 'Módulo desabilitado nesta versão'}</p></div><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />Habilitar</label></div>{extras}<div className="grid gap-3 sm:grid-cols-3"><div className="sm:col-span-3"><Label>Etapas em dias (separadas por vírgula)</Label><Input value={rule.offsets.join(', ')} onChange={(event) => onChange('offsets', event.target.value)} disabled={!enabled} /></div><div><Label>Recorrer após D+</Label><Input type="number" value={rule.recorrenciaApos} onChange={(event) => onChange('recorrenciaApos', event.target.value)} disabled={!enabled} /></div><div><Label>A cada</Label><Input type="number" value={rule.recorrenciaDias} onChange={(event) => onChange('recorrenciaDias', event.target.value)} disabled={!enabled} /></div><div className="self-end pb-2 text-sm text-muted-foreground">dias corridos, ajustados ao dia útil</div></div></div>
}

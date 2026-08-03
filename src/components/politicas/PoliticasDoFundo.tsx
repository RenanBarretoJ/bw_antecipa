'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, FileCog, History, Link2, Plus, Send, ShieldCheck, Star, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarPoliticaDoFundo,
  criarVersaoPoliticaNoFundo,
  definirPoliticaPadrao,
  publicarVersaoPoliticaNoFundo,
  vincularPoliticaAoCedenteFundo,
  type CriarVersaoPoliticaInput,
} from '@/lib/actions/politica'
import {
  normalizarRequisitoLegadoParaEdicao,
  resolverMomentoObrigatorioLegado,
  type PoliticaMomentoObrigatorio,
  type PoliticaRequisitoInput,
} from '@/lib/politicas/requisitos-documentais'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DetailField, DetailSection, EmptyState, LoadingState, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import {
  createPolicyInternalCode,
  describeAceiteSacado,
  describeAcompanhamentoEntrega,
  describeMomentoCessao,
  documentLabel,
  mapLegacyFlagsToOperationalSelections,
  mapOperationalSelectionsToLegacyFlags,
  policyDocumentOptions,
  policyResponsibleLabels,
  policyMomentLabels,
  policyValidationLabels,
  shouldClosePublishModal,
  shouldCloseVersionModalAfterCreate,
  type PoliticaOperationalSelections,
} from '@/lib/politicas/ui'

interface LinkRow { id: string; cedente_id: string; fundo_id: string; status: string; vigente_desde: string; vigente_ate?: string | null }
interface CedenteRow { id: string; razao_social: string; cnpj: string }
interface PolicyRow { id: string; fundo_id?: string | null; codigo: string; nome: string; descricao: string | null; status: string; padrao?: boolean | null; created_at?: string | null; updated_at?: string | null }
interface VersionRow {
  id: string
  politica_operacional_id: string
  fundo_id?: string | null
  cedente_fundo_id?: string | null
  versao: number
  status?: string | null
  publicada_em: string | null
  publicada_por?: string | null
  vigente_desde: string
  vigente_ate?: string | null
  created_at?: string | null
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  permite_postergacao_upload_canhoto: boolean
  limite_postergacao_upload_canhoto_dias: number | null
  configuracao?: Record<string, unknown> | null
}
interface RequirementRow {
  id: string
  politica_operacional_versao_id: string
  politica_operacional_id: string
  fundo_id?: string | null
  cedente_fundo_id?: string | null
  codigo: string
  escopo: PoliticaMomentoObrigatorio
  momento_obrigatorio: string | null
  tipo_documento_codigo: PoliticaRequisitoInput['tipo_documento_codigo']
  prazo_dias_corridos: number | null
  observacoes: string | null
  responsavel_upload: PoliticaRequisitoInput['responsavel_upload']
  responsavel_aprovacao: PoliticaRequisitoInput['responsavel_aprovacao']
  nivel_validacao?: PoliticaRequisitoInput['nivel_validacao']
  formatos_aceitos?: string[]
  quantidade_minima?: number
  obrigatorio: boolean
  ordem?: number
  ativo?: boolean
}
interface AssignmentRow {
  id: string
  cedente_fundo_id: string
  politica_operacional_id: string
  status: string
  vigente_desde: string
  vigente_ate: string | null
  motivo: string | null
  created_at?: string | null
}

type VersionStep = 'fluxo' | 'requisitos' | 'revisao'

const defaultSelections: PoliticaOperationalSelections = {
  aceiteSacado: 'antes_cessao',
  momentoCessao: 'desembolso',
  acompanhamentoEntrega: 'nao_aplicavel',
}

const emptyRequirement = (index = 0): PoliticaRequisitoInput => ({
  codigo: `requisito_${index + 1}`,
  momento_obrigatorio: 'nf_pre_cessao',
  tipo_documento_codigo: 'nf_xml',
  obrigatorio: true,
  quantidade_minima: 1,
  formatos_aceitos: ['xml'],
  nivel_validacao: 'manual',
  prazo_dias_corridos: null,
  responsavel_upload: 'cedente',
  responsavel_aprovacao: 'gestor',
  ordem: index,
  ativo: true,
})

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : '—'
}

function versionStatus(version: VersionRow) {
  if (version.status) return version.status
  if (version.publicada_em && version.vigente_ate) return 'substituida'
  if (version.publicada_em) return 'publicada'
  return 'rascunho'
}

function cloneRequirements(rows: RequirementRow[]): PoliticaRequisitoInput[] {
  return rows.map((requirement, index) => normalizarRequisitoLegadoParaEdicao({ ...requirement }, index))
}

export function PoliticasDoFundo({ fundoId, showFundoInLabel = true }: { fundoId?: string; showFundoInLabel?: boolean }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [links, setLinks] = useState<LinkRow[]>([])
  const [cedentes, setCedentes] = useState<CedenteRow[]>([])
  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [requirements, setRequirements] = useState<RequirementRow[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [policyModalOpen, setPolicyModalOpen] = useState(false)
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [detailsVersion, setDetailsVersion] = useState<VersionRow | null>(null)
  const [publishVersion, setPublishVersion] = useState<VersionRow | null>(null)
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [versionStep, setVersionStep] = useState<VersionStep>('fluxo')
  const [policyForm, setPolicyForm] = useState({ codigo: '', nome: '', descricao: '' })
  const [linkForm, setLinkForm] = useState({ politicaId: '', vigenteDesde: new Date().toISOString().slice(0, 10), motivo: '' })
  const [operationalSelections, setOperationalSelections] = useState<PoliticaOperationalSelections>(defaultSelections)
  const [postponementForm, setPostponementForm] = useState({ permite: false, limiteDias: '' })
  const [requirementsForm, setRequirementsForm] = useState<PoliticaRequisitoInput[]>([])

  const loadData = useCallback(async () => {
    const supabase = createClient()
    setLoading(true)
    const linkQuery = supabase.from('cedente_fundos').select('id, cedente_id, fundo_id, status, vigente_desde, vigente_ate').order('vigente_desde', { ascending: false })
    const policyQuery = supabase.from('politicas_operacionais').select('id, fundo_id, codigo, nome, descricao, status, padrao, created_at, updated_at').order('created_at', { ascending: false })
    if (fundoId) {
      linkQuery.eq('fundo_id', fundoId)
      policyQuery.eq('fundo_id', fundoId)
    }

    const [linkResult, cedenteResult, policyResult, assignmentResult] = await Promise.all([
      linkQuery,
      supabase.from('cedentes').select('id, razao_social, cnpj').order('razao_social'),
      policyQuery,
      supabase.from('cedente_fundo_politicas').select('id, cedente_fundo_id, politica_operacional_id, status, vigente_desde, vigente_ate, motivo, created_at').order('vigente_desde', { ascending: false }),
    ])

    const nextLinks = (linkResult.data || []) as LinkRow[]
    const linkIds = new Set(nextLinks.map((link) => link.id))
    const nextPolicies = ((policyResult.data || []) as PolicyRow[]).filter((policy) => !fundoId || policy.fundo_id === fundoId)
    const policyIds = nextPolicies.map((policy) => policy.id)

    let versionResult: { data: unknown[] | null; error: { message?: string } | null } = { data: [], error: null }
    let requirementResult: { data: unknown[] | null; error: { message?: string } | null } = { data: [], error: null }
    if (policyIds.length > 0) {
      ;[versionResult, requirementResult] = await Promise.all([
        supabase
          .from('politica_operacional_versoes')
          .select('id, politica_operacional_id, fundo_id, cedente_fundo_id, versao, status, publicada_em, publicada_por, vigente_desde, vigente_ate, created_at, aceite_sacado_obrigatorio, cessao_no_desembolso, cria_acompanhamento_entrega, permite_postergacao_upload_canhoto, limite_postergacao_upload_canhoto_dias, configuracao')
          .in('politica_operacional_id', policyIds)
          .order('versao', { ascending: false }),
        supabase
          .from('politica_requisitos_documentais')
          .select('id, politica_operacional_versao_id, politica_operacional_id, fundo_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, tipo_documento_codigo, prazo_dias_corridos, observacoes, responsavel_upload, responsavel_aprovacao, nivel_validacao, formatos_aceitos, quantidade_minima, obrigatorio, ordem, ativo')
          .in('politica_operacional_id', policyIds)
          .order('ordem'),
      ]) as [{ data: unknown[] | null; error: { message?: string } | null }, { data: unknown[] | null; error: { message?: string } | null }]
    }

    const queryError = linkResult.error || cedenteResult.error || policyResult.error || assignmentResult.error || versionResult.error || requirementResult.error
    if (queryError) notifications.error(`Erro ao recarregar politicas: ${queryError.message || 'consulta nao concluida.'}`)

    setLinks(nextLinks)
    setCedentes((cedenteResult.data || []) as CedenteRow[])
    setPolicies(nextPolicies)
    setAssignments(((assignmentResult.data || []) as AssignmentRow[]).filter((assignment) => linkIds.has(assignment.cedente_fundo_id)))
    setVersions((versionResult.data || []) as VersionRow[])
    setRequirements((requirementResult.data || []) as RequirementRow[])
    setSelectedPolicyId((current) => current || nextPolicies[0]?.id || '')
    setLoading(false)
  }, [fundoId, notifications])

  useEffect(() => { loadData() }, [loadData])

  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) || policies[0] || null
  const activePolicies = policies.filter((policy) => policy.status === 'ativa')
  const publishedVersions = versions.filter((version) => versionStatus(version) === 'publicada')
  const pendingLinks = links.filter((link) => !assignments.some((assignment) => assignment.cedente_fundo_id === link.id && assignment.status === 'ativa' && !assignment.vigente_ate))
  const defaultPolicy = policies.find((policy) => policy.padrao)

  const versionsByPolicy = useMemo(() => {
    const map = new Map<string, VersionRow[]>()
    for (const version of versions) {
      map.set(version.politica_operacional_id, [...(map.get(version.politica_operacional_id) || []), version])
    }
    return map
  }, [versions])

  const requirementsByVersion = useMemo(() => {
    const map = new Map<string, RequirementRow[]>()
    for (const requirement of requirements) {
      map.set(requirement.politica_operacional_versao_id, [...(map.get(requirement.politica_operacional_versao_id) || []), requirement])
    }
    return map
  }, [requirements])

  const cedenteName = (id: string) => cedentes.find((cedente) => cedente.id === id)?.razao_social || id
  const policyName = (id: string) => policies.find((policy) => policy.id === id)?.nome || 'Politica nao encontrada'
  const currentAssignment = (linkId: string) => assignments.find((assignment) => assignment.cedente_fundo_id === linkId && assignment.status === 'ativa' && !assignment.vigente_ate)
  const currentVersion = (policyId: string) => versionsByPolicy.get(policyId)?.find((version) => versionStatus(version) === 'publicada') || null
  const currentRequirementCount = (policyId: string) => {
    const version = currentVersion(policyId)
    return version ? (requirementsByVersion.get(version.id) || []).length : 0
  }
  const linkedCount = (policyId: string) => assignments.filter((assignment) => assignment.politica_operacional_id === policyId && assignment.status === 'ativa' && !assignment.vigente_ate).length

  const execute = async (operation: () => Promise<{ success?: boolean; message?: string } | undefined>) => {
    setBusy(true)
    try {
      const actionResult = await operation()
      notifications.fromActionResult(actionResult)
      if (actionResult?.success) {
        await loadData()
        router.refresh()
      }
      return actionResult
    } catch (error) {
      const message = error instanceof Error ? error.message : 'A operacao nao foi concluida.'
      notifications.error(message)
      return { success: false, message }
    } finally {
      setBusy(false)
    }
  }

  function openPolicyModal() {
    setPolicyForm({
      codigo: createPolicyInternalCode(fundoId || 'fundo'),
      nome: 'Politica operacional padrao',
      descricao: '',
    })
    setPolicyModalOpen(true)
  }

  async function createPolicy() {
    if (!fundoId) return notifications.error('Abra o detalhe de um fundo para criar politicas do catalogo.')
    const actionResult = await execute(() => criarPoliticaDoFundo(fundoId, policyForm.codigo, policyForm.nome, policyForm.descricao))
    if (actionResult?.success) {
      setPolicyModalOpen(false)
      setPolicyForm({ codigo: '', nome: '', descricao: '' })
      const id = (actionResult as { data?: { id?: string } }).data?.id
      if (id) setSelectedPolicyId(id)
    }
  }

  function openVersionModal(policy: PolicyRow, base?: VersionRow | null) {
    setSelectedPolicyId(policy.id)
    const source = base || currentVersion(policy.id) || versionsByPolicy.get(policy.id)?.find((version) => versionStatus(version) === 'rascunho') || null
    const sourceRequirements = source ? requirementsByVersion.get(source.id) || [] : []
    setOperationalSelections(source ? mapLegacyFlagsToOperationalSelections(source) : defaultSelections)
    setPostponementForm(source ? {
      permite: source.permite_postergacao_upload_canhoto === true,
      limiteDias: source.limite_postergacao_upload_canhoto_dias?.toString() || '',
    } : { permite: false, limiteDias: '' })
    setRequirementsForm(source ? cloneRequirements(sourceRequirements) : [emptyRequirement(0)])
    setVersionStep('fluxo')
    setVersionModalOpen(true)
  }

  async function createVersion() {
    if (!fundoId || !selectedPolicy) return notifications.error('Selecione uma politica do fundo.')
    const flags = mapOperationalSelectionsToLegacyFlags(operationalSelections)
    const payload: CriarVersaoPoliticaInput = {
      ...flags,
      permite_postergacao_upload_canhoto: postponementForm.permite,
      limite_postergacao_upload_canhoto_dias: postponementForm.permite && postponementForm.limiteDias
        ? Number(postponementForm.limiteDias)
        : null,
      configuracao: {
        fluxo_operacional: operationalSelections,
        requisito_ui_schema: 'bw-antecipa.politica-operacional-ui.v2',
      },
      requisitos: requirementsForm.map((requirement, index) => ({ ...requirement, ordem: index })),
    }
    setBusy(true)
    const actionResult = await criarVersaoPoliticaNoFundo(fundoId, selectedPolicy.id, payload)
    notifications.fromActionResult(actionResult)
    if (shouldCloseVersionModalAfterCreate(actionResult)) {
      await loadData()
      setVersionModalOpen(false)
      router.refresh()
    }
    setBusy(false)
  }

  async function confirmPublish() {
    if (!fundoId || !publishVersion) return
    const actionResult = await execute(() => publicarVersaoPoliticaNoFundo(fundoId, publishVersion.id))
    if (shouldClosePublishModal(actionResult)) setPublishVersion(null)
  }

  function openLinkModal(link: LinkRow) {
    const current = currentAssignment(link.id)
    setSelectedLinkId(link.id)
    setLinkForm({
      politicaId: current?.politica_operacional_id || defaultPolicy?.id || activePolicies[0]?.id || '',
      vigenteDesde: new Date().toISOString().slice(0, 10),
      motivo: '',
    })
    setLinkModalOpen(true)
  }

  async function confirmLinkPolicy() {
    if (!fundoId || !selectedLinkId || !linkForm.politicaId) return notifications.error('Selecione o cedente e a politica.')
    const actionResult = await execute(() => vincularPoliticaAoCedenteFundo(fundoId, selectedLinkId, linkForm.politicaId, `${linkForm.vigenteDesde}T00:00:00.000Z`, linkForm.motivo))
    if (actionResult?.success) setLinkModalOpen(false)
  }

  function updateRequirement(index: number, patch: Partial<PoliticaRequisitoInput>) {
    setRequirementsForm((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  function setRequirementDocument(index: number, value: PoliticaRequisitoInput['tipo_documento_codigo']) {
    const option = policyDocumentOptions.find((item) => item.value === value)
    updateRequirement(index, { tipo_documento_codigo: value, codigo: value, formatos_aceitos: option?.formatos || [] })
  }

  if (loading) return <LoadingState label="Carregando politicas..." />

  return (
    <div className="space-y-5">
      <DetailSection title="Status das politicas" icon={ShieldCheck}>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-background p-4"><DetailField label="Politicas ativas" value={`${activePolicies.length}`} /></div>
          <div className="rounded-xl border border-border bg-background p-4"><DetailField label="Versoes publicadas" value={`${publishedVersions.length}`} /></div>
          <div className="rounded-xl border border-border bg-background p-4"><DetailField label="Cedentes vinculados" value={`${links.length - pendingLinks.length} de ${links.length}`} /></div>
          <div className="rounded-xl border border-border bg-background p-4"><DetailField label="Politica padrao" value={defaultPolicy?.nome || 'Nao definida'} /></div>
        </div>
        {pendingLinks.length > 0 && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
            {pendingLinks.length} cedente(s) com politica pendente. Eles ficam bloqueados para novas operacoes ate a vinculacao manual pelo gestor.
          </p>
        )}
      </DetailSection>

      <DetailSection title="Catalogo de politicas do fundo" icon={FileCog} action={<Button type="button" size="sm" onClick={openPolicyModal} disabled={busy || !fundoId}><Plus className="mr-2 size-4" /> Criar politica</Button>}>
        {policies.length === 0 ? (
          <EmptyState title="Nenhuma politica no catalogo" description="Crie uma politica reutilizavel do fundo. Depois publique uma versao e vincule manualmente aos cedentes." icon={FileCog} action={<Button type="button" onClick={openPolicyModal} disabled={!fundoId}>Criar politica</Button>} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="grid gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid-cols-[minmax(180px,1fr)_110px_120px_120px_110px_150px_minmax(260px,1fr)]">
              <span>Politica</span><span>Status</span><span>Versao</span><span>Requisitos</span><span>Cedentes</span><span>Publicacao</span><span className="text-right">Acoes</span>
            </div>
            <div className="divide-y divide-border">
              {policies.map((policy) => {
                const version = currentVersion(policy.id)
                const draft = versionsByPolicy.get(policy.id)?.find((item) => versionStatus(item) === 'rascunho')
                return (
                  <div key={policy.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(180px,1fr)_110px_120px_120px_110px_150px_minmax(260px,1fr)] lg:items-center">
                    <div>
                      <div className="flex items-center gap-2 font-semibold">{policy.nome}{policy.padrao ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Padrao</span> : null}</div>
                      <p className="mt-1 text-xs text-muted-foreground">{policy.codigo}</p>
                    </div>
                    <StatusBadge status={policy.status} />
                    <span>{version ? `v${version.versao}` : draft ? `Rascunho v${draft.versao}` : '—'}</span>
                    <span>{currentRequirementCount(policy.id)}</span>
                    <span>{linkedCount(policy.id)}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(version?.publicada_em)}</span>
                    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={() => openVersionModal(policy, version || draft || null)}><Copy className="mr-1 size-3.5" /> Nova versao</Button>
                      {draft && <Button type="button" size="sm" onClick={() => setPublishVersion(draft)}><Send className="mr-1 size-3.5" /> Publicar</Button>}
                      <Button type="button" size="sm" variant="outline" disabled={busy || policy.status !== 'ativa' || !!policy.padrao} onClick={() => fundoId && execute(() => definirPoliticaPadrao(fundoId, policy.id))}><Star className="mr-1 size-3.5" /> Padrao</Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </DetailSection>

      <DetailSection title="Cedentes e politica aplicada" icon={Link2}>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid-cols-[minmax(220px,1fr)_minmax(200px,1fr)_110px_160px_120px_130px]">
            <span>Cedente</span><span>Politica</span><span>Versao</span><span>Vigencia</span><span>Status</span><span className="text-right">Acoes</span>
          </div>
          <div className="divide-y divide-border">
            {links.map((link) => {
              const assignment = currentAssignment(link.id)
              const version = assignment ? currentVersion(assignment.politica_operacional_id) : null
              return (
                <div key={link.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(220px,1fr)_minmax(200px,1fr)_110px_160px_120px_130px] lg:items-center">
                  <div>
                    <p className="font-semibold">{cedenteName(link.cedente_id)}</p>
                    <p className="text-xs text-muted-foreground">{showFundoInLabel ? link.fundo_id : ''}</p>
                  </div>
                  <span>{assignment ? policyName(assignment.politica_operacional_id) : 'Politica pendente'}</span>
                  <span>{version ? `v${version.versao}` : '—'}</span>
                  <span className="text-xs text-muted-foreground">Desde {formatDate(assignment?.vigente_desde)}</span>
                  <StatusBadge status={assignment ? 'ativa' : 'pendente'} label={assignment ? 'Ativa' : 'Pendente'} />
                  <div className="text-right"><Button type="button" size="sm" variant={assignment ? 'outline' : 'default'} onClick={() => openLinkModal(link)}>Alterar politica</Button></div>
                </div>
              )
            })}
            {links.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum cedente vinculado a este fundo.</p>}
          </div>
        </div>
      </DetailSection>

      <DetailSection title="Historico" icon={History}>
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="grid gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid-cols-[160px_minmax(180px,1fr)_110px_160px_120px_minmax(220px,1fr)]">
            <span>Data</span><span>Politica</span><span>Versao</span><span>Status</span><span>Requisitos</span><span>Acoes</span>
          </div>
          <div className="divide-y divide-border">
            {versions.map((version) => (
              <div key={version.id} className="grid gap-3 px-4 py-3 text-sm lg:grid-cols-[160px_minmax(180px,1fr)_110px_160px_120px_minmax(220px,1fr)] lg:items-center">
                <span className="text-xs text-muted-foreground">{formatDateTime(version.publicada_em || version.created_at || version.vigente_desde)}</span>
                <span className="font-medium">{policyName(version.politica_operacional_id)}</span>
                <span>v{version.versao}</span>
                <StatusBadge status={versionStatus(version)} label={versionStatus(version) === 'substituida' ? 'Substituida' : undefined} />
                <span>{(requirementsByVersion.get(version.id) || []).length}</span>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setDetailsVersion(version)}>Ver</Button>
                  <Button type="button" size="sm" variant="outline" disabled title="Comparacao visual fica para a proxima etapa">Comparar</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    const policy = policies.find((item) => item.id === version.politica_operacional_id)
                    if (policy) openVersionModal(policy, version)
                  }}>Duplicar</Button>
                </div>
              </div>
            ))}
            {versions.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Nenhuma versao criada ainda.</p>}
          </div>
        </div>
      </DetailSection>

      <Dialog open={policyModalOpen} onOpenChange={setPolicyModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Criar politica do fundo</DialogTitle>
            <DialogDescription>A politica nasce no catalogo do fundo como rascunho. Ela so passa a operar depois de uma versao publicada e vinculacao manual aos cedentes.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={policyForm.nome} onChange={(event) => setPolicyForm((prev) => ({ ...prev, nome: event.target.value }))} /></div>
            <div><Label>Descricao</Label><Input value={policyForm.descricao} onChange={(event) => setPolicyForm((prev) => ({ ...prev, descricao: event.target.value }))} /></div>
            <div><Label>Codigo interno</Label><Input value={policyForm.codigo} onChange={(event) => setPolicyForm((prev) => ({ ...prev, codigo: event.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPolicyModalOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={createPolicy} disabled={busy || !policyForm.codigo || !policyForm.nome}>Criar politica</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkModalOpen} onOpenChange={setLinkModalOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Alterar politica aplicada</DialogTitle>
            <DialogDescription>A alteracao sera aplicada somente as novas operacoes. Operacoes existentes mantem a politica registrada no snapshot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Cedente</Label><p className="mt-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">{cedenteName(links.find((link) => link.id === selectedLinkId)?.cedente_id || '')}</p></div>
            <div>
              <Label>Politica</Label>
              <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={linkForm.politicaId} onChange={(event) => setLinkForm((prev) => ({ ...prev, politicaId: event.target.value }))}>
                <option value="">Selecione</option>
                {activePolicies.map((policy) => <option key={policy.id} value={policy.id}>{policy.nome} {policy.padrao ? '(padrao)' : ''}</option>)}
              </select>
            </div>
            <div><Label>Inicio da vigencia</Label><Input type="date" value={linkForm.vigenteDesde} onChange={(event) => setLinkForm((prev) => ({ ...prev, vigenteDesde: event.target.value }))} /></div>
            <div><Label>Motivo/observacao</Label><Input value={linkForm.motivo} onChange={(event) => setLinkForm((prev) => ({ ...prev, motivo: event.target.value }))} placeholder="Ex.: enquadramento operacional aprovado pelo comite" /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLinkModalOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={confirmLinkPolicy} disabled={busy || !linkForm.politicaId}>Confirmar vinculacao</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={versionModalOpen} onOpenChange={setVersionModalOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Nova versao da politica</DialogTitle>
            <DialogDescription>A nova versao copia a base selecionada. Versoes publicadas permanecem imutaveis e operacoes antigas mantem snapshot anterior.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {(['fluxo', 'requisitos', 'revisao'] as const).map((step) => (
              <button key={step} type="button" onClick={() => setVersionStep(step)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${versionStep === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                {step === 'fluxo' ? 'Fluxo operacional' : step === 'requisitos' ? 'Requisitos documentais' : 'Revisao e publicacao'}
              </button>
            ))}
          </div>

          {versionStep === 'fluxo' && (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border bg-background p-4">
                <Label>Aceite do sacado</Label>
                <div className="mt-3 space-y-2">
                  {[
                    ['nao_exigido', 'Nao exigido'],
                    ['antes_cessao', 'Exigido antes da cessao'],
                    ['antes_desembolso', 'Exigido antes do desembolso'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" checked={operationalSelections.aceiteSacado === value} onChange={() => setOperationalSelections((prev) => ({ ...prev, aceiteSacado: value as PoliticaOperationalSelections['aceiteSacado'] }))} /> {label}</label>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <Label>Momento da cessao</Label>
                <div className="mt-3 space-y-2">
                  {[
                    ['aprovacao', 'Na aprovacao'],
                    ['assinatura', 'Na assinatura'],
                    ['desembolso', 'No desembolso'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" checked={operationalSelections.momentoCessao === value} onChange={() => setOperationalSelections((prev) => ({ ...prev, momentoCessao: value as PoliticaOperationalSelections['momentoCessao'] }))} /> {label}</label>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <Label>Acompanhamento de entrega</Label>
                <div className="mt-3 space-y-2">
                  {[
                    ['nao_aplicavel', 'Nao aplicavel'],
                    ['apos_desembolso', 'Obrigatorio apos desembolso'],
                    ['antes_liberacao_definitiva', 'Obrigatorio antes da liberacao definitiva'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" checked={operationalSelections.acompanhamentoEntrega === value} onChange={() => setOperationalSelections((prev) => ({ ...prev, acompanhamentoEntrega: value as PoliticaOperationalSelections['acompanhamentoEntrega'] }))} /> {label}</label>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background p-4 lg:col-span-3">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Label>Postergação do upload do canhoto</Label>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                      Permite ao cedente comunicar uma única nova previsão após a cessão. O prazo original permanece visível e a comunicação não depende de aprovação do gestor.
                    </p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={postponementForm.permite}
                      onChange={(event) => setPostponementForm((current) => ({ ...current, permite: event.target.checked }))}
                    />
                    Permitir postergação do upload do canhoto
                  </label>
                </div>
                {postponementForm.permite && (
                  <div className="mt-4 max-w-xs">
                    <Label htmlFor="limite-postergacao-canhoto">Limite máximo de postergação em dias corridos</Label>
                    <Input
                      id="limite-postergacao-canhoto"
                      type="number"
                      min={1}
                      step={1}
                      value={postponementForm.limiteDias}
                      onChange={(event) => setPostponementForm((current) => ({ ...current, limiteDias: event.target.value }))}
                      placeholder="5 (padrão)"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">Se não informado, o limite aplicado será de 5 dias corridos.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {versionStep === 'requisitos' && (
            <div className="space-y-3">
              {requirementsForm.map((requirement, index) => (
                <div key={`${index}-${requirement.codigo}`} className="space-y-4 rounded-xl border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold">Requisito {index + 1}</h3>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRequirementsForm((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} className="mr-1" /> Remover</Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div><Label>Tipo de documento</Label><select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.tipo_documento_codigo} onChange={(event) => setRequirementDocument(index, event.target.value as PoliticaRequisitoInput['tipo_documento_codigo'])}>{policyDocumentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                    <div><Label>Momento obrigatorio</Label><select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.momento_obrigatorio} onChange={(event) => updateRequirement(index, { momento_obrigatorio: event.target.value as PoliticaMomentoObrigatorio })}>{Object.entries(policyMomentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                    <div><Label>Responsavel</Label><select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.responsavel_upload} onChange={(event) => updateRequirement(index, { responsavel_upload: event.target.value as PoliticaRequisitoInput['responsavel_upload'] })}>{Object.entries(policyResponsibleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                    <div><Label>Obrigatoriedade</Label><select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.obrigatorio ? 'sim' : 'nao'} onChange={(event) => updateRequirement(index, { obrigatorio: event.target.value === 'sim' })}><option value="sim">Obrigatorio</option><option value="nao">Opcional</option></select></div>
                    <div><Label>Prazo</Label><Input type="number" value={requirement.prazo_dias_corridos ?? ''} onChange={(event) => updateRequirement(index, { prazo_dias_corridos: event.target.value ? Number(event.target.value) : null })} placeholder="Sem prazo" /></div>
                    <div><Label>Regra de validade</Label><select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.nivel_validacao || 'manual'} onChange={(event) => updateRequirement(index, { nivel_validacao: event.target.value as PoliticaRequisitoInput['nivel_validacao'] })}>{Object.entries(policyValidationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setRequirementsForm((items) => [...items, emptyRequirement(items.length)])}><Plus size={14} className="mr-1" /> Adicionar requisito</Button>
            </div>
          )}

          {versionStep === 'revisao' && (
            <div className="space-y-4">
              <div className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-3">
                <DetailField label="Aceite do sacado" value={describeAceiteSacado(operationalSelections.aceiteSacado)} />
                <DetailField label="Momento da cessao" value={describeMomentoCessao(operationalSelections.momentoCessao)} />
                <DetailField label="Entrega" value={describeAcompanhamentoEntrega(operationalSelections.acompanhamentoEntrega)} />
                <DetailField label="Postergação do canhoto" value={postponementForm.permite ? `Permitida uma vez · limite ${postponementForm.limiteDias || '5'} dias` : 'Não permitida'} />
              </div>
              <div className="rounded-xl border border-border">
                <div className="border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Requisitos</div>
                <div className="divide-y divide-border">
                  {requirementsForm.map((requirement, index) => (
                    <div key={`${index}-${requirement.codigo}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(180px,1fr)_140px_140px_120px]">
                      <span className="font-medium">{documentLabel(requirement.tipo_documento_codigo)}</span>
                      <span className="text-muted-foreground">{policyMomentLabels[requirement.momento_obrigatorio]}</span>
                      <span className="text-muted-foreground">{policyResponsibleLabels[requirement.responsavel_upload]}</span>
                      <StatusBadge status={requirement.obrigatorio ? 'Obrigatorio' : 'Opcional'} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVersionModalOpen(false)}>Cancelar</Button>
            <Button type="button" variant="outline" onClick={() => setVersionStep(versionStep === 'fluxo' ? 'requisitos' : versionStep === 'requisitos' ? 'revisao' : 'fluxo')}>{versionStep === 'revisao' ? 'Voltar ao inicio' : 'Continuar'}</Button>
            <Button type="button" onClick={createVersion} disabled={busy || !selectedPolicy}>Criar versao em rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailsVersion} onOpenChange={(open) => { if (!open) setDetailsVersion(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          {detailsVersion && (
            <>
              <DialogHeader>
                <DialogTitle>Detalhes da versao {detailsVersion.versao}</DialogTitle>
                <DialogDescription>Consulta somente leitura da versao selecionada.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-3">
                <DetailField label="Status" value={<StatusBadge status={versionStatus(detailsVersion)} />} />
                <DetailField label="Publicacao" value={formatDateTime(detailsVersion.publicada_em)} />
                <DetailField label="Vigencia" value={`${formatDateTime(detailsVersion.vigente_desde)}${detailsVersion.vigente_ate ? ` ate ${formatDateTime(detailsVersion.vigente_ate)}` : ''}`} />
                <DetailField label="Aceite do sacado" value={describeAceiteSacado(mapLegacyFlagsToOperationalSelections(detailsVersion).aceiteSacado)} />
                <DetailField label="Momento da cessao" value={describeMomentoCessao(mapLegacyFlagsToOperationalSelections(detailsVersion).momentoCessao)} />
                <DetailField label="Acompanhamento de entrega" value={describeAcompanhamentoEntrega(mapLegacyFlagsToOperationalSelections(detailsVersion).acompanhamentoEntrega)} />
              </div>
              <div className="rounded-xl border border-border">
                <div className="border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Requisitos documentais</div>
                <div className="divide-y divide-border">
                  {(requirementsByVersion.get(detailsVersion.id) || []).map((requirement) => (
                    <div key={requirement.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(180px,1fr)_140px_140px_120px]">
                      <span className="font-medium">{documentLabel(requirement.tipo_documento_codigo)}</span>
                      <span className="text-muted-foreground">{policyMomentLabels[resolverMomentoObrigatorioLegado(requirement)]}</span>
                      <span className="text-muted-foreground">{policyResponsibleLabels[requirement.responsavel_upload]}</span>
                      <StatusBadge status={requirement.obrigatorio ? 'Obrigatorio' : 'Opcional'} />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!publishVersion} onOpenChange={(open) => { if (!open) setPublishVersion(null) }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Publicar nova versao</DialogTitle>
            <DialogDescription>A nova versao substituira a versao atualmente publicada. Operacoes ja criadas manterao o snapshot anterior.</DialogDescription>
          </DialogHeader>
          {publishVersion && (
            <div className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
              <DetailField label="Politica" value={policyName(publishVersion.politica_operacional_id)} />
              <DetailField label="Nova versao" value={`v${publishVersion.versao}`} />
              <DetailField label="Versao substituida" value={currentVersion(publishVersion.politica_operacional_id) ? `v${currentVersion(publishVersion.politica_operacional_id)?.versao}` : 'Nenhuma'} />
              <DetailField label="Requisitos" value={`${(requirementsByVersion.get(publishVersion.id) || []).length}`} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishVersion(null)}>Cancelar</Button>
            <Button type="button" onClick={confirmPublish} disabled={busy}>Confirmar publicacao</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Copy, FileCog, History, MoreHorizontal, Plus, Power, Send, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarPoliticaOperacional,
  criarPoliticaOperacionalNoFundo,
  criarVersaoPolitica,
  criarVersaoPoliticaNoFundo,
  publicarVersaoPolitica,
  publicarVersaoPoliticaNoFundo,
  type CriarVersaoPoliticaInput,
  type PoliticaRequisitoInput,
} from '@/lib/actions/politica'
import { vincularFundoCedente } from '@/lib/actions/gestor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DetailField, DetailSection, EmptyState, LoadingState, StatusBadge } from '@/components/data-display/primitives'
import {
  createPolicyInternalCode,
  derivePoliticaVersionState,
  describeAceiteSacado,
  describeAcompanhamentoEntrega,
  describeMomentoCessao,
  getPoliticaDisplayState,
  documentLabel,
  mapLegacyFlagsToOperationalSelections,
  mapOperationalSelectionsToLegacyFlags,
  policyDocumentOptions,
  policyResponsibleLabels,
  policyScopeLabels,
  policyValidationLabels,
  shouldClosePublishModal,
  shouldCloseVersionModalAfterCreate,
  type PoliticaOperationalSelections,
} from '@/lib/politicas/ui'

interface LinkRow { id: string; cedente_id: string; fundo_id: string; status: string; vigente_desde: string }
interface CedenteRow { id: string; razao_social: string; cnpj: string }
interface FundoRow { id: string; nome: string; ativo: boolean | null }
interface PolicyRow { id: string; cedente_fundo_id: string; codigo: string; nome: string; descricao: string | null; status: string; created_at?: string | null; updated_at?: string | null }
interface VersionRow {
  id: string
  politica_operacional_id: string
  cedente_fundo_id: string
  versao: number
  publicada_em: string | null
  publicada_por?: string | null
  vigente_desde: string
  vigente_ate?: string | null
  created_at?: string | null
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  configuracao?: Record<string, unknown> | null
}
interface RequirementRow {
  id: string
  politica_operacional_versao_id: string
  politica_operacional_id: string
  cedente_fundo_id: string
  codigo: string
  escopo: PoliticaRequisitoInput['escopo']
  tipo_documento_codigo: PoliticaRequisitoInput['tipo_documento_codigo']
  prazo_dias_corridos: number | null
  responsavel_upload: PoliticaRequisitoInput['responsavel_upload']
  responsavel_aprovacao: PoliticaRequisitoInput['responsavel_aprovacao']
  nivel_validacao?: PoliticaRequisitoInput['nivel_validacao']
  formatos_aceitos?: string[]
  quantidade_minima?: number
  obrigatorio: boolean
  ordem?: number
  ativo?: boolean
}

type VersionStep = 'fluxo' | 'requisitos' | 'revisao'

const defaultSelections: PoliticaOperationalSelections = {
  aceiteSacado: 'antes_cessao',
  momentoCessao: 'desembolso',
  acompanhamentoEntrega: 'nao_aplicavel',
}

const emptyRequirement = (index = 0): PoliticaRequisitoInput => ({
  codigo: `requisito_${index + 1}`,
  escopo: 'nf_pre_cessao',
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

function versionStatus(version: VersionRow) {
  if (version.publicada_em && version.vigente_ate) return 'substituida'
  if (version.publicada_em) return 'publicada'
  return 'rascunho'
}

function cloneRequirements(rows: RequirementRow[]): PoliticaRequisitoInput[] {
  return rows.map((requirement, index) => ({
    codigo: requirement.codigo,
    escopo: requirement.escopo,
    tipo_documento_codigo: requirement.tipo_documento_codigo,
    obrigatorio: requirement.obrigatorio,
    quantidade_minima: requirement.quantidade_minima || 1,
    formatos_aceitos: requirement.formatos_aceitos || [],
    nivel_validacao: requirement.nivel_validacao || 'manual',
    prazo_dias_corridos: requirement.prazo_dias_corridos,
    responsavel_upload: requirement.responsavel_upload,
    responsavel_aprovacao: requirement.responsavel_aprovacao,
    ordem: requirement.ordem ?? index,
    ativo: requirement.ativo ?? true,
  }))
}

export function PoliticasDoFundo({ fundoId, showFundoInLabel = true }: { fundoId?: string; showFundoInLabel?: boolean }) {
  const router = useRouter()
  const [links, setLinks] = useState<LinkRow[]>([])
  const [cedentes, setCedentes] = useState<CedenteRow[]>([])
  const [fundos, setFundos] = useState<FundoRow[]>([])
  const [policies, setPolicies] = useState<PolicyRow[]>([])
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [requirements, setRequirements] = useState<RequirementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [selectedLinkId, setSelectedLinkId] = useState('')
  const [selectedPolicyId, setSelectedPolicyId] = useState('')
  const [policyModalOpen, setPolicyModalOpen] = useState(false)
  const [versionModalOpen, setVersionModalOpen] = useState(false)
  const [detailsVersion, setDetailsVersion] = useState<VersionRow | null>(null)
  const [publishVersion, setPublishVersion] = useState<VersionRow | null>(null)
  const [linkActionsOpen, setLinkActionsOpen] = useState(false)
  const [versionStep, setVersionStep] = useState<VersionStep>('fluxo')
  const [policyForm, setPolicyForm] = useState({ codigo: '', nome: '', descricao: '' })
  const [operationalSelections, setOperationalSelections] = useState<PoliticaOperationalSelections>(defaultSelections)
  const [requirementsForm, setRequirementsForm] = useState<PoliticaRequisitoInput[]>([])

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const linkQuery = supabase.from('cedente_fundos').select('id, cedente_id, fundo_id, status, vigente_desde').order('status').order('vigente_desde', { ascending: false })
    if (fundoId) linkQuery.eq('fundo_id', fundoId)
    const [linkResult, cedenteResult, fundoResult, policyResult] = await Promise.all([
      linkQuery,
      supabase.from('cedentes').select('id, razao_social, cnpj').order('razao_social'),
      supabase.from('fundos').select('id, nome, ativo').order('nome'),
      supabase.from('politicas_operacionais').select('id, cedente_fundo_id, codigo, nome, descricao, status, created_at, updated_at').order('created_at', { ascending: false }),
    ])
    const nextLinks = (linkResult.data || []) as LinkRow[]
    const nextPolicies = (policyResult.data || []) as PolicyRow[]
    const linkIds = nextLinks.map((link) => link.id)
    const policyIds = nextPolicies
      .filter((policy) => linkIds.includes(policy.cedente_fundo_id))
      .map((policy) => policy.id)

    let versionResult: { data: unknown[] | null; error: unknown | null } = { data: [], error: null }
    let requirementResult: { data: unknown[] | null; error: unknown | null } = { data: [], error: null }

    if (linkIds.length > 0 && policyIds.length > 0) {
      const versionQuery = supabase
        .from('politica_operacional_versoes')
        .select('id, politica_operacional_id, cedente_fundo_id, versao, publicada_em, publicada_por, vigente_desde, vigente_ate, created_at, aceite_sacado_obrigatorio, cessao_no_desembolso, cria_acompanhamento_entrega, configuracao')
        .in('politica_operacional_id', policyIds)
        .in('cedente_fundo_id', linkIds)
        .order('versao', { ascending: false })

      const requirementQuery = supabase
        .from('politica_requisitos_documentais')
        .select('id, politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, tipo_documento_codigo, prazo_dias_corridos, responsavel_upload, responsavel_aprovacao, nivel_validacao, formatos_aceitos, quantidade_minima, obrigatorio, ordem, ativo')
        .in('politica_operacional_id', policyIds)
        .in('cedente_fundo_id', linkIds)
        .order('ordem')

      ;[versionResult, requirementResult] = await Promise.all([versionQuery, requirementQuery]) as [
        { data: unknown[] | null; error: unknown | null },
        { data: unknown[] | null; error: unknown | null },
      ]
    }

    const queryError = linkResult.error || cedenteResult.error || fundoResult.error || policyResult.error || versionResult.error || requirementResult.error
    if (queryError) setMessage(`Erro ao recarregar politica operacional: ${(queryError as { message?: string }).message || 'consulta nao concluida.'}`)

    setLinks(nextLinks)
    setCedentes((cedenteResult.data || []) as CedenteRow[])
    setFundos((fundoResult.data || []) as FundoRow[])
    setPolicies(nextPolicies)
    setVersions((versionResult.data || []) as VersionRow[])
    setRequirements((requirementResult.data || []) as RequirementRow[])
    setSelectedLinkId((current) => current || nextLinks[0]?.id || '')
    setLoading(false)
  }, [fundoId])

  // Carga inicial da gestão de políticas.
  useEffect(() => { loadData() }, [loadData])

  const selectedLink = links.find((link) => link.id === selectedLinkId) || null
  const visiblePolicies = useMemo(() => policies.filter((policy) => policy.cedente_fundo_id === selectedLinkId), [policies, selectedLinkId])
  const derivedPolicy = visiblePolicies.find((policy) => policy.status === 'ativa') || visiblePolicies[0] || null
  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) || derivedPolicy
  const visibleVersions = useMemo(
    () => versions.filter((version) => version.politica_operacional_id === selectedPolicy?.id && version.cedente_fundo_id === selectedPolicy?.cedente_fundo_id),
    [versions, selectedPolicy?.id, selectedPolicy?.cedente_fundo_id],
  )
  const { versaoPublicada, versaoRascunho, possuiVersoes, historico: historicoVersoes } = useMemo(() => derivePoliticaVersionState(visibleVersions), [visibleVersions])
  const politicaDisplayState = getPoliticaDisplayState({ versaoPublicada, versaoRascunho, possuiVersoes })
  const versionForRequirements = versaoPublicada || versaoRascunho
  const currentRequirements = requirements.filter(
    (requirement) => requirement.politica_operacional_versao_id === versionForRequirements?.id
      && requirement.politica_operacional_id === selectedPolicy?.id
      && requirement.cedente_fundo_id === selectedPolicy?.cedente_fundo_id,
  )
  const lastUpdate = [selectedPolicy?.updated_at, versionForRequirements?.publicada_em, versionForRequirements?.created_at].filter(Boolean).sort().at(-1)
  const cedenteName = (id: string) => cedentes.find((cedente) => cedente.id === id)?.razao_social || id
  const fundoName = (id: string) => fundos.find((fundo) => fundo.id === id)?.nome || id

  const execute = async (operation: () => Promise<{ success?: boolean; message?: string } | undefined>) => {
    setBusy(true)
    try {
      const result = await operation()
      setMessage(result?.message || '')
      if (result?.success) await loadData()
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'A operacao nao foi concluida.'
      setMessage(errorMessage)
      return { success: false, message: errorMessage }
    } finally {
      setBusy(false)
    }
  }

  function openPolicyModal() {
    if (!selectedLinkId) {
      setMessage('Selecione um vínculo cedente-fundo.')
      return
    }
    setPolicyForm({
      codigo: createPolicyInternalCode(selectedLinkId),
      nome: 'Política operacional padrão',
      descricao: '',
    })
    setPolicyModalOpen(true)
  }

  async function createPolicy() {
    if (!selectedLinkId) return setMessage('Selecione um vínculo cedente-fundo.')
    setBusy(true)
    const result = fundoId
      ? await criarPoliticaOperacionalNoFundo(fundoId, selectedLinkId, policyForm.codigo, policyForm.nome, policyForm.descricao)
      : await criarPoliticaOperacional(selectedLinkId, policyForm.codigo, policyForm.nome, policyForm.descricao)
    setMessage(result?.message || '')
    if (result?.success) {
      if (result.data?.id) setSelectedPolicyId(result.data.id)
      setPolicyModalOpen(false)
      setPolicyForm({ codigo: '', nome: '', descricao: '' })
      await loadData()
    }
    setBusy(false)
  }

  function openVersionModal(base?: VersionRow | null) {
    if (!selectedPolicy) {
      setMessage('Configure uma política antes de criar versões.')
      return
    }
    const source = base || versaoPublicada || versaoRascunho
    const sourceRequirements = source ? requirements.filter((requirement) => requirement.politica_operacional_versao_id === source.id) : []
    setOperationalSelections(source ? mapLegacyFlagsToOperationalSelections(source) : defaultSelections)
    setRequirementsForm(source ? cloneRequirements(sourceRequirements) : [])
    setVersionStep('fluxo')
    setVersionModalOpen(true)
  }

  async function createVersion() {
    if (!selectedPolicy) return setMessage('Selecione uma política.')
    const flags = mapOperationalSelectionsToLegacyFlags(operationalSelections)
    const payload: CriarVersaoPoliticaInput = {
      ...flags,
      configuracao: {
        fluxo_operacional: operationalSelections,
        requisito_ui_schema: 'bw-antecipa.politica-operacional-ui.v1',
      },
      requisitos: requirementsForm.map((requirement, index) => ({ ...requirement, ordem: index })),
    }
    setBusy(true)
    const result = fundoId
      ? await criarVersaoPoliticaNoFundo(fundoId, selectedPolicy.id, payload)
      : await criarVersaoPolitica(selectedPolicy.id, payload)
    setMessage(result?.message || '')
    if (!shouldCloseVersionModalAfterCreate(result)) {
      setBusy(false)
      return
    }

    await loadData()
    setVersionModalOpen(false)
    setVersionStep('fluxo')
    router.refresh()
    setBusy(false)
  }

  async function confirmPublish() {
    if (!publishVersion) return
    const result = await execute(() => fundoId ? publicarVersaoPoliticaNoFundo(fundoId, publishVersion.id) : publicarVersaoPolitica(publishVersion.id))
    if (!shouldClosePublishModal(result)) return
    setPublishVersion(null)
    router.refresh()
  }

  function updateRequirement(index: number, patch: Partial<PoliticaRequisitoInput>) {
    setRequirementsForm((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  function setRequirementDocument(index: number, value: PoliticaRequisitoInput['tipo_documento_codigo']) {
    const option = policyDocumentOptions.find((item) => item.value === value)
    updateRequirement(index, {
      tipo_documento_codigo: value,
      codigo: value,
      formatos_aceitos: option?.formatos || [],
    })
  }

  if (loading) return <LoadingState label="Carregando políticas..." />

  return (
    <div className="space-y-5">
      {message && <div className="rounded-xl border border-info/25 bg-info/10 px-4 py-3 text-sm text-info-foreground">{message}</div>}

      <DetailSection title="Status da política operacional" icon={FileCog}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold">{selectedPolicy?.nome || 'Nenhuma política configurada'}</h3>
              <StatusBadge status={selectedPolicy?.status || 'não_configurada'} label={selectedPolicy ? undefined : 'Não configurada'} />
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              A política operacional pertence ao vínculo cedente-fundo selecionado. Cada operação criada preserva um snapshot imutável da versão utilizada.
            </p>
          </div>
          <dl className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
            <DetailField label="Versão vigente" value={versaoPublicada ? `v${versaoPublicada.versao}` : '—'} />
            <DetailField label="Publicação" value={formatDateTime(versaoPublicada?.publicada_em)} />
            <DetailField label="Requisitos" value={`${currentRequirements.length}`} />
            <DetailField label="Última atualização" value={formatDateTime(lastUpdate)} />
          </dl>
        </div>
      </DetailSection>

      <DetailSection
        title="Cedente vinculado ao fundo"
        icon={Building2}
        action={
          selectedLink && (
            <Button type="button" size="sm" variant="outline" onClick={() => setLinkActionsOpen((value) => !value)}>
              <MoreHorizontal className="mr-2 size-4" /> Ações do vínculo
            </Button>
          )
        }
      >
        <div className="space-y-4">
          <select className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" value={selectedLinkId} onChange={(event) => { setSelectedLinkId(event.target.value); setSelectedPolicyId(''); setLinkActionsOpen(false) }}>
            <option value="">Selecione um vínculo</option>
            {links.map((link) => <option key={link.id} value={link.id}>{cedenteName(link.cedente_id)}{showFundoInLabel ? ` — ${fundoName(link.fundo_id)}` : ''} ({link.status})</option>)}
          </select>
          {selectedLink && (
            <div className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm md:grid-cols-3">
              <DetailField label="Cedente" value={cedenteName(selectedLink.cedente_id)} />
              <DetailField label="Status do vínculo" value={<StatusBadge status={selectedLink.status} />} />
              <DetailField label="Vigência" value={`Desde ${formatDateTime(selectedLink.vigente_desde)}`} />
            </div>
          )}
          {linkActionsOpen && selectedLink && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm">
              <p className="font-semibold text-warning-foreground">Ação secundária</p>
              <p className="mt-1 text-muted-foreground">Suspender o vínculo afeta novas configurações operacionais para este cedente no fundo.</p>
              <Button size="sm" variant="outline" disabled={busy || selectedLink.status !== 'ativo'} onClick={() => execute(() => vincularFundoCedente(selectedLink.cedente_id, null))} className="mt-3">
                <Power size={13} className="mr-1" /> Suspender vínculo
              </Button>
            </div>
          )}
          {links.length === 0 && <p className="text-sm text-muted-foreground">Nenhum vínculo encontrado para este fundo.</p>}
        </div>
      </DetailSection>

      {!selectedPolicy ? (
        <DetailSection title="Política operacional" icon={FileCog}>
          <EmptyState
            title="Nenhuma política configurada"
            description="Configure a política operacional do vínculo selecionado para definir fluxo, requisitos documentais e publicação versionada."
            icon={FileCog}
            action={<Button type="button" onClick={openPolicyModal} disabled={busy || !selectedLinkId}><Plus className="mr-2 size-4" /> Configurar política</Button>}
          />
        </DetailSection>
      ) : (
        <>
          <DetailSection
            title="Política vigente"
            icon={FileCog}
            action={
              possuiVersoes && (
                <div className="flex flex-wrap gap-2">
                  {versaoPublicada && <Button type="button" size="sm" variant="outline" onClick={() => setDetailsVersion(versaoPublicada)}>Ver detalhes</Button>}
                  {politicaDisplayState === 'preparacao' ? (
                    <Button type="button" size="sm" onClick={() => openVersionModal(versaoRascunho)} disabled={busy}>
                      Continuar configuração
                    </Button>
                  ) : (
                    <Button type="button" size="sm" onClick={() => openVersionModal(versaoPublicada || versaoRascunho)} disabled={busy}>
                      Criar nova versão
                    </Button>
                  )}
                </div>
              )
            }
          >
            {politicaDisplayState === 'vigente' && versaoPublicada ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">{selectedPolicy.nome}</h3>
                  {selectedPolicy.descricao && <p className="mt-1 text-sm text-muted-foreground">{selectedPolicy.descricao}</p>}
                </div>
                <div className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-2 xl:grid-cols-4">
                  <DetailField label="Aceite do sacado" value={describeAceiteSacado(mapLegacyFlagsToOperationalSelections(versaoPublicada).aceiteSacado)} />
                  <DetailField label="Momento da cessão" value={describeMomentoCessao(mapLegacyFlagsToOperationalSelections(versaoPublicada).momentoCessao)} />
                  <DetailField label="Acompanhamento da entrega" value={describeAcompanhamentoEntrega(mapLegacyFlagsToOperationalSelections(versaoPublicada).acompanhamentoEntrega)} />
                  <DetailField label="Requisitos" value={`${currentRequirements.length}`} />
                </div>
              </div>
            ) : politicaDisplayState === 'preparacao' && versaoRascunho ? (
              <EmptyState
                title="Versão em preparação"
                description="Existe uma versão em rascunho. Continue a configuração ou publique quando ela estiver pronta para se tornar vigente."
                icon={FileCog}
                action={<Button type="button" onClick={() => openVersionModal(versaoRascunho)} disabled={busy}>Continuar configuração</Button>}
              />
            ) : (
              <EmptyState title="Política sem qualquer versão" description="Crie a primeira versão em rascunho e publique para torná-la vigente." icon={FileCog} action={<Button type="button" onClick={() => openVersionModal()} disabled={busy}>Criar primeira versão</Button>} />
            )}
          </DetailSection>

          <DetailSection title="Histórico de versões" icon={History}>
            {historicoVersoes.length === 0 ? (
              <EmptyState title="Nenhuma versão criada" description="As versões da política aparecerão aqui." icon={History} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="hidden grid-cols-[90px_120px_170px_140px_140px_minmax(220px,1fr)] gap-4 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
                  <span>Versão</span>
                  <span>Status</span>
                  <span>Data</span>
                  <span>Requisitos</span>
                  <span>Responsável</span>
                  <span className="text-right">Ações</span>
                </div>
                <div className="divide-y divide-border">
                  {historicoVersoes.map((version) => {
                    const versionRequirements = requirements.filter(
                      (requirement) => requirement.politica_operacional_versao_id === version.id
                        && requirement.politica_operacional_id === version.politica_operacional_id
                        && requirement.cedente_fundo_id === version.cedente_fundo_id,
                    )
                    const status = versionStatus(version)
                    return (
                      <div key={version.id} className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[90px_120px_170px_140px_140px_minmax(220px,1fr)] lg:items-center">
                        <span className="font-medium">v{version.versao}</span>
                        <StatusBadge status={status} label={status === 'substituida' ? 'Substituída' : undefined} />
                        <span className="text-xs text-muted-foreground">{formatDateTime(version.publicada_em || version.created_at || version.vigente_desde)}</span>
                        <span className="text-muted-foreground">{versionRequirements.length}</span>
                        <span className="text-xs text-muted-foreground">{version.publicada_por ? 'Registrado' : 'Não informado'}</span>
                        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                          <Button type="button" size="sm" variant="outline" onClick={() => setDetailsVersion(version)}>Ver</Button>
                          <Button type="button" size="sm" variant="outline" disabled title="Comparação visual ficará para a próxima etapa">Comparar</Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => openVersionModal(version)}><Copy className="mr-1 size-3.5" /> Duplicar</Button>
                          {status === 'rascunho' && <Button type="button" size="sm" onClick={() => setPublishVersion(version)}><Send className="mr-1 size-3.5" /> Publicar</Button>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </DetailSection>
        </>
      )}

      <Dialog open={policyModalOpen} onOpenChange={setPolicyModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Configurar política operacional</DialogTitle>
            <DialogDescription>A política nasce como rascunho no vínculo cedente-fundo. O código é gerado automaticamente e pode ser editado antes da primeira publicação.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={policyForm.nome} onChange={(event) => setPolicyForm((prev) => ({ ...prev, nome: event.target.value }))} /></div>
            <div><Label>Descrição</Label><Input value={policyForm.descricao} onChange={(event) => setPolicyForm((prev) => ({ ...prev, descricao: event.target.value }))} /></div>
            <div>
              <Label>Código interno</Label>
              <Input value={policyForm.codigo} onChange={(event) => setPolicyForm((prev) => ({ ...prev, codigo: event.target.value }))} />
              <p className="mt-1 text-xs text-muted-foreground">Usado internamente para auditoria e integração. Não será exibido na operação principal.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPolicyModalOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={createPolicy} disabled={busy || !policyForm.codigo || !policyForm.nome}>Criar rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={versionModalOpen} onOpenChange={setVersionModalOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>Nova versão da política</DialogTitle>
            <DialogDescription>A nova versão começa copiando a versão base selecionada. Versões publicadas permanecem imutáveis e operações antigas mantêm snapshot anterior.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            {(['fluxo', 'requisitos', 'revisao'] as const).map((step) => (
              <button key={step} type="button" onClick={() => setVersionStep(step)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${versionStep === step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                {step === 'fluxo' ? 'Fluxo operacional' : step === 'requisitos' ? 'Requisitos documentais' : 'Revisão e publicação'}
              </button>
            ))}
          </div>

          {versionStep === 'fluxo' && (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border bg-background p-4">
                <Label>Aceite do sacado</Label>
                <div className="mt-3 space-y-2">
                  {[
                    ['nao_exigido', 'Não exigido'],
                    ['antes_cessao', 'Exigido antes da cessão'],
                    ['antes_desembolso', 'Exigido antes do desembolso'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" checked={operationalSelections.aceiteSacado === value} onChange={() => setOperationalSelections((prev) => ({ ...prev, aceiteSacado: value as PoliticaOperationalSelections['aceiteSacado'] }))} /> {label}</label>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <Label>Momento da cessão</Label>
                <div className="mt-3 space-y-2">
                  {[
                    ['aprovacao', 'Na aprovação'],
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
                    ['nao_aplicavel', 'Não aplicável'],
                    ['apos_desembolso', 'Obrigatório após desembolso'],
                    ['antes_liberacao_definitiva', 'Obrigatório antes da liberação definitiva'],
                  ].map(([value, label]) => (
                    <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" checked={operationalSelections.acompanhamentoEntrega === value} onChange={() => setOperationalSelections((prev) => ({ ...prev, acompanhamentoEntrega: value as PoliticaOperationalSelections['acompanhamentoEntrega'] }))} /> {label}</label>
                  ))}
                </div>
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
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <Label>Tipo de documento</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.tipo_documento_codigo} onChange={(event) => setRequirementDocument(index, event.target.value as PoliticaRequisitoInput['tipo_documento_codigo'])}>
                        {policyDocumentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Categoria</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.escopo} onChange={(event) => updateRequirement(index, { escopo: event.target.value as PoliticaRequisitoInput['escopo'] })}>
                        {Object.entries(policyScopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Momento obrigatório</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.escopo} onChange={(event) => updateRequirement(index, { escopo: event.target.value as PoliticaRequisitoInput['escopo'] })}>
                        {Object.entries(policyScopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Responsável</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.responsavel_upload} onChange={(event) => updateRequirement(index, { responsavel_upload: event.target.value as PoliticaRequisitoInput['responsavel_upload'] })}>
                        {Object.entries(policyResponsibleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Obrigatoriedade</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.obrigatorio ? 'sim' : 'nao'} onChange={(event) => updateRequirement(index, { obrigatorio: event.target.value === 'sim' })}>
                        <option value="sim">Obrigatório</option>
                        <option value="nao">Opcional</option>
                      </select>
                    </div>
                    <div>
                      <Label>Prazo</Label>
                      <Input type="number" value={requirement.prazo_dias_corridos ?? ''} onChange={(event) => updateRequirement(index, { prazo_dias_corridos: event.target.value ? Number(event.target.value) : null })} placeholder="Sem prazo" />
                    </div>
                    <div>
                      <Label>Regra de validade</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.nivel_validacao || 'manual'} onChange={(event) => updateRequirement(index, { nivel_validacao: event.target.value as PoliticaRequisitoInput['nivel_validacao'] })}>
                        {Object.entries(policyValidationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Bloqueia avanço</Label>
                      <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={requirement.obrigatorio ? 'sim' : 'nao'} onChange={(event) => updateRequirement(index, { obrigatorio: event.target.value === 'sim' })}>
                        <option value="sim">Sim, se obrigatório</option>
                        <option value="nao">Não</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 xl:col-span-4">
                      <Label>Observações</Label>
                      <Input value={(requirement.formatos_aceitos || []).join(', ')} onChange={(event) => updateRequirement(index, { formatos_aceitos: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="Formatos aceitos ou observações operacionais" />
                    </div>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setRequirementsForm((items) => [...items, emptyRequirement(items.length)])}>
                <Plus size={14} className="mr-1" /> Adicionar requisito
              </Button>
            </div>
          )}

          {versionStep === 'revisao' && (
            <div className="space-y-4">
              <div className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-3">
                <DetailField label="Aceite do sacado" value={describeAceiteSacado(operationalSelections.aceiteSacado)} />
                <DetailField label="Momento da cessão" value={describeMomentoCessao(operationalSelections.momentoCessao)} />
                <DetailField label="Entrega" value={describeAcompanhamentoEntrega(operationalSelections.acompanhamentoEntrega)} />
              </div>
              <div className="rounded-xl border border-border">
                <div className="border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Requisitos</div>
                <div className="divide-y divide-border">
                  {requirementsForm.map((requirement, index) => (
                    <div key={`${index}-${requirement.codigo}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(180px,1fr)_140px_140px_120px]">
                      <span className="font-medium">{documentLabel(requirement.tipo_documento_codigo)}</span>
                      <span className="text-muted-foreground">{policyScopeLabels[requirement.escopo]}</span>
                      <span className="text-muted-foreground">{policyResponsibleLabels[requirement.responsavel_upload]}</span>
                      <StatusBadge status={requirement.obrigatorio ? 'Obrigatório' : 'Opcional'} />
                    </div>
                  ))}
                  {requirementsForm.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum requisito documental nesta versão.</p>}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVersionModalOpen(false)}>Cancelar</Button>
            <Button type="button" variant="outline" onClick={() => setVersionStep(versionStep === 'fluxo' ? 'requisitos' : versionStep === 'requisitos' ? 'revisao' : 'fluxo')}>
              {versionStep === 'revisao' ? 'Voltar ao início' : 'Continuar'}
            </Button>
            <Button type="button" onClick={createVersion} disabled={busy || !selectedPolicy}>Criar versão em rascunho</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detailsVersion} onOpenChange={(open) => { if (!open) setDetailsVersion(null) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          {detailsVersion && (
            <>
              <DialogHeader>
                <DialogTitle>Detalhes da versão {detailsVersion.versao}</DialogTitle>
                <DialogDescription>Consulta somente leitura da versão selecionada.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-3">
                <DetailField label="Status" value={<StatusBadge status={versionStatus(detailsVersion)} />} />
                <DetailField label="Publicação" value={formatDateTime(detailsVersion.publicada_em)} />
                <DetailField label="Vigência" value={`${formatDateTime(detailsVersion.vigente_desde)}${detailsVersion.vigente_ate ? ` até ${formatDateTime(detailsVersion.vigente_ate)}` : ''}`} />
                <DetailField label="Aceite do sacado" value={describeAceiteSacado(mapLegacyFlagsToOperationalSelections(detailsVersion).aceiteSacado)} />
                <DetailField label="Momento da cessão" value={describeMomentoCessao(mapLegacyFlagsToOperationalSelections(detailsVersion).momentoCessao)} />
                <DetailField label="Acompanhamento de entrega" value={describeAcompanhamentoEntrega(mapLegacyFlagsToOperationalSelections(detailsVersion).acompanhamentoEntrega)} />
              </div>
              <div className="rounded-xl border border-border">
                <div className="border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Requisitos documentais</div>
                <div className="divide-y divide-border">
                  {requirements.filter((requirement) => requirement.politica_operacional_versao_id === detailsVersion.id).map((requirement) => (
                    <div key={requirement.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(180px,1fr)_140px_140px_120px]">
                      <span className="font-medium">{documentLabel(requirement.tipo_documento_codigo)}</span>
                      <span className="text-muted-foreground">{policyScopeLabels[requirement.escopo]}</span>
                      <span className="text-muted-foreground">{policyResponsibleLabels[requirement.responsavel_upload]}</span>
                      <StatusBadge status={requirement.obrigatorio ? 'Obrigatório' : 'Opcional'} />
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
            <DialogTitle>Publicar nova versão</DialogTitle>
            <DialogDescription>A nova versão substituirá a versão atualmente publicada. Operações já criadas manterão o snapshot anterior.</DialogDescription>
          </DialogHeader>
          {message && (
            <div className="rounded-xl border border-info/25 bg-info/10 px-4 py-3 text-sm text-info-foreground">
              {message}
            </div>
          )}
          {publishVersion && (
            <div className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
              <DetailField label="Política" value={selectedPolicy?.nome || 'Política operacional'} />
              <DetailField label="Nova versão" value={`v${publishVersion.versao}`} />
              <DetailField label="Versão substituída" value={versaoPublicada ? `v${versaoPublicada.versao}` : 'Nenhuma'} />
              <DetailField
                label="Requisitos"
                value={`${requirements.filter((requirement) => requirement.politica_operacional_versao_id === publishVersion.id && requirement.politica_operacional_id === publishVersion.politica_operacional_id && requirement.cedente_fundo_id === publishVersion.cedente_fundo_id).length}`}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishVersion(null)}>Cancelar</Button>
            <Button type="button" onClick={confirmPublish} disabled={busy}>Confirmar publicação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

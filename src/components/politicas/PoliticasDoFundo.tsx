'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Building2, FileCog, Plus, Power, Send, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { criarPoliticaOperacional, criarPoliticaOperacionalNoFundo, criarVersaoPolitica, criarVersaoPoliticaNoFundo, desativarPolitica, desativarPoliticaNoFundo, publicarVersaoPolitica, publicarVersaoPoliticaNoFundo, type PoliticaRequisitoInput } from '@/lib/actions/politica'
import { vincularFundoCedente } from '@/lib/actions/gestor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DetailSection, LoadingState, StatusBadge } from '@/components/data-display/primitives'

interface LinkRow { id: string; cedente_id: string; fundo_id: string; status: string; vigente_desde: string }
interface CedenteRow { id: string; razao_social: string; cnpj: string }
interface FundoRow { id: string; nome: string; ativo: boolean | null }
interface PolicyRow { id: string; cedente_fundo_id: string; codigo: string; nome: string; descricao: string | null; status: string }
interface VersionRow { id: string; politica_operacional_id: string; versao: number; publicada_em: string | null; vigente_desde: string; aceite_sacado_obrigatorio: boolean; cessao_no_desembolso: boolean; cria_acompanhamento_entrega: boolean }
interface RequirementRow { id: string; politica_operacional_versao_id: string; codigo: string; escopo: string; tipo_documento_codigo: string; prazo_dias_corridos: number | null; responsavel_upload: string; responsavel_aprovacao: string; obrigatorio: boolean }

const emptyRequirement = (): PoliticaRequisitoInput => ({
  codigo: '', escopo: 'nf_pre_cessao', tipo_documento_codigo: 'nf_xml', obrigatorio: true,
  quantidade_minima: 1, formatos_aceitos: ['xml'], nivel_validacao: 'manual', prazo_dias_corridos: null,
  responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor', ordem: 0, ativo: true,
})

export function PoliticasDoFundo({ fundoId, showFundoInLabel = true }: { fundoId?: string; showFundoInLabel?: boolean }) {
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
  const [policyForm, setPolicyForm] = useState({ codigo: '', nome: '', descricao: '' })
  const [versionForm, setVersionForm] = useState({ aceite: true, cessao: true, entrega: false, requisitos: [] as PoliticaRequisitoInput[] })

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const linkQuery = supabase.from('cedente_fundos').select('id, cedente_id, fundo_id, status, vigente_desde').order('status').order('vigente_desde', { ascending: false })
    if (fundoId) linkQuery.eq('fundo_id', fundoId)
    const [linkResult, cedenteResult, fundoResult, policyResult, versionResult, requirementResult] = await Promise.all([
      linkQuery,
      supabase.from('cedentes').select('id, razao_social, cnpj').order('razao_social'),
      supabase.from('fundos').select('id, nome, ativo').order('nome'),
      supabase.from('politicas_operacionais').select('id, cedente_fundo_id, codigo, nome, descricao, status').order('created_at', { ascending: false }),
      supabase.from('politica_operacional_versoes').select('id, politica_operacional_id, versao, publicada_em, vigente_desde, aceite_sacado_obrigatorio, cessao_no_desembolso, cria_acompanhamento_entrega').order('versao', { ascending: false }),
      supabase.from('politica_requisitos_documentais').select('id, politica_operacional_versao_id, codigo, escopo, tipo_documento_codigo, prazo_dias_corridos, responsavel_upload, responsavel_aprovacao, obrigatorio').order('ordem'),
    ])
    const nextLinks = (linkResult.data || []) as LinkRow[]
    setLinks(nextLinks)
    setCedentes((cedenteResult.data || []) as CedenteRow[])
    setFundos((fundoResult.data || []) as FundoRow[])
    setPolicies((policyResult.data || []) as PolicyRow[])
    setVersions((versionResult.data || []) as VersionRow[])
    setRequirements((requirementResult.data || []) as RequirementRow[])
    setSelectedLinkId((current) => current || nextLinks[0]?.id || '')
    setLoading(false)
  }, [fundoId])

  // Carga inicial da gestao de politicas.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const selectedLink = links.find((link) => link.id === selectedLinkId) || null
  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) || null
  const visiblePolicies = useMemo(() => policies.filter((policy) => policy.cedente_fundo_id === selectedLinkId), [policies, selectedLinkId])
  const visibleVersions = useMemo(() => versions.filter((version) => version.politica_operacional_id === selectedPolicyId), [versions, selectedPolicyId])
  const cedenteName = (id: string) => cedentes.find((cedente) => cedente.id === id)?.razao_social || id
  const fundoName = (id: string) => fundos.find((fundo) => fundo.id === id)?.nome || id

  const execute = async (operation: () => Promise<{ success?: boolean; message?: string } | undefined>) => {
    setBusy(true)
    const result = await operation()
    setMessage(result?.message || '')
    if (result?.success) await loadData()
    setBusy(false)
  }

  const createPolicy = async () => {
    if (!selectedLinkId) return setMessage('Selecione um vinculo cedente-fundo.')
    await execute(() => fundoId
      ? criarPoliticaOperacionalNoFundo(fundoId, selectedLinkId, policyForm.codigo, policyForm.nome, policyForm.descricao)
      : criarPoliticaOperacional(selectedLinkId, policyForm.codigo, policyForm.nome, policyForm.descricao))
    setPolicyForm({ codigo: '', nome: '', descricao: '' })
  }

  const createVersion = async () => {
    if (!selectedPolicyId) return setMessage('Selecione uma politica.')
    const payload = { aceite_sacado_obrigatorio: versionForm.aceite, cessao_no_desembolso: versionForm.cessao, cria_acompanhamento_entrega: versionForm.entrega, requisitos: versionForm.requisitos }
    await execute(() => fundoId ? criarVersaoPoliticaNoFundo(fundoId, selectedPolicyId, payload) : criarVersaoPolitica(selectedPolicyId, payload))
    setVersionForm((current) => ({ ...current, requisitos: [] }))
  }

  if (loading) return <LoadingState label="Carregando políticas..." />

  return (
    <div className="space-y-5">
      {message && <div className="rounded-xl border border-info/25 bg-info/10 px-4 py-3 text-sm text-info-foreground">{message}</div>}

      <DetailSection title="Cedentes vinculados ao fundo" icon={Building2}>
        <div className="space-y-3">
          <select className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" value={selectedLinkId} onChange={(event) => { setSelectedLinkId(event.target.value); setSelectedPolicyId('') }}>
            <option value="">Selecione um vínculo</option>
            {links.map((link) => <option key={link.id} value={link.id}>{cedenteName(link.cedente_id)}{showFundoInLabel ? ` — ${fundoName(link.fundo_id)}` : ''} ({link.status})</option>)}
          </select>
          {selectedLink && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Vigente desde {new Date(selectedLink.vigente_desde).toLocaleDateString('pt-BR')}</span><Button size="sm" variant="outline" disabled={busy || selectedLink.status !== 'ativo'} onClick={() => execute(() => vincularFundoCedente(selectedLink.cedente_id, null))}><Power size={13} className="mr-1" /> Suspender vínculo</Button></div>}
          {links.length === 0 && <p className="text-sm text-muted-foreground">Nenhum vínculo encontrado para este fundo.</p>}
        </div>
      </DetailSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <DetailSection title="Políticas do vínculo" icon={FileCog}>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label>Código</Label><Input value={policyForm.codigo} onChange={(event) => setPolicyForm({ ...policyForm, codigo: event.target.value })} /></div>
              <div><Label>Nome</Label><Input value={policyForm.nome} onChange={(event) => setPolicyForm({ ...policyForm, nome: event.target.value })} /></div>
            </div>
            <div><Label>Descrição</Label><Input value={policyForm.descricao} onChange={(event) => setPolicyForm({ ...policyForm, descricao: event.target.value })} /></div>
            <Button onClick={createPolicy} disabled={busy || !selectedLinkId} className="gap-2"><Plus size={15} /> Criar rascunho</Button>
            <div className="divide-y overflow-hidden rounded-xl border border-border">
              {visiblePolicies.map((policy) => <button key={policy.id} type="button" onClick={() => setSelectedPolicyId(policy.id)} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50 ${selectedPolicyId === policy.id ? 'bg-primary/5' : ''}`}><span className="font-medium">{policy.codigo} — {policy.nome}</span><StatusBadge status={policy.status} /></button>)}
              {visiblePolicies.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma política para o vínculo.</p>}
            </div>
            {selectedPolicy && <Button variant="outline" size="sm" disabled={busy || selectedPolicy.status === 'desativada'} onClick={() => execute(() => fundoId ? desativarPoliticaNoFundo(fundoId, selectedPolicy.id) : desativarPolitica(selectedPolicy.id))}>Desativar política</Button>}
          </div>
        </DetailSection>

        <DetailSection title="Nova versão" icon={FileCog}>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={versionForm.aceite} onChange={(event) => setVersionForm({ ...versionForm, aceite: event.target.checked })} /> Aceite sacado</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={versionForm.cessao} onChange={(event) => setVersionForm({ ...versionForm, cessao: event.target.checked })} /> Cessão no desembolso</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={versionForm.entrega} onChange={(event) => setVersionForm({ ...versionForm, entrega: event.target.checked })} /> Acomp. entrega</label>
            </div>
            <div className="space-y-3">
              {versionForm.requisitos.map((requirement, index) => <div key={`${index}-${requirement.codigo}`} className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between"><span className="text-xs font-semibold">Requisito {index + 1}</span><Button type="button" variant="ghost" size="icon" onClick={() => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} /></Button></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Código" value={requirement.codigo} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, codigo: event.target.value } : item) })} />
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={requirement.tipo_documento_codigo} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, tipo_documento_codigo: event.target.value as PoliticaRequisitoInput['tipo_documento_codigo'] } : item) })}><option value="nf_xml">NF XML</option><option value="nf_danfe_pdf">DANFE PDF</option><option value="nf_pedido_compra">Pedido de compra</option><option value="cte">CT-e</option><option value="canhoto">Canhoto</option></select>
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={requirement.escopo} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, escopo: event.target.value as PoliticaRequisitoInput['escopo'] } : item) })}><option value="nf_pre_cessao">NF pré-cessão</option><option value="operacao">Operação</option><option value="pos_cessao">Pós-cessão</option><option value="entrega">Entrega</option></select>
                  <Input placeholder="Formatos: xml,pdf" value={(requirement.formatos_aceitos || []).join(',')} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, formatos_aceitos: event.target.value.split(',') } : item) })} />
                </div>
              </div>)}
            </div>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setVersionForm({ ...versionForm, requisitos: [...versionForm.requisitos, emptyRequirement()] })}><Plus size={14} className="mr-1" /> Requisito</Button><Button onClick={createVersion} disabled={busy || !selectedPolicyId} className="gap-2"><FileCog size={15} /> Criar versão</Button></div>
          </div>
        </DetailSection>
      </div>

      {selectedPolicy && <DetailSection title={`Histórico de versões — ${selectedPolicy.codigo}`} icon={Send}><div className="space-y-2">{visibleVersions.map((version) => <div key={version.id} className="rounded-xl border border-border bg-background px-4 py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">Versão {version.versao}</span><span className="text-xs text-muted-foreground">criada em {new Date(version.vigente_desde).toLocaleDateString('pt-BR')}</span>{version.publicada_em && <StatusBadge status="publicada" label="Publicada" />}</div>{!version.publicada_em && <Button size="sm" disabled={busy} onClick={() => execute(() => fundoId ? publicarVersaoPoliticaNoFundo(fundoId, version.id) : publicarVersaoPolitica(version.id))}><Send size={13} className="mr-1" /> Publicar</Button>}</div><div className="mt-2 text-xs text-muted-foreground">Aceite sacado: {version.aceite_sacado_obrigatorio ? 'sim' : 'não'} · Cessão no desembolso: {version.cessao_no_desembolso ? 'sim' : 'não'} · Logística: {version.cria_acompanhamento_entrega ? 'sim' : 'não'}</div><div className="mt-3 flex flex-wrap gap-1.5">{requirements.filter((requirement) => requirement.politica_operacional_versao_id === version.id).map((requirement) => <span key={requirement.id} className="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">{requirement.codigo} · {requirement.tipo_documento_codigo} · {requirement.prazo_dias_corridos === null ? 'sem prazo' : `${requirement.prazo_dias_corridos}d`} · upload {requirement.responsavel_upload} · aprova {requirement.responsavel_aprovacao}{requirement.obrigatorio ? '' : ' · opcional'}</span>)}</div></div>)}{visibleVersions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma versão criada.</p>}</div></DetailSection>}
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { criarPoliticaOperacional, criarVersaoPolitica, desativarPolitica, publicarVersaoPolitica, type PoliticaRequisitoInput } from '@/lib/actions/politica'
import { vincularFundoCedente } from '@/lib/actions/gestor'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Building2, FileCog, Loader2, Plus, Power, Send, Trash2 } from 'lucide-react'

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

export default function PoliticasPage() {
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

  const loadData = async () => {
    const supabase = createClient()
    const [linkResult, cedenteResult, fundoResult, policyResult, versionResult, requirementResult] = await Promise.all([
      supabase.from('cedente_fundos').select('id, cedente_id, fundo_id, status, vigente_desde').order('status').order('vigente_desde', { ascending: false }),
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
    const nextPolicies = (policyResult.data || []) as PolicyRow[]
    setPolicies(nextPolicies)
    setVersions((versionResult.data || []) as VersionRow[])
    setRequirements((requirementResult.data || []) as RequirementRow[])
    if (!selectedLinkId && nextLinks.length > 0) setSelectedLinkId(nextLinks[0].id)
    if (!selectedPolicyId && nextPolicies.length > 0) setSelectedPolicyId(nextPolicies[0].id)
    setLoading(false)
  }

  // A carga inicial sincroniza a tela com o estado persistido do Supabase.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { loadData() }, [])

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
    await execute(() => criarPoliticaOperacional(selectedLinkId, policyForm.codigo, policyForm.nome, policyForm.descricao))
    setPolicyForm({ codigo: '', nome: '', descricao: '' })
  }

  const createVersion = async () => {
    if (!selectedPolicyId) return setMessage('Selecione uma politica.')
    await execute(() => criarVersaoPolitica(selectedPolicyId, {
      aceite_sacado_obrigatorio: versionForm.aceite,
      cessao_no_desembolso: versionForm.cessao,
      cria_acompanhamento_entrega: versionForm.entrega,
      requisitos: versionForm.requisitos,
    }))
    setVersionForm((current) => ({ ...current, requisitos: [] }))
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin" /></div>

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <FileCog size={24} className="text-primary" />
        <div><h1 className="text-2xl font-bold">Políticas operacionais</h1><p className="text-sm text-muted-foreground">Configure vínculos, versões e requisitos documentais do contexto operacional.</p></div>
      </div>

      {message && <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">{message}</div>}

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 size={17} /> Vínculo cedente-fundo</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={selectedLinkId} onChange={(event) => { setSelectedLinkId(event.target.value); setSelectedPolicyId('') }}>
            <option value="">Selecione um vínculo</option>
            {links.map((link) => <option key={link.id} value={link.id}>{cedenteName(link.cedente_id)} — {fundoName(link.fundo_id)} ({link.status})</option>)}
          </select>
          {selectedLink && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>Vigente desde {new Date(selectedLink.vigente_desde).toLocaleDateString('pt-BR')}</span><Button size="sm" variant="outline" disabled={busy || selectedLink.status !== 'ativo'} onClick={() => execute(() => vincularFundoCedente(selectedLink.cedente_id, null))}><Power size={13} className="mr-1" /> Suspender vínculo</Button></div>}
          {links.length === 0 && <p className="text-sm text-muted-foreground">Nenhum vínculo encontrado. O vínculo é criado na tela de detalhe do cedente.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Políticas do vínculo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div><Label>Código</Label><Input value={policyForm.codigo} onChange={(event) => setPolicyForm({ ...policyForm, codigo: event.target.value })} placeholder="POL-OPERACAO-01" /></div>
              <div><Label>Nome</Label><Input value={policyForm.nome} onChange={(event) => setPolicyForm({ ...policyForm, nome: event.target.value })} placeholder="Política padrão" /></div>
            </div>
            <div><Label>Descrição</Label><Input value={policyForm.descricao} onChange={(event) => setPolicyForm({ ...policyForm, descricao: event.target.value })} /></div>
            <Button onClick={createPolicy} disabled={busy || !selectedLinkId} className="gap-2"><Plus size={15} /> Criar rascunho</Button>
            <div className="divide-y rounded-md border">
              {visiblePolicies.map((policy) => <button key={policy.id} type="button" onClick={() => setSelectedPolicyId(policy.id)} className={`w-full px-3 py-2 text-left text-sm ${selectedPolicyId === policy.id ? 'bg-muted' : ''}`}><span className="font-medium">{policy.codigo} — {policy.nome}</span><Badge variant="outline" className="ml-2">{policy.status}</Badge></button>)}
              {visiblePolicies.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma política para o vínculo.</p>}
            </div>
            {selectedPolicy && <Button variant="outline" size="sm" disabled={busy || selectedPolicy.status === 'desativada'} onClick={() => execute(() => desativarPolitica(selectedPolicy.id))}>Desativar política</Button>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Nova versão</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">A versão é criada como rascunho. Publicar uma versão fecha a versão publicada anterior dessa política.</p>
            <div className="grid gap-2 sm:grid-cols-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={versionForm.aceite} onChange={(event) => setVersionForm({ ...versionForm, aceite: event.target.checked })} /> Aceite sacado</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={versionForm.cessao} onChange={(event) => setVersionForm({ ...versionForm, cessao: event.target.checked })} /> Cessão no desembolso</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={versionForm.entrega} onChange={(event) => setVersionForm({ ...versionForm, entrega: event.target.checked })} /> Acomp. entrega</label>
            </div>
            <div className="space-y-3">
              {versionForm.requisitos.map((requirement, index) => <div key={`${index}-${requirement.codigo}`} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between"><span className="text-xs font-semibold">Requisito {index + 1}</span><Button type="button" variant="ghost" size="icon" onClick={() => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} /></Button></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input placeholder="Código" value={requirement.codigo} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, codigo: event.target.value } : item) })} />
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={requirement.tipo_documento_codigo} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, tipo_documento_codigo: event.target.value as PoliticaRequisitoInput['tipo_documento_codigo'] } : item) })}><option value="nf_xml">NF XML</option><option value="nf_danfe_pdf">DANFE PDF</option><option value="nf_pedido_compra">Pedido de compra</option><option value="cte">CT-e</option><option value="canhoto">Canhoto</option></select>
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={requirement.escopo} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, escopo: event.target.value as PoliticaRequisitoInput['escopo'] } : item) })}><option value="nf_pre_cessao">NF pré-cessão</option><option value="operacao">Operação</option><option value="pos_cessao">Pós-cessão</option><option value="entrega">Entrega</option></select>
                  <Input placeholder="Formatos: xml,pdf" value={(requirement.formatos_aceitos || []).join(',')} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, formatos_aceitos: event.target.value.split(',') } : item) })} />
                </div>
                <div className="grid gap-2 sm:grid-cols-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={requirement.obrigatorio !== false} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, obrigatorio: event.target.checked } : item) })} /> Obrigatório</label><Input type="number" min="0" placeholder="Prazo (dias)" value={requirement.prazo_dias_corridos ?? ''} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, prazo_dias_corridos: event.target.value === '' ? null : Number(event.target.value) } : item) })} /><select className="h-9 rounded-md border bg-background px-2" value={requirement.responsavel_aprovacao} onChange={(event) => setVersionForm({ ...versionForm, requisitos: versionForm.requisitos.map((item, itemIndex) => itemIndex === index ? { ...item, responsavel_aprovacao: event.target.value as PoliticaRequisitoInput['responsavel_aprovacao'] } : item) })}><option value="gestor">Aprovação: gestor</option><option value="cedente">Aprovação: cedente</option><option value="sacado">Aprovação: sacado</option><option value="sistema">Aprovação: sistema</option></select></div>
              </div>)}
            </div>
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setVersionForm({ ...versionForm, requisitos: [...versionForm.requisitos, emptyRequirement()] })}><Plus size={14} className="mr-1" /> Requisito</Button><Button onClick={createVersion} disabled={busy || !selectedPolicyId} className="gap-2"><FileCog size={15} /> Criar versão</Button></div>
          </CardContent>
        </Card>
      </div>

      {selectedPolicy && <Card><CardHeader><CardTitle className="text-base">Histórico de versões — {selectedPolicy.codigo}</CardTitle></CardHeader><CardContent className="space-y-2">{visibleVersions.map((version) => <div key={version.id} className="rounded-md border px-3 py-2 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium">Versão {version.versao}</span><span className="ml-2 text-xs text-muted-foreground">criada em {new Date(version.vigente_desde).toLocaleDateString('pt-BR')}</span>{version.publicada_em && <Badge className="ml-2">Publicada</Badge>}</div>{!version.publicada_em && <Button size="sm" disabled={busy} onClick={() => execute(() => publicarVersaoPolitica(version.id))}><Send size={13} className="mr-1" /> Publicar</Button>}</div><div className="mt-2 flex flex-wrap gap-1">{requirements.filter((requirement) => requirement.politica_operacional_versao_id === version.id).map((requirement) => <span key={requirement.id} className="rounded bg-muted px-2 py-1 text-[11px]">{requirement.codigo} · {requirement.tipo_documento_codigo} · {requirement.prazo_dias_corridos === null ? 'sem prazo' : `${requirement.prazo_dias_corridos}d`} · upload {requirement.responsavel_upload} · aprova {requirement.responsavel_aprovacao}{requirement.obrigatorio ? '' : ' · opcional'}</span>)}</div></div>)}{visibleVersions.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma versão criada.</p>}</CardContent></Card>}
    </div>
  )
}

'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Activity, PlugZap, Plus, ShieldAlert } from 'lucide-react'
import {
  ativarCredencialAdmin,
  desativarIntegracaoAdmin,
  publicarIntegracaoAdmin,
  revogarCredencialAdmin,
  salvarIntegracaoRascunhoAdmin,
  testarIntegracaoAdmin,
} from '@/app/admin/fundos/configuracoes-tecnicas-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { IntegrationDraftForm } from './integration-draft-form'
import { DetailField, EmptyState, FieldGrid, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  type AdminConfiguracoesTecnicasFundo,
} from '@/lib/admin/configuracoes-tecnicas'
import { executarMutacaoTecnica } from '@/lib/admin/executar-mutacao-tecnica'
import type { VortxConfiguracaoStatus } from '@/lib/admin/vortx-vrs'
import {
  draftIdentityForEditor,
  editIntegrationEditorState,
  initialIntegrationEditorState,
  newIntegrationEditorState,
  type IntegrationEditorState,
} from '@/lib/admin/integracao-editor'
import {
  INTEGRATION_CAPABILITIES,
  INTEGRATION_CAPABILITY_LABELS,
} from '@/lib/integracoes/capabilities'
import { prepararConfiguracaoVortxVrs } from '@/lib/integracoes/configuracao-vortx-vrs'

type Confirmation = { kind: 'activate' | 'revoke' | 'publish' | 'disable' | 'test'; id: string } | null
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Nao informado'


export function FundoIntegracoesTecnicas({ state, execPage, vortxConfig }: { state: AdminConfiguracoesTecnicasFundo; execPage: number; vortxConfig: VortxConfiguracaoStatus[] }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [reason, setReason] = useState('')
  const [createFormGeneration, setCreateFormGeneration] = useState(0)
  const [editor, setEditor] = useState<IntegrationEditorState>(() => initialIntegrationEditorState(state.integracoes[0]?.id))
  const draftCardRef = useRef<HTMLDivElement>(null)
  const selectedIntegrationId = editor.mode === 'edit' ? editor.integrationId : null
  const integration = state.integracoes.find((item) => item.id === selectedIntegrationId)
  const versions = integration?.versoes || []
  const draft = versions.find((item) => item.status === 'rascunho')
  const published = versions.find((item) => item.status === 'publicada')
  const defaultVersion = draft || published
  const confirmContent = useMemo(() => ({
    activate: ['Ativar credencial', 'A credencial passara a poder ser utilizada por versoes tecnicas deste ambiente.', 'Ativar credencial'],
    revoke: ['Revogar credencial', 'A credencial deixa de funcionar imediatamente. Versoes publicadas vinculadas a ela ficarao indisponiveis.', 'Revogar'],
    publish: ['Publicar integracao', 'Esta versao substituira a atual nas novas execucoes. A credencial preparada sera ativada na mesma transacao, substituindo a anterior.', 'Publicar'],
    disable: ['Desativar integracao', 'A versao deixara de estar disponivel para execucoes operacionais.', 'Desativar'],
    test: ['Testar integracao', 'O teste usara exatamente a versao e a credencial vinculada, sem fallback.', 'Executar teste'],
  }), [])

  function beginCreateIntegration() {
    setEditor(newIntegrationEditorState())
    setCreateFormGeneration((current) => current + 1)
    requestAnimationFrame(() => draftCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function refresh(result: Awaited<ReturnType<typeof ativarCredencialAdmin>>) {
    notifications.fromActionResult(result)
    if (result.success) {
      setConfirmation(null)
      setReason('')
      router.refresh()
    }
  }

  function executeConfirmation(mfaCode: string) {
    if (!confirmation) return
    startTransition(async () => {
      const input = { fundoId: state.fundo.id, id: confirmation.id, mfaCode, motivo: reason }
      const result = await executarMutacaoTecnica(() => (
        confirmation.kind === 'activate' ? ativarCredencialAdmin(input)
          : confirmation.kind === 'revoke' ? revogarCredencialAdmin(input)
            : confirmation.kind === 'publish' ? publicarIntegracaoAdmin(input)
              : confirmation.kind === 'disable' ? desativarIntegracaoAdmin(input)
                : testarIntegracaoAdmin(input)
      ))
      refresh(result)
    })
  }

  function saveDraft(formData: FormData, onSaved: () => void) {
    const lifecycle = editor.mode
    const identity = draftIdentityForEditor(editor, draft)
    startTransition(async () => {
      let config: Record<string, unknown> = {}
      try { config = JSON.parse(String(formData.get('configuracao') || '{}')) as Record<string, unknown> } catch { notifications.error('O JSON de configuracao nao e valido.'); return }
      if (formData.get('adapterKey') === 'vortx_vrs') {
        try { config = prepararConfiguracaoVortxVrs({
          configuracao: config,
          codigoCarteira: String(formData.get('codigoCarteira') || ''),
          inclusao: {
            termo: String(formData.get('vrsTermo') || ''),
            cnpj_originador: String(formData.get('vrsCnpjOriginador') || ''),
            tipo_preco: String(formData.get('vrsTipoPreco') || ''),
            metodo_preco: String(formData.get('vrsMetodoPreco') || ''),
            modalidade_operacao: String(formData.get('vrsModalidadeOperacao') || ''),
            registradora: String(formData.get('vrsRegistradora') || ''),
          },
        }) }
        catch (error) { notifications.error(error instanceof Error ? error.message : 'Codigo da carteira VRS invalido.'); return }
      }
      const result = await executarMutacaoTecnica(() => salvarIntegracaoRascunhoAdmin({
        fundoId: state.fundo.id,
        integracaoFundoId: identity.integrationId,
        versaoId: identity.versionId,
        providerKey: formData.get('providerKey'),
        systemName: formData.get('systemName'),
        adapterKey: formData.get('adapterKey'),
        capabilities: formData.getAll('capabilities'),
        ambiente: formData.get('ambiente'),
        endpointBase: formData.get('endpointBase'),
        identificadorCliente: formData.get('identificadorCliente'),
        credencialIntegracaoId: formData.get('credencialIntegracaoId'),
        configuracaoNaoSensivel: config,
        updatedAtEsperado: identity.updatedAt,
        novaCredencial: formData.get('novaCredencial') === 'true' ? {
          nome: formData.get('credentialName'), usuario: formData.get('usuario'),
          senha: formData.get('senha'), mfaCode: formData.get('mfaCode'),
        } : undefined,
      }))
      notifications.fromActionResult(result)
      if (result.success) {
        onSaved()
        if (lifecycle === 'create' && result.data?.integrationId) {
          setEditor(editIntegrationEditorState(result.data.integrationId))
        }
        router.refresh()
      }
    })
  }

  return <div className="space-y-5">
    {!state.fundo.ativo && <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm"><ShieldAlert className="size-5 shrink-0 text-warning-foreground" /><p>Fundo inativo: configuracoes e testes tecnicos continuam permitidos, mas execucoes operacionais permanecem bloqueadas.</p></div>}

    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><PlugZap className="size-5" />Integracoes tecnicas</CardTitle><CardDescription>Fontes versionadas por capability, fundo e ambiente. Nao existe fallback automatico.</CardDescription></div><Button type="button" variant="outline" onClick={beginCreateIntegration}><Plus />Nova integracao</Button></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">{INTEGRATION_CAPABILITIES.map((capability) => { const source = state.integracoes.flatMap((item) => item.versoes.map((version) => ({ item, version }))).find(({ version }) => version.status === 'publicada' && version.active_capabilities.includes(capability)); return <div key={capability} className="rounded-lg border border-border p-3"><p className="text-xs font-semibold text-muted-foreground">{INTEGRATION_CAPABILITY_LABELS[capability]}</p><p className="mt-1 truncate text-sm font-medium">{source?.item.system_name || 'Nao configurada'}</p><p className="truncate text-xs text-muted-foreground">{source?.item.provider_key || 'Sem fonte publicada'}</p></div> })}</div>
        {state.integracoes.length > 0 && <div className="divide-y divide-border rounded-xl border border-border px-4">{state.integracoes.map((item) => { const current = item.versoes.find((version) => version.status === 'publicada'); return <button type="button" key={item.id} onClick={() => setEditor(editIntegrationEditorState(item.id))} className={`flex w-full items-center gap-3 py-3 text-left ${selectedIntegrationId === item.id ? 'text-primary' : ''}`}><div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.system_name}</p><p className="truncate text-xs text-muted-foreground">Provider: {item.provider_key} · {current?.ambiente || 'sem versao publicada'} · {(current?.capabilities || []).map((capability) => INTEGRATION_CAPABILITY_LABELS[capability]).join(', ') || 'sem capabilities publicadas'}</p></div><StatusBadge status={current ? 'ativo' : 'pendente'} label={current ? 'Configurada' : 'Rascunho'} /></button> })}</div>}
        {integration && <FieldGrid><DetailField label="Integracao selecionada" value={`${integration.system_name} / ${integration.provider_key}`} /><DetailField label="Versao publicada" value={published ? `v${published.versao}` : 'Nao publicada'} /><DetailField label="Adapter" value={defaultVersion?.adapter_key || 'Nao implementado'} /><DetailField label="Ambiente" value={defaultVersion?.ambiente || 'Nao definido'} /></FieldGrid>}
      </CardContent>
    </Card>

    <div ref={draftCardRef} className="scroll-mt-6">
      <Card>
        <CardHeader><CardTitle>{editor.mode === 'create' ? 'Nova integracao tecnica' : 'Configuracao da integracao'}</CardTitle><CardDescription>Salvar cria ou atualiza somente o rascunho. Publicacao e teste exigem confirmacao TOTP separada. O teste e tecnico e nao cria remessa nem representa operacao real.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {editor.mode === 'none'
            ? <EmptyState title="Nenhuma integracao selecionada" description="Selecione uma integracao acima ou clique em Nova integracao para iniciar um rascunho." icon={PlugZap} />
            : <IntegrationDraftForm key={`${editor.mode}:${editor.mode === 'create' ? createFormGeneration : 0}:${integration?.id || 'novo'}:${defaultVersion?.id || 'novo'}:${defaultVersion?.updated_at || 'inicial'}`} integration={integration} defaultVersion={defaultVersion} fundCnpj={state.fundo.cnpj} fundId={state.fundo.id} onChanged={() => router.refresh()} vortxConfig={vortxConfig} onRevoke={(id) => setConfirmation({ kind: 'revoke', id })} credentials={state.credenciais} pending={pending} onSubmit={saveDraft} />}
          <div className="divide-y divide-border rounded-xl border border-border px-4">
            {versions.map((version) => { const credencialPreparada = state.credenciais.some((item) => item.id === version.credencial_integracao_id && item.status === 'rascunho'); const testeGenericoIndisponivel = !version.adapter_key || version.adapter_key === 'vortx_vrs' || credencialPreparada; return <div key={version.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-semibold">Versao {version.versao} · {version.ambiente}</p><p className="truncate text-xs text-muted-foreground" title={version.endpoint_base}>{version.endpoint_base || 'Endpoint nao informado'} · {version.capabilities.map((capability) => INTEGRATION_CAPABILITY_LABELS[capability]).join(', ') || 'sem capabilities'}</p></div><StatusBadge status={version.status === 'publicada' ? 'ativo' : version.status === 'rascunho' ? 'pendente' : 'desativada'} label={version.status} /><Button type="button" size="sm" variant="outline" disabled={testeGenericoIndisponivel} title={credencialPreparada ? 'Publique para ativar a credencial antes de testar' : !version.adapter_key ? 'Teste indisponivel: adapter nao implementado' : version.adapter_key === 'vortx_vrs' ? 'Use Testar conexao na autenticacao da integracao' : undefined} onClick={() => setConfirmation({ kind: 'test', id: version.id })}>Testar</Button>{version.status === 'rascunho' && <Button type="button" size="sm" disabled={!version.adapter_key} onClick={() => setConfirmation({ kind: 'publish', id: version.id })}>Publicar</Button>}{version.status === 'publicada' && <Button type="button" size="sm" variant="destructive" onClick={() => setConfirmation({ kind: 'disable', id: version.id })}>Desativar</Button>}</div> })}
          </div>
        </CardContent>
      </Card>
    </div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5" />Execucoes recentes</CardTitle><CardDescription>Testes tecnicos e execucoes operacionais permanecem identificados separadamente.</CardDescription></CardHeader><CardContent>{state.execucoes.length === 0 ? <EmptyState title="Nenhuma execucao" description="Os testes e envios aparecerao aqui." icon={Activity} /> : <><div className="divide-y divide-border">{state.execucoes.map((item) => <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[120px_120px_minmax(0,1fr)_180px]"><StatusBadge status={item.status === 'sucesso' ? 'ativo' : item.status === 'erro' ? 'reprovada' : 'pendente'} label={item.status} /><span className="text-sm font-medium">{item.tipo_execucao}</span><span className="truncate text-sm text-muted-foreground">{item.mensagem_resumida || 'Sem mensagem'}</span><span className="text-sm text-muted-foreground sm:text-right">{date(item.iniciada_em)}</span></div>)}</div><div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm"><span>{state.execucoes_total} execucao(oes)</span><div className="flex gap-2"><Link aria-disabled={execPage === 1} className={`rounded-lg border border-border px-3 py-2 ${execPage === 1 ? 'pointer-events-none opacity-50' : 'hover:bg-muted'}`} href={`/admin/fundos/${state.fundo.id}?tab=integracoes&execPage=${execPage - 1}`}>Anterior</Link><Link aria-disabled={execPage * 20 >= state.execucoes_total} className={`rounded-lg border border-border px-3 py-2 ${execPage * 20 >= state.execucoes_total ? 'pointer-events-none opacity-50' : 'hover:bg-muted'}`} href={`/admin/fundos/${state.fundo.id}?tab=integracoes&execPage=${execPage + 1}`}>Proxima</Link></div></div></>}</CardContent></Card>

    {confirmation && <SensitiveConfirmDialog open onOpenChange={(open) => !open && setConfirmation(null)} title={confirmContent[confirmation.kind][0]} description={confirmContent[confirmation.kind][1]} confirmLabel={confirmContent[confirmation.kind][2]} pendingLabel={confirmation.kind === 'activate' ? 'Ativando...' : undefined} destructive={confirmation.kind === 'revoke' || confirmation.kind === 'disable'} pending={pending} onConfirm={executeConfirmation}>{confirmation.kind === 'revoke' && <div><Label htmlFor="sa3-reason" className="mb-2">Motivo obrigatorio</Label><Input id="sa3-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} /></div>}</SensitiveConfirmDialog>}
  </div>
}

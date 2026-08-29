'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Activity, KeyRound, Loader2, PlugZap, Plus, ShieldAlert } from 'lucide-react'
import {
  ativarCredencialAdmin,
  cadastrarCredencialAdmin,
  desativarIntegracaoAdmin,
  publicarIntegracaoAdmin,
  revogarCredencialAdmin,
  salvarIntegracaoRascunhoAdmin,
  testarIntegracaoAdmin,
} from '@/app/admin/fundos/configuracoes-tecnicas-actions'
import { SensitiveConfirmDialog } from '@/components/admin/sensitive-confirm-dialog'
import { VortxCredentialSection } from '@/components/admin/vortx-vrs-credential-section'
import { DetailField, EmptyState, FieldGrid, StatusBadge } from '@/components/data-display/primitives'
import { useNotifications } from '@/components/notifications/notification-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  obterAcoesCredencial,
  type AdminConfiguracoesTecnicasFundo,
  type AdminCredencialIntegracao,
  type AdminIntegracao,
  type AdminIntegracaoVersao,
} from '@/lib/admin/configuracoes-tecnicas'
import { executarMutacaoTecnica } from '@/lib/admin/executar-mutacao-tecnica'
import type { VortxConfiguracaoStatus } from '@/lib/admin/vortx-vrs'
import {
  adapterSubmissionFields,
  draftIdentityForEditor,
  editIntegrationEditorState,
  initialIntegrationEditorState,
  newIntegrationEditorState,
  type IntegrationEditorState,
} from '@/lib/admin/integracao-editor'
import { ADAPTER_CATALOG, capabilitiesDisponiveisParaAdapter, obterAdapterCatalogo } from '@/lib/integracoes/adapter-catalog'
import {
  INTEGRATION_CAPABILITIES,
  INTEGRATION_CAPABILITY_LABELS,
  type IntegrationCapability,
} from '@/lib/integracoes/capabilities'
import { possuiCapabilityFinanceira } from '@/lib/integracoes/configuracao-financeira'
import { codigoCarteiraDaConfiguracao, configuracaoInclusaoVrs, prepararConfiguracaoVortxVrs } from '@/lib/integracoes/configuracao-vortx-vrs'

type Confirmation = { kind: 'activate' | 'revoke' | 'publish' | 'disable' | 'test'; id: string } | null
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Nao informado'

function IntegrationDraftForm({
  integration,
  defaultVersion,
  fundCnpj,
  activeCredentials,
  pending,
  onSubmit,
}: {
  integration?: AdminIntegracao
  defaultVersion?: AdminIntegracaoVersao
  fundCnpj: string
  activeCredentials: AdminCredencialIntegracao[]
  pending: boolean
  onSubmit: (formData: FormData) => void
}) {
  const [environment, setEnvironment] = useState<'homologacao' | 'producao'>(defaultVersion?.ambiente || 'homologacao')
  const [credentialId, setCredentialId] = useState(defaultVersion?.credencial_integracao_id || '')
  const [endpoint, setEndpoint] = useState(defaultVersion?.endpoint_base || '')
  const [clientId, setClientId] = useState(defaultVersion?.identificador_cliente || '')
  const [config, setConfig] = useState(JSON.stringify(defaultVersion?.configuracao_nao_sensivel || {}, null, 2))
  const [adapterKey, setAdapterKey] = useState(defaultVersion?.adapter_key || '')
  const [capabilities, setCapabilities] = useState<IntegrationCapability[]>(defaultVersion?.capabilities || [])
  const [providerKey, setProviderKey] = useState(integration?.provider_key || 'CUSTOM')
  const [systemName, setSystemName] = useState(integration?.system_name || '')
  const [codigoCarteira, setCodigoCarteira] = useState(codigoCarteiraDaConfiguracao(defaultVersion?.configuracao_nao_sensivel || {}))
  const [vrsInclusao, setVrsInclusao] = useState(() => configuracaoInclusaoVrs(defaultVersion?.configuracao_nao_sensivel || {}))
  const catalogo = obterAdapterCatalogo(adapterKey)
  const locked = Boolean(integration?.versoes.some((item) => item.status !== 'rascunho'))
  const adapterFields = adapterSubmissionFields(locked)
  const compatibleCredentials = activeCredentials.filter((item) => item.ambiente === environment)
  const usesFinancialReports = possuiCapabilityFinanceira(capabilities)
  const normalizedFundCnpj = fundCnpj.replace(/\D/g, '')
  const capabilitiesDisponiveis = capabilitiesDisponiveisParaAdapter(adapterKey)

  function changeAdapter(value: string) {
    setAdapterKey(value)
    const catalogoSelecionado = obterAdapterCatalogo(value)
    if (catalogoSelecionado) {
      setProviderKey(catalogoSelecionado.providerKey)
      setSystemName(catalogoSelecionado.systemName)
      setCapabilities((current) => current.filter((item) => catalogoSelecionado.capabilities.includes(item)))
      if (!catalogoSelecionado.showsClientIdentifier) setClientId('')
    }
  }

  function changeEnvironment(value: 'homologacao' | 'producao') {
    setEnvironment(value)
    const selectedCredential = activeCredentials.find((item) => item.id === credentialId)
    if (!selectedCredential || selectedCredential.ambiente !== value) setCredentialId('')
  }

  function toggleCapability(capability: IntegrationCapability) {
    setCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability])
  }

  return <form action={onSubmit} className="grid gap-3 md:grid-cols-2">
    <label className="space-y-1 md:col-span-2"><Label>Sistema / Adapter</Label><select name={adapterFields.selectName} value={adapterKey} onChange={(event) => changeAdapter(event.target.value)} disabled={locked} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="">Custom (configuracao manual)</option>{ADAPTER_CATALOG.map((item) => <option key={item.adapterKey} value={item.adapterKey}>{item.label}</option>)}</select>{adapterFields.hiddenName && <input type="hidden" name={adapterFields.hiddenName} value={adapterKey} />}</label>
    {!catalogo && <>
      <label className="space-y-1"><Label>Provider</Label><Input name="providerKey" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} readOnly={locked} required /></label>
      <label className="space-y-1"><Label>Nome do sistema</Label><Input name="systemName" value={systemName} onChange={(event) => setSystemName(event.target.value)} readOnly={locked} required /></label>
    </>}
    {catalogo && <>
      <input type="hidden" name="providerKey" value={providerKey} />
      <input type="hidden" name="systemName" value={systemName} />
    </>}
    <fieldset className="space-y-2 md:col-span-2"><legend className="text-sm font-medium">Capabilities</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{INTEGRATION_CAPABILITIES.map((capability) => { const disabled = !capabilitiesDisponiveis.includes(capability); return <label key={capability} className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${disabled ? 'opacity-50' : ''}`}><input type="checkbox" name="capabilities" value={capability} checked={capabilities.includes(capability)} disabled={disabled} onChange={() => toggleCapability(capability)} />{INTEGRATION_CAPABILITY_LABELS[capability]}</label> })}</div></fieldset>
    <label className="space-y-1"><Label>Ambiente</Label><select name="ambiente" value={environment} onChange={(event) => changeEnvironment(event.target.value as 'homologacao' | 'producao')} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="homologacao">Homologacao</option><option value="producao">Producao</option></select></label>
    {catalogo?.credentialKind !== 'vortx_mtls' && <label className="space-y-1"><Label>Credencial ativa</Label><select name="credencialIntegracaoId" value={compatibleCredentials.some((item) => item.id === credentialId) ? credentialId : ''} onChange={(event) => setCredentialId(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="">Nenhuma por enquanto</option>{compatibleCredentials.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>}
    {catalogo?.credentialKind === 'vortx_mtls' && <input type="hidden" name="credencialIntegracaoId" value="" />}
    {(!catalogo || catalogo.showsGenericEndpoint) && <label className="space-y-1 md:col-span-2"><Label>Endpoint</Label><Input name="endpointBase" type="url" placeholder="Pode ser informado antes da publicacao" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>}
    {catalogo && !catalogo.showsGenericEndpoint && <>
      <input type="hidden" name="endpointBase" value="" />
      <label className="space-y-1"><Label>Base URL</Label><Input value={catalogo.defaultBaseUrl[environment] || 'Definida na secao Credenciais'} readOnly aria-readonly="true" /><span className="block text-xs text-muted-foreground">Configurada junto com a credencial, na secao Credenciais abaixo.</span></label>
    </>}
    {(!catalogo || catalogo.showsClientIdentifier) && <label className="space-y-1"><Label>Identificador do cliente</Label><Input name="identificadorCliente" placeholder="Obrigatorio somente para publicar" value={clientId} onChange={(event) => setClientId(event.target.value)} /></label>}
    {catalogo && !catalogo.showsClientIdentifier && <input type="hidden" name="identificadorCliente" value="" />}
    {catalogo?.credentialKind === 'vortx_mtls' && <>
      <label className="space-y-1"><Label>Código da carteira VRS</Label><Input name="codigoCarteira" placeholder="Ex.: CART01" value={codigoCarteira} onChange={(event) => setCodigoCarteira(event.target.value)} /></label>
      <label className="space-y-1"><Label>Termo VRS</Label><Input name="vrsTermo" value={vrsInclusao.termo} onChange={(event) => setVrsInclusao((current) => ({ ...current, termo: event.target.value }))} /></label>
      <label className="space-y-1"><Label>CNPJ do originador</Label><Input name="vrsCnpjOriginador" inputMode="numeric" value={vrsInclusao.cnpj_originador} onChange={(event) => setVrsInclusao((current) => ({ ...current, cnpj_originador: event.target.value.replace(/\D/g, '').slice(0, 14) }))} /></label>
      <label className="space-y-1"><Label>Tipo de preço</Label><select name="vrsTipoPreco" value={vrsInclusao.tipo_preco} onChange={(event) => setVrsInclusao((current) => ({ ...current, tipo_preco: event.target.value }))} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="">Selecione</option><option value="PREFIXADO">Prefixado</option><option value="POSFIXADO">Pos-fixado</option></select></label>
      <label className="space-y-1"><Label>Método de preço</Label><Input name="vrsMetodoPreco" value={vrsInclusao.metodo_preco} onChange={(event) => setVrsInclusao((current) => ({ ...current, metodo_preco: event.target.value }))} /></label>
      <label className="space-y-1"><Label>Modalidade da operação</Label><Input name="vrsModalidadeOperacao" inputMode="numeric" maxLength={4} value={vrsInclusao.modalidade_operacao} onChange={(event) => setVrsInclusao((current) => ({ ...current, modalidade_operacao: event.target.value.replace(/\D/g, '').slice(0, 4) }))} /></label>
      <label className="space-y-1"><Label>Registradora</Label><select name="vrsRegistradora" value={vrsInclusao.registradora} onChange={(event) => setVrsInclusao((current) => ({ ...current, registradora: event.target.value }))} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="">Selecione</option><option value="CERC">CERC</option><option value="B3">B3</option></select></label>
    </>}
    {usesFinancialReports && <label className="space-y-1"><Label>CNPJ do fundo para relatorios financeiros</Label><Input value={normalizedFundCnpj} readOnly aria-readonly="true" /><span className="block text-xs text-muted-foreground">Obtido do cadastro do fundo e preservado automaticamente nesta versao.</span></label>}
    {!catalogo && <label className="space-y-1 md:col-span-2"><Label>Configuracao nao sensivel (JSON)</Label><textarea name="configuracao" value={config} onChange={(event) => setConfig(event.target.value)} className="min-h-24 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" /><span className="block text-xs text-muted-foreground">Parametros tecnicos adicionais. O CNPJ dos relatorios financeiros e controlado pelo cadastro do fundo.</span></label>}
    {catalogo && <input type="hidden" name="configuracao" value={config} />}
    <Button type="submit" className="md:w-fit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Salvar rascunho</Button>
  </form>
}

export function FundoIntegracoesTecnicas({ state, execPage, vortxConfig }: { state: AdminConfiguracoesTecnicasFundo; execPage: number; vortxConfig: VortxConfiguracaoStatus[] }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [reason, setReason] = useState('')
  const [rotationId, setRotationId] = useState<string | null>(null)
  const [createFormGeneration, setCreateFormGeneration] = useState(0)
  const [editor, setEditor] = useState<IntegrationEditorState>(() => initialIntegrationEditorState(state.integracoes[0]?.id))
  const credentialFormRef = useRef<HTMLFormElement>(null)
  const draftCardRef = useRef<HTMLDivElement>(null)
  const selectedIntegrationId = editor.mode === 'edit' ? editor.integrationId : null
  const integration = state.integracoes.find((item) => item.id === selectedIntegrationId)
  const versions = integration?.versoes || []
  const draft = versions.find((item) => item.status === 'rascunho')
  const published = versions.find((item) => item.status === 'publicada')
  const integrationCredentials = state.credenciais.filter((item) => item.integracao_fundo_id === integration?.id)
  const activeCredentials = integrationCredentials.filter((item) => item.status === 'ativa')
  const defaultVersion = draft || published
  const confirmContent = useMemo(() => ({
    activate: ['Ativar credencial', 'A credencial passara a poder ser utilizada por versoes tecnicas deste ambiente.', 'Ativar credencial'],
    revoke: ['Revogar credencial', 'A credencial deixa de funcionar imediatamente. Versoes publicadas vinculadas a ela ficarao indisponiveis.', 'Revogar'],
    publish: ['Publicar integracao', 'Esta versao substituira a versao publicada atual e sera usada nas novas execucoes.', 'Publicar'],
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

  function createCredential(formData: FormData) {
    if (!integration) { notifications.warning('Salve a integracao antes de cadastrar credenciais.'); return }
    startTransition(async () => {
      const result = await executarMutacaoTecnica(() => cadastrarCredencialAdmin({
        fundoId: state.fundo.id,
        integracaoFundoId: integration.id,
        ambiente: formData.get('ambiente'),
        nome: formData.get('nome'),
        usuario: formData.get('usuario'),
        senha: formData.get('senha'),
        credencialAnteriorId: rotationId,
        mfaCode: formData.get('mfaCode'),
      }))
      notifications.fromActionResult(result)
      if (result.success) {
        credentialFormRef.current?.reset()
        setRotationId(null)
        router.refresh()
      }
    })
  }

  function saveDraft(formData: FormData) {
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
      }))
      notifications.fromActionResult(result)
      if (result.success) {
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

    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5" />Credenciais</CardTitle><CardDescription>Somente metadados mascarados sao exibidos. Segredos nunca retornam ao navegador.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {!integration ? <EmptyState title={editor.mode === 'create' ? 'Salve a integracao primeiro' : 'Nenhuma integracao selecionada'} description={editor.mode === 'create' ? 'Depois do primeiro salvamento, as credenciais serao liberadas para esta integracao.' : 'Selecione uma integracao existente ou inicie uma nova configuracao.'} icon={KeyRound} />
        : defaultVersion?.adapter_key === 'vortx_vrs' ? <VortxCredentialSection fundoId={state.fundo.id} vortxConfig={vortxConfig} onChanged={() => router.refresh()} />
        : <>
          {integrationCredentials.length === 0 ? <EmptyState title="Nenhuma credencial" description="Cadastre uma credencial por ambiente para esta integracao." icon={KeyRound} /> : <div className="divide-y divide-border rounded-xl border border-border px-4">
            {integrationCredentials.map((credential) => {
              const foiRotacionada = integrationCredentials.some((item) => item.substituida_por === credential.id)
              const actions = obterAcoesCredencial(credential.status)
              return <div key={credential.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{credential.nome}</p><p className="text-xs text-muted-foreground">{integration.system_name} · {credential.ambiente} · {credential.usuario_mascarado || 'usuario protegido'}</p><p className="text-xs text-muted-foreground">Criada em {date(credential.criada_em)} · ultima rotacao {foiRotacionada ? date(credential.ativada_em) : 'nao realizada'} · ultimo uso {date(credential.ultimo_uso_em)}</p></div>
              <StatusBadge status={credential.status === 'ativa' ? 'ativo' : credential.status === 'revogada' ? 'reprovada' : credential.status === 'substituida' ? 'desativada' : 'pendente'} label={credential.status} />
              {actions.includes('ativar') && <Button type="button" size="sm" variant="outline" onClick={() => setConfirmation({ kind: 'activate', id: credential.id })}>Ativar</Button>}
              {actions.includes('rotacionar') && <Button type="button" size="sm" variant="outline" onClick={() => setRotationId(credential.id)}>Rotacionar</Button>}
              {actions.includes('revogar') && <Button type="button" size="sm" variant="destructive" onClick={() => setConfirmation({ kind: 'revoke', id: credential.id })}>Revogar</Button>}
            </div>})}
          </div>}
          <form ref={credentialFormRef} action={createCredential} className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2">
            <div className="md:col-span-2"><p className="font-semibold">{rotationId ? 'Rotacionar credencial' : 'Nova credencial'}</p>{rotationId && <p className="text-xs text-muted-foreground">A credencial anterior sera substituida somente apos a ativacao da nova.</p>}</div>
            <label className="space-y-1"><Label>Ambiente</Label><select name="ambiente" defaultValue="homologacao" className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="homologacao">Homologacao</option><option value="producao">Producao</option></select></label>
            <label className="space-y-1"><Label>Nome</Label><Input name="nome" required maxLength={120} /></label>
            <label className="space-y-1"><Label>Usuario</Label><Input name="usuario" required autoComplete="off" /></label>
            <label className="space-y-1"><Label>Senha</Label><Input name="senha" type="password" required autoComplete="new-password" /></label>
            <label className="space-y-1"><Label>Codigo TOTP</Label><Input name="mfaCode" required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" /></label>
            <div className="flex items-end gap-2"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{rotationId ? 'Cadastrar rotacao' : 'Cadastrar credencial'}</Button>{rotationId && <Button type="button" variant="outline" onClick={() => setRotationId(null)}>Cancelar</Button>}</div>
          </form>
        </>}
      </CardContent>
    </Card>

    <div ref={draftCardRef} className="scroll-mt-6">
      <Card>
        <CardHeader><CardTitle>{editor.mode === 'create' ? 'Nova integracao tecnica' : 'Configuracao da integracao'}</CardTitle><CardDescription>Salvar cria ou atualiza somente o rascunho. Publicacao e teste exigem confirmacao TOTP separada. O teste e tecnico e nao cria remessa nem representa operacao real.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {editor.mode === 'none'
            ? <EmptyState title="Nenhuma integracao selecionada" description="Selecione uma integracao acima ou clique em Nova integracao para iniciar um rascunho." icon={PlugZap} />
            : <IntegrationDraftForm key={`${editor.mode}:${editor.mode === 'create' ? createFormGeneration : 0}:${integration?.id || 'novo'}:${defaultVersion?.id || 'novo'}:${defaultVersion?.updated_at || 'inicial'}`} integration={integration} defaultVersion={defaultVersion} fundCnpj={state.fundo.cnpj} activeCredentials={activeCredentials} pending={pending} onSubmit={saveDraft} />}
          <div className="divide-y divide-border rounded-xl border border-border px-4">
            {versions.map((version) => { const testeGenericoIndisponivel = !version.adapter_key || version.adapter_key === 'vortx_vrs'; return <div key={version.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-semibold">Versao {version.versao} · {version.ambiente}</p><p className="truncate text-xs text-muted-foreground" title={version.endpoint_base}>{version.endpoint_base || 'Endpoint nao informado'} · {version.capabilities.map((capability) => INTEGRATION_CAPABILITY_LABELS[capability]).join(', ') || 'sem capabilities'}</p></div><StatusBadge status={version.status === 'publicada' ? 'ativo' : version.status === 'rascunho' ? 'pendente' : 'desativada'} label={version.status} /><Button type="button" size="sm" variant="outline" disabled={testeGenericoIndisponivel} title={!version.adapter_key ? 'Teste indisponivel: adapter nao implementado' : version.adapter_key === 'vortx_vrs' ? 'Use Testar conexao na secao Credenciais' : undefined} onClick={() => setConfirmation({ kind: 'test', id: version.id })}>Testar</Button>{version.status === 'rascunho' && <Button type="button" size="sm" disabled={!version.adapter_key} onClick={() => setConfirmation({ kind: 'publish', id: version.id })}>Publicar</Button>}{version.status === 'publicada' && <Button type="button" size="sm" variant="destructive" onClick={() => setConfirmation({ kind: 'disable', id: version.id })}>Desativar</Button>}</div> })}
          </div>
        </CardContent>
      </Card>
    </div>

    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-5" />Execucoes recentes</CardTitle><CardDescription>Testes tecnicos e execucoes operacionais permanecem identificados separadamente.</CardDescription></CardHeader><CardContent>{state.execucoes.length === 0 ? <EmptyState title="Nenhuma execucao" description="Os testes e envios aparecerao aqui." icon={Activity} /> : <><div className="divide-y divide-border">{state.execucoes.map((item) => <div key={item.id} className="grid gap-2 py-3 sm:grid-cols-[120px_120px_minmax(0,1fr)_180px]"><StatusBadge status={item.status === 'sucesso' ? 'ativo' : item.status === 'erro' ? 'reprovada' : 'pendente'} label={item.status} /><span className="text-sm font-medium">{item.tipo_execucao}</span><span className="truncate text-sm text-muted-foreground">{item.mensagem_resumida || 'Sem mensagem'}</span><span className="text-sm text-muted-foreground sm:text-right">{date(item.iniciada_em)}</span></div>)}</div><div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm"><span>{state.execucoes_total} execucao(oes)</span><div className="flex gap-2"><Link aria-disabled={execPage === 1} className={`rounded-lg border border-border px-3 py-2 ${execPage === 1 ? 'pointer-events-none opacity-50' : 'hover:bg-muted'}`} href={`/admin/fundos/${state.fundo.id}?tab=integracoes&execPage=${execPage - 1}`}>Anterior</Link><Link aria-disabled={execPage * 20 >= state.execucoes_total} className={`rounded-lg border border-border px-3 py-2 ${execPage * 20 >= state.execucoes_total ? 'pointer-events-none opacity-50' : 'hover:bg-muted'}`} href={`/admin/fundos/${state.fundo.id}?tab=integracoes&execPage=${execPage + 1}`}>Proxima</Link></div></div></>}</CardContent></Card>

    {confirmation && <SensitiveConfirmDialog open onOpenChange={(open) => !open && setConfirmation(null)} title={confirmContent[confirmation.kind][0]} description={confirmContent[confirmation.kind][1]} confirmLabel={confirmContent[confirmation.kind][2]} pendingLabel={confirmation.kind === 'activate' ? 'Ativando...' : undefined} destructive={confirmation.kind === 'revoke' || confirmation.kind === 'disable'} pending={pending} onConfirm={executeConfirmation}>{confirmation.kind === 'revoke' && <div><Label htmlFor="sa3-reason" className="mb-2">Motivo obrigatorio</Label><Input id="sa3-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={500} /></div>}</SensitiveConfirmDialog>}
  </div>
}

'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VortxCredentialSection } from './vortx-vrs-credential-section'
import { InlineCredentialFields } from './integration-inline-credential-fields'
import type { AdminIntegracao, AdminIntegracaoVersao, AdminCredencialIntegracao } from '@/lib/admin/configuracoes-tecnicas'
import type { VortxConfiguracaoStatus } from '@/lib/admin/vortx-vrs'
import { adapterSubmissionFields } from '@/lib/admin/integracao-editor'
import { credencialCompativel } from '@/lib/admin/credencial-compativel'
import { ADAPTER_CATALOG, capabilitiesDisponiveisParaAdapter, obterAdapterCatalogo } from '@/lib/integracoes/adapter-catalog'
import { INTEGRATION_CAPABILITIES, INTEGRATION_CAPABILITY_LABELS, type IntegrationCapability } from '@/lib/integracoes/capabilities'
import { possuiCapabilityFinanceira } from '@/lib/integracoes/configuracao-financeira'
import { codigoCarteiraDaConfiguracao, configuracaoInclusaoVrs } from '@/lib/integracoes/configuracao-vortx-vrs'

export function IntegrationDraftForm({
  integration,
  defaultVersion,
  fundCnpj,
  fundId,
  credentials,
  pending,
  onSubmit,
  onChanged,
  vortxConfig,
  onRevoke,
}: {
  integration?: AdminIntegracao
  defaultVersion?: AdminIntegracaoVersao
  fundCnpj: string
  fundId: string
  credentials: AdminCredencialIntegracao[]
  pending: boolean
  onSubmit: (formData: FormData, onSaved: () => void) => void
  onChanged: () => void
  vortxConfig: VortxConfiguracaoStatus[]
  onRevoke: (id: string) => void
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
  const compatibleCredentials = credentials.filter((item) => credencialCompativel(item, {
    fundoId: fundId, integrationId: integration?.id || null, providerKey,
    environment, adapterKey, capabilities, permitirRascunho: true,
  }))
  const usesFinancialReports = possuiCapabilityFinanceira(capabilities)
  const normalizedFundCnpj = fundCnpj.replace(/\D/g, '')
  const capabilitiesDisponiveis = capabilitiesDisponiveisParaAdapter(adapterKey)

  const [authMode, setAuthMode] = useState('existing')
  const history = credentials.filter((item) => item.integracao_fundo_id === integration?.id && item.ambiente === environment)

  function changeAdapter(value: string) {
    setCredentialId('')
    setAuthMode('existing')
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
    setAuthMode('existing')
    const selectedCredential = credentials.find((item) => item.id === credentialId)
    if (!selectedCredential || selectedCredential.ambiente !== value) setCredentialId('')
  }

  function toggleCapability(capability: IntegrationCapability) {
    setCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability])
  }

  return <div className="space-y-4"><form onSubmit={(event) => { event.preventDefault(); if (!pending) onSubmit(new FormData(event.currentTarget), () => setAuthMode('existing')) }} className="grid gap-3 md:grid-cols-2">
    <label className="space-y-1 md:col-span-2"><Label>Provedor / sistema</Label><select name={adapterFields.selectName} required={!integration} value={adapterKey} onChange={(event) => changeAdapter(event.target.value)} disabled={locked} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="">{integration && !catalogo ? "Sistema legado (configuracao manual)" : "Selecione o sistema"}</option>{ADAPTER_CATALOG.map((item) => <option key={item.adapterKey} value={item.adapterKey}>{item.label}</option>)}</select>{adapterFields.hiddenName && <input type="hidden" name={adapterFields.hiddenName} value={adapterKey} />}</label>
    {!catalogo && integration && <>
      <label className="space-y-1"><Label>Provider</Label><Input name="providerKey" value={providerKey} onChange={(event) => setProviderKey(event.target.value)} readOnly={locked} required /></label>
      <label className="space-y-1"><Label>Nome do sistema</Label><Input name="systemName" value={systemName} onChange={(event) => setSystemName(event.target.value)} readOnly={locked} required /></label>
    </>}
    {catalogo && <>
      <input type="hidden" name="providerKey" value={providerKey} />
      <input type="hidden" name="systemName" value={systemName} />
    </>}
    <fieldset className="space-y-2 md:col-span-2"><legend className="text-sm font-medium">Funcionalidades da integracao</legend><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{(catalogo ? capabilitiesDisponiveis : integration ? INTEGRATION_CAPABILITIES : []).map((capability) => { const disabled = !capabilitiesDisponiveis.includes(capability); return <label key={capability} className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${disabled ? 'opacity-50' : ''}`}><input type="checkbox" name="capabilities" value={capability} checked={capabilities.includes(capability)} disabled={disabled} onChange={() => toggleCapability(capability)} />{INTEGRATION_CAPABILITY_LABELS[capability]}</label> })}</div></fieldset>
    <label className="space-y-1"><Label>Ambiente</Label><select name="ambiente" value={environment} onChange={(event) => changeEnvironment(event.target.value as 'homologacao' | 'producao')} className="h-10 w-full rounded-lg border border-input bg-background px-3"><option value="homologacao">Homologacao</option><option value="producao">Producao</option></select></label>
    {(catalogo?.credentialKind === 'usuario_senha' || (!catalogo && integration)) && <fieldset className="space-y-3 rounded-xl border border-border p-4 md:col-span-2">
      <legend className="px-1 text-sm font-semibold">Autenticacao · Usuario e senha</legend>
      <p className="text-sm text-muted-foreground">Usa o provedor e o ambiente selecionados acima. As funcionalidades sao definidas somente na integracao.</p>
      <label className="block space-y-1"><Label>Credencial da versao</Label><select name="credencialIntegracaoId" disabled={authMode === 'new'} value={compatibleCredentials.some((item) => item.id === credentialId) ? credentialId : ''} onChange={(event) => setCredentialId(event.target.value)} className="h-10 w-full rounded-lg border border-input bg-background px-3">
        <option value="">Configurar depois</option>{compatibleCredentials.map((item) => <option key={item.id} value={item.id}>{item.nome} · {item.status === 'rascunho' ? 'sera ativada ao publicar' : 'ativa'}</option>)}
      </select></label>
      <input type="hidden" name="novaCredencial" value={authMode === 'new' ? 'true' : 'false'} />
      {authMode === 'new' ? <InlineCredentialFields key={adapterKey + environment} defaultName={systemName + ' - ' + environment} pending={pending} onCancel={() => setAuthMode('existing')} />
        : catalogo && <Button type="button" variant="outline" disabled={pending} onClick={() => setAuthMode('new')}>{credentialId ? 'Substituir / rotacionar credencial' : 'Configurar usuario e senha'}</Button>}
    </fieldset>}
    {catalogo?.credentialKind === 'vortx_mtls' && <input type="hidden" name="credencialIntegracaoId" value="" />}
    {(!catalogo || catalogo.showsGenericEndpoint) && <label className="space-y-1 md:col-span-2"><Label>Endpoint</Label><Input name="endpointBase" type="url" placeholder="Pode ser informado antes da publicacao" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>}
    {catalogo && !catalogo.showsGenericEndpoint && <>
      <input type="hidden" name="endpointBase" value="" />
      <label className="space-y-1"><Label>Base URL</Label><Input value={catalogo.defaultBaseUrl[environment] || 'Definida na autenticacao abaixo'} readOnly aria-readonly="true" /><span className="block text-xs text-muted-foreground">Configurada junto com a credencial, na autenticacao desta integracao.</span></label>
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
    {!catalogo && integration && <label className="space-y-1 md:col-span-2"><Label>Configuracao nao sensivel (JSON)</Label><textarea name="configuracao" value={config} onChange={(event) => setConfig(event.target.value)} className="min-h-24 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs" /><span className="block text-xs text-muted-foreground">Parametros tecnicos adicionais. O CNPJ dos relatorios financeiros e controlado pelo cadastro do fundo.</span></label>}
    {catalogo && <input type="hidden" name="configuracao" value={config} />}
    <Button type="submit" className="md:w-fit" disabled={pending || (!catalogo && !integration)}>{pending && <Loader2 className="animate-spin" />}Salvar rascunho</Button>
  </form>
    {catalogo?.credentialKind === 'vortx_mtls' && <section className="space-y-3" aria-label="Autenticacao da integracao">
      <h3 className="font-semibold">Autenticacao · Key, Secret e certificado mTLS</h3>
      <p className="text-sm text-muted-foreground">A substituicao Vortx e imediata para este fundo e ambiente, mediante confirmacao TOTP. Nao depende da publicacao do rascunho.</p>
      <VortxCredentialSection key={environment} fundoId={fundId} ambiente={environment} vortxConfig={vortxConfig} onChanged={onChanged} />
    </section>}
    {catalogo?.credentialKind === 'usuario_senha' && history.length > 0 && <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer text-sm font-semibold">Historico de autenticacao · {history.length}</summary>
      <div className="divide-y divide-border">{history.map((credential) => <div key={credential.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="min-w-0 text-sm"><p className="break-words">{credential.nome} · {credential.status}</p><p className="text-xs text-muted-foreground">{credential.usuario_mascarado || 'Usuario protegido'}</p></div>
        {credential.status === 'ativa' && <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => onRevoke(credential.id)}>Revogar</Button>}
      </div>)}</div>
    </details>}
  </div>
}

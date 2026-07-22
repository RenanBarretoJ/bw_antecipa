'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ArrowLeft, Banknote, FileCog, Plug, UploadCloud } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarConfiguracaoCnab,
  criarOuAtualizarIntegracaoFundo,
  criarVersaoConfiguracaoCnab,
  atualizarRascunhoIntegracaoFundo,
  ativarCredencialPortalFidc,
  cadastrarCredencialPortalFidc,
  desativarIntegracaoFundo,
  gerarArquivoTesteConfiguracaoCnab,
  importarConfiguracaoCnabLegado,
  listarCredenciaisPortalFidc,
  publicarVersaoConfiguracaoCnab,
  publicarVersaoIntegracaoFundo,
  revogarCredencialPortalFidc,
  testarConexaoIntegracaoFundo,
} from '@/lib/actions/configuracoes-cnab'
import type { Fundo } from '@/types/database'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { DetailField, DetailSection, EmptyState, FieldGrid, LoadingState, StatusBadge } from '@/components/data-display/primitives'
import { formatCNPJ } from '@/lib/utils'
import { PoliticasDoFundo } from '@/components/politicas/PoliticasDoFundo'
import { TemplatesDoFundo } from '@/components/templates/TemplatesDoFundo'

type ConfigRow = {
  id: string
  fundo_id: string
  codigo: string
  nome: string
  descricao: string | null
  status: string
  configuracao_cnab_versoes?: VersionRow[]
}

type VersionRow = {
  id: string
  versao: number
  status: string
  layout: string
  versao_layout: string
  codigo_originador: string
  codigo_empresa: string
  convenio: string
  codigo_banco: string
  banco: string
  agencia: string
  conta: string
  carteira: string
  especie_titulo: string
  tipo_recebivel: string
  conteudo_hash: string
  vigente_desde: string
}

type IntegracaoRow = {
  id: string
  fundo_id: string
  provedor: string
  nome: string
  status: string
  integracao_fundo_versoes?: IntegracaoVersionRow[]
}

type IntegracaoVersionRow = {
  id: string
  versao: number
  ambiente: string
  status: string
  identificador_cliente: string
  codigo_originador: string | null
  endpoint_base: string
  credential_ref: string
  credencial_integracao_id: string | null
  secret_name: string | null
  vault_key: string | null
  vigente_desde: string
  vigente_ate: string | null
  publicada_em: string | null
}

type IntegracaoExecucaoRow = {
  id: string
  fundo_id: string
  integracao_fundo_versao_id: string
  remessa_cnab_id: string | null
  operacao_id: string | null
  tipo_execucao: string
  ambiente: string
  status: string
  tentativa: number
  protocolo_externo: string | null
  codigo_resposta: string | null
  mensagem_resumida: string | null
  erro_categoria: string | null
  duracao_ms: number | null
  iniciada_em: string
  finalizada_em: string | null
}

type CredencialPortalFidcRow = {
  id: string
  fundo_id: string
  integracao_fundo_id: string
  ambiente: 'homologacao' | 'producao'
  nome: string
  status: 'rascunho' | 'ativa' | 'substituida' | 'revogada'
  chave_versao: string
  criada_por: string
  criada_em: string
  ativada_em: string | null
  revogada_em: string | null
  substituida_por: string | null
  ultimo_uso_em: string | null
  created_at: string
  updated_at: string
  criador?: { nome_completo: string; email: string } | null
}

const LEGADO_PADRAO_UI = {
  versaoLayout: 'H/D/T',
  codigoBanco: '611',
  banco: 'BBBBBBBBBBBBBBB',
  agencia: '00000',
  conta: '0000000000',
  digitoConta: '0',
  carteira: '000',
  convenio: '00000000000000000000',
  codigoOriginador: '00000000000000500497',
  codigoEmpresa: '00000000000000500497',
  tipoInscricao: '02',
  numeroInscricao: '00000000000000',
  especieTitulo: '61',
  tipoRecebivel: '01',
  configuracao: {
    literalRemessa: 'REMESSA',
    codigoServico: '01',
    literalServico: 'COBRANCA',
    identificacaoSistema: 'MX',
    sequencialHeaderInicial: 1,
    ocorrencia: '01',
    caracteristicaEspecial: '00',
    modalidadeOperacao: '0000',
    naturezaOperacao: '00',
    origemRecurso: '0000',
    numeroBancoCobranca: '000',
    agenciaDepositaria: '00000',
    condicaoPapeleta: '1',
    emitePapeletaDebAuto: 'N',
    tipoPessoaCedente: '02',
    tipoInscricaoSacado: '02',
    cepSacadoDefault: '00000000',
  },
} as const

const defaultConfigForm = {
  codigo: 'cnab444_legado',
  nome: 'CNAB 444 legado',
  descricao: '',
}

const defaultVersionForm = {
  versaoLayout: LEGADO_PADRAO_UI.versaoLayout,
  codigoBanco: LEGADO_PADRAO_UI.codigoBanco,
  banco: LEGADO_PADRAO_UI.banco,
  agencia: LEGADO_PADRAO_UI.agencia,
  conta: LEGADO_PADRAO_UI.conta,
  digitoConta: LEGADO_PADRAO_UI.digitoConta,
  carteira: LEGADO_PADRAO_UI.carteira,
  convenio: LEGADO_PADRAO_UI.convenio,
  codigoOriginador: LEGADO_PADRAO_UI.codigoOriginador,
  codigoEmpresa: LEGADO_PADRAO_UI.codigoEmpresa,
  tipoInscricao: LEGADO_PADRAO_UI.tipoInscricao,
  numeroInscricao: LEGADO_PADRAO_UI.numeroInscricao,
  especieTitulo: LEGADO_PADRAO_UI.especieTitulo,
  tipoRecebivel: LEGADO_PADRAO_UI.tipoRecebivel,
}

const defaultIntegracaoForm = {
  provedor: 'fromtis' as const,
  ambiente: 'homologacao' as const,
  identificadorCliente: '',
  codigoOriginador: '',
  endpointBase: '',
  credentialRef: '',
  credencialIntegracaoId: '',
  secretName: '',
  vaultKey: '',
}

type IntegracaoForm = {
  provedor: 'fromtis' | 'sinqia'
  ambiente: 'homologacao' | 'producao'
  identificadorCliente: string
  codigoOriginador: string
  endpointBase: string
  credentialRef: string
  credencialIntegracaoId: string
  secretName: string
  vaultKey: string
}

type CredencialForm = {
  ambiente: 'homologacao' | 'producao'
  nome: string
  usuario: string
  senha: string
}

const defaultCredencialForm: CredencialForm = {
  ambiente: 'homologacao' as const,
  nome: '',
  usuario: '',
  senha: '',
}

const tabs = ['dados', 'politica', 'templates', 'cnab', 'integracoes'] as const

export default function FundoDetalhePage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const fundoId = params.id
  const tabParam = searchParams.get('tab')
  const activeTab = tabs.includes(tabParam as (typeof tabs)[number]) ? tabParam as (typeof tabs)[number] : 'dados'
  const [fundo, setFundo] = useState<Fundo | null>(null)
  const [configs, setConfigs] = useState<ConfigRow[]>([])
  const [integracoes, setIntegracoes] = useState<IntegracaoRow[]>([])
  const [execucoesIntegracao, setExecucoesIntegracao] = useState<IntegracaoExecucaoRow[]>([])
  const [credenciaisPortalFidc, setCredenciaisPortalFidc] = useState<CredencialPortalFidcRow[]>([])
  const [selectedConfigId, setSelectedConfigId] = useState('')
  const [editingIntegracaoVersaoId, setEditingIntegracaoVersaoId] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [configForm, setConfigForm] = useState(defaultConfigForm)
  const [versionForm, setVersionForm] = useState(defaultVersionForm)
  const [integracaoForm, setIntegracaoForm] = useState<IntegracaoForm>(defaultIntegracaoForm)
  const [credencialForm, setCredencialForm] = useState(defaultCredencialForm)
  const [motivoRevogacao, setMotivoRevogacao] = useState('')
  const [isPending, startTransition] = useTransition()

  const loadData = useCallback(async () => {
    const supabase = createClient()
    const [{ data: fundoData }, { data: configsData }, { data: integracoesData }, { data: execucoesData }, credenciaisResult] = await Promise.all([
      supabase.from('fundos').select('*').eq('id', fundoId).maybeSingle(),
      supabase.from('configuracoes_cnab').select('*, configuracao_cnab_versoes(*)').eq('fundo_id', fundoId).order('created_at', { ascending: false }),
      supabase.from('integracoes_fundo').select('*, integracao_fundo_versoes(*)').eq('fundo_id', fundoId).order('created_at', { ascending: false }),
      supabase.from('integracao_execucoes').select('*').eq('fundo_id', fundoId).order('iniciada_em', { ascending: false }).limit(12),
      listarCredenciaisPortalFidc(fundoId),
    ])
    setFundo((fundoData || null) as Fundo | null)
    setConfigs(((configsData || []) as ConfigRow[]).map((config) => ({
      ...config,
      configuracao_cnab_versoes: [...(config.configuracao_cnab_versoes || [])].sort((a, b) => b.versao - a.versao),
    })))
    setIntegracoes(((integracoesData || []) as IntegracaoRow[]).map((integracao) => ({
      ...integracao,
      integracao_fundo_versoes: [...(integracao.integracao_fundo_versoes || [])].sort((a, b) => b.versao - a.versao),
    })))
    setExecucoesIntegracao((execucoesData || []) as IntegracaoExecucaoRow[])
    setCredenciaisPortalFidc((credenciaisResult.success ? credenciaisResult.data || [] : []) as CredencialPortalFidcRow[])
    setLoading(false)
  }, [fundoId])

  // Sincroniza o detalhe do fundo com os dados remotos.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData() }, [loadData])

  const selectedConfig = useMemo(() => configs.find((config) => config.id === selectedConfigId) || configs[0] || null, [configs, selectedConfigId])
  const integracaoMetrics = useMemo(() => {
    const totalFinalizadas = execucoesIntegracao.filter((execucao) => execucao.status !== 'iniciada')
    const totalSucesso = totalFinalizadas.filter((execucao) => execucao.status === 'sucesso').length
    const taxaSucesso = totalFinalizadas.length > 0 ? Math.round((totalSucesso / totalFinalizadas.length) * 100) : null

    return {
      ultimoTeste: execucoesIntegracao.find((execucao) => execucao.tipo_execucao === 'teste_conexao') || null,
      ultimoEnvio: execucoesIntegracao.find((execucao) => execucao.tipo_execucao === 'envio_remessa') || null,
      errosRecentes: execucoesIntegracao.filter((execucao) => ['erro', 'timeout'].includes(execucao.status)).length,
      taxaSucesso,
    }
  }, [execucoesIntegracao])

  function notify(result: { success: boolean; message: string }) {
    setMessage(result.message)
    setMessageType(result.success ? 'success' : 'error')
  }

  function runAction(action: () => Promise<{ success: boolean; message: string; data?: unknown }>) {
    startTransition(async () => {
      const result = await action()
      notify(result)
      if (result.success) await loadData()
    })
  }

  async function downloadArquivoTeste(versaoId: string) {
    startTransition(async () => {
      const result = await gerarArquivoTesteConfiguracaoCnab(fundoId, versaoId)
      notify(result)
      if (result.success && result.data) {
        const { nomeArquivo, conteudo } = result.data
        const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = nomeArquivo
        a.click()
        URL.revokeObjectURL(url)
      }
    })
  }

  function editarRascunhoIntegracao(version: IntegracaoVersionRow) {
    setEditingIntegracaoVersaoId(version.id)
    setIntegracaoForm({
      provedor: 'fromtis',
      ambiente: version.ambiente as 'homologacao' | 'producao',
      identificadorCliente: version.identificador_cliente,
      codigoOriginador: version.codigo_originador || '',
      endpointBase: version.endpoint_base,
      credentialRef: version.credential_ref,
      credencialIntegracaoId: version.credencial_integracao_id || '',
      secretName: version.secret_name || '',
      vaultKey: version.vault_key || '',
    })
  }

  function salvarIntegracaoPortalFidc() {
    runAction(async () => {
      const payload = { ...integracaoForm, provedor: 'fromtis' as const, credencialIntegracaoId: integracaoForm.credencialIntegracaoId || null, configuracaoNaoSensivel: {} }
      const action = editingIntegracaoVersaoId
        ? await atualizarRascunhoIntegracaoFundo(fundoId, editingIntegracaoVersaoId, payload)
        : await criarOuAtualizarIntegracaoFundo(fundoId, payload)
      if (action.success) {
        setEditingIntegracaoVersaoId('')
        setIntegracaoForm(defaultIntegracaoForm)
      }
      return action
    })
  }

  function cadastrarCredencial() {
    runAction(async () => {
      const action = await cadastrarCredencialPortalFidc(fundoId, credencialForm)
      if (action.success) setCredencialForm(defaultCredencialForm)
      return action
    })
  }

  function ativarCredencial(credencialId: string) {
    runAction(() => ativarCredencialPortalFidc(fundoId, credencialId, 'Ativacao pelo cadastro do fundo'))
  }

  function revogarCredencial(credencialId: string) {
    runAction(async () => {
      const action = await revogarCredencialPortalFidc(fundoId, credencialId, motivoRevogacao)
      if (action.success) setMotivoRevogacao('')
      return action
    })
  }

  if (loading) return <PageContainer><LoadingState label="Carregando fundo..." /></PageContainer>
  if (!fundo) return <PageContainer><EmptyState title="Fundo não encontrado" action={<Link href="/gestor/fundos" className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted">Voltar para fundos</Link>} /></PageContainer>

  return (
    <PageContainer className="space-y-6">
      <PageHeader
        eyebrow="Cadastro do fundo"
        title={fundo.nome}
        description={`${formatCNPJ(fundo.cnpj)} · ${fundo.ativo ? 'ativo' : 'inativo'}`}
        action={<Link href="/gestor/fundos" className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted"><ArrowLeft size={14} /> Voltar</Link>}
      />

      {message && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${messageType === 'success' ? 'border-success/25 bg-success/10 text-success-foreground' : 'border-destructive/25 bg-destructive/5 text-destructive'}`}>
          {message}
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2">
        {tabs.map((tab) => (
          <Link key={tab} href={`/gestor/fundos/${fundoId}?tab=${tab}`} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            {tab === 'dados' ? 'Dados gerais' : tab === 'politica' ? 'Política operacional' : tab === 'templates' ? 'Templates jurídicos' : tab === 'cnab' ? 'CNAB' : 'Integrações'}
          </Link>
        ))}
      </div>

      {activeTab === 'dados' && (
        <DetailSection title="Dados gerais" icon={Banknote}>
          <FieldGrid>
            <DetailField label="Fundo" value={fundo.nome} />
            <DetailField label="CNPJ" value={formatCNPJ(fundo.cnpj)} />
            <DetailField label="Status" value={<StatusBadge status={fundo.ativo ? 'ativo' : 'inativo'} label={fundo.ativo ? 'Ativo' : 'Inativo'} />} />
            <DetailField label="Administradora" value={fundo.administradora_nome} />
            <DetailField label="Gestora" value={fundo.gestora_nome} />
            <DetailField label="Custodiante" value={fundo.custodiante_nome} />
            <DetailField label="Banco" value={fundo.banco} />
            <DetailField label="Agência" value={fundo.agencia} />
            <DetailField label="Conta vinculada" value={fundo.conta_vinculada} />
          </FieldGrid>
        </DetailSection>
      )}
      {activeTab === 'politica' && (
        <PoliticasDoFundo fundoId={fundoId} showFundoInLabel={false} />
      )}
      {activeTab === 'templates' && (
        <TemplatesDoFundo fundoId={fundoId} showFundoSelector={false} />
      )}

      {activeTab === 'cnab' && (
        <div className="space-y-5">
          <DetailSection title="CNAB do fundo" icon={FileCog} action={<Button type="button" onClick={() => runAction(() => importarConfiguracaoCnabLegado(fundoId))} disabled={isPending}><UploadCloud className="mr-2 size-4" /> Importar legado</Button>}>
            {configs.length === 0 ? (
              <EmptyState title="Nenhuma configuração CNAB" description="Crie uma configuração no contexto deste fundo ou importe a configuração legado." icon={FileCog} />
            ) : (
              <div className="space-y-4">
                {configs.map((config) => (
                  <article key={config.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{config.nome}</h3>
                          <StatusBadge status={config.status} />
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{config.codigo}</span>
                        </div>
                        {config.descricao && <p className="mt-2 text-sm text-muted-foreground">{config.descricao}</p>}
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => setSelectedConfigId(config.id)}>Nova versão</Button>
                    </div>
                    <div className="mt-4 space-y-2">
                      {(config.configuracao_cnab_versoes || []).map((version) => (
                        <div key={version.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">v{version.versao} · {version.layout} {version.versao_layout}</span>
                                <StatusBadge status={version.status} />
                              </div>
                              <p className="text-xs text-muted-foreground">Originador {version.codigo_originador} · Empresa {version.codigo_empresa} · Convênio {version.convenio}</p>
                              <p className="text-xs text-muted-foreground">Banco {version.codigo_banco} · Agência {version.agencia} · Conta {version.conta} · Carteira {version.carteira} · Espécie {version.especie_titulo}</p>
                              <p className="text-xs text-muted-foreground">Hash {version.conteudo_hash.slice(0, 16)}...</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => downloadArquivoTeste(version.id)}>Arquivo de teste</Button>
                              {version.status !== 'publicada' && <Button type="button" size="sm" onClick={() => runAction(() => publicarVersaoConfiguracaoCnab(fundoId, version.id))}>Publicar</Button>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </DetailSection>

          <div className="grid gap-5 xl:grid-cols-2">
            <DetailSection title="Criar configuração CNAB" icon={FileCog}>
              <div className="space-y-3">
                <div><Label>Código</Label><Input value={configForm.codigo} onChange={(e) => setConfigForm((p) => ({ ...p, codigo: e.target.value }))} /></div>
                <div><Label>Nome</Label><Input value={configForm.nome} onChange={(e) => setConfigForm((p) => ({ ...p, nome: e.target.value }))} /></div>
                <div><Label>Descrição</Label><Input value={configForm.descricao} onChange={(e) => setConfigForm((p) => ({ ...p, descricao: e.target.value }))} /></div>
                <Button type="button" onClick={() => runAction(async () => {
                  const action = await criarConfiguracaoCnab({ fundoId, ...configForm })
                  if (action.success) setConfigForm(defaultConfigForm)
                  return action
                })} disabled={isPending} className="w-full">Criar configuração</Button>
              </div>
            </DetailSection>

            <DetailSection title="Nova versão CNAB444" icon={FileCog}>
              <div className="space-y-3">
                <div>
                  <Label>Configuração</Label>
                  <select value={selectedConfig?.id || ''} onChange={(event) => setSelectedConfigId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    {configs.map((config) => <option key={config.id} value={config.id}>{config.nome}</option>)}
                  </select>
                </div>
                {Object.entries(versionForm).map(([field, value]) => (
                  <div key={field}>
                    <Label>{field === 'codigoOriginador' ? 'Código originador' : field}</Label>
                    <Input value={value} onChange={(e) => setVersionForm((p) => ({ ...p, [field]: e.target.value }))} />
                    {field === 'codigoOriginador' && <p className="mt-1 text-xs text-muted-foreground">Específico por fundo. Zeros à esquerda serão preservados. Alteração exige nova versão publicada e não altera remessas antigas.</p>}
                  </div>
                ))}
                <Button type="button" onClick={() => selectedConfig && runAction(() => criarVersaoConfiguracaoCnab(fundoId, selectedConfig.id, { layout: 'cnab444', configuracao: LEGADO_PADRAO_UI.configuracao, ...versionForm }))} disabled={isPending || !selectedConfig} className="w-full">Criar versão</Button>
              </div>
            </DetailSection>
          </div>
        </div>
      )}

      {activeTab === 'integracoes' && (
        <div className="space-y-5">
          <DetailSection title="Credenciais do Portal FIDC" icon={Plug}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <div className="space-y-3">
                {credenciaisPortalFidc.length === 0 ? (
                  <EmptyState title="Nenhuma credencial cadastrada" description="Cadastre usuario e senha do Portal FIDC sem novo deploy. Os valores serao criptografados server-side." icon={Plug} />
                ) : (
                  credenciaisPortalFidc.map((credencial) => (
                    <article key={credencial.id} className="rounded-xl border border-border bg-background p-4 text-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{credencial.nome}</h3>
                            <StatusBadge status={credencial.status} />
                            <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{credencial.ambiente}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">Criada em {new Date(credencial.criada_em).toLocaleString('pt-BR')} por {credencial.criador?.nome_completo || credencial.criador?.email || 'usuario nao informado'}</p>
                          <p className="text-xs text-muted-foreground">Chave {credencial.chave_versao} · Ativada {credencial.ativada_em ? new Date(credencial.ativada_em).toLocaleString('pt-BR') : 'nao'} · Ultimo uso {credencial.ultimo_uso_em ? new Date(credencial.ultimo_uso_em).toLocaleString('pt-BR') : 'sem uso'}</p>
                          {credencial.revogada_em && <p className="text-xs text-destructive">Revogada em {new Date(credencial.revogada_em).toLocaleString('pt-BR')}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {credencial.status !== 'ativa' && credencial.status !== 'revogada' && (
                            <Button type="button" size="sm" onClick={() => ativarCredencial(credencial.id)} disabled={isPending}>Ativar</Button>
                          )}
                          {credencial.status !== 'revogada' && (
                            <Button type="button" size="sm" variant="outline" onClick={() => revogarCredencial(credencial.id)} disabled={isPending || motivoRevogacao.trim().length < 10}>Revogar</Button>
                          )}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <h3 className="font-semibold">Cadastrar nova credencial</h3>
                <p className="mt-1 text-xs text-muted-foreground">A senha nunca sera exibida novamente. Para rotacionar, cadastre uma nova credencial e ative-a.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <Label>Ambiente</Label>
                    <select value={credencialForm.ambiente} onChange={(e) => setCredencialForm((p) => ({ ...p, ambiente: e.target.value as 'homologacao' | 'producao' }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                      <option value="homologacao">Homologacao</option>
                      <option value="producao">Producao</option>
                    </select>
                  </div>
                  <div><Label>Nome de identificacao</Label><Input value={credencialForm.nome} onChange={(e) => setCredencialForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Portal FIDC homologacao" /></div>
                  <div><Label>Usuario</Label><Input value={credencialForm.usuario} onChange={(e) => setCredencialForm((p) => ({ ...p, usuario: e.target.value }))} autoComplete="off" /></div>
                  <div><Label>Senha</Label><Input type="password" value={credencialForm.senha} onChange={(e) => setCredencialForm((p) => ({ ...p, senha: e.target.value }))} autoComplete="new-password" placeholder="Informe nova senha" /></div>
                  <Button type="button" className="w-full" disabled={isPending} onClick={cadastrarCredencial}>Cadastrar credencial criptografada</Button>
                </div>
                <div className="mt-4 border-t border-border pt-4">
                  <Label>Motivo para revogacao</Label>
                  <Input value={motivoRevogacao} onChange={(e) => setMotivoRevogacao(e.target.value)} placeholder="Obrigatorio para revogar credenciais" />
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection title="Portal FIDC" icon={Plug}>
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ultimo teste</p>
                <p className="mt-2 text-sm font-semibold">{integracaoMetrics.ultimoTeste ? new Date(integracaoMetrics.ultimoTeste.iniciada_em).toLocaleString('pt-BR') : 'Sem teste'}</p>
                {integracaoMetrics.ultimoTeste && <StatusBadge status={integracaoMetrics.ultimoTeste.status} />}
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Ultimo envio</p>
                <p className="mt-2 text-sm font-semibold">{integracaoMetrics.ultimoEnvio ? new Date(integracaoMetrics.ultimoEnvio.iniciada_em).toLocaleString('pt-BR') : 'Sem envio'}</p>
                {integracaoMetrics.ultimoEnvio && <StatusBadge status={integracaoMetrics.ultimoEnvio.status} />}
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Taxa de sucesso</p>
                <p className="mt-2 text-sm font-semibold">{integracaoMetrics.taxaSucesso === null ? 'Sem dados' : `${integracaoMetrics.taxaSucesso}%`}</p>
                <p className="text-xs text-muted-foreground">base: execucoes recentes</p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Erros recentes</p>
                <p className="mt-2 text-sm font-semibold">{integracaoMetrics.errosRecentes}</p>
                <p className="text-xs text-muted-foreground">erro ou timeout</p>
              </div>
            </div>
            {integracoes.length === 0 ? (
              <EmptyState title="Nenhuma configuracao Portal FIDC" description="Cadastre a integracao Portal FIDC - Sinqia no contexto deste fundo. As credenciais ficam criptografadas em tabela propria." icon={Plug} />
            ) : (
              <div className="space-y-3">
                {integracoes.map((integracao) => (
                  <article key={integracao.id} className="rounded-xl border border-border bg-background p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">Portal FIDC - Sinqia</h3>
                        <StatusBadge status={integracao.status} />
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">provedor tecnico: {integracao.provedor}</span>
                      </div>
                      {integracao.status !== 'desativada' && (
                        <Button type="button" size="sm" variant="outline" onClick={() => runAction(() => desativarIntegracaoFundo(fundoId, integracao.id))}>Desativar</Button>
                      )}
                    </div>
                    <div className="mt-4 space-y-2">
                      {(integracao.integracao_fundo_versoes || []).map((version) => (
                        <div key={version.id} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 text-sm lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">v{version.versao} - {version.ambiente}</span>
                              <StatusBadge status={version.status} />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">Cliente {version.identificador_cliente} - Originador {version.codigo_originador || 'nao informado'} - Credencial {version.credencial_integracao_id ? credenciaisPortalFidc.find((credencial) => credencial.id === version.credencial_integracao_id)?.nome || 'credencial vinculada' : version.credential_ref}</p>
                            <p className="text-xs text-muted-foreground">Endpoint {version.endpoint_base}</p>
                            <p className="text-xs text-muted-foreground">Vigencia desde {new Date(version.vigente_desde).toLocaleString('pt-BR')}{version.publicada_em ? ` - publicada em ${new Date(version.publicada_em).toLocaleString('pt-BR')}` : ''}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {version.status === 'rascunho' && <Button type="button" size="sm" variant="outline" onClick={() => editarRascunhoIntegracao(version)}>Editar rascunho</Button>}
                            <Button type="button" size="sm" variant="outline" onClick={() => runAction(() => testarConexaoIntegracaoFundo(fundoId, version.id))}>Testar conexao</Button>
                            {version.status !== 'publicada' && version.status !== 'desativada' && <Button type="button" size="sm" onClick={() => runAction(() => publicarVersaoIntegracaoFundo(fundoId, version.id))}>Publicar</Button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection title={editingIntegracaoVersaoId ? 'Editar rascunho Portal FIDC' : 'Nova versao Portal FIDC'} icon={Plug}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Provedor</Label>
                <select value="fromtis" disabled className="mt-2 h-10 w-full rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                  <option value="fromtis">Portal FIDC - Sinqia</option>
                </select>
              </div>
              <div>
                <Label>Ambiente</Label>
                <select value={integracaoForm.ambiente} onChange={(e) => setIntegracaoForm((p) => ({ ...p, ambiente: e.target.value as 'homologacao' | 'producao' }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="homologacao">Homologação</option>
                  <option value="producao">Produção</option>
                </select>
              </div>
              <div><Label>Identificador cliente</Label><Input value={integracaoForm.identificadorCliente} onChange={(e) => setIntegracaoForm((p) => ({ ...p, identificadorCliente: e.target.value }))} /></div>
              <div><Label>Codigo originador do Portal FIDC</Label><Input value={integracaoForm.codigoOriginador} onChange={(e) => setIntegracaoForm((p) => ({ ...p, codigoOriginador: e.target.value }))} /></div>
              <div className="md:col-span-2"><Label>Endpoint base</Label><Input value={integracaoForm.endpointBase} onChange={(e) => setIntegracaoForm((p) => ({ ...p, endpointBase: e.target.value }))} placeholder="https://..." /></div>
              <div>
                <Label>Credencial ativa</Label>
                <select value={integracaoForm.credencialIntegracaoId} onChange={(e) => setIntegracaoForm((p) => ({ ...p, credencialIntegracaoId: e.target.value }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="">Usar fallback temporario por referencia</option>
                  {credenciaisPortalFidc
                    .filter((credencial) => credencial.status === 'ativa' && credencial.ambiente === integracaoForm.ambiente)
                    .map((credencial) => <option key={credencial.id} value={credencial.id}>{credencial.nome} - {credencial.ambiente}</option>)}
                </select>
              </div>
              <div><Label>Referencia de credencial</Label><Input value={integracaoForm.credentialRef} onChange={(e) => setIntegracaoForm((p) => ({ ...p, credentialRef: e.target.value }))} placeholder="portal_fidc_fundo_abc_homologacao" /></div>
              <div><Label>Secret name</Label><Input value={integracaoForm.secretName} onChange={(e) => setIntegracaoForm((p) => ({ ...p, secretName: e.target.value }))} /></div>
              <div><Label>Vault key</Label><Input value={integracaoForm.vaultKey} onChange={(e) => setIntegracaoForm((p) => ({ ...p, vaultKey: e.target.value }))} /></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Preferencialmente selecione uma credencial ativa criptografada. A referencia por variavel de ambiente permanece apenas como fallback temporario de migracao.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" disabled={isPending} onClick={salvarIntegracaoPortalFidc}>{editingIntegracaoVersaoId ? 'Salvar rascunho' : 'Criar versao'}</Button>
              {editingIntegracaoVersaoId && <Button type="button" variant="outline" onClick={() => { setEditingIntegracaoVersaoId(''); setIntegracaoForm(defaultIntegracaoForm) }}>Cancelar edicao</Button>}
            </div>
          </DetailSection>

          <DetailSection title="Execucoes recentes" icon={Plug}>
            {execucoesIntegracao.length === 0 ? (
              <EmptyState title="Nenhuma execucao registrada" description="Testes, envios e consultas do Portal FIDC aparecerao aqui." icon={Plug} />
            ) : (
              <div className="space-y-2">
                {execucoesIntegracao.map((execucao) => (
                  <div key={execucao.id} className="rounded-lg border border-border bg-background p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{execucao.tipo_execucao}</span>
                        <StatusBadge status={execucao.status} />
                        <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">tentativa {execucao.tentativa}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(execucao.iniciada_em).toLocaleString('pt-BR')}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Ambiente {execucao.ambiente}{execucao.protocolo_externo ? ` - Protocolo ${execucao.protocolo_externo}` : ''}{execucao.duracao_ms !== null ? ` - ${execucao.duracao_ms}ms` : ''}</p>
                    {execucao.mensagem_resumida && <p className="mt-1 text-xs text-muted-foreground">{execucao.mensagem_resumida}</p>}
                    {execucao.erro_categoria && <p className="mt-1 text-xs text-destructive">Categoria: {execucao.erro_categoria}</p>}
                  </div>
                ))}
              </div>
            )}
          </DetailSection>
        </div>
      )}
    </PageContainer>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Circle, FileCog, Plug, RotateCcw, ShieldAlert, UploadCloud } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  criarConfiguracaoCnab,
  criarOuAtualizarIntegracaoFundo,
  criarVersaoConfiguracaoCnab,
  atualizarRascunhoIntegracaoFundo,
  ativarCredencialPortalFidc,
  cadastrarCredencialPortalFidc,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  updated_at?: string | null
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
  digito_conta: string
  carteira: string
  especie_titulo: string
  tipo_inscricao: string
  numero_inscricao: string
  tipo_recebivel: string
  conteudo_hash: string
  vigente_desde: string
  vigente_ate?: string | null
  publicada_em?: string | null
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

type VersionForm = {
  versaoLayout: string
  codigoBanco: string
  banco: string
  agencia: string
  conta: string
  digitoConta: string
  carteira: string
  convenio: string
  codigoOriginador: string
  codigoEmpresa: string
  tipoInscricao: string
  numeroInscricao: string
  especieTitulo: string
  tipoRecebivel: string
}

const defaultVersionForm: VersionForm = {
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

const cnabVersionFieldLabels: Record<keyof typeof defaultVersionForm, string> = {
  versaoLayout: 'Versão do layout',
  codigoBanco: 'Código do banco',
  banco: 'Banco',
  agencia: 'Agência',
  conta: 'Conta',
  digitoConta: 'Dígito da conta',
  carteira: 'Carteira',
  convenio: 'Convênio',
  codigoOriginador: 'Código originador',
  codigoEmpresa: 'Código da empresa',
  tipoInscricao: 'Tipo de inscrição',
  numeroInscricao: 'Número de inscrição',
  especieTitulo: 'Espécie do título',
  tipoRecebivel: 'Tipo de recebível',
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

const portalFidcEndpointDefaults: Record<'homologacao' | 'producao', string> = {
  homologacao: '',
  producao: '',
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString('pt-BR') : 'Não registrado'
}

function ambienteLabel(value: string) {
  return value === 'producao' ? 'Produção' : 'Homologação'
}

function statusChecklist(ok: boolean) {
  const Icon = ok ? CheckCircle2 : Circle
  return <Icon size={16} className={ok ? 'text-success' : 'text-muted-foreground'} aria-hidden="true" />
}

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
  const [cnabLayoutForm, setCnabLayoutForm] = useState<'cnab444'>('cnab444')
  const [configCnabModalOpen, setConfigCnabModalOpen] = useState(false)
  const [versaoCnabModalOpen, setVersaoCnabModalOpen] = useState(false)
  const [detalheTecnicoCnab, setDetalheTecnicoCnab] = useState<VersionRow | null>(null)
  const [arquivadasVisiveis, setArquivadasVisiveis] = useState(false)
  const [arquivosTesteGerados, setArquivosTesteGerados] = useState<Set<string>>(new Set())
  const [integracaoForm, setIntegracaoForm] = useState<IntegracaoForm>(defaultIntegracaoForm)
  const [credencialForm, setCredencialForm] = useState(defaultCredencialForm)
  const [motivoRevogacao, setMotivoRevogacao] = useState('')
  const [credencialRevogacao, setCredencialRevogacao] = useState<CredencialPortalFidcRow | null>(null)
  const [credencialRotacaoId, setCredencialRotacaoId] = useState('')
  const [historicoIntegracaoTab, setHistoricoIntegracaoTab] = useState<'versoes' | 'execucoes'>('versoes')
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
  const versoesCnab = useMemo(() => configs.flatMap((config) => config.configuracao_cnab_versoes || []), [configs])
  const versaoCnabPublicada = useMemo(() => versoesCnab.find((version) => version.status === 'publicada') || null, [versoesCnab])
  const configuracaoCnabVigente = useMemo(
    () => configs.find((config) => config.status === 'ativa' && (config.configuracao_cnab_versoes || []).some((version) => version.status === 'publicada')) || configs.find((config) => config.status !== 'desativada') || null,
    [configs],
  )
  const versaoCnabVigente = useMemo(
    () => (configuracaoCnabVigente?.configuracao_cnab_versoes || []).find((version) => version.status === 'publicada') || null,
    [configuracaoCnabVigente],
  )
  const versoesCnabVigentes = useMemo(() => configuracaoCnabVigente?.configuracao_cnab_versoes || [], [configuracaoCnabVigente])
  const configuracoesCnabArquivadas = useMemo(() => configs.filter((config) => config.status === 'desativada'), [configs])
  const legadoImportado = useMemo(() => configs.some((config) => config.codigo === defaultConfigForm.codigo), [configs])
  const cnabDadosBancariosCompletos = !!(versaoCnabVigente?.codigo_banco && versaoCnabVigente.banco && versaoCnabVigente.agencia && versaoCnabVigente.conta && versaoCnabVigente.carteira)
  const versoesPortalFidc = useMemo(() => integracoes.flatMap((integracao) => integracao.integracao_fundo_versoes || []), [integracoes])
  const versaoPortalFidcPublicada = useMemo(() => versoesPortalFidc.find((version) => version.status === 'publicada') || null, [versoesPortalFidc])
  const versaoPortalFidcAtual = useMemo(() => versaoPortalFidcPublicada || versoesPortalFidc[0] || null, [versaoPortalFidcPublicada, versoesPortalFidc])
  const credencialRotacao = useMemo(() => credenciaisPortalFidc.find((credencial) => credencial.id === credencialRotacaoId) || null, [credenciaisPortalFidc, credencialRotacaoId])
  const credencialRevogacaoEmUso = useMemo(
    () => !!credencialRevogacao && versoesPortalFidc.some((version) => version.status === 'publicada' && version.credencial_integracao_id === credencialRevogacao.id),
    [credencialRevogacao, versoesPortalFidc],
  )
  const credenciaisAtivasAmbiente = useMemo(
    () => credenciaisPortalFidc.filter((credencial) => credencial.status === 'ativa' && credencial.ambiente === integracaoForm.ambiente),
    [credenciaisPortalFidc, integracaoForm.ambiente],
  )
  const codigoOriginadorCnab = versaoCnabPublicada?.codigo_originador || ''
  const codigoOriginadorDivergente = !!(codigoOriginadorCnab && versaoPortalFidcAtual?.codigo_originador && versaoPortalFidcAtual.codigo_originador !== codigoOriginadorCnab)
  const integracaoMetrics = useMemo(() => {
    const totalFinalizadas = execucoesIntegracao.filter((execucao) => execucao.status !== 'iniciada')
    const totalSucesso = totalFinalizadas.filter((execucao) => execucao.status === 'sucesso').length
    const taxaSucesso = totalFinalizadas.length > 0 ? Math.round((totalSucesso / totalFinalizadas.length) * 100) : null

    return {
      ultimoTeste: execucoesIntegracao.find((execucao) => execucao.tipo_execucao === 'teste_conexao') || null,
      ultimoEnvio: execucoesIntegracao.find((execucao) => execucao.tipo_execucao === 'envio_remessa') || null,
      ultimoErro: execucoesIntegracao.find((execucao) => ['erro', 'timeout'].includes(execucao.status)) || null,
      errosRecentes: execucoesIntegracao.filter((execucao) => ['erro', 'timeout'].includes(execucao.status)).length,
      taxaSucesso,
    }
  }, [execucoesIntegracao])

  useEffect(() => {
    if (activeTab !== 'integracoes') return
    // Sincroniza o formulário operacional com a versão publicada/rascunho carregada.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIntegracaoForm((prev) => ({
      ...prev,
      codigoOriginador: codigoOriginadorCnab || prev.codigoOriginador,
      identificadorCliente: prev.identificadorCliente || versaoPortalFidcAtual?.identificador_cliente || fundo?.cnpj?.replace(/\D/g, '') || '',
      endpointBase: prev.endpointBase || versaoPortalFidcAtual?.endpoint_base || portalFidcEndpointDefaults[prev.ambiente],
      credentialRef: prev.credentialRef || versaoPortalFidcAtual?.credential_ref || `portal_fidc_${fundoId}_${prev.ambiente}`,
      credencialIntegracaoId: prev.credencialIntegracaoId || versaoPortalFidcAtual?.credencial_integracao_id || '',
      secretName: prev.secretName || versaoPortalFidcAtual?.secret_name || '',
      vaultKey: prev.vaultKey || versaoPortalFidcAtual?.vault_key || '',
    }))
  }, [activeTab, codigoOriginadorCnab, fundo?.cnpj, fundoId, versaoPortalFidcAtual])

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
        setArquivosTesteGerados((prev) => new Set(prev).add(versaoId))
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

  function preencherFormularioVersaoCnab(version?: VersionRow | null) {
    setCnabLayoutForm('cnab444')
    setVersionForm(version ? {
      versaoLayout: version.versao_layout,
      codigoBanco: version.codigo_banco,
      banco: version.banco,
      agencia: version.agencia,
      conta: version.conta,
      digitoConta: version.digito_conta || defaultVersionForm.digitoConta,
      carteira: version.carteira,
      convenio: version.convenio,
      codigoOriginador: version.codigo_originador,
      codigoEmpresa: version.codigo_empresa,
      tipoInscricao: version.tipo_inscricao || defaultVersionForm.tipoInscricao,
      numeroInscricao: version.numero_inscricao || defaultVersionForm.numeroInscricao,
      especieTitulo: version.especie_titulo,
      tipoRecebivel: version.tipo_recebivel,
    } : defaultVersionForm)
  }

  function abrirNovaVersaoCnab(version?: VersionRow | null) {
    const config = configs.find((item) => (item.configuracao_cnab_versoes || []).some((candidate) => candidate.id === version?.id)) || configuracaoCnabVigente || selectedConfig
    if (config) setSelectedConfigId(config.id)
    preencherFormularioVersaoCnab(version || versaoCnabVigente)
    setVersaoCnabModalOpen(true)
  }

  function criarConfiguracaoCnabOperacional() {
    runAction(async () => {
      const action = await criarConfiguracaoCnab({ fundoId, ...configForm })
      if (action.success) {
        const data = action.data as { id?: string } | undefined
        if (data?.id) setSelectedConfigId(data.id)
        setConfigForm(defaultConfigForm)
        setConfigCnabModalOpen(false)
        preencherFormularioVersaoCnab(null)
        setVersaoCnabModalOpen(true)
      }
      return action
    })
  }

  function criarVersaoCnabOperacional() {
    const config = configs.find((item) => item.id === selectedConfigId) || configuracaoCnabVigente || selectedConfig
    if (!config) return
    runAction(async () => {
      const action = await criarVersaoConfiguracaoCnab(fundoId, config.id, { layout: cnabLayoutForm, configuracao: LEGADO_PADRAO_UI.configuracao, ...versionForm })
      if (action.success) setVersaoCnabModalOpen(false)
      return action
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
      const payload = {
        ...integracaoForm,
        provedor: 'fromtis' as const,
        identificadorCliente: integracaoForm.identificadorCliente || versaoPortalFidcAtual?.identificador_cliente || fundo?.cnpj?.replace(/\D/g, '') || fundoId,
        codigoOriginador: codigoOriginadorCnab || integracaoForm.codigoOriginador,
        credentialRef: integracaoForm.credentialRef || versaoPortalFidcAtual?.credential_ref || `portal_fidc_${fundoId}_${integracaoForm.ambiente}`,
        credencialIntegracaoId: integracaoForm.credencialIntegracaoId || null,
        secretName: integracaoForm.secretName || versaoPortalFidcAtual?.secret_name || '',
        vaultKey: integracaoForm.vaultKey || versaoPortalFidcAtual?.vault_key || '',
        configuracaoNaoSensivel: {},
      }
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

  function cadastrarCredencial(options?: { fecharRotacao?: boolean }) {
    runAction(async () => {
      const action = await cadastrarCredencialPortalFidc(fundoId, credencialForm)
      if (action.success) {
        setCredencialForm(defaultCredencialForm)
        if (options?.fecharRotacao) setCredencialRotacaoId('')
      }
      return action
    })
  }

  function ativarCredencial(credencialId: string) {
    runAction(() => ativarCredencialPortalFidc(fundoId, credencialId, 'Ativacao pelo cadastro do fundo'))
  }

  function revogarCredencial(credencialId: string) {
    runAction(async () => {
      const action = await revogarCredencialPortalFidc(fundoId, credencialId, motivoRevogacao)
      if (action.success) {
        setMotivoRevogacao('')
        setCredencialRevogacao(null)
      }
      return action
    })
  }

  function abrirRevogacaoCredencial(credencial: CredencialPortalFidcRow) {
    setCredencialRevogacao(credencial)
    setMotivoRevogacao('')
  }

  function fecharRevogacaoCredencial() {
    setCredencialRevogacao(null)
    setMotivoRevogacao('')
  }

  function alterarAmbienteIntegracao(ambiente: 'homologacao' | 'producao') {
    const versaoMesmoAmbiente = versoesPortalFidc.find((version) => version.ambiente === ambiente)
    const credencialAtiva = credenciaisPortalFidc.find((credencial) => credencial.status === 'ativa' && credencial.ambiente === ambiente)
    setIntegracaoForm((prev) => ({
      ...prev,
      ambiente,
      endpointBase: versaoMesmoAmbiente?.endpoint_base || portalFidcEndpointDefaults[ambiente],
      credencialIntegracaoId: credencialAtiva?.id || '',
      credentialRef: versaoMesmoAmbiente?.credential_ref || `portal_fidc_${fundoId}_${ambiente}`,
    }))
  }

  function prepararRotacaoCredencial(credencial: CredencialPortalFidcRow) {
    setCredencialRotacaoId(credencial.id)
    setCredencialForm({
      ambiente: credencial.ambiente,
      nome: `${credencial.nome} - rotação`,
      usuario: '',
      senha: '',
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
          <DetailSection
            title="Status CNAB 444"
            icon={FileCog}
            action={
              <div className="flex flex-wrap gap-2">
                {!legadoImportado && (
                  <Button type="button" variant="outline" onClick={() => runAction(() => importarConfiguracaoCnabLegado(fundoId))} disabled={isPending}>
                    <UploadCloud className="mr-2 size-4" /> Importar configuração atual
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => setConfigCnabModalOpen(true)} disabled={isPending}>
                  Nova configuração
                </Button>
                <Button type="button" onClick={() => abrirNovaVersaoCnab()} disabled={isPending || !configuracaoCnabVigente}>
                  Nova versão
                </Button>
              </div>
            }
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-3">
                {[
                  { label: 'Configuração publicada', ok: !!versaoCnabVigente },
                  { label: 'Código originador informado', ok: !!versaoCnabVigente?.codigo_originador },
                  { label: 'Dados bancários completos', ok: cnabDadosBancariosCompletos },
                  { label: 'Arquivo de teste gerado nesta sessão', ok: !!versaoCnabVigente && arquivosTesteGerados.has(versaoCnabVigente.id) },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                    {statusChecklist(item.ok)}
                    <span className={item.ok ? 'font-medium text-foreground' : 'text-muted-foreground'}>{item.label}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pronto para operação</p>
                <p className="mt-2 text-2xl font-semibold">{versaoCnabVigente && cnabDadosBancariosCompletos ? 'Sim' : 'Não'}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {versaoCnabVigente
                    ? `Versão vigente: ${versaoCnabVigente.versao}. Alterações exigem nova versão publicada.`
                    : 'Publique uma versão CNAB para liberar geração operacional.'}
                </p>
              </div>
            </div>
          </DetailSection>

          <DetailSection title="Configuração vigente" icon={Banknote}>
            {!configuracaoCnabVigente ? (
              <EmptyState title="CNAB ainda não configurado" description="Importe a configuração atual ou crie uma nova configuração para este fundo." icon={FileCog} />
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{configuracaoCnabVigente.nome}</h3>
                      <StatusBadge status={configuracaoCnabVigente.status} />
                    </div>
                    {configuracaoCnabVigente.descricao && <p className="mt-1 text-sm text-muted-foreground">{configuracaoCnabVigente.descricao}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {versaoCnabVigente && (
                      <Button type="button" size="sm" variant="outline" onClick={() => downloadArquivoTeste(versaoCnabVigente.id)} disabled={isPending}>
                        Arquivo de teste
                      </Button>
                    )}
                    <Button type="button" size="sm" onClick={() => abrirNovaVersaoCnab(versaoCnabVigente)} disabled={isPending}>
                      Nova versão a partir da vigente
                    </Button>
                  </div>
                </div>

                {versaoCnabVigente ? (
                  <div className="grid gap-4 rounded-xl border border-border bg-background p-4 md:grid-cols-3">
                    <DetailField label="Layout" value={`CNAB 444 · ${versaoCnabVigente.versao_layout}`} />
                    <DetailField label="Código originador" value={versaoCnabVigente.codigo_originador} />
                    <DetailField label="Banco" value={`${versaoCnabVigente.codigo_banco} · ${versaoCnabVigente.banco}`} />
                    <DetailField label="Agência" value={versaoCnabVigente.agencia} />
                    <DetailField label="Conta" value={`${versaoCnabVigente.conta}${versaoCnabVigente.digito_conta ? `-${versaoCnabVigente.digito_conta}` : ''}`} />
                    <DetailField label="Carteira" value={versaoCnabVigente.carteira} />
                    <DetailField label="Convênio" value={versaoCnabVigente.convenio} />
                    <DetailField label="Código da empresa" value={versaoCnabVigente.codigo_empresa} />
                    <DetailField label="Espécie" value={versaoCnabVigente.especie_titulo} />
                  </div>
                ) : (
                  <EmptyState title="Nenhuma versão publicada" description="Crie uma versão e publique para tornar esta configuração operacional." icon={FileCog} />
                )}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Histórico de versões" icon={FileCog}>
            {versoesCnabVigentes.length === 0 ? (
              <EmptyState title="Nenhuma versão registrada" description="As versões da configuração vigente aparecerão aqui." icon={FileCog} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="grid grid-cols-[90px_minmax(140px,1fr)_120px_150px_180px] gap-3 border-b border-border bg-muted/50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <span>Versão</span>
                  <span>Layout</span>
                  <span>Status</span>
                  <span>Publicação</span>
                  <span className="text-right">Ações</span>
                </div>
                <div className="divide-y divide-border">
                  {versoesCnabVigentes.map((version) => (
                    <div key={version.id} className="grid grid-cols-[90px_minmax(140px,1fr)_120px_150px_180px] items-center gap-3 px-4 py-3 text-sm">
                      <span className="font-medium">v{version.versao}</span>
                      <span className="text-muted-foreground">CNAB 444 · {version.versao_layout}</span>
                      <StatusBadge status={version.status} />
                      <span className="text-xs text-muted-foreground">{formatDateTime(version.publicada_em)}</span>
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setDetalheTecnicoCnab(version)}>Detalhes</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => downloadArquivoTeste(version.id)} disabled={isPending}>Teste</Button>
                        {version.status === 'rascunho' && (
                          <Button type="button" size="sm" onClick={() => runAction(() => publicarVersaoConfiguracaoCnab(fundoId, version.id))} disabled={isPending}>
                            Publicar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DetailSection>

          <DetailSection
            title="Configurações arquivadas"
            icon={ShieldAlert}
            action={
              <Button type="button" size="sm" variant="outline" onClick={() => setArquivadasVisiveis((value) => !value)}>
                {arquivadasVisiveis ? 'Ocultar' : 'Mostrar'} arquivadas
              </Button>
            }
          >
            {!arquivadasVisiveis ? (
              <p className="text-sm text-muted-foreground">Configurações antigas ficam separadas para evitar edição acidental da configuração operacional.</p>
            ) : configuracoesCnabArquivadas.length === 0 ? (
              <EmptyState title="Nenhuma configuração arquivada" description="Configurações desativadas aparecerão aqui." icon={ShieldAlert} />
            ) : (
              <div className="space-y-3">
                {configuracoesCnabArquivadas.map((config) => {
                  const ultimaVersao = config.configuracao_cnab_versoes?.[0]
                  return (
                    <article key={config.id} className="rounded-xl border border-border bg-background p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{config.nome}</h3>
                            <StatusBadge status={config.status} />
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{config.descricao || 'Configuração arquivada sem descrição.'}</p>
                        </div>
                        {ultimaVersao && (
                          <Button type="button" size="sm" variant="outline" onClick={() => setDetalheTecnicoCnab(ultimaVersao)}>
                            Ver detalhes
                          </Button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </DetailSection>

          <Dialog open={configCnabModalOpen} onOpenChange={setConfigCnabModalOpen}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Nova configuração CNAB</DialogTitle>
                <DialogDescription>Crie a configuração dentro deste fundo. A versão operacional será preenchida no próximo passo.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div><Label>Código interno</Label><Input value={configForm.codigo} onChange={(e) => setConfigForm((p) => ({ ...p, codigo: e.target.value }))} /></div>
                <div><Label>Nome da configuração</Label><Input value={configForm.nome} onChange={(e) => setConfigForm((p) => ({ ...p, nome: e.target.value }))} /></div>
                <div><Label>Descrição</Label><Input value={configForm.descricao} onChange={(e) => setConfigForm((p) => ({ ...p, descricao: e.target.value }))} /></div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfigCnabModalOpen(false)}>Cancelar</Button>
                <Button type="button" onClick={criarConfiguracaoCnabOperacional} disabled={isPending}>Criar e preencher versão</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={versaoCnabModalOpen} onOpenChange={setVersaoCnabModalOpen}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Nova versão CNAB 444</DialogTitle>
                <DialogDescription>Versões publicadas preservam o histórico das remessas antigas. Zeros à esquerda são mantidos como texto.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Configuração do fundo</Label>
                  <select value={selectedConfigId} onChange={(event) => setSelectedConfigId(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    {configs.filter((config) => config.status !== 'desativada').map((config) => <option key={config.id} value={config.id}>{config.nome}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Layout</Label>
                  <select value={cnabLayoutForm} onChange={() => setCnabLayoutForm('cnab444')} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    <option value="cnab444">CNAB 444</option>
                  </select>
                </div>
                {Object.entries(versionForm).map(([field, value]) => (
                  <div key={field}>
                    <Label>{cnabVersionFieldLabels[field as keyof typeof defaultVersionForm]}</Label>
                    <Input value={value} onChange={(e) => setVersionForm((p) => ({ ...p, [field]: e.target.value }))} />
                    {field === 'codigoOriginador' && (
                      <p className="mt-1 text-xs text-muted-foreground">Específico por fundo. Não converta para número: zeros à esquerda serão preservados.</p>
                    )}
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setVersaoCnabModalOpen(false)}>Cancelar</Button>
                <Button type="button" onClick={criarVersaoCnabOperacional} disabled={isPending || !selectedConfigId}>Salvar rascunho</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!detalheTecnicoCnab} onOpenChange={(open) => { if (!open) setDetalheTecnicoCnab(null) }}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Detalhes técnicos da versão</DialogTitle>
                <DialogDescription>Informações de auditoria da versão CNAB selecionada.</DialogDescription>
              </DialogHeader>
              {detalheTecnicoCnab && (
                <div className="grid gap-3 text-sm">
                  <DetailField label="Versão" value={`v${detalheTecnicoCnab.versao}`} />
                  <DetailField label="Status" value={detalheTecnicoCnab.status} />
                  <DetailField label="Vigência" value={`${formatDateTime(detalheTecnicoCnab.vigente_desde)}${detalheTecnicoCnab.vigente_ate ? ` até ${formatDateTime(detalheTecnicoCnab.vigente_ate)}` : ''}`} />
                  <DetailField label="Hash de conteúdo" value={detalheTecnicoCnab.conteudo_hash} />
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {activeTab === 'integracoes' && (
        <div className="space-y-5">
          <DetailSection
            title="Portal FIDC — Sinqia"
            icon={Plug}
            action={
              <div className="flex flex-wrap gap-2">
                {versaoPortalFidcAtual && (
                  <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => runAction(() => testarConexaoIntegracaoFundo(fundoId, versaoPortalFidcAtual.id))}>
                    Testar conexão
                  </Button>
                )}
                {versaoPortalFidcAtual && versaoPortalFidcAtual.status !== 'publicada' && versaoPortalFidcAtual.status !== 'desativada' && (
                  <Button type="button" size="sm" disabled={isPending} onClick={() => runAction(() => publicarVersaoIntegracaoFundo(fundoId, versaoPortalFidcAtual.id))}>
                    Publicar integração
                  </Button>
                )}
              </div>
            }
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    { label: 'Credencial cadastrada', ok: credenciaisAtivasAmbiente.length > 0 },
                    { label: 'Configuração CNAB publicada', ok: !!versaoCnabPublicada },
                    { label: 'Código originador válido', ok: !!codigoOriginadorCnab && !codigoOriginadorDivergente },
                    { label: 'Teste de conexão validado', ok: integracaoMetrics.ultimoTeste?.status === 'sucesso' },
                    { label: 'Integração publicada', ok: !!versaoPortalFidcPublicada },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                      {statusChecklist(item.ok)}
                      <span className={item.ok ? 'font-medium text-foreground' : 'text-muted-foreground'}>{item.label}</span>
                    </div>
                  ))}
                </div>
                {codigoOriginadorDivergente && (
                  <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning-foreground">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">Código originador divergente</p>
                      <p className="mt-1 text-muted-foreground">CNAB publicado: {codigoOriginadorCnab}. Portal FIDC atual: {versaoPortalFidcAtual?.codigo_originador || 'não informado'}. Salvar uma nova configuração usará automaticamente o código da versão CNAB publicada.</p>
                    </div>
                  </div>
                )}
              </div>
              <dl className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm">
                <DetailField label="Último teste" value={integracaoMetrics.ultimoTeste ? `${formatDateTime(integracaoMetrics.ultimoTeste.iniciada_em)} · ${integracaoMetrics.ultimoTeste.status}` : 'Pendente'} />
                <DetailField label="Último envio" value={integracaoMetrics.ultimoEnvio ? `${formatDateTime(integracaoMetrics.ultimoEnvio.iniciada_em)} · ${integracaoMetrics.ultimoEnvio.status}` : 'Sem envio'} />
                <DetailField label="Taxa de sucesso" value={integracaoMetrics.taxaSucesso === null ? 'Sem dados' : `${integracaoMetrics.taxaSucesso}%`} />
                <DetailField label="Último erro" value={integracaoMetrics.ultimoErro?.mensagem_resumida || integracaoMetrics.ultimoErro?.erro_categoria || 'Sem erro recente'} />
              </dl>
            </div>
          </DetailSection>

          <DetailSection title="Credenciais" icon={Plug}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
              <div className="space-y-3">
                {credenciaisPortalFidc.length === 0 ? (
                  <EmptyState title="Nenhuma credencial cadastrada" description="Cadastre as credenciais do Portal FIDC para este fundo." icon={Plug} />
                ) : (
                  credenciaisPortalFidc.map((credencial) => (
                    <article key={credencial.id} className="rounded-xl border border-border bg-background p-4 text-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{credencial.nome}</h3>
                            <StatusBadge status={credencial.status} />
                            <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{ambienteLabel(credencial.ambiente)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">Criada em {formatDateTime(credencial.criada_em)}{credencial.criador ? ` por ${credencial.criador.nome_completo || credencial.criador.email}` : ''}</p>
                          <p className="text-xs text-muted-foreground">Último uso: {formatDateTime(credencial.ultimo_uso_em)}</p>
                          {credencial.revogada_em && <p className="text-xs text-destructive">Revogada em {formatDateTime(credencial.revogada_em)}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={() => prepararRotacaoCredencial(credencial)} disabled={isPending}>
                            <RotateCcw className="mr-1.5 size-3.5" /> Rotacionar
                          </Button>
                          {credencial.status !== 'ativa' && credencial.status !== 'revogada' && (
                            <Button type="button" size="sm" onClick={() => ativarCredencial(credencial.id)} disabled={isPending}>Ativar</Button>
                          )}
                          {credencial.status !== 'revogada' && (
                            <Button type="button" size="sm" variant="outline" onClick={() => abrirRevogacaoCredencial(credencial)} disabled={isPending}>Revogar</Button>
                          )}
                        </div>
                      </div>
                      {credencialRevogacao?.id === credencial.id && (
                        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive sm:flex-row sm:items-center sm:justify-between">
                          <span>Revogação selecionada. Confirme o motivo no modal para concluir.</span>
                          <Button type="button" size="xs" variant="destructive" onClick={() => abrirRevogacaoCredencial(credencial)}>Abrir confirmação</Button>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <h3 className="font-semibold">Cadastrar nova credencial</h3>
                <p className="mt-1 text-xs text-muted-foreground">A senha nunca será exibida novamente. Para rotacionar, cadastre uma nova credencial e ative-a.</p>
                <div className="mt-4 space-y-3">
                  <div>
                    <Label>Ambiente</Label>
                    <select value={credencialForm.ambiente} onChange={(e) => setCredencialForm((p) => ({ ...p, ambiente: e.target.value as 'homologacao' | 'producao' }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                      <option value="homologacao">Homologação</option>
                      <option value="producao">Produção</option>
                    </select>
                  </div>
                  <div><Label>Nome</Label><Input value={credencialForm.nome} onChange={(e) => setCredencialForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Portal FIDC homologação" /></div>
                  <div><Label>Usuário</Label><Input value={credencialForm.usuario} onChange={(e) => setCredencialForm((p) => ({ ...p, usuario: e.target.value }))} autoComplete="off" /></div>
                  <div><Label>Senha</Label><Input type="password" value={credencialForm.senha} onChange={(e) => setCredencialForm((p) => ({ ...p, senha: e.target.value }))} autoComplete="new-password" placeholder="Informe nova senha" /></div>
                  <Button type="button" className="w-full" disabled={isPending} onClick={() => cadastrarCredencial()}>Cadastrar credencial</Button>
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection title="Configuração do Portal FIDC" icon={Plug}>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Ambiente</Label>
                <select value={integracaoForm.ambiente} onChange={(e) => alterarAmbienteIntegracao(e.target.value as 'homologacao' | 'producao')} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="homologacao">Homologação</option>
                  <option value="producao">Produção</option>
                </select>
              </div>
              <div>
                <Label>Credencial ativa</Label>
                <select value={integracaoForm.credencialIntegracaoId} onChange={(e) => setIntegracaoForm((p) => ({ ...p, credencialIntegracaoId: e.target.value }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                  <option value="">Selecione uma credencial ativa</option>
                  {credenciaisAtivasAmbiente.map((credencial) => <option key={credencial.id} value={credencial.id}>{credencial.nome}</option>)}
                </select>
              </div>
              <div className="md:col-span-2"><Label>Endpoint</Label><Input value={integracaoForm.endpointBase} onChange={(e) => setIntegracaoForm((p) => ({ ...p, endpointBase: e.target.value }))} placeholder="https://..." /></div>
              <div>
                <Label>Código originador</Label>
                <div className="mt-2 rounded-md border border-input bg-muted px-3 py-2 text-sm font-semibold text-foreground">{codigoOriginadorCnab || 'CNAB publicado não encontrado'}</div>
                <p className="mt-1 text-xs text-muted-foreground">{versaoCnabPublicada ? `Origem: CNAB versão ${versaoCnabPublicada.versao}` : 'Publique uma configuração CNAB para habilitar o código originador.'}</p>
              </div>
              <div>
                <Label>Versão atual</Label>
                <div className="mt-2 rounded-md border border-input bg-muted px-3 py-2 text-sm text-foreground">
                  {versaoPortalFidcAtual ? (
                    <span className="font-semibold">v{versaoPortalFidcAtual.versao} · {versaoPortalFidcAtual.status}</span>
                  ) : 'Nenhuma versão criada'}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{versaoPortalFidcAtual?.publicada_em ? `Publicada em ${formatDateTime(versaoPortalFidcAtual.publicada_em)}` : 'Salvar rascunho cria ou atualiza a configuração deste fundo.'}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" disabled={isPending || !codigoOriginadorCnab || !integracaoForm.endpointBase || !integracaoForm.credencialIntegracaoId} onClick={salvarIntegracaoPortalFidc}>Salvar rascunho</Button>
              {versaoPortalFidcAtual && <Button type="button" variant="outline" disabled={isPending} onClick={() => runAction(() => testarConexaoIntegracaoFundo(fundoId, versaoPortalFidcAtual.id))}>Testar conexão</Button>}
              {versaoPortalFidcAtual && versaoPortalFidcAtual.status !== 'publicada' && versaoPortalFidcAtual.status !== 'desativada' && <Button type="button" disabled={isPending} onClick={() => runAction(() => publicarVersaoIntegracaoFundo(fundoId, versaoPortalFidcAtual.id))}>Publicar</Button>}
              {editingIntegracaoVersaoId && <Button type="button" variant="outline" onClick={() => { setEditingIntegracaoVersaoId(''); setIntegracaoForm(defaultIntegracaoForm) }}>Cancelar edicao</Button>}
            </div>
            {(!codigoOriginadorCnab || !integracaoForm.credencialIntegracaoId) && (
              <p className="mt-3 text-xs text-muted-foreground">Para salvar, publique a configuração CNAB e selecione uma credencial ativa do mesmo ambiente.</p>
            )}
          </DetailSection>

          <DetailSection title="Histórico" icon={Plug}>
            <div className="mb-4 flex gap-2">
              {(['versoes', 'execucoes'] as const).map((tab) => (
                <button key={tab} type="button" onClick={() => setHistoricoIntegracaoTab(tab)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${historicoIntegracaoTab === tab ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                  {tab === 'versoes' ? 'Versões' : 'Execuções'}
                </button>
              ))}
            </div>
            {historicoIntegracaoTab === 'versoes' ? (
              versoesPortalFidc.length === 0 ? (
                <EmptyState title="Nenhuma versão registrada" description="Salve a primeira configuração para iniciar o histórico do Portal FIDC." icon={Plug} />
              ) : (
                <div className="space-y-2">
                  {versoesPortalFidc.map((version) => (
                    <div key={version.id} className="rounded-lg border border-border bg-background p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">Versão {version.versao}</span>
                          <StatusBadge status={version.status} />
                          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{ambienteLabel(version.ambiente)}</span>
                        </div>
                        {version.status === 'rascunho' && <Button type="button" size="sm" variant="outline" onClick={() => editarRascunhoIntegracao(version)}>Editar</Button>}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">Vigência: {formatDateTime(version.vigente_desde)}{version.vigente_ate ? ` até ${formatDateTime(version.vigente_ate)}` : ''}</p>
                      <p className="text-xs text-muted-foreground">Publicação: {formatDateTime(version.publicada_em)}</p>
                    </div>
                  ))}
                </div>
              )
            ) : (
              execucoesIntegracao.length === 0 ? (
                <EmptyState title="Nenhuma execução registrada" description="Testes, envios e consultas do Portal FIDC aparecerão aqui." icon={Plug} />
              ) : (
                <div className="space-y-2">
                  {execucoesIntegracao.map((execucao) => (
                    <div key={execucao.id} className="rounded-lg border border-border bg-background p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{execucao.tipo_execucao.replaceAll('_', ' ')}</span>
                          <StatusBadge status={execucao.status} />
                          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{ambienteLabel(execucao.ambiente)}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatDateTime(execucao.iniciada_em)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">Protocolo: {execucao.protocolo_externo || 'não informado'} · Tempo: {execucao.duracao_ms !== null ? `${execucao.duracao_ms}ms` : 'não medido'}</p>
                      {execucao.mensagem_resumida && <p className="mt-1 text-xs text-muted-foreground">Mensagem: {execucao.mensagem_resumida}</p>}
                    </div>
                  ))}
                </div>
              )
            )}
          </DetailSection>

          <Dialog open={!!credencialRotacaoId} onOpenChange={(open) => { if (!open) { setCredencialRotacaoId(''); setCredencialForm(defaultCredencialForm) } }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <RotateCcw size={20} aria-hidden="true" />
                </div>
                <DialogTitle>Rotacionar credencial</DialogTitle>
                <DialogDescription>
                  Cadastre uma nova credencial para substituir a atual. A credencial anterior não será revogada automaticamente; depois de validar a nova, ative-a e revogue a antiga se necessário.
                </DialogDescription>
              </DialogHeader>
              {credencialRotacao && (
                <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                  <p className="font-semibold">{credencialRotacao.nome}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{ambienteLabel(credencialRotacao.ambiente)} · último uso: {formatDateTime(credencialRotacao.ultimo_uso_em)}</p>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Ambiente</Label>
                  <select value={credencialForm.ambiente} onChange={(e) => setCredencialForm((p) => ({ ...p, ambiente: e.target.value as 'homologacao' | 'producao' }))} className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
                    <option value="homologacao">Homologação</option>
                    <option value="producao">Produção</option>
                  </select>
                </div>
                <div><Label>Nome</Label><Input value={credencialForm.nome} onChange={(e) => setCredencialForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Portal FIDC produção - rotação" /></div>
                <div><Label>Usuário</Label><Input value={credencialForm.usuario} onChange={(e) => setCredencialForm((p) => ({ ...p, usuario: e.target.value }))} autoComplete="off" /></div>
                <div><Label>Nova senha</Label><Input type="password" value={credencialForm.senha} onChange={(e) => setCredencialForm((p) => ({ ...p, senha: e.target.value }))} autoComplete="new-password" placeholder="Informe a nova senha" /></div>
              </div>
              <div className="rounded-xl border border-info/25 bg-info/10 p-3 text-xs text-muted-foreground">
                Próximo passo recomendado: cadastrar a nova credencial, ativá-la, testar conexão e só então revogar a credencial antiga.
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setCredencialRotacaoId(''); setCredencialForm(defaultCredencialForm) }}>Cancelar</Button>
                <Button type="button" disabled={isPending || !credencialForm.nome.trim() || !credencialForm.usuario.trim() || !credencialForm.senha} onClick={() => cadastrarCredencial({ fecharRotacao: true })}>Cadastrar nova credencial</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={!!credencialRevogacao} onOpenChange={(open) => { if (!open) fecharRevogacaoCredencial() }}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                  <ShieldAlert size={20} aria-hidden="true" />
                </div>
                <DialogTitle>Revogar credencial</DialogTitle>
                <DialogDescription>Essa credencial deixará de aparecer como opção ativa para novas configurações do Portal FIDC.</DialogDescription>
              </DialogHeader>
              {credencialRevogacao && (
                <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{credencialRevogacao.nome}</p>
                    <StatusBadge status={credencialRevogacao.status} />
                    <span className="rounded-full bg-background px-2 py-1 text-xs text-muted-foreground">{ambienteLabel(credencialRevogacao.ambiente)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Criada em {formatDateTime(credencialRevogacao.criada_em)} · último uso: {formatDateTime(credencialRevogacao.ultimo_uso_em)}</p>
                </div>
              )}
              <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                {credencialRevogacaoEmUso
                  ? 'Esta credencial está vinculada à configuração publicada do Portal FIDC. Para revogar, primeiro publique uma nova configuração usando outra credencial ativa.'
                  : 'Antes de revogar, confirme que nenhuma configuração publicada depende operacionalmente desta credencial ou que já existe uma credencial substituta ativa.'}
              </div>
              <div className="space-y-2">
                <Label>Motivo obrigatório</Label>
                <textarea
                  value={motivoRevogacao}
                  onChange={(e) => setMotivoRevogacao(e.target.value)}
                  placeholder="Ex.: credencial substituída por rotação de senha em homologação."
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres. Esse motivo ficará registrado para auditoria.</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={fecharRevogacaoCredencial}>Cancelar</Button>
                <Button type="button" variant="destructive" disabled={isPending || !credencialRevogacao || credencialRevogacaoEmUso || motivoRevogacao.trim().length < 10} onClick={() => credencialRevogacao && revogarCredencial(credencialRevogacao.id)}>Confirmar revogação</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </PageContainer>
  )
}

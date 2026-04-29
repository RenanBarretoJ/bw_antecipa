'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { analisarDocumento, aprovarCedente, reprovarCedente, solicitarAtualizacaoDocumento, toggleEscrowCedente, aprovarAlteracaoCedente, reprovarAlteracaoCedente, convidarUsuarioCedente, revogarAcessoCedente } from '@/lib/actions/gestor'
import { salvarTaxasCedente } from '@/lib/actions/operacao'
import { salvarContratoAssinado } from '@/lib/actions/cedente'
import { formatCNPJ, formatDate } from '@/lib/utils'
import { buckets } from '@/lib/storage'
import { ArrowLeft, CheckCircle, XCircle, FileText, Eye, X, Plus, Trash2, Settings, RefreshCw, Loader2, GitCompare, Users, UserPlus, UserX } from 'lucide-react'
import { calcularExpiracaoDoc } from '@/lib/documentos'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BotaoDownloadContrato } from '@/components/contratos/BotaoDownloadContrato'
import { UploadDocumentoAssinado } from '@/components/contratos/UploadDocumentoAssinado'

interface CedenteDetail {
  id: string; cnpj: string; razao_social: string; nome_fantasia: string | null
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null
  bairro: string | null; cidade: string | null; estado: string | null
  telefone_comercial: string | null; email_comercial: string | null; cnae: string | null
  banco: string | null; agencia: string | null; conta: string | null; tipo_conta: string | null
  status: string; habilitar_escrow: boolean; created_at: string
  contrato_url: string | null
  contrato_assinado_url: string | null
}

interface DocRecord {
  id: string; tipo: string; versao: number; status: string
  nome_arquivo: string | null; url_arquivo: string | null
  motivo_reprovacao: string | null; created_at: string
  representante_id: string | null
  analisado_em: string | null
  atualizacao_solicitada_em: string | null
}

interface RepresentanteRecord {
  id: string; nome: string; cpf: string; rg: string; cargo: string
  email: string; telefone: string; principal: boolean
}

interface AcessoCedenteRecord {
  id: string
  user_id: string
  perfil: 'administrador' | 'operador'
  ativo: boolean
  created_at: string
  profiles: { nome_completo: string; email: string } | null
}

interface AlteracaoPendente {
  id: string
  dados_atuais: Record<string, unknown>
  dados_propostos: Record<string, unknown>
  representantes_atuais: RepresentanteRecord[]
  representantes_propostos: RepresentanteRecord[]
  status: string
  solicitado_em: string
}

const tipoLabels: Record<string, string> = {
  contrato_social: 'Contrato Social', cartao_cnpj: 'Cartao CNPJ',
  rg_cpf: 'RG e CPF', comprovante_endereco: 'Comprovante de Endereco',
  extrato_bancario: 'Comprovante de Faturamento', balanco_patrimonial: 'Balanco Patrimonial',
  dre: 'DRE', procuracao: 'Procuracao',
}

const tipoLabelsRep: Record<string, string> = {
  rg_cpf: 'RG e CPF',
  comprovante_de_renda: 'Comprovante de Renda',
  comprovante_endereco: 'Comprovante de Residencia (ultimos 90 dias)',
  procuracao: 'Procuracao',
}

const statusBadgeVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  aguardando_envio: 'secondary',
  enviado: 'default',
  em_analise: 'outline',
  aprovado: 'default',
  reprovado: 'destructive',
}

const statusColors: Record<string, string> = {
  aguardando_envio: 'bg-gray-100 text-gray-600',
  enviado: 'bg-blue-100 text-blue-700',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovado: 'bg-green-100 text-green-700',
  reprovado: 'bg-red-100 text-red-700',
}

export default function CedenteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [cedente, setCedente] = useState<CedenteDetail | null>(null)
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [representantes, setRepresentantes] = useState<RepresentanteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [modal, setModal] = useState<{ doc: DocRecord; previewUrl: string } | null>(null)
  const [motivoReprovacao, setMotivoReprovacao] = useState('')
  const [motivoCadastro, setMotivoCadastro] = useState('')
  const [showReprovarCadastro, setShowReprovarCadastro] = useState(false)

  const [requestingUpdate, setRequestingUpdate] = useState<string | null>(null)

  // Taxas
  const [taxas, setTaxas] = useState<Array<{ prazo_min: number; prazo_max: number; taxa_percentual: number }>>([])
  const [savingTaxas, setSavingTaxas] = useState(false)
  const [taxasMessage, setTaxasMessage] = useState('')

  // Escrow
  const [togglingEscrow, setTogglingEscrow] = useState(false)
  const [escrowMessage, setEscrowMessage] = useState('')

  // Alteração cadastral
  const [alteracao, setAlteracao] = useState<AlteracaoPendente | null>(null)
  const [motivoRepAlteracao, setMotivoRepAlteracao] = useState('')
  const [showReprovarAlteracao, setShowReprovarAlteracao] = useState(false)
  const [loadingAlteracao, setLoadingAlteracao] = useState(false)
  const [alteracaoMessage, setAlteracaoMessage] = useState('')

  // Acessos
  const [acessos, setAcessos] = useState<AcessoCedenteRecord[]>([])
  const [showConviteModal, setShowConviteModal] = useState(false)
  const [emailConvite, setEmailConvite] = useState('')
  const [perfilConvite, setPerfilConvite] = useState<'administrador' | 'operador'>('operador')
  const [loadingConvite, setLoadingConvite] = useState(false)
  const [conviteMessage, setConviteMessage] = useState('')
  const [revogandoId, setRevogandoId] = useState<string | null>(null)

  const loadData = async () => {
    const supabase = createClient()

    const { data: c } = await supabase.from('cedentes').select('*').eq('id', id).single()
    setCedente(c as CedenteDetail | null)

    const { data: reps } = await supabase
      .from('representantes')
      .select('id, nome, cpf, rg, cargo, email, telefone, principal')
      .eq('cedente_id', id)
      .order('principal', { ascending: false })

    setRepresentantes((reps || []) as RepresentanteRecord[])

    const { data: d } = await supabase
      .from('documentos')
      .select('id, tipo, versao, status, nome_arquivo, url_arquivo, motivo_reprovacao, created_at, representante_id, analisado_em, atualizacao_solicitada_em')
      .eq('cedente_id', id)
      .order('tipo').order('versao', { ascending: false })

    setDocs((d || []) as DocRecord[])

    // Carregar taxas
    const { data: t } = await supabase
      .from('taxas_cedente')
      .select('prazo_min, prazo_max, taxa_percentual')
      .eq('cedente_id', id)
      .order('prazo_min', { ascending: true })

    setTaxas((t || []) as Array<{ prazo_min: number; prazo_max: number; taxa_percentual: number }>)

    // Alteração cadastral pendente
    const { data: alt } = await supabase
      .from('solicitacoes_alteracao_cedente')
      .select('id, dados_atuais, dados_propostos, representantes_atuais, representantes_propostos, status, solicitado_em')
      .eq('cedente_id', id)
      .eq('status', 'pendente')
      .limit(1)
      .single()

    setAlteracao(alt as AlteracaoPendente | null)

    // Acessos vinculados
    const { data: ac } = await supabase
      .from('cedente_acessos')
      .select('id, user_id, perfil, ativo, created_at')
      .eq('cedente_id', id)
      .order('created_at', { ascending: true })

    if (ac && ac.length > 0) {
      const userIds = (ac as { user_id: string }[]).map((a) => a.user_id)
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, nome_completo, email')
        .in('id', userIds)
      const profsMap = Object.fromEntries(
        ((profs || []) as { id: string; nome_completo: string; email: string }[]).map((p) => [p.id, p])
      )
      setAcessos(
        (ac as { id: string; user_id: string; perfil: 'administrador' | 'operador'; ativo: boolean; created_at: string }[]).map((a) => ({
          ...a,
          profiles: profsMap[a.user_id] ? { nome_completo: profsMap[a.user_id].nome_completo, email: profsMap[a.user_id].email } : null,
        }))
      )
    } else {
      setAcessos([])
    }
    setLoading(false)
  }

  useEffect(() => { loadData() }, [id])

  // Docs da empresa (representante_id = null), mais recente por tipo
  const getLatestEmpresa = (tipo: string): DocRecord | null => {
    return docs.find((d) => d.tipo === tipo && d.representante_id === null) || null
  }

  // Docs por representante
  const getLatestByRep = (tipo: string, repId: string): DocRecord | null => {
    return docs.find((d) => d.tipo === tipo && d.representante_id === repId) || null
  }

  // Fallback legado: doc sem representante_id para rg_cpf
  const getLatestLegado = (tipo: string): DocRecord | null => {
    return docs.find((d) => d.tipo === tipo) || null
  }

  const openPreview = async (doc: DocRecord) => {
    if (!doc.url_arquivo) return
    const supabase = createClient()
    const { data } = await supabase.storage
      .from(buckets.documentos)
      .createSignedUrl(doc.url_arquivo, 3600)

    setModal({ doc, previewUrl: data?.signedUrl || '' })
    setMotivoReprovacao('')
  }

  const handleAnalise = async (decisao: 'aprovado' | 'reprovado') => {
    if (!modal) return
    if (decisao === 'reprovado' && !motivoReprovacao.trim()) {
      setMessage('Motivo da reprovacao e obrigatorio.')
      return
    }

    setActionLoading(true)
    const result = await analisarDocumento(modal.doc.id, decisao, motivoReprovacao || undefined)
    setMessage(result?.message || '')
    if (result?.success) {
      setModal(null)
      await loadData()
    }
    setActionLoading(false)
  }

  const handleAprovarCadastro = async () => {
    setActionLoading(true)
    const result = await aprovarCedente(id)
    setMessage(result?.message || '')
    if (result?.success) await loadData()
    setActionLoading(false)
  }

  const handleReprovarCadastro = async () => {
    if (!motivoCadastro.trim()) {
      setMessage('Motivo e obrigatorio.')
      return
    }
    setActionLoading(true)
    const result = await reprovarCedente(id, motivoCadastro)
    setMessage(result?.message || '')
    if (result?.success) {
      setShowReprovarCadastro(false)
      await loadData()
    }
    setActionLoading(false)
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
        <Card>
          <CardHeader><Skeleton className="h-6 w-40" /></CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!cedente) {
    return <p className="text-muted-foreground text-center py-20">Cedente nao encontrado.</p>
  }

  const handleSolicitarAtualizacao = async (docId: string) => {
    setRequestingUpdate(docId)
    const result = await solicitarAtualizacaoDocumento(docId)
    setMessage(result?.message || '')
    if (result?.success) await loadData()
    setRequestingUpdate(null)
  }

  const renderDocRow = (tipo: string, doc: DocRecord | null, label: string) => {
    const status = doc?.status || 'aguardando_envio'
    const expiracao = doc?.status === 'aprovado' ? calcularExpiracaoDoc(doc.analisado_em, tipo) : null
    const isRequesting = requestingUpdate === doc?.id

    return (
      <div key={`${tipo}_${doc?.id ?? 'empty'}`} className="flex items-center justify-between py-3 border-b border-border last:border-0 gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <FileText size={18} className="text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{label}</p>
            {doc?.nome_arquivo && <p className="text-xs text-muted-foreground truncate">{doc.nome_arquivo} (v{doc.versao})</p>}
            {doc?.atualizacao_solicitada_em && (
              <p className="text-xs text-amber-600 mt-0.5">
                Atualização solicitada em {new Date(doc.atualizacao_solicitada_em).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
          {expiracao && (
            expiracao.expirado ? (
              <Badge variant="destructive" className="text-xs whitespace-nowrap">Vencido</Badge>
            ) : expiracao.diasRestantes !== null && expiracao.diasRestantes <= 30 ? (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 whitespace-nowrap">
                Vence em {expiracao.diasRestantes}d
              </Badge>
            ) : null
          )}
          <Badge variant={statusBadgeVariant[status] || 'secondary'} className={statusColors[status]}>
            {status.replace(/_/g, ' ')}
          </Badge>
          {doc && !doc.atualizacao_solicitada_em && status !== 'aguardando_envio' && (
            <Button
              size="sm"
              variant="outline"
              className="text-amber-600 border-amber-300 hover:bg-amber-50 text-xs h-8 px-2"
              disabled={isRequesting}
              onClick={() => handleSolicitarAtualizacao(doc.id)}
            >
              {isRequesting
                ? <><Loader2 size={12} className="animate-spin" /> Solicitando...</>
                : <><RefreshCw size={12} /> Solicitar Atualização</>}
            </Button>
          )}
          {doc?.url_arquivo && (
            <Button
              size="sm"
              variant={doc.status === 'enviado' || doc.status === 'em_analise' ? 'default' : 'ghost'}
              onClick={() => openPreview(doc)}
            >
              <Eye size={14} /> {doc.status === 'enviado' || doc.status === 'em_analise' ? 'Analisar' : 'Ver'}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const docsEmpresaObrig = ['contrato_social', 'cartao_cnpj', 'comprovante_endereco', 'extrato_bancario', 'balanco_patrimonial', 'dre']
  const empresaAprovada = docsEmpresaObrig.every((t) => getLatestEmpresa(t)?.status === 'aprovado')

  // Multi-representante: verificar rg_cpf e comprovante_endereco por rep. comprovante_de_renda e procuracao sao opcionais.
  const docsRepObrig = ['rg_cpf', 'comprovante_endereco']
  const repsAprovadas = representantes.length === 0
    ? getLatestLegado('rg_cpf')?.status === 'aprovado'
    : representantes.every((rep) => docsRepObrig.every((t) => getLatestByRep(t, rep.id)?.status === 'aprovado'))

  const todosAprovados = empresaAprovada && repsAprovadas

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/gestor/cedentes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft size={16} /> Voltar
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{cedente.razao_social}</h1>
          <p className="text-muted-foreground font-mono tabular-nums">{formatCNPJ(cedente.cnpj)}</p>
        </div>
        <Badge variant={statusBadgeVariant[cedente.status] || 'secondary'}>
          {cedente.status}
        </Badge>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          message.includes('sucesso') || message.includes('aprovado') || message.includes('criada')
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-destructive/10 text-destructive border-destructive/20'
        }`}>{message}</div>
      )}

      {/* Dados Cadastrais */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Dados Cadastrais</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div><span className="text-muted-foreground">Nome Fantasia:</span> <span className="text-foreground ml-1">{cedente.nome_fantasia || '-'}</span></div>
            <div><span className="text-muted-foreground">CNAE:</span> <span className="text-foreground ml-1 tabular-nums">{cedente.cnae || '-'}</span></div>
            <div><span className="text-muted-foreground">Cadastro:</span> <span className="text-foreground ml-1">{formatDate(cedente.created_at)}</span></div>
            <div><span className="text-muted-foreground">Endereco:</span> <span className="text-foreground ml-1">{cedente.logradouro}, {cedente.numero} {cedente.complemento} - {cedente.bairro}, {cedente.cidade}/{cedente.estado} - CEP {cedente.cep}</span></div>
            <div><span className="text-muted-foreground">Telefone:</span> <span className="text-foreground ml-1 tabular-nums">{cedente.telefone_comercial || '-'}</span></div>
            <div><span className="text-muted-foreground">E-mail:</span> <span className="text-foreground ml-1">{cedente.email_comercial || '-'}</span></div>
          </div>

          <h3 className="text-md font-semibold text-foreground mt-6 mb-3">Representantes Legais</h3>
          {representantes.length > 0 ? (
            <div className="space-y-4">
              {representantes.map((rep, idx) => (
                <div key={rep.id} className="border border-border rounded-lg p-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Representante {idx + 1}{rep.principal ? ' (principal)' : ''}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Nome:</span> <span className="text-foreground ml-1">{rep.nome}</span></div>
                    <div><span className="text-muted-foreground">CPF:</span> <span className="text-foreground ml-1 tabular-nums">{rep.cpf}</span></div>
                    <div><span className="text-muted-foreground">RG:</span> <span className="text-foreground ml-1 tabular-nums">{rep.rg}</span></div>
                    <div><span className="text-muted-foreground">Cargo:</span> <span className="text-foreground ml-1">{rep.cargo}</span></div>
                    <div><span className="text-muted-foreground">E-mail:</span> <span className="text-foreground ml-1">{rep.email}</span></div>
                    <div><span className="text-muted-foreground">Telefone:</span> <span className="text-foreground ml-1 tabular-nums">{rep.telefone}</span></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum representante cadastrado.</p>
          )}

          <h3 className="text-md font-semibold text-foreground mt-6 mb-3">Dados Bancarios</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div><span className="text-muted-foreground">Banco:</span> <span className="text-foreground ml-1">{cedente.banco || '-'}</span></div>
            <div><span className="text-muted-foreground">Agencia:</span> <span className="text-foreground ml-1 tabular-nums">{cedente.agencia || '-'}</span></div>
            <div><span className="text-muted-foreground">Conta:</span> <span className="text-foreground ml-1 tabular-nums">{cedente.conta || '-'}</span></div>
            <div><span className="text-muted-foreground">Tipo:</span> <span className="text-foreground ml-1">{cedente.tipo_conta || '-'}</span></div>
          </div>
        </CardContent>
      </Card>

      {/* Documentos */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Empresa */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase mb-3">Empresa</p>
            <div className="space-y-0">
              {(['contrato_social', 'cartao_cnpj', 'comprovante_endereco', 'extrato_bancario', 'balanco_patrimonial', 'dre'] as const).map((tipo) =>
                renderDocRow(tipo, getLatestEmpresa(tipo), tipoLabels[tipo])
              )}
            </div>
          </div>

          {/* Por representante */}
          {representantes.length > 0 ? representantes.map((rep) => (
            <div key={rep.id}>
              <p className="text-sm font-semibold text-muted-foreground uppercase mb-3">
                {rep.nome}{rep.principal ? ' (principal)' : ''}
              </p>
              <div className="space-y-0">
                {(['rg_cpf', 'comprovante_de_renda', 'comprovante_endereco', 'procuracao'] as const).map((tipo) =>
                  renderDocRow(tipo, getLatestByRep(tipo, rep.id), tipoLabelsRep[tipo] || tipoLabels[tipo])
                )}
              </div>
            </div>
          )) : (
            /* Fallback legado */
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase mb-3">Representante Legal</p>
              <div className="space-y-0">
                {(['rg_cpf', 'procuracao'] as const).map((tipo) =>
                  renderDocRow(tipo, getLatestLegado(tipo), tipoLabelsRep[tipo] || tipoLabels[tipo])
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Acoes do Cadastro */}
      {cedente.status !== 'ativo' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Acoes do Cadastro</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 flex-wrap">
              {todosAprovados && cedente.status !== 'ativo' && (
                <Button
                  onClick={handleAprovarCadastro}
                  disabled={actionLoading}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle size={18} /> {actionLoading ? 'Processando...' : 'Aprovar Cadastro'}
                </Button>
              )}
              {!todosAprovados && (
                <p className="text-amber-600 text-sm py-2">Todos os documentos obrigatorios precisam estar aprovados antes de aprovar o cadastro.</p>
              )}
              <Button
                variant="destructive"
                onClick={() => setShowReprovarCadastro(!showReprovarCadastro)}
              >
                <XCircle size={18} /> Reprovar Cadastro
              </Button>
            </div>

            {showReprovarCadastro && (
              <div className="mt-4 p-4 border border-destructive/30 rounded-lg bg-destructive/5">
                <Label className="block text-sm font-medium text-destructive mb-1">Motivo da reprovacao *</Label>
                <textarea
                  className="w-full px-3 py-2 border border-destructive/30 rounded-lg text-sm bg-background text-foreground"
                  rows={3}
                  value={motivoCadastro}
                  onChange={(e) => setMotivoCadastro(e.target.value)}
                />
                <Button
                  variant="destructive"
                  onClick={handleReprovarCadastro}
                  disabled={actionLoading}
                  className="mt-2"
                >
                  {actionLoading ? 'Processando...' : 'Confirmar Reprovacao'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Taxas Pre-configuradas */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Settings size={18} />
              Taxas Pre-configuradas
            </CardTitle>
            <Button
              size="sm"
              variant="default"
              onClick={() => setTaxas([...taxas, { prazo_min: 0, prazo_max: 30, taxa_percentual: 2.5 }])}
            >
              <Plus size={14} /> Adicionar faixa
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {taxas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma taxa configurada. As operacoes deste cedente terao taxa definida manualmente pelo gestor.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3 text-xs font-medium text-muted-foreground uppercase">
                <span>Prazo Min (dias)</span>
                <span>Prazo Max (dias)</span>
                <span>Taxa (% a.m.)</span>
                <span></span>
              </div>
              {taxas.map((t, i) => (
                <div key={i} className="grid grid-cols-4 gap-3 items-center">
                  <Input
                    type="number"
                    min="0"
                    value={t.prazo_min}
                    onChange={(e) => {
                      const updated = [...taxas]
                      updated[i] = { ...updated[i], prazo_min: parseInt(e.target.value) || 0 }
                      setTaxas(updated)
                    }}
                    className="h-11 tabular-nums"
                  />
                  <Input
                    type="number"
                    min="0"
                    value={t.prazo_max}
                    onChange={(e) => {
                      const updated = [...taxas]
                      updated[i] = { ...updated[i], prazo_max: parseInt(e.target.value) || 0 }
                      setTaxas(updated)
                    }}
                    className="h-11 tabular-nums"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={t.taxa_percentual}
                    onChange={(e) => {
                      const updated = [...taxas]
                      updated[i] = { ...updated[i], taxa_percentual: parseFloat(e.target.value) || 0 }
                      setTaxas(updated)
                    }}
                    className="h-11 tabular-nums"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setTaxas(taxas.filter((_, idx) => idx !== i))}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={async () => {
                setSavingTaxas(true)
                setTaxasMessage('')
                const result = await salvarTaxasCedente(id, taxas)
                setTaxasMessage(result?.message || '')
                setSavingTaxas(false)
              }}
              disabled={savingTaxas}
            >
              {savingTaxas ? 'Salvando...' : 'Salvar Taxas'}
            </Button>
            {taxasMessage && (
              <span className={`text-sm ${taxasMessage.includes('sucesso') ? 'text-green-600' : 'text-destructive'}`}>
                {taxasMessage}
              </span>
            )}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            As taxas sao aplicadas automaticamente quando o cedente solicita antecipacao. O gestor pode ajustar na aprovacao.
          </p>
        </CardContent>
      </Card>

      {/* Alteração cadastral pendente */}
      {alteracao && (
        <Card className="mb-6 border-yellow-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
              <GitCompare size={18} />
              Solicitação de Alteração Cadastral
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Solicitada em {new Date(alteracao.solicitado_em).toLocaleString('pt-BR')}
            </p>

            {/* Diff dos campos */}
            {Object.entries(alteracao.dados_propostos).map(([campo, valorNovo]) => {
              const valorAtual = alteracao.dados_atuais[campo]
              if (valorAtual === valorNovo) return null
              return (
                <div key={campo} className="grid grid-cols-2 gap-3 text-sm border-b pb-3 last:border-0 last:pb-0">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase">{campo.replace(/_/g, ' ')}</p>
                    <p className="text-destructive line-through opacity-70">{String(valorAtual || '—')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1 uppercase">Proposto</p>
                    <p className="text-emerald-700 dark:text-emerald-400 font-medium">{String(valorNovo || '—')}</p>
                  </div>
                </div>
              )
            })}

            {/* Diff de representantes */}
            {alteracao.representantes_propostos.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">Representantes propostos</p>
                <div className="space-y-1">
                  {alteracao.representantes_propostos.map((rep, i) => (
                    <p key={i} className="text-sm text-emerald-700 dark:text-emerald-400">
                      {rep.nome} — {rep.cargo}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {alteracaoMessage && (
              <p className={`text-sm ${alteracaoMessage.includes('aprovada') ? 'text-green-600' : 'text-destructive'}`}>
                {alteracaoMessage}
              </p>
            )}

            {showReprovarAlteracao ? (
              <div className="space-y-2 border-t pt-3">
                <textarea
                  value={motivoRepAlteracao}
                  onChange={(e) => setMotivoRepAlteracao(e.target.value)}
                  placeholder="Motivo da reprovação (obrigatório)..."
                  rows={3}
                  className="w-full border border-destructive/30 rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50"
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setShowReprovarAlteracao(false); setMotivoRepAlteracao('') }}>
                    Cancelar
                  </Button>
                  <Button variant="destructive" size="sm" disabled={loadingAlteracao} onClick={async () => {
                    setLoadingAlteracao(true)
                    const result = await reprovarAlteracaoCedente(alteracao.id, motivoRepAlteracao)
                    setAlteracaoMessage(result?.message || '')
                    if (result?.success) { setAlteracao(null); setShowReprovarAlteracao(false) }
                    setLoadingAlteracao(false)
                  }}>
                    {loadingAlteracao ? <Loader2 size={14} className="animate-spin" /> : null}
                    Confirmar Reprovação
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 border-t pt-3">
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={loadingAlteracao}
                  onClick={async () => {
                    setLoadingAlteracao(true)
                    const result = await aprovarAlteracaoCedente(alteracao.id)
                    setAlteracaoMessage(result?.message || '')
                    if (result?.success) { await loadData(); setAlteracao(null) }
                    setLoadingAlteracao(false)
                  }}
                >
                  {loadingAlteracao ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Aprovar Alteração
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setShowReprovarAlteracao(true)}>
                  <XCircle size={14} /> Reprovar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Configuracoes de Acesso */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings size={18} />
            Configuracoes de Acesso
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Extrato Escrow</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quando habilitado, o cedente visualiza a aba "Extrato" com saldo e movimentos da conta escrow.
              </p>
            </div>
            <Button
              size="sm"
              variant={cedente.habilitar_escrow ? 'destructive' : 'default'}
              disabled={togglingEscrow}
              onClick={async () => {
                setTogglingEscrow(true)
                setEscrowMessage('')
                const result = await toggleEscrowCedente(id, !cedente.habilitar_escrow)
                setEscrowMessage(result?.message || '')
                if (result?.success) await loadData()
                setTogglingEscrow(false)
              }}
              className={cedente.habilitar_escrow ? '' : 'bg-green-600 hover:bg-green-700 text-white'}
            >
              {togglingEscrow ? 'Aguarde...' : cedente.habilitar_escrow ? 'Desabilitar' : 'Habilitar'}
            </Button>
          </div>
          {escrowMessage && (
            <p className={`text-sm mt-2 ${escrowMessage.includes('sucesso') ? 'text-green-600' : 'text-destructive'}`}>
              {escrowMessage}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Acessos Vinculados */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users size={18} />
              Acessos Vinculados
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => { setShowConviteModal(true); setConviteMessage('') }}>
              <UserPlus size={14} /> Convidar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {acessos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuario adicional vinculado.</p>
          ) : (
            <div className="space-y-2">
              {acessos.map((ac) => (
                <div key={ac.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {ac.profiles?.nome_completo || ac.profiles?.email || 'Sem nome'}
                    </p>
                    <p className="text-xs text-muted-foreground">{ac.profiles?.email}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <Badge className={ac.perfil === 'administrador' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}>
                      {ac.perfil}
                    </Badge>
                    {ac.ativo ? (
                      <Badge className="bg-green-100 text-green-700">ativo</Badge>
                    ) : (
                      <Badge className="bg-red-100 text-red-700">revogado</Badge>
                    )}
                    {ac.ativo && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive h-7 px-2"
                        disabled={revogandoId === ac.id}
                        onClick={async () => {
                          setRevogandoId(ac.id)
                          const result = await revogarAcessoCedente(ac.id)
                          if (result?.success) await loadData()
                          else setConviteMessage(result?.message || '')
                          setRevogandoId(null)
                        }}
                      >
                        {revogandoId === ac.id ? <Loader2 size={12} className="animate-spin" /> : <UserX size={12} />}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Convite */}
      {showConviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl shadow-xl max-w-md w-full border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                <UserPlus size={16} /> Convidar Usuario
              </h3>
              <Button variant="ghost" size="icon" onClick={() => { setShowConviteModal(false); setEmailConvite(''); setConviteMessage('') }}>
                <X size={18} />
              </Button>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-sm">Email</Label>
                <Input
                  type="email"
                  placeholder="usuario@empresa.com"
                  value={emailConvite}
                  onChange={(e) => setEmailConvite(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm">Perfil</Label>
                <div className="flex gap-2 mt-1">
                  {(['operador', 'administrador'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPerfilConvite(p)}
                      className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                        perfilConvite === p
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {p === 'operador' ? 'Operador' : 'Administrador'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {perfilConvite === 'operador'
                    ? 'Pode lancar NFs e consultar operacoes.'
                    : 'Acesso completo, incluindo solicitacao de alteracao cadastral.'}
                </p>
              </div>
              {conviteMessage && (
                <p className={`text-sm ${conviteMessage.includes('concedido') ? 'text-green-600' : 'text-destructive'}`}>
                  {conviteMessage}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => { setShowConviteModal(false); setEmailConvite(''); setConviteMessage('') }}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  disabled={loadingConvite || !emailConvite.trim()}
                  onClick={async () => {
                    setLoadingConvite(true)
                    setConviteMessage('')
                    const result = await convidarUsuarioCedente(id, emailConvite.trim(), perfilConvite)
                    setConviteMessage(result?.message || '')
                    if (result?.success) {
                      await loadData()
                      setEmailConvite('')
                      setTimeout(() => setShowConviteModal(false), 1500)
                    }
                    setLoadingConvite(false)
                  }}
                >
                  {loadingConvite ? <Loader2 size={14} className="animate-spin" /> : null}
                  Confirmar Convite
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Contrato de Cessao */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText size={18} />
            Contrato de Cessao
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Versao gerada pelo sistema</p>
            <BotaoDownloadContrato
              tipo="contrato"
              id={cedente.id}
              storagePath={cedente.contrato_url}
              label="Contrato Mae"
              className="w-full"
            />
          </div>
          <div className="border-t pt-3 space-y-1">
            <p className="text-xs text-muted-foreground">Versao assinada pelas partes</p>
            <UploadDocumentoAssinado
              label="Contrato Assinado"
              storagePath={cedente.contrato_assinado_url}
              uploadPath={`cedentes/${cedente.id}/contrato-cessao-assinado.pdf`}
              onSuccess={async (path) => {
                await salvarContratoAssinado(cedente.id, path)
                await loadData()
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Modal de Analise de Documento */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-border">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-semibold text-foreground">
                {tipoLabels[modal.doc.tipo] || modal.doc.tipo} — v<span className="tabular-nums">{modal.doc.versao}</span>
              </h3>
              <Button variant="ghost" size="icon" onClick={() => setModal(null)}>
                <X size={20} />
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {modal.previewUrl ? (
                modal.doc.nome_arquivo?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={modal.previewUrl} className="w-full h-[500px] border rounded" />
                ) : (
                  <img src={modal.previewUrl} alt={modal.doc.nome_arquivo || ''} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-muted-foreground text-center py-10">Nao foi possivel carregar o preview.</p>
              )}
            </div>

            {(modal.doc.status === 'enviado' || modal.doc.status === 'em_analise') && (
              <div className="p-4 border-t border-border space-y-3">
                <div className="flex gap-3">
                  <Button
                    onClick={() => handleAnalise('aprovado')}
                    disabled={actionLoading}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  >
                    {actionLoading ? 'Processando...' : 'Aprovar'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (motivoReprovacao.trim()) handleAnalise('reprovado')
                      else setMessage('Preencha o motivo da reprovacao.')
                    }}
                    disabled={actionLoading}
                    className="flex-1"
                  >
                    Reprovar
                  </Button>
                </div>
                <div>
                  <Label className="block text-sm text-muted-foreground mb-1">Motivo da reprovacao (obrigatorio para reprovar)</Label>
                  <textarea
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background text-foreground"
                    rows={2}
                    value={motivoReprovacao}
                    onChange={(e) => setMotivoReprovacao(e.target.value)}
                    placeholder="Descreva o motivo..."
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

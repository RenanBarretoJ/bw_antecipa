'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { analisarDocumento, aprovarCedente, reprovarCedente } from '@/lib/actions/gestor'
import { salvarTaxasCedente } from '@/lib/actions/operacao'
import { formatCNPJ, formatDate } from '@/lib/utils'
import { ArrowLeft, CheckCircle, XCircle, FileText, Eye, X, Plus, Trash2, Settings } from 'lucide-react'
import Link from 'next/link'

interface CedenteDetail {
  id: string; cnpj: string; razao_social: string; nome_fantasia: string | null
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null
  bairro: string | null; cidade: string | null; estado: string | null
  telefone_comercial: string | null; email_comercial: string | null; cnae: string | null
  nome_representante: string | null; cpf_representante: string | null; rg_representante: string | null
  cargo_representante: string | null; email_representante: string | null; telefone_representante: string | null
  banco: string | null; agencia: string | null; conta: string | null; tipo_conta: string | null
  status: string; created_at: string
}

interface DocRecord {
  id: string; tipo: string; versao: number; status: string
  nome_arquivo: string | null; url_arquivo: string | null
  motivo_reprovacao: string | null; created_at: string
}

const tipoLabels: Record<string, string> = {
  contrato_social: 'Contrato Social', cartao_cnpj: 'Cartao CNPJ',
  rg_cpf: 'RG e CPF', comprovante_endereco: 'Comprovante de Endereco',
  extrato_bancario: 'Extrato Bancario', balanco_patrimonial: 'Balanco Patrimonial',
  dre: 'DRE', procuracao: 'Procuracao',
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
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [modal, setModal] = useState<{ doc: DocRecord; previewUrl: string } | null>(null)
  const [motivoReprovacao, setMotivoReprovacao] = useState('')
  const [motivoCadastro, setMotivoCadastro] = useState('')
  const [showReprovarCadastro, setShowReprovarCadastro] = useState(false)

  // Taxas
  const [taxas, setTaxas] = useState<Array<{ prazo_min: number; prazo_max: number; taxa_percentual: number }>>([])
  const [savingTaxas, setSavingTaxas] = useState(false)
  const [taxasMessage, setTaxasMessage] = useState('')

  const loadData = async () => {
    const supabase = createClient()

    const { data: c } = await supabase.from('cedentes').select('*').eq('id', id).single()
    setCedente(c as CedenteDetail | null)

    const { data: d } = await supabase
      .from('documentos')
      .select('id, tipo, versao, status, nome_arquivo, url_arquivo, motivo_reprovacao, created_at')
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
    setLoading(false)
  }

  useEffect(() => { loadData() }, [id])

  const getLatestByTipo = () => {
    const map: Record<string, DocRecord> = {}
    for (const doc of docs) {
      if (!map[doc.tipo]) map[doc.tipo] = doc
    }
    return map
  }

  const openPreview = async (doc: DocRecord) => {
    if (!doc.url_arquivo) return
    const supabase = createClient()
    const { data } = await supabase.storage
      .from('documentos-cedentes')
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
    return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
  }

  if (!cedente) {
    return <p className="text-gray-500 text-center py-20">Cedente nao encontrado.</p>
  }

  const latestDocs = getLatestByTipo()
  const docsObrigatorios = ['contrato_social', 'cartao_cnpj', 'rg_cpf', 'comprovante_endereco', 'extrato_bancario', 'balanco_patrimonial', 'dre']
  const todosAprovados = docsObrigatorios.every((t) => latestDocs[t]?.status === 'aprovado')

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/gestor/cedentes" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft size={16} /> Voltar
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cedente.razao_social}</h1>
          <p className="text-gray-500 font-mono">{formatCNPJ(cedente.cnpj)}</p>
        </div>
        <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${statusColors[cedente.status] || 'bg-gray-100'}`}>
          {cedente.status}
        </span>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.includes('sucesso') || message.includes('aprovado') || message.includes('criada')
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>{message}</div>
      )}

      {/* Dados Cadastrais */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Dados Cadastrais</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div><span className="text-gray-500">Nome Fantasia:</span> <span className="text-gray-900 ml-1">{cedente.nome_fantasia || '-'}</span></div>
          <div><span className="text-gray-500">CNAE:</span> <span className="text-gray-900 ml-1">{cedente.cnae || '-'}</span></div>
          <div><span className="text-gray-500">Cadastro:</span> <span className="text-gray-900 ml-1">{formatDate(cedente.created_at)}</span></div>
          <div><span className="text-gray-500">Endereco:</span> <span className="text-gray-900 ml-1">{cedente.logradouro}, {cedente.numero} {cedente.complemento} - {cedente.bairro}, {cedente.cidade}/{cedente.estado} - CEP {cedente.cep}</span></div>
          <div><span className="text-gray-500">Telefone:</span> <span className="text-gray-900 ml-1">{cedente.telefone_comercial || '-'}</span></div>
          <div><span className="text-gray-500">E-mail:</span> <span className="text-gray-900 ml-1">{cedente.email_comercial || '-'}</span></div>
        </div>

        <h3 className="text-md font-semibold text-gray-900 mt-6 mb-3">Representante Legal</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div><span className="text-gray-500">Nome:</span> <span className="text-gray-900 ml-1">{cedente.nome_representante || '-'}</span></div>
          <div><span className="text-gray-500">CPF:</span> <span className="text-gray-900 ml-1">{cedente.cpf_representante || '-'}</span></div>
          <div><span className="text-gray-500">RG:</span> <span className="text-gray-900 ml-1">{cedente.rg_representante || '-'}</span></div>
          <div><span className="text-gray-500">Cargo:</span> <span className="text-gray-900 ml-1">{cedente.cargo_representante || '-'}</span></div>
          <div><span className="text-gray-500">E-mail:</span> <span className="text-gray-900 ml-1">{cedente.email_representante || '-'}</span></div>
          <div><span className="text-gray-500">Telefone:</span> <span className="text-gray-900 ml-1">{cedente.telefone_representante || '-'}</span></div>
        </div>

        <h3 className="text-md font-semibold text-gray-900 mt-6 mb-3">Dados Bancarios</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">Banco:</span> <span className="text-gray-900 ml-1">{cedente.banco || '-'}</span></div>
          <div><span className="text-gray-500">Agencia:</span> <span className="text-gray-900 ml-1">{cedente.agencia || '-'}</span></div>
          <div><span className="text-gray-500">Conta:</span> <span className="text-gray-900 ml-1">{cedente.conta || '-'}</span></div>
          <div><span className="text-gray-500">Tipo:</span> <span className="text-gray-900 ml-1">{cedente.tipo_conta || '-'}</span></div>
        </div>
      </div>

      {/* Documentos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Documentos</h2>
        <div className="space-y-3">
          {Object.entries(tipoLabels).map(([tipo, label]) => {
            const doc = latestDocs[tipo]
            const status = doc?.status || 'aguardando_envio'
            return (
              <div key={tipo} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <FileText size={18} className="text-gray-400" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    {doc?.nome_arquivo && <p className="text-xs text-gray-400">{doc.nome_arquivo} (v{doc.versao})</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[status]}`}>
                    {status.replace('_', ' ')}
                  </span>
                  {doc && (doc.status === 'enviado' || doc.status === 'em_analise') && (
                    <button onClick={() => openPreview(doc)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                      <Eye size={14} /> Analisar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Acoes do Cadastro */}
      {cedente.status !== 'ativo' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Acoes do Cadastro</h2>
          <div className="flex gap-3">
            {todosAprovados && cedente.status !== 'ativo' && (
              <button onClick={handleAprovarCadastro} disabled={actionLoading}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                <CheckCircle size={18} /> {actionLoading ? 'Processando...' : 'Aprovar Cadastro'}
              </button>
            )}
            {!todosAprovados && (
              <p className="text-amber-600 text-sm py-2">Todos os documentos obrigatorios precisam estar aprovados antes de aprovar o cadastro.</p>
            )}
            <button onClick={() => setShowReprovarCadastro(!showReprovarCadastro)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700">
              <XCircle size={18} /> Reprovar Cadastro
            </button>
          </div>

          {showReprovarCadastro && (
            <div className="mt-4 p-4 border border-red-200 rounded-lg bg-red-50">
              <label className="block text-sm font-medium text-red-700 mb-1">Motivo da reprovacao *</label>
              <textarea className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm" rows={3}
                value={motivoCadastro} onChange={(e) => setMotivoCadastro(e.target.value)} />
              <button onClick={handleReprovarCadastro} disabled={actionLoading}
                className="mt-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50">
                {actionLoading ? 'Processando...' : 'Confirmar Reprovacao'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Taxas Pre-configuradas */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Settings size={18} />
            Taxas Pre-configuradas
          </h2>
          <button
            onClick={() => setTaxas([...taxas, { prazo_min: 0, prazo_max: 30, taxa_percentual: 2.5 }])}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
          >
            <Plus size={14} /> Adicionar faixa
          </button>
        </div>

        {taxas.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma taxa configurada. As operacoes deste cedente terao taxa definida manualmente pelo gestor.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3 text-xs font-medium text-gray-500 uppercase">
              <span>Prazo Min (dias)</span>
              <span>Prazo Max (dias)</span>
              <span>Taxa (% a.m.)</span>
              <span></span>
            </div>
            {taxas.map((t, i) => (
              <div key={i} className="grid grid-cols-4 gap-3 items-center">
                <input
                  type="number"
                  min="0"
                  value={t.prazo_min}
                  onChange={(e) => {
                    const updated = [...taxas]
                    updated[i] = { ...updated[i], prazo_min: parseInt(e.target.value) || 0 }
                    setTaxas(updated)
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min="0"
                  value={t.prazo_max}
                  onChange={(e) => {
                    const updated = [...taxas]
                    updated[i] = { ...updated[i], prazo_max: parseInt(e.target.value) || 0 }
                    setTaxas(updated)
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={t.taxa_percentual}
                  onChange={(e) => {
                    const updated = [...taxas]
                    updated[i] = { ...updated[i], taxa_percentual: parseFloat(e.target.value) || 0 }
                    setTaxas(updated)
                  }}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  onClick={() => setTaxas(taxas.filter((_, idx) => idx !== i))}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={async () => {
              setSavingTaxas(true)
              setTaxasMessage('')
              const result = await salvarTaxasCedente(id, taxas)
              setTaxasMessage(result?.message || '')
              setSavingTaxas(false)
            }}
            disabled={savingTaxas}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {savingTaxas ? 'Salvando...' : 'Salvar Taxas'}
          </button>
          {taxasMessage && (
            <span className={`text-sm ${taxasMessage.includes('sucesso') ? 'text-green-600' : 'text-red-600'}`}>
              {taxasMessage}
            </span>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-400">
          As taxas sao aplicadas automaticamente quando o cedente solicita antecipacao. O gestor pode ajustar na aprovacao.
        </p>
      </div>

      {/* Modal de Analise de Documento */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">
                {tipoLabels[modal.doc.tipo] || modal.doc.tipo} — v{modal.doc.versao}
              </h3>
              <button onClick={() => setModal(null)} className="p-1 hover:bg-gray-100 rounded"><X size={20} /></button>
            </div>

            <div className="flex-1 overflow-auto p-4">
              {modal.previewUrl ? (
                modal.doc.nome_arquivo?.toLowerCase().endsWith('.pdf') ? (
                  <iframe src={modal.previewUrl} className="w-full h-[500px] border rounded" />
                ) : (
                  <img src={modal.previewUrl} alt={modal.doc.nome_arquivo || ''} className="max-w-full mx-auto rounded" />
                )
              ) : (
                <p className="text-gray-500 text-center py-10">Nao foi possivel carregar o preview.</p>
              )}
            </div>

            <div className="p-4 border-t space-y-3">
              <div className="flex gap-3">
                <button onClick={() => handleAnalise('aprovado')} disabled={actionLoading}
                  className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
                  {actionLoading ? 'Processando...' : 'Aprovar'}
                </button>
                <button onClick={() => {
                  if (motivoReprovacao.trim()) handleAnalise('reprovado')
                  else setMessage('Preencha o motivo da reprovacao.')
                }} disabled={actionLoading}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium">
                  Reprovar
                </button>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Motivo da reprovacao (obrigatorio para reprovar)</label>
                <textarea className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2}
                  value={motivoReprovacao} onChange={(e) => setMotivoReprovacao(e.target.value)}
                  placeholder="Descreva o motivo..." />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

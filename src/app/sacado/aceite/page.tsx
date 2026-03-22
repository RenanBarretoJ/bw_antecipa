'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { aceitarCessao, contestarCessao } from '@/lib/actions/sacado'
import { formatCurrency, formatCNPJ, formatDate } from '@/lib/utils'
import {
  CheckCircle,
  XCircle,
  Receipt,
  AlertTriangle,
  Wallet,
} from 'lucide-react'

interface NfCessao {
  id: string
  numero_nf: string
  cnpj_emitente: string
  razao_social_emitente: string
  valor_bruto: number
  data_vencimento: string
  status: string
  cedente_id: string
}

interface ContaInfo {
  cedente_id: string
  identificador: string
}

export default function AceiteCessaoPage() {
  const [nfs, setNfs] = useState<NfCessao[]>([])
  const [contas, setContas] = useState<ContaInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [contestando, setContestando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')

  const loadData = async () => {
    const supabase = createClient()

    // NFs cedidas (em_antecipacao) destinadas a este sacado
    const { data: nfsData } = await supabase
      .from('notas_fiscais')
      .select('id, numero_nf, cnpj_emitente, razao_social_emitente, valor_bruto, data_vencimento, status, cedente_id')
      .eq('status', 'em_antecipacao')
      .order('data_vencimento', { ascending: true })

    setNfs((nfsData || []) as NfCessao[])

    // Buscar contas escrow para mostrar dados de pagamento
    const { data: contasData } = await supabase
      .from('contas_escrow')
      .select('cedente_id, identificador')

    setContas((contasData || []) as ContaInfo[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const getContaEscrow = (cedenteId: string) => {
    return contas.find((c) => c.cedente_id === cedenteId)?.identificador || null
  }

  const handleAceitar = async (nfId: string) => {
    setProcessing(nfId)
    setMessage('')
    const result = await aceitarCessao(nfId)
    if (result?.success) {
      setMessage(result.message || 'Aceita!')
      setMessageType('success')
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(null)
  }

  const handleContestar = async (nfId: string) => {
    if (!motivo.trim()) {
      setMessage('Informe o motivo da contestacao.')
      setMessageType('error')
      return
    }
    setProcessing(nfId)
    const result = await contestarCessao(nfId, motivo)
    if (result?.success) {
      setMessage(result.message || 'Contestada.')
      setMessageType('success')
      setContestando(null)
      setMotivo('')
      await loadData()
    } else {
      setMessage(result?.message || 'Erro.')
      setMessageType('error')
    }
    setProcessing(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Aceite de Cessao</h1>
        <p className="text-gray-500">Confirme ou conteste as cessoes de credito das NFs emitidas contra voce.</p>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message}
        </div>
      )}

      {nfs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <CheckCircle size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhuma cessao pendente de aceite.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {nfs.map((nf) => {
            const contaEscrow = getContaEscrow(nf.cedente_id)
            const isContestando = contestando === nf.id
            const isProcessing = processing === nf.id

            return (
              <div key={nf.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Receipt size={18} className="text-purple-600" />
                        <span className="font-bold text-gray-900 text-lg">NF {nf.numero_nf}</span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500 text-xs">Cedente (Emitente)</span>
                          <p className="font-medium">{nf.razao_social_emitente}</p>
                          <p className="text-xs text-gray-400">{formatCNPJ(nf.cnpj_emitente)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Valor</span>
                          <p className="font-bold text-lg">{formatCurrency(nf.valor_bruto)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Vencimento</span>
                          <p className="font-medium">{formatDate(nf.data_vencimento)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500 text-xs">Status</span>
                          <p className="font-medium text-purple-700">Cessao ativa</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Conta escrow para pagamento */}
                  {contaEscrow && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg flex items-center gap-2 text-sm">
                      <Wallet size={16} className="text-blue-600" />
                      <span className="text-blue-700">
                        Conta para pagamento: <strong className="font-mono">{contaEscrow}</strong>
                      </span>
                    </div>
                  )}

                  {/* Acoes */}
                  {!isContestando && (
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => handleAceitar(nf.id)}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                      >
                        <CheckCircle size={16} />
                        {isProcessing ? 'Processando...' : 'Aceitar Cessao'}
                      </button>
                      <button
                        onClick={() => setContestando(nf.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm font-medium"
                      >
                        <XCircle size={16} />
                        Contestar
                      </button>
                    </div>
                  )}

                  {/* Form contestacao */}
                  {isContestando && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={16} className="text-red-600" />
                        <span className="font-medium text-red-800">Contestar Cessao</span>
                      </div>
                      <textarea
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Descreva o motivo da contestacao (obrigatorio)..."
                        rows={3}
                        className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm mb-3"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setContestando(null); setMotivo('') }}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => handleContestar(nf.id)}
                          disabled={isProcessing}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm"
                        >
                          {isProcessing ? 'Enviando...' : 'Confirmar Contestacao'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

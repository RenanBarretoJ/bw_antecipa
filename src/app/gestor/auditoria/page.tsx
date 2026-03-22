'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { ShieldCheck, Search, Filter, Calendar, ChevronDown, ChevronUp } from 'lucide-react'

interface LogRecord {
  id: string
  tipo_evento: string
  entidade_tipo: string
  entidade_id: string | null
  dados_antes: Record<string, unknown> | null
  dados_depois: Record<string, unknown> | null
  created_at: string
  profiles: { nome_completo: string; email: string; role: string } | null
}

const tipoEventoColors: Record<string, string> = {
  CEDENTE_CADASTRADO: 'bg-blue-100 text-blue-700',
  CEDENTE_APROVADO: 'bg-green-100 text-green-700',
  CEDENTE_REPROVADO: 'bg-red-100 text-red-700',
  DOCUMENTO_ENVIADO: 'bg-blue-100 text-blue-700',
  DOCUMENTO_APROVADO: 'bg-green-100 text-green-700',
  DOCUMENTO_REPROVADO: 'bg-red-100 text-red-700',
  NF_CADASTRADA: 'bg-blue-100 text-blue-700',
  NF_SUBMETIDA: 'bg-blue-100 text-blue-700',
  NF_APROVADA: 'bg-green-100 text-green-700',
  NF_REPROVADA: 'bg-red-100 text-red-700',
  OPERACAO_SOLICITADA: 'bg-purple-100 text-purple-700',
  OPERACAO_APROVADA: 'bg-green-100 text-green-700',
  OPERACAO_REPROVADA: 'bg-red-100 text-red-700',
  OPERACAO_CANCELADA: 'bg-gray-100 text-gray-700',
  OPERACAO_LIQUIDADA: 'bg-emerald-100 text-emerald-700',
  OPERACAO_INADIMPLENTE: 'bg-red-100 text-red-700',
  ESCROW_CREDITO: 'bg-green-100 text-green-700',
  ESCROW_DEBITO: 'bg-red-100 text-red-700',
  TAXAS_ATUALIZADAS: 'bg-amber-100 text-amber-700',
  CESSAO_ACEITA: 'bg-green-100 text-green-700',
  CESSAO_CONTESTADA: 'bg-red-100 text-red-700',
}

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<LogRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('logs_auditoria')
        .select('id, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois, created_at, profiles(nome_completo, email, role)')
        .order('created_at', { ascending: false })
        .limit(200)

      setLogs((data || []) as LogRecord[])
      setLoading(false)
    }
    load()
  }, [])

  const tiposUnicos = [...new Set(logs.map((l) => l.tipo_evento))].sort()

  const logsFiltrados = logs.filter((log) => {
    if (filtroTipo !== 'todos' && log.tipo_evento !== filtroTipo) return false
    if (dataInicio && log.created_at.split('T')[0] < dataInicio) return false
    if (dataFim && log.created_at.split('T')[0] > dataFim) return false
    if (busca) {
      const term = busca.toLowerCase()
      return (
        log.tipo_evento.toLowerCase().includes(term) ||
        log.entidade_tipo.toLowerCase().includes(term) ||
        (log.profiles?.nome_completo || '').toLowerCase().includes(term) ||
        (log.profiles?.email || '').toLowerCase().includes(term) ||
        (log.entidade_id || '').includes(term)
      )
    }
    return true
  })

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={24} className="text-purple-600" />
          Auditoria
        </h1>
        <p className="text-gray-500">Log completo de todas as acoes do sistema.</p>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Buscar por evento, usuario, entidade..."
              value={busca} onChange={(e) => setBusca(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
            <option value="todos">Todos os eventos</option>
            {tiposUnicos.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-gray-400" />
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm" />
            <span className="text-gray-400 text-xs">ate</span>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-2 text-sm" />
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-400 mb-3">{logsFiltrados.length} registros</p>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : logsFiltrados.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <ShieldCheck size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Nenhum log encontrado.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logsFiltrados.map((log) => {
            const isExpanded = expanded === log.id
            const eventColor = tipoEventoColors[log.tipo_evento] || 'bg-gray-100 text-gray-700'

            return (
              <div key={log.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : log.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${eventColor}`}>
                      {log.tipo_evento}
                    </span>
                    <span className="text-sm text-gray-600 truncate">
                      {log.profiles?.nome_completo || 'Sistema'}
                      <span className="text-gray-400 ml-1">({log.profiles?.role || 'auto'})</span>
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {log.entidade_tipo} {log.entidade_id ? `#${log.entidade_id.substring(0, 8)}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-gray-400">
                      {new Date(log.created_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                      {log.dados_antes && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Dados Antes</p>
                          <pre className="bg-red-50 rounded-lg p-3 text-xs overflow-auto max-h-40">
                            {JSON.stringify(log.dados_antes, null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.dados_depois && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1">Dados Depois</p>
                          <pre className="bg-green-50 rounded-lg p-3 text-xs overflow-auto max-h-40">
                            {JSON.stringify(log.dados_depois, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                    {log.profiles && (
                      <p className="text-xs text-gray-400 mt-2">
                        Usuario: {log.profiles.email}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

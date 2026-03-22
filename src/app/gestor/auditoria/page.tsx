'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { ShieldCheck, Search, Calendar, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck size={24} className="text-purple-600" />
          Auditoria
        </h1>
        <p className="text-muted-foreground">Log completo de todas as acoes do sistema.</p>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                type="text"
                placeholder="Buscar por evento, usuario, entidade..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9 h-11"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => { if (v) setFiltroTipo(v) }}>
              <SelectTrigger className="h-11 w-full md:w-56">
                <SelectValue placeholder="Todos os eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os eventos</SelectItem>
                {tiposUnicos.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-muted-foreground shrink-0" />
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="h-11 w-36"
              />
              <span className="text-muted-foreground text-xs">ate</span>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="h-11 w-36"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground mb-3 tabular-nums">{logsFiltrados.length} registros</p>

      {/* Lista */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : logsFiltrados.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ShieldCheck size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">Nenhum log encontrado.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {logsFiltrados.map((log) => {
            const isExpanded = expanded === log.id
            const eventColor = tipoEventoColors[log.tipo_evento] || 'bg-gray-100 text-gray-700'

            return (
              <Card key={log.id} className="overflow-hidden py-0">
                <button
                  onClick={() => setExpanded(isExpanded ? null : log.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 text-left"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Badge className={`shrink-0 rounded text-xs font-medium ${eventColor}`}>
                      {log.tipo_evento}
                    </Badge>
                    <span className="text-sm text-foreground truncate">
                      {log.profiles?.nome_completo || 'Sistema'}
                      <span className="text-muted-foreground ml-1">({log.profiles?.role || 'auto'})</span>
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {log.entidade_tipo} {log.entidade_id ? `#${log.entidade_id.substring(0, 8)}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(log.created_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                      })}
                    </span>
                    {isExpanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-border">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                      {log.dados_antes && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Dados Antes</p>
                          <pre className="bg-red-50 rounded-lg p-3 text-xs overflow-auto max-h-40">
                            {JSON.stringify(log.dados_antes, null, 2)}
                          </pre>
                        </div>
                      )}
                      {log.dados_depois && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Dados Depois</p>
                          <pre className="bg-green-50 rounded-lg p-3 text-xs overflow-auto max-h-40">
                            {JSON.stringify(log.dados_depois, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                    {log.profiles && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Usuario: {log.profiles.email}
                      </p>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type HistoricoCategoria =
  | 'documento'
  | 'analise'
  | 'aprovacao'
  | 'reprovacao'
  | 'operacao'
  | 'integracao'
  | 'desembolso'
  | 'logistica'
  | 'conclusao'
  | 'sistema'

export type HistoricoVisibilidade = 'interno' | 'cedente' | 'ambos'

export interface HistoricoEventoView {
  id: string
  tipoEvento: string
  categoria: HistoricoCategoria
  descricao: string
  atorNome: string
  atorPerfil: string
  origem: string
  metadataResumo: string[]
  visibilidade: HistoricoVisibilidade
  createdAt: string
}

const METADATA_LABELS: Record<string, string> = {
  numero_nf: 'NF',
  valor_bruto: 'Valor bruto',
  valor_bruto_total: 'Valor bruto',
  valor_liquido_desembolso: 'Valor líquido',
  valor_antecipado: 'Valor antecipado',
  documento: 'Documento',
  tipo_documento: 'Tipo',
  numero_versao: 'Versão',
  status: 'Status',
  status_anterior: 'Status anterior',
  status_novo: 'Novo status',
  resultado: 'Resultado',
  status_validacao: 'Validação',
  quantidade_nfs: 'NFs',
  motivo_resumido: 'Motivo',
  protocolo: 'Protocolo',
}

const METADATA_DENYLIST = new Set([
  'id',
  'uuid',
  'path',
  'storage_path',
  'bucket',
  'sha256',
  'hash',
  'token',
  'senha',
  'secret',
  'stack',
  'erro_tecnico',
])

function isSafeMetadataKey(key: string) {
  const normalized = key.toLowerCase()
  return !Array.from(METADATA_DENYLIST).some((forbidden) => normalized.includes(forbidden))
}

function formatMetadataValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return value ? 'sim' : 'não'
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value
  return null
}

export function resumirMetadataHistorico(metadata: unknown, maxItems = 4): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  const entries = Object.entries(metadata as Record<string, unknown>)
    .filter(([key]) => isSafeMetadataKey(key))
    .map(([key, value]) => {
      const formatted = formatMetadataValue(value)
      if (!formatted) return null
      return `${METADATA_LABELS[key] ?? key.replaceAll('_', ' ')}: ${formatted}`
    })
    .filter((value): value is string => Boolean(value))

  return entries.slice(0, maxItems)
}

export function groupHistoricoByDate(events: HistoricoEventoView[]) {
  return events.reduce<Array<{ dateKey: string; label: string; events: HistoricoEventoView[] }>>((groups, event) => {
    const date = new Date(event.createdAt)
    const dateKey = Number.isNaN(date.getTime()) ? 'sem-data' : date.toISOString().slice(0, 10)
    const existing = groups.find((group) => group.dateKey === dateKey)
    if (existing) {
      existing.events.push(event)
      return groups
    }
    groups.push({ dateKey, label: formatDateGroupLabel(event.createdAt), events: [event] })
    return groups
  }, [])
}

export function formatDateGroupLabel(value: string, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Sem data'

  const todayKey = now.toISOString().slice(0, 10)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const dateKey = date.toISOString().slice(0, 10)

  if (dateKey === todayKey) return 'Hoje'
  if (dateKey === yesterday.toISOString().slice(0, 10)) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date)
}

export function formatEventTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
}

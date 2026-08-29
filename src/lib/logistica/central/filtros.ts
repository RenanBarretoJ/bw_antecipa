import { readSearchParam, type SearchParamsInput } from '@/lib/pagination'
import {
  CENTRAL_LOGISTICA_TABS,
  FILTROS_PENDENCIA_LOGISTICA,
  MOMENTOS_DOCUMENTO,
  STATUS_DOCUMENTO_LOGISTICO,
  VISOES_RAPIDAS_LOGISTICA,
  type FiltrosCentralLogistica,
  type PeriodoLogistica,
} from './tipos'

const STATUS_LOGISTICO = new Set(['ENTREGUE', 'EM_TRANSITO', 'INDETERMINADA'])
const STATUS_OPERACAO = new Set(['sem_operacao', 'solicitada', 'em_analise', 'aprovada', 'em_andamento', 'liquidada', 'inadimplente', 'reprovada', 'cancelada'])
const PERIODOS = new Set<PeriodoLogistica>(['emissao', 'operacao', 'cessao', 'desembolso', 'vencimento'])

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const normalized = String(value || '')
  return allowed.includes(normalized as T) ? normalized as T : null
}

function data(value: unknown) {
  const normalized = String(value || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

export function parseFiltrosCentralLogistica(input: SearchParamsInput): FiltrosCentralLogistica {
  const read = (key: string) => readSearchParam(input, key)
  const tab = enumValue(read('tab'), CENTRAL_LOGISTICA_TABS) || 'geral'
  const pagina = Math.max(1, Number.parseInt(read('page') || '1', 10) || 1)
  const limiteInformado = Number.parseInt(read('pageSize') || '20', 10)
  const limite = ([20, 50, 100].includes(limiteInformado) ? limiteInformado : 20) as 20 | 50 | 100
  const periodoInformado = String(read('periodo') || 'emissao') as PeriodoLogistica

  return {
    tab,
    pagina,
    limite,
    busca: String(read('q') || '').trim().slice(0, 120),
    cedente: read('cedente') || null,
    sacado: read('sacado') || null,
    operacao: read('operacao') || null,
    statusLogistico: STATUS_LOGISTICO.has(String(read('statusLogistico')))
      ? String(read('statusLogistico')) as FiltrosCentralLogistica['statusLogistico']
      : null,
    statusCte: enumValue(read('statusCte'), STATUS_DOCUMENTO_LOGISTICO),
    statusComprovante: enumValue(read('statusComprovante'), STATUS_DOCUMENTO_LOGISTICO),
    momentoCte: enumValue(read('momentoCte'), MOMENTOS_DOCUMENTO),
    momentoComprovante: enumValue(read('momentoComprovante'), MOMENTOS_DOCUMENTO),
    pendencia: enumValue(read('pendencia'), FILTROS_PENDENCIA_LOGISTICA),
    statusOperacao: STATUS_OPERACAO.has(String(read('statusOperacao'))) ? String(read('statusOperacao')) : null,
    periodo: PERIODOS.has(periodoInformado) ? periodoInformado : 'emissao',
    dataDe: data(read('dataDe')),
    dataAte: data(read('dataAte')),
    visao: enumValue(read('visao'), VISOES_RAPIDAS_LOGISTICA),
  }
}

import type { AceiteSacadoStatus } from '@/lib/types/domain'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { verificarElegibilidadeDocumental } from '@/lib/actions/documento-v2'

export type DocumentacaoStatus = 'satisfeita' | 'incompleta' | 'nao_verificada' | 'legado'

export interface EstadoOperacional {
  operacao_id: string
  status_operacao: string
  cedente_id: string
  aceite_exigido: boolean
  aceite_status: AceiteSacadoStatus
  legado: boolean
  contexto_valido: boolean
  snapshot_consistente: boolean
  nfs: Array<{ id: string; numero_nf: string; cedente_id: string; status: string; valor_bruto: number; valor_liquido: number | null; data_vencimento: string }>
}

export interface GateOperacional {
  elegivel: boolean
  bloqueios: string[]
  avisos: string[]
  aceite_exigido: boolean
  aceite_status: AceiteSacadoStatus
  documentacao_status: DocumentacaoStatus
  estado?: EstadoOperacional
}

type OperacaoContexto = {
  id: string
  cedente_id: string
  status: string
  cedente_fundo_id: string | null
  politica_operacional_id: string | null
  politica_operacional_versao_id: string | null
  politica_versao: number | null
  politica_snapshot: Record<string, unknown> | null
  politica_snapshot_hash: string | null
  contexto_configuracao_status: string | null
  contexto_capturado_em: string | null
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: AceiteSacadoStatus | null
  valor_bruto_total: number
  valor_liquido_desembolso: number
}

type NfContexto = {
  id: string
  numero_nf: string
  cedente_id: string
  status: string
  valor_bruto: number
  valor_liquido: number | null
  data_vencimento: string
}

function snapshotConsistente(op: OperacaoContexto): boolean {
  if (op.contexto_configuracao_status !== 'completo') return true
  const snapshot = op.politica_snapshot
  if (!snapshot || !op.politica_snapshot_hash || !op.politica_operacional_versao_id || !op.politica_operacional_id || !op.cedente_fundo_id || !op.politica_versao || !op.contexto_capturado_em) return false
  return snapshot.schema === 'bw-antecipa.politica-operacional.v1'
    && snapshot.cedente_fundo_id === op.cedente_fundo_id
    && snapshot.politica_operacional_id === op.politica_operacional_id
    && snapshot.politica_operacional_versao_id === op.politica_operacional_versao_id
    && snapshot.politica_versao === op.politica_versao
    && snapshot.aceite_sacado_obrigatorio === op.aceite_sacado_exigido
}

function estadoGateBase(estado: EstadoOperacional): GateOperacional {
  const bloqueios: string[] = []
  const avisos: string[] = []
  const legado = estado.legado

  if (legado) avisos.push('Operação histórica sem contexto completo; aplicado fallback legado de aceite obrigatório.')
  if (!estado.contexto_valido) bloqueios.push('O contexto operacional da operação está incompleto.')
  if (!estado.snapshot_consistente) bloqueios.push('O snapshot da operação diverge dos campos normalizados.')
  if (!['solicitada', 'em_analise'].includes(estado.status_operacao)) bloqueios.push(`A operação está no status "${estado.status_operacao}" e não pode ser analisada.`)
  if (estado.nfs.length === 0) bloqueios.push('A operação não possui NFs vinculadas.')

  for (const nf of estado.nfs) {
    if (nf.cedente_id !== estado.cedente_id) bloqueios.push(`A NF ${nf.numero_nf} não pertence ao cedente da operação.`)
    if (nf.status === 'cancelada' || nf.status === 'contestada') bloqueios.push(`A NF ${nf.numero_nf} está ${nf.status} e não pode seguir.`)
  }

  if (estado.aceite_exigido) {
    if (estado.aceite_status !== 'aceito') bloqueios.push(`O aceite do sacado está ${estado.aceite_status}, mas é obrigatório.`)
    for (const nf of estado.nfs) {
      if (nf.status !== 'aceita') bloqueios.push(`A NF ${nf.numero_nf} ainda não foi aceita pelo sacado.`)
    }
  } else if (estado.aceite_status !== 'dispensado') {
    bloqueios.push('A operação sem aceite obrigatório precisa estar marcada como dispensada.')
  }

  return {
    elegivel: bloqueios.length === 0,
    bloqueios,
    avisos,
    aceite_exigido: estado.aceite_exigido,
    aceite_status: estado.aceite_status,
    documentacao_status: 'nao_verificada',
    estado,
  }
}

export function avaliarEstadoOperacional(estado: EstadoOperacional): GateOperacional {
  return estadoGateBase(estado)
}

async function carregarEstado(client: AppSupabaseClient, operacaoId: string): Promise<EstadoOperacional | null> {
  const { data: operation, error: operationError } = await client
    .from('operacoes')
    .select('id, cedente_id, status, cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id, politica_versao, politica_snapshot, politica_snapshot_hash, contexto_configuracao_status, contexto_capturado_em, aceite_sacado_exigido, aceite_sacado_status, valor_bruto_total, valor_liquido_desembolso')
    .eq('id', operacaoId)
    .maybeSingle()
  if (operationError || !operation) return null

  const { data: links, error: linksError } = await client
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)
  if (linksError) return null

  const nfIds = ((links || []) as Array<{ nota_fiscal_id: string }>).map((link) => link.nota_fiscal_id)
  const { data: nfs, error: nfsError } = nfIds.length
    ? await client.from('notas_fiscais').select('id, numero_nf, cedente_id, status, valor_bruto, valor_liquido, data_vencimento').in('id', nfIds)
    : { data: [], error: null }
  if (nfsError) return null

  const op = operation as unknown as OperacaoContexto
  const legacy = op.aceite_sacado_exigido === null || op.aceite_sacado_status === null || op.contexto_configuracao_status !== 'completo'
  return {
    operacao_id: op.id,
    status_operacao: op.status,
    cedente_id: op.cedente_id,
    aceite_exigido: op.aceite_sacado_exigido ?? true,
    aceite_status: op.aceite_sacado_status ?? 'pendente',
    legado: legacy,
    contexto_valido: op.contexto_configuracao_status !== 'completo' || (!!op.cedente_fundo_id && !!op.politica_operacional_id && !!op.politica_operacional_versao_id && !!op.politica_versao && !!op.politica_snapshot && !!op.politica_snapshot_hash && !!op.contexto_capturado_em),
    snapshot_consistente: snapshotConsistente(op),
    nfs: (nfs || []) as NfContexto[],
  }
}

export async function obterEstadoOperacional(client: AppSupabaseClient, operacaoId: string): Promise<GateOperacional> {
  const estado = await carregarEstado(client, operacaoId)
  if (!estado) {
    return { elegivel: false, bloqueios: ['Operação não encontrada.'], avisos: [], aceite_exigido: true, aceite_status: 'pendente', documentacao_status: 'nao_verificada' }
  }
  const gate = avaliarEstadoOperacional(estado)
  if (estado.legado) gate.documentacao_status = 'legado'
  return gate
}

export async function validarGateAceiteSacado(client: AppSupabaseClient, notaFiscalId: string): Promise<GateOperacional> {
  const { data: link } = await client.from('operacoes_nfs').select('operacao_id').eq('nota_fiscal_id', notaFiscalId).limit(1).maybeSingle()
  if (!link) return { elegivel: false, bloqueios: ['A NF não está vinculada a uma operação.'], avisos: [], aceite_exigido: true, aceite_status: 'pendente', documentacao_status: 'nao_verificada' }

  const gate = await obterEstadoOperacional(client, (link as { operacao_id: string }).operacao_id)
  if (!gate.aceite_exigido || gate.aceite_status === 'dispensado') {
    return { ...gate, elegivel: false, bloqueios: ['Esta operação não exige aceite do sacado.'] }
  }
  if (gate.aceite_status !== 'pendente') return { ...gate, elegivel: false, bloqueios: [`A operação não está aberta para aceite (${gate.aceite_status}).`] }
  const nf = gate.estado?.nfs.find((item) => item.id === notaFiscalId)
  if (!nf) return { ...gate, elegivel: false, bloqueios: ['A NF não pertence à operação relacionada.'] }
  if (nf.status !== 'em_antecipacao') return { ...gate, elegivel: false, bloqueios: ['Esta NF não está aberta para aceite.'] }
  return { ...gate, elegivel: true, bloqueios: [] }
}

export function validarElegibilidadeSolicitacao(input: { snapshot: Record<string, unknown>; politicaOperacionalVersaoId: string; aceiteSacadoObrigatorio: boolean; quantidadeNfs: number }): GateOperacional {
  const bloqueios: string[] = []
  if (!input.politicaOperacionalVersaoId || !input.snapshot) bloqueios.push('A solicitação não possui contexto de política completo.')
  if (input.quantidadeNfs <= 0) bloqueios.push('A solicitação precisa possuir ao menos uma NF.')
  if (input.snapshot.aceite_sacado_obrigatorio !== input.aceiteSacadoObrigatorio) bloqueios.push('O snapshot diverge da decisão normalizada de aceite.')
  return { elegivel: bloqueios.length === 0, bloqueios, avisos: [], aceite_exigido: input.aceiteSacadoObrigatorio, aceite_status: input.aceiteSacadoObrigatorio ? 'pendente' : 'dispensado', documentacao_status: 'nao_verificada' }
}

export async function validarElegibilidadeAprovacao(client: AppSupabaseClient, operacaoId: string, valores?: { taxaDesconto?: number; valorLiquidoDesembolso?: number }): Promise<GateOperacional> {
  const gate = await obterEstadoOperacional(client, operacaoId)
  if (!gate.estado) return gate

  const taxa = valores?.taxaDesconto ?? 0
  const liquido = valores?.valorLiquidoDesembolso ?? gate.estado.nfs.reduce((total, nf) => total + (nf.valor_liquido ?? nf.valor_bruto), 0)
  if (!Number.isFinite(taxa) || taxa < 0) gate.bloqueios.push('A taxa de desconto é inválida.')
  if (!Number.isFinite(liquido) || liquido <= 0) gate.bloqueios.push('O valor líquido de desembolso deve ser maior que zero.')
  if (!Number.isFinite(gate.estado.nfs.reduce((total, nf) => total + nf.valor_bruto, 0)) || gate.estado.nfs.some((nf) => !Number.isFinite(nf.valor_bruto) || nf.valor_bruto <= 0)) gate.bloqueios.push('A operação possui valor financeiro de NF inválido.')

  const documental = await Promise.all(gate.estado.nfs.map(async (nf) => {
    try { return await verificarElegibilidadeDocumental(nf.id) } catch { return null }
  }))
  const naoVerificado = documental.some((item) => item === null)
  const incompleta = documental.some((item) => item !== null && !item.elegivel)
  gate.documentacao_status = naoVerificado ? 'nao_verificada' : incompleta ? 'incompleta' : gate.estado.legado ? 'legado' : 'satisfeita'
  if (naoVerificado) gate.bloqueios.push('Não foi possível verificar a documentação pré-cessão.')
  if (incompleta) gate.bloqueios.push('A documentação pré-cessão obrigatória não está satisfeita.')
  gate.elegivel = gate.bloqueios.length === 0
  return gate
}

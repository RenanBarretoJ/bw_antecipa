import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { requireAuthenticated } from '@/lib/auth/authorization'
import type { HistoricoCategoria, HistoricoVisibilidade } from './formatters'

type ContextoEvento = {
  tenant_id?: string | null
  fundo_id?: string | null
  cedente_id?: string | null
  cedente_fundo_id?: string | null
  nota_fiscal_id?: string | null
  operacao_id?: string | null
}

export type RegistrarEventoDominioInput = ContextoEvento & {
  tipo_evento: string
  categoria: HistoricoCategoria
  descricao: string
  metadata?: Record<string, unknown>
  visibilidade?: HistoricoVisibilidade
  correlation_id?: string | null
  origem?: string
  origem_evento?: string | null
  origem_registro_id?: string | null
}

export async function carregarContextoEventoNota(
  client: AppSupabaseClient,
  notaFiscalId: string,
): Promise<ContextoEvento & { numero_nf?: string | null; valor_bruto?: number | null; status?: string | null }> {
  const { data } = await client
    .from('notas_fiscais')
    .select('id, numero_nf, status, valor_bruto, cedente_id, cedente_fundo_id, fundo_id')
    .eq('id', notaFiscalId)
    .maybeSingle()

  const nf = data as {
    id: string
    numero_nf: string | null
    status: string | null
    valor_bruto: number | null
    cedente_id: string | null
    cedente_fundo_id: string | null
    fundo_id: string | null
  } | null

  return {
    tenant_id: nf?.fundo_id ?? null,
    fundo_id: nf?.fundo_id ?? null,
    cedente_id: nf?.cedente_id ?? null,
    cedente_fundo_id: nf?.cedente_fundo_id ?? null,
    nota_fiscal_id: nf?.id ?? notaFiscalId,
    numero_nf: nf?.numero_nf ?? null,
    valor_bruto: nf?.valor_bruto ?? null,
    status: nf?.status ?? null,
  }
}

export async function carregarContextoEventoOperacao(
  client: AppSupabaseClient,
  operacaoId: string,
): Promise<ContextoEvento & { valor_bruto_total?: number | null; status?: string | null; quantidade_nfs?: number }> {
  const { data: operacao } = await client
    .from('operacoes')
    .select('id, cedente_id, cedente_fundo_id, valor_bruto_total, status')
    .eq('id', operacaoId)
    .maybeSingle()

  const { data: nfs } = await client
    .from('operacoes_nfs')
    .select('notas_fiscais(id, fundo_id)')
    .eq('operacao_id', operacaoId)

  const op = operacao as {
    id: string
    cedente_id: string | null
    cedente_fundo_id: string | null
    valor_bruto_total: number | null
    status: string | null
  } | null
  const nfRows = (nfs ?? []) as Array<{ notas_fiscais?: { id: string; fundo_id: string | null } | null }>
  const fundoId = nfRows.find((row) => row.notas_fiscais?.fundo_id)?.notas_fiscais?.fundo_id ?? null

  return {
    tenant_id: fundoId,
    fundo_id: fundoId,
    cedente_id: op?.cedente_id ?? null,
    cedente_fundo_id: op?.cedente_fundo_id ?? null,
    operacao_id: op?.id ?? operacaoId,
    valor_bruto_total: op?.valor_bruto_total ?? null,
    status: op?.status ?? null,
    quantidade_nfs: nfRows.length,
  }
}

export async function carregarContextoEventoDocumentoVersao(
  client: AppSupabaseClient,
  versaoId: string,
): Promise<ContextoEvento & {
  documento_nome?: string | null
  documento_tipo?: string | null
  numero_versao?: number | null
  nome_arquivo?: string | null
}> {
  const { data: versao } = await client
    .from('documento_versoes')
    .select('id, documento_id, numero_versao, nome_original')
    .eq('id', versaoId)
    .maybeSingle()

  const typedVersao = versao as {
    id: string
    documento_id: string
    numero_versao: number | null
    nome_original: string | null
  } | null
  if (!typedVersao) return {}

  const { data: documento } = await client
    .from('documentos_repositorio')
    .select('id, documento_tipo_id')
    .eq('id', typedVersao.documento_id)
    .maybeSingle()
  const typedDocumento = documento as { id: string; documento_tipo_id: string | null } | null

  const { data: tipo } = typedDocumento?.documento_tipo_id
    ? await client
      .from('documento_tipos')
      .select('codigo, nome')
      .eq('id', typedDocumento.documento_tipo_id)
      .maybeSingle()
    : { data: null }

  const { data: vinculo } = await client
    .from('documento_vinculos')
    .select('nota_fiscal_id, operacao_id, nota_fiscal_entrega_id, cedente_id')
    .eq('documento_id', typedVersao.documento_id)
    .limit(1)
    .maybeSingle()

  const typedVinculo = vinculo as {
    nota_fiscal_id: string | null
    operacao_id: string | null
    nota_fiscal_entrega_id?: string | null
    cedente_id: string | null
  } | null

  let contexto: ContextoEvento = {}
  if (typedVinculo?.nota_fiscal_id) {
    contexto = await carregarContextoEventoNota(client, typedVinculo.nota_fiscal_id)
  } else if (typedVinculo?.nota_fiscal_entrega_id) {
    const { data: entrega } = await client
      .from('nota_fiscal_entregas')
      .select('nota_fiscal_id')
      .eq('id', typedVinculo.nota_fiscal_entrega_id)
      .maybeSingle()
    const notaFiscalId = (entrega as { nota_fiscal_id?: string | null } | null)?.nota_fiscal_id
    if (notaFiscalId) contexto = await carregarContextoEventoNota(client, notaFiscalId)
  } else if (typedVinculo?.operacao_id) {
    contexto = await carregarContextoEventoOperacao(client, typedVinculo.operacao_id)
  }

  return {
    ...contexto,
    cedente_id: contexto.cedente_id ?? typedVinculo?.cedente_id ?? null,
    documento_nome: (tipo as { nome?: string | null } | null)?.nome ?? null,
    documento_tipo: (tipo as { codigo?: string | null } | null)?.codigo ?? null,
    numero_versao: typedVersao.numero_versao,
    nome_arquivo: typedVersao.nome_original,
  }
}

export async function registrarEventoDominio(
  input: RegistrarEventoDominioInput,
  client?: AppSupabaseClient,
) {
  try {
    const context = await requireAuthenticated(client)
    const payload = {
      tenant_id: input.tenant_id ?? input.fundo_id ?? null,
      fundo_id: input.fundo_id ?? null,
      cedente_id: input.cedente_id ?? null,
      cedente_fundo_id: input.cedente_fundo_id ?? null,
      nota_fiscal_id: input.nota_fiscal_id ?? null,
      operacao_id: input.operacao_id ?? null,
      tipo_evento: input.tipo_evento,
      categoria: input.categoria,
      ator_usuario_id: context.user.id,
      ator_nome_snapshot: context.profile.nome_completo || context.profile.email || 'Usuario',
      ator_perfil_snapshot: context.profile.role,
      origem: input.origem ?? 'app',
      descricao: input.descricao,
      metadata: input.metadata ?? {},
      visibilidade: input.visibilidade ?? 'ambos',
      correlation_id: input.correlation_id ?? null,
      origem_evento: input.origem_evento ?? null,
      origem_registro_id: input.origem_registro_id ?? null,
    }

    const { error } = await context.supabase.from('eventos_dominio').insert(payload as never)
    if (error) {
      console.error('[eventos_dominio] falha_ao_registrar', {
        tipo_evento: input.tipo_evento,
        nota_fiscal_id: input.nota_fiscal_id,
        operacao_id: input.operacao_id,
        erro: error.message,
      })
    }
  } catch (error) {
    console.error('[eventos_dominio] falha_inesperada', {
      tipo_evento: input.tipo_evento,
      nota_fiscal_id: input.nota_fiscal_id,
      operacao_id: input.operacao_id,
      erro: error instanceof Error ? error.message : String(error),
    })
  }
}

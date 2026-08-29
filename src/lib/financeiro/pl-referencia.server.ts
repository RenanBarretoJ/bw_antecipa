import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  selecionarPlReferenciaTemporal,
  type PlReferenciaCandidato,
  type PlReferenciaResolvido,
} from './pl-referencia'

type PlReferenciaQueryRow = {
  id: string
  importacao_id: string
  fundo_id: string
  data_referencia: string
  patrimonio_liquido: string | number
  vigente: boolean
  publicada_em: string | null
  importacao: {
    id: string
    status: string
    tipo_base: string
    completude: string
    origem: string | null
    provedor: string | null
    publicada_em: string | null
    hash_conteudo: string | null
  } | null
}

function mapearCandidato(row: PlReferenciaQueryRow): PlReferenciaCandidato | null {
  if (!row.importacao) return null
  return {
    fundoId: row.fundo_id,
    snapshotId: row.id,
    importacaoId: row.importacao_id,
    dataBase: row.data_referencia,
    patrimonioLiquido: String(row.patrimonio_liquido),
    snapshotVigente: row.vigente,
    snapshotPublicadaEm: row.publicada_em,
    importacaoPublicadaEm: row.importacao.publicada_em,
    importacaoStatus: row.importacao.status,
    importacaoTipoBase: row.importacao.tipo_base,
    importacaoCompletude: row.importacao.completude,
    importacaoOrigem: row.importacao.origem,
    importacaoProvedor: row.importacao.provedor,
    importacaoHashConteudo: row.importacao.hash_conteudo,
  }
}

export async function resolverPlReferencia(
  client: SupabaseClient<Database>,
  input: { fundoId: string; dataOperacional: string },
): Promise<PlReferenciaResolvido | null> {
  const { data, error } = await client.from('carteira_snapshots')
    .select(`
      id,importacao_id,fundo_id,data_referencia,patrimonio_liquido,vigente,publicada_em,
      importacao:importacoes_financeiras!carteira_snapshots_importacao_id_fkey!inner(
        id,status,tipo_base,completude,origem,provedor,publicada_em,hash_conteudo
      )
    `)
    .eq('fundo_id', input.fundoId)
    .eq('vigente', true)
    .lt('data_referencia', input.dataOperacional)
    .gt('patrimonio_liquido', 0)
    .eq('importacao.status', 'PUBLICADA')
    .eq('importacao.tipo_base', 'CARTEIRA')
    .eq('importacao.completude', 'COMPLETO_COM_DADOS')
    .order('data_referencia', { ascending: false })
    .order('publicada_em', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Nao foi possivel resolver o PL de referencia: ${error.message}`)
  if (!data) return null
  const candidato = mapearCandidato(data as unknown as PlReferenciaQueryRow)
  return candidato
    ? selecionarPlReferenciaTemporal({ ...input, candidatos: [candidato] })
    : null
}

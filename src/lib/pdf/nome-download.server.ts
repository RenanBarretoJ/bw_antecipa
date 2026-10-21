import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { ContratoDocumentType, ContratoEntityType } from '@/lib/types/domain'
import { nomeDocumentoDownload } from '@/lib/arquivos/nomes'

type Client = SupabaseClient<Database>

export async function nomeDocumentoDoFundo(supabase: Client, input: {
  fundoId: string; tipo: ContratoDocumentType; identificador: string
}): Promise<string | null> {
  const { data, error } = await supabase.from('fundos').select('nome').eq('id', input.fundoId).maybeSingle()
  if (error) throw new Error('Nao foi possivel identificar o Fundo do documento.')
  return data ? nomeDocumentoDownload({ tipo: input.tipo, fundoNome: data.nome, identificador: input.identificador }) : null
}

/** Call only AFTER entity authorization, with its registered path, never a client-supplied path/fund. */
export async function resolverNomeDownloadDocumento(supabase: Client, input: {
  entidadeTipo: ContratoEntityType; entidadeId: string; tipo: ContratoDocumentType; storagePath: string
}): Promise<string | null> {
  if (input.tipo === 'remessa' || input.tipo === 'comprovante_pagamento') return null
  let fundoId: string | null = null
  let identificador = input.entidadeId
  if (input.entidadeTipo === 'operacao') {
    const { data: op, error } = await supabase.from('operacoes').select('cedente_fundo_id').eq('id', input.entidadeId).maybeSingle()
    if (error) throw new Error('Nao foi possivel identificar o contexto do documento.')
    if (op?.cedente_fundo_id) {
      const { data: link, error } = await supabase.from('cedente_fundos').select('fundo_id').eq('id', op.cedente_fundo_id).maybeSingle()
      if (error) throw new Error('Nao foi possivel identificar o Fundo historico do documento.')
      fundoId = link?.fundo_id ?? null
    }
  } else {
    const { data: ced, error } = await supabase.from('cedentes').select('cnpj').eq('id', input.entidadeId).maybeSingle()
    if (error) throw new Error('Nao foi possivel identificar o cedente do documento.')
    if (!ced) return null
    identificador = ced.cnpj
    const { data: doc, error: docError } = await supabase.from('documentos_gerados').select('fundo_id')
      .eq('cedente_id', input.entidadeId).eq('storage_path', input.storagePath).maybeSingle()
    if (docError) throw new Error('Nao foi possivel identificar a origem do documento.')
    fundoId = doc?.fundo_id ?? null
    if (!fundoId) {
      const { data: links, error } = await supabase.from('cedente_fundos').select('fundo_id')
        .eq('cedente_id', input.entidadeId).eq('status', 'ativo').limit(2)
      if (error) throw new Error('Nao foi possivel identificar o Fundo do contrato.')
      // Never guess the fund of an ambiguous legacy shared contract from the active-fund cookie.
      if (links?.length === 1) fundoId = links[0].fundo_id
    }
  }
  return fundoId ? nomeDocumentoDoFundo(supabase, { fundoId, tipo: input.tipo, identificador }) : null
}

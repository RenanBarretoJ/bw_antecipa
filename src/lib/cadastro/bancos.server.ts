import 'server-only'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import type { BancoCatalogo } from './types'

export type { BancoCatalogo }

const BRASILAPI_BANKS_URL = 'https://brasilapi.com.br/api/banks/v1'
const TIMEOUT_MS = 10_000

export async function buscarBancos(
  client: AppSupabaseClient,
  termo: string,
  limite = 20,
): Promise<BancoCatalogo[]> {
  const termoNormalizado = (termo || '').trim()
  let query = client
    .from('bancos')
    .select('id, codigo, ispb, nome, nome_completo')
    .eq('ativo', true)
    .order('codigo', { ascending: true })
    .limit(limite)

  if (termoNormalizado) {
    const somenteDigitos = termoNormalizado.replace(/\D/g, '')
    const filtros = [`nome.ilike.%${termoNormalizado}%`, `codigo.ilike.%${termoNormalizado}%`]
    if (somenteDigitos) filtros.push(`ispb.ilike.%${somenteDigitos}%`)
    query = query.or(filtros.join(','))
  }

  const { data, error } = await query
  if (error) throw new Error(`Nao foi possivel consultar o catalogo de bancos: ${error.message}`)
  return (data || []) as BancoCatalogo[]
}

type BrasilApiBanco = {
  ispb?: string
  code?: number | null
  fullName?: string
  name?: string
}

/**
 * Busca a lista completa de bancos na BrasilAPI e sincroniza (upsert) no
 * catalogo canonico via RPC SECURITY DEFINER gated a super_admin. Nao
 * apaga registros -- apenas insere/atualiza por codigo.
 */
export async function sincronizarBancosBrasilApi(
  client: AppSupabaseClient,
  fetchFn: typeof fetch = fetch,
): Promise<{ totalRecebido: number; totalUpsertado: number }> {
  let response: Response
  try {
    response = await fetchFn(BRASILAPI_BANKS_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('A sincronizacao de bancos demorou demais para responder.')
    }
    throw new Error('Nao foi possivel consultar a BrasilAPI para sincronizar os bancos.')
  }

  if (!response.ok) {
    throw new Error('Servico de bancos da BrasilAPI indisponivel no momento.')
  }

  let payload: BrasilApiBanco[]
  try {
    payload = await response.json()
  } catch {
    throw new Error('Resposta invalida da BrasilAPI ao sincronizar bancos.')
  }

  const bancos = (Array.isArray(payload) ? payload : [])
    .filter((b) => b.code !== null && b.code !== undefined && b.name)
    .map((b) => ({
      codigo: String(b.code).padStart(3, '0'),
      ispb: b.ispb || null,
      nome: b.name as string,
      nome_completo: b.fullName || null,
    }))

  const { data, error } = await client.rpc('sincronizar_bancos_super_admin', { p_bancos: bancos })
  if (error) throw new Error(`Nao foi possivel sincronizar o catalogo de bancos: ${error.message}`)

  const resultado = (Array.isArray(data) ? data[0] : data) as { total_recebido: number; total_upsertado: number } | null
  return {
    totalRecebido: resultado?.total_recebido ?? 0,
    totalUpsertado: resultado?.total_upsertado ?? 0,
  }
}

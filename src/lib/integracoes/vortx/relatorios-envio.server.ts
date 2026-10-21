import 'server-only'
import { resolverConfiguracaoVortxVrs, type VortxVrsConfig } from './credenciais.server'
import { autenticarVortxVrs } from './vortx-vrs-client.server'
import { solicitarRelatorioVortxHttp } from './relatorios-http.server'
import type { SolicitacaoRelatorio } from './relatorios-operacao'

export type TransicionarRelatorio = (estado: 'enviando'|'falha_autenticacao'|'aceita'|'recusada'|'indeterminada', protocolo?: string|null, http?: number|null) => Promise<SolicitacaoRelatorio>

/** A single transport path for human and scheduled reservations; neither caller can supply credentials or a URL. */
export async function enviarRelatorioReservado(row: SolicitacaoRelatorio, transicionar: TransicionarRelatorio) {
  let token: string
  let config: VortxVrsConfig
  try {
    config = await resolverConfiguracaoVortxVrs(row.fundo_id, row.ambiente)
    const origin = row.ambiente === 'producao' ? 'https://api.vortx.com.br' : 'https://api-stg.vortx.com.br'
    if (config.fundoId !== row.fundo_id || config.ambiente !== row.ambiente || config.baseUrl !== origin) throw new Error('VRS_CREDENTIAL_SCOPE_MISMATCH')
    token = (await autenticarVortxVrs(config)).accessToken
  } catch { return transicionar('falha_autenticacao') }
  await transicionar('enviando') // SQL revalidates the current version/capability before the only provider POST.
  const resposta = await solicitarRelatorioVortxHttp({ ambiente: row.ambiente, token, pedido: row.pedido, credential: config.credential })
  return transicionar(resposta.estado, resposta.protocolo, resposta.http)
}

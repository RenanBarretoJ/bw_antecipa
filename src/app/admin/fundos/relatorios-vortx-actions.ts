'use server'

import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import { carregarContextoRelatorios } from '@/lib/integracoes/vortx/relatorios-contexto.server'
import { prepararSolicitacaoRelatorioVortx, ContratoRelatorioVortxError } from '@/lib/integracoes/vortx/relatorios-contrato'
import { solicitarRelatorioSchema, solicitacaoRelatorioSchema, RELATORIOS_OPERADOR, type SolicitacaoRelatorioResult } from '@/lib/integracoes/vortx/relatorios-operacao'
import { resolverConfiguracaoVortxVrs } from '@/lib/integracoes/vortx/credenciais.server'
import { autenticarVortxVrs } from '@/lib/integracoes/vortx/vortx-vrs-client.server'
import { solicitarRelatorioVortxHttp } from '@/lib/integracoes/vortx/relatorios-http.server'

const reservaSchema = z.object({ criada: z.boolean(), solicitacao: solicitacaoRelatorioSchema })

export async function solicitarRelatorioVortx(input: unknown): Promise<SolicitacaoRelatorioResult> {
  let reservada = false
  try {
    const parsed = solicitarRelatorioSchema.safeParse(input)
    if (!parsed.success) return { success: false, message: 'Revise o tipo, as datas e o código do autenticador.' }
    const form = parsed.data
    const { auth, contexto } = await carregarContextoRelatorios(form.fundoId)
    const versao = contexto.versoes.find(v => v.id === form.versaoId)
    const descricao = RELATORIOS_OPERADOR.find(r => r.tipo === form.tipo)
    if (!versao || !descricao || !versao.capabilities.includes(descricao.capability)) {
      return { success: false, message: 'Este relatório não está habilitado na versão publicada deste Fundo.' }
    }
    const pedido = prepararSolicitacaoRelatorioVortx({ codigoCarteira: versao.carteira, tipoRelatorio: form.tipo,
      dataInicio: form.inicio, dataFim: form.fim, dataReferencia: form.referencia, extensaoArquivo: form.extensao }, obterDataCivilOperacional())
    // Mesmo contrato de confirmação VRS; o nonce é consumido atomicamente com a reserva no banco.
    const autorizacao = await autorizarEConsumirAcaoSensivel(auth, 'testar_conexao_vortx_vrs', form.mfaCode, { consumoTransacional: true })
    if (!('nonceHash' in autorizacao) || !autorizacao.nonceHash) throw new Error('MISSING_TRANSACTION_NONCE')
    const lease = randomBytes(32).toString('hex')
    const { data, error } = await auth.supabase.rpc('admin_reservar_relatorio_vortx', {
      p_fundo_id: form.fundoId, p_versao_id: versao.id, p_tipo: pedido.tipoRelatorio, p_inicio: pedido.dataInicio,
      p_fim: pedido.dataFim, p_referencia: pedido.dataReferencia, p_extensao: pedido.extensaoArquivo,
      p_nonce_hash: autorizacao.nonceHash, p_lease_hash: createHash('sha256').update(lease).digest('hex'),
    })
    if (error) throw new Error('REPORT_RESERVATION_FAILED')
    const reserva = reservaSchema.parse(data)
    if (!reserva.criada) return { success: true, criada: false, solicitacao: reserva.solicitacao }
    reservada = true
    // Contexto retornado pela RPC deve coincidir com o pedido validado. Nunca aceitar carteira do cliente.
    const row = reserva.solicitacao
    if (row.fundo_id !== form.fundoId || row.integracao_versao_id !== versao.id || row.ambiente !== versao.ambiente
      || Object.entries(pedido).some(([key, value]) => row.pedido[key as keyof typeof pedido] !== value)) throw new Error('RESERVATION_SCOPE_MISMATCH')

    async function transicionar(estado: 'enviando'|'falha_autenticacao'|'aceita'|'recusada'|'indeterminada', protocolo: string|null = null, http: number|null = null) {
      const result = await auth.supabase.rpc('admin_transicionar_relatorio_vortx', {
        p_id: row.id, p_lease: lease, p_estado: estado, p_protocolo: protocolo, p_http: http,
      })
      if (result.error) throw new Error('REPORT_TRANSITION_FAILED')
      return solicitacaoRelatorioSchema.parse(result.data)
    }
    let token: string
    try {
      const config = await resolverConfiguracaoVortxVrs(form.fundoId, row.ambiente)
      const origin = row.ambiente === 'producao' ? 'https://api.vortx.com.br' : 'https://api-stg.vortx.com.br'
      if (config.fundoId !== form.fundoId || config.ambiente !== row.ambiente || config.baseUrl !== origin) throw new Error('VRS_CREDENTIAL_SCOPE_MISMATCH')
      token = (await autenticarVortxVrs(config)).accessToken
    } catch {
      return { success: true, criada: true, solicitacao: await transicionar('falha_autenticacao') }
    }
    await transicionar('enviando') // Se o banco não registrar o início, não enviar o POST.
    const resposta = await solicitarRelatorioVortxHttp({ ambiente: row.ambiente, token, pedido: row.pedido })
    return { success: true, criada: true, solicitacao: await transicionar(resposta.estado, resposta.protocolo, resposta.http) }
  } catch (error) {
    if (!reservada && (error instanceof AuthorizationError || error instanceof ContratoRelatorioVortxError)) {
      return { success: false, message: error.message }
    }
    return { success: false, message: reservada
      ? 'O pedido foi registrado, mas a conclusão não foi confirmada. Atualize o histórico e procure o suporte antes de reenviar. Não houve retentativa automática.'
      : 'Não foi possível registrar o pedido. Nenhuma solicitação de relatório foi enviada à Vórtx.' }
  }
}

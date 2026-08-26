import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import {
  construirRequestPayloadSanitizado,
  decodificarImagemBase64,
  mimeDeclaradoCompativel,
  type PayloadComprovanteWebhookValidado,
} from './webhook-comprovante-transportadora-payload'
import {
  datasComprovanteWebhookPlausiveis,
  resolverComprovanteWebhook,
  validarCruzamentoComprovanteWebhook,
  type CteVinculoPorChave,
  type NotaFiscalRemessaPorChave,
  type NotaFiscalVendaPorChave,
} from './webhook-comprovante-transportadora-matching'
import { enviarObjetoDocumento, gerarCaminhoEvidenciaWebhookTransportadora, removerObjetoDocumento } from '@/lib/documentos-v2/storage'
import { DOCUMENTO_V2_BUCKET } from '@/lib/documentos-v2/tipos'

export type AdminClient = ReturnType<typeof createAdminClient>

export type IntegracaoTransportadora = {
  id: string
  fundoId: string
  provider: string
  cnpjTransportadora: string | null
}

/**
 * Resolve o Bearer token para a integracao de transportadora correspondente
 * -- nunca em texto puro (hash SHA-256, mesmo algoritmo com que o token foi
 * hasheado na criacao/rotacao). Falha silenciosamente (retorna null) para
 * qualquer token invalido/nao-ativo/de integracao inativa/de outro provider
 * -- a rota mapeia isso para 401. O token vive em
 * integracoes_transportadoras_tokens (historico, P1) -- so o status
 * 'ativo' autentica; 'substituido'/'revogado' nunca autenticam de novo,
 * mesmo que o hash ainda exista na tabela para auditoria.
 */
export async function resolverIntegracaoPorToken(
  token: string,
  provider: string,
  client: AdminClient = createAdminClient(),
): Promise<IntegracaoTransportadora | null> {
  if (!token) return null
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
  const { data: tokenRow, error: tokenError } = await client
    .from('integracoes_transportadoras_tokens')
    .select('integracao_id')
    .eq('token_hash', tokenHash)
    .eq('status', 'ativo')
    .maybeSingle()
  if (tokenError || !tokenRow) return null

  const { data, error } = await client
    .from('integracoes_transportadoras')
    .select('id, fundo_id, provider, cnpj_transportadora')
    .eq('id', tokenRow.integracao_id)
    .eq('ativo', true)
    .maybeSingle()
  if (error || !data) return null
  if (data.provider !== provider) return null
  return { id: data.id, fundoId: data.fundo_id, provider: data.provider, cnpjTransportadora: data.cnpj_transportadora }
}

export type ResultadoWebhookComprovante = {
  status:
    | 'PROCESSADO'
    | 'DUPLICADO'
    | 'NAO_IDENTIFICADO'
    | 'REVISAO_MATCH'
    | 'IGNORADO_CANHOTO_JA_APROVADO'
    | 'AGUARDANDO_ENTREGA'
    | 'ERRO_REPROCESSAVEL'
    | 'ERRO_FINAL'
    | 'EVIDENCIA_INDISPONIVEL'
  webhookEventoId: string
  canhotoId: string | null
  detalhe: string | null
}

type RpcRegistrarComprovanteResultado = { status: string; canhoto_id: string | null; requisito_id: string | null }

/** Status elegiveis para reprocessamento real (secao 3 do ticket). */
export const STATUSES_REPROCESSAVEIS = ['NAO_IDENTIFICADO', 'REVISAO_MATCH', 'ERRO_REPROCESSAVEL'] as const

/**
 * Persiste a copia sanitizada do JSON efetivamente devolvido ao carrier
 * (P0_Claude_Webhook_Transportadora_Payloads_Auditoria_v2) -- chamado pela
 * rota logo antes de responder, so quando ja existe um webhook_evento_id
 * real (a resposta FINAL, apos processarWebhookComprovanteTransportadora
 * resolver). Respostas de autenticacao/validacao anteriores ao INSERT do
 * inbox (401/400 sem evento criado ainda) nao tem linha para anexar --
 * comportamento inalterado para esses casos.
 */
export async function registrarRespostaWebhookComprovante(
  webhookEventoId: string,
  input: { payload: unknown; httpStatus: number },
  client: AdminClient = createAdminClient(),
): Promise<void> {
  if (!webhookEventoId) return
  await client
    .from('integracao_logistica_webhook_eventos')
    .update({
      response_payload: input.payload,
      response_http_status: input.httpStatus,
      respondido_em: new Date().toISOString(),
    })
    .eq('id', webhookEventoId)
}

function calcularIdempotencyKey(input: {
  integracaoId: string
  externalEventId: string | null
  chaveCte: string | null
  chaveNfe: string
  dataEntregaNfe: string
  imagemSha256: string
}): string {
  const base = input.externalEventId
    ? `ext:${input.integracaoId}:${input.externalEventId}`
    : `derived:${input.integracaoId}:${input.chaveCte || ''}:${input.chaveNfe}:${input.dataEntregaNfe}:${input.imagemSha256}`
  return createHash('sha256').update(base, 'utf8').digest('hex')
}

function extensaoPorContentType(contentType: string): string {
  if (contentType === 'image/jpeg' || contentType === 'image/jpg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  return 'pdf'
}

export async function carregarVendaPorChave(client: AdminClient, chaveNfe: string): Promise<NotaFiscalVendaPorChave | null> {
  const { data } = await client
    .from('notas_fiscais')
    .select('id, fundo_id, cedente_id, cnpj_emitente, cnpj_destinatario')
    .eq('chave_acesso', chaveNfe)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, fundoId: data.fundo_id, cedenteId: data.cedente_id, cnpjEmitente: data.cnpj_emitente, cnpjDestinatario: data.cnpj_destinatario }
}

export async function carregarRemessaPorChave(client: AdminClient, chaveNfe: string): Promise<NotaFiscalRemessaPorChave | null> {
  const { data } = await client
    .from('nota_fiscal_remessas')
    .select('id, nota_fiscal_venda_id, status_validacao, emitente_cnpj')
    .eq('chave_acesso', chaveNfe)
    .maybeSingle()
  if (!data) return null
  return { id: data.id, notaFiscalVendaId: data.nota_fiscal_venda_id, statusValidacao: data.status_validacao, emitenteCnpj: data.emitente_cnpj }
}

export async function carregarVinculosPorChaveCte(client: AdminClient, chaveCte: string): Promise<{ cteEncontrado: boolean; cteId: string | null; cnpjTransportadora: string | null; vinculos: CteVinculoPorChave[] }> {
  const { data: cte } = await client.from('ctes').select('id, cnpj_transportadora').eq('chave_cte', chaveCte).maybeSingle()
  if (!cte) return { cteEncontrado: false, cteId: null, cnpjTransportadora: null, vinculos: [] }
  const { data: vinculos } = await client
    .from('cte_notas_fiscais')
    .select('nota_fiscal_id, nota_fiscal_remessa_id, tipo_vinculo')
    .eq('cte_id', cte.id)
  return {
    cteEncontrado: true,
    cteId: cte.id,
    cnpjTransportadora: cte.cnpj_transportadora,
    vinculos: (vinculos || []).map((v) => ({ notaFiscalId: v.nota_fiscal_id, notaFiscalRemessaId: v.nota_fiscal_remessa_id, tipoVinculo: v.tipo_vinculo })),
  }
}

async function finalizarComErro(
  client: AdminClient,
  webhookEventoId: string,
  status: ResultadoWebhookComprovante['status'],
  erroCodigo: string,
  detalhe: string,
  tentativaCountAtual: number | null,
): Promise<ResultadoWebhookComprovante> {
  const patch: Record<string, unknown> = { status, processado_em: new Date().toISOString(), erro_codigo: erroCodigo, erro_detalhe: detalhe }
  if (tentativaCountAtual !== null) patch.tentativa_count = tentativaCountAtual + 1
  await client.from('integracao_logistica_webhook_eventos').update(patch).eq('id', webhookEventoId)
  return { status, webhookEventoId, canhotoId: null, detalhe }
}

/**
 * Nucleo compartilhado entre o processamento em tempo real e o
 * reprocessamento (P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora)
 * -- os dois chegam aqui com o arquivo JA persistido (bucket/path
 * conhecidos), diferindo so em ONDE o arquivo foi salvo (upload novo vs.
 * recarregado do proprio evento). Faz a resolucao de vinculo, validacao
 * cruzada e, se resolver, chama a MESMA RPC de persistencia
 * (registrar_comprovante_entrega_webhook) que ja cria
 * documentos_repositorio/documento_versoes/canhotos -- nunca duplica essa
 * logica.
 */
async function resolverEFinalizarComprovante(input: {
  client: AdminClient
  webhookEventoId: string
  fundoId: string
  provider: string
  integracaoId: string
  cnpjTransportadoraIntegracao: string | null
  chaveNfe: string
  chaveCte: string | null
  cnpjCliente: string
  cnpjEmitente: string
  cnpjTransportadora: string
  dataEmissaoNfe: string
  dataEntregaNfe: string
  bucket: string
  path: string
  nomeOriginal: string
  mimeType: string
  tamanhoBytes: number
  sha256: string
  tentativaCountAtual: number | null
}): Promise<ResultadoWebhookComprovante> {
  const { client, webhookEventoId } = input

  const finalizar = async (status: ResultadoWebhookComprovante['status'], patch: Record<string, unknown> = {}): Promise<ResultadoWebhookComprovante> => {
    const updatePayload: Record<string, unknown> = { status, processado_em: new Date().toISOString(), ...patch }
    if (input.tentativaCountAtual !== null) updatePayload.tentativa_count = input.tentativaCountAtual + 1
    await client.from('integracao_logistica_webhook_eventos').update(updatePayload).eq('id', webhookEventoId)
    return { status, webhookEventoId, canhotoId: (patch.canhoto_id as string | undefined) ?? null, detalhe: (patch.erro_detalhe as string | undefined) ?? null }
  }

  // Regra 3: resolucao pela chave_nfe primeiro, chave_cte como fallback.
  const [vendaPorChave, remessaPorChave] = await Promise.all([
    carregarVendaPorChave(client, input.chaveNfe),
    carregarRemessaPorChave(client, input.chaveNfe),
  ])
  const porCte = input.chaveCte ? await carregarVinculosPorChaveCte(client, input.chaveCte) : null

  const resolucao = resolverComprovanteWebhook({
    chaveNfe: { vendaPorChave, remessaPorChave },
    chaveCte: porCte ? { cteEncontrado: porCte.cteEncontrado, vinculos: porCte.vinculos } : null,
  })

  if (resolucao.resultado === 'AMBIGUO') {
    return finalizar('REVISAO_MATCH', { erro_codigo: 'MATCH_AMBIGUO', erro_detalhe: 'chave_cte referencia mais de uma NF-e -- vinculo nao pode ser determinado automaticamente.' })
  }
  if (resolucao.resultado === 'NAO_IDENTIFICADO') {
    return finalizar('NAO_IDENTIFICADO', { erro_codigo: 'NF_NAO_ENCONTRADA', erro_detalhe: 'Nenhuma NF de venda ou remessa encontrada para chave_nfe/chave_cte informadas.' })
  }

  // Carrega a venda completa (o match por chave_cte pode nao ter vindo com os dados da venda ainda).
  const vendaResolvida = resolucao.metodo === 'CHAVE_NFE_VENDA' && vendaPorChave
    ? vendaPorChave
    : await (async () => {
      const { data } = await client
        .from('notas_fiscais')
        .select('id, fundo_id, cedente_id, cnpj_emitente, cnpj_destinatario')
        .eq('id', resolucao.notaFiscalVendaId)
        .maybeSingle()
      return data ? { id: data.id, fundoId: data.fundo_id, cedenteId: data.cedente_id, cnpjEmitente: data.cnpj_emitente, cnpjDestinatario: data.cnpj_destinatario } : null
    })()

  if (!vendaResolvida) {
    return finalizar('ERRO_REPROCESSAVEL', { erro_codigo: 'VENDA_NAO_CARREGADA', erro_detalhe: 'NF de venda resolvida mas nao pode ser carregada.' })
  }

  // Cross-fund deny: nunca revela a um integracao de outro fundo que a
  // chave bate com uma NF -- mesma resposta de "nao identificado".
  if (vendaResolvida.fundoId !== input.fundoId) {
    return finalizar('NAO_IDENTIFICADO', { erro_codigo: 'CROSS_FUND_DENY', erro_detalhe: 'NF resolvida pertence a outro fundo.' })
  }

  let cnpjEmitenteEsperado: string | null = vendaResolvida.cnpjEmitente
  if (resolucao.tipoVinculo === 'VIA_REMESSA' && resolucao.notaFiscalRemessaId) {
    const notaFiscalRemessaId = resolucao.notaFiscalRemessaId
    const remessa = resolucao.metodo === 'CHAVE_NFE_REMESSA' && remessaPorChave
      ? remessaPorChave
      : await (async () => {
        const { data } = await client
          .from('nota_fiscal_remessas')
          .select('id, nota_fiscal_venda_id, status_validacao, emitente_cnpj')
          .eq('id', notaFiscalRemessaId)
          .maybeSingle()
        return data ? { id: data.id, notaFiscalVendaId: data.nota_fiscal_venda_id, statusValidacao: data.status_validacao, emitenteCnpj: data.emitente_cnpj } : null
      })()
    if (!remessa || remessa.statusValidacao !== 'VALIDADA') {
      return finalizar('REVISAO_MATCH', { erro_codigo: 'REMESSA_NAO_VALIDADA', erro_detalhe: 'NF de remessa vinculada nao esta VALIDADA.' })
    }
    cnpjEmitenteEsperado = remessa.emitenteCnpj
  }

  const cnpjTransportadoraCte = porCte?.cnpjTransportadora ?? null
  const cruzamento = validarCruzamentoComprovanteWebhook({
    cnpjClientePayload: input.cnpjCliente,
    cnpjDestinatarioVenda: vendaResolvida.cnpjDestinatario,
    cnpjEmitentePayload: input.cnpjEmitente,
    cnpjEmitenteEsperado,
    cnpjTransportadoraPayload: input.cnpjTransportadora,
    cnpjTransportadoraEsperado: input.cnpjTransportadoraIntegracao || cnpjTransportadoraCte,
  })
  if (!cruzamento.ok) {
    return finalizar('REVISAO_MATCH', { erro_codigo: cruzamento.motivo, erro_detalhe: 'Divergencia material na validacao cruzada -- revisao manual necessaria.' })
  }
  if (!datasComprovanteWebhookPlausiveis(input.dataEmissaoNfe, input.dataEntregaNfe)) {
    return finalizar('REVISAO_MATCH', { erro_codigo: 'DATAS_INCONSISTENTES', erro_detalhe: 'data_entrega_nfe anterior a data_emissao_nfe.' })
  }

  // Pre-checagem (otimizacao -- evita chamar a RPC quando ja sabemos que ha
  // canhoto aprovado). Seguro remover o arquivo aqui -- hash/metadados ja
  // estao gravados no proprio evento (persisted_at), nunca se perde a
  // trilha de auditoria mesmo apos o arquivo ser removido do Storage.
  const { data: entregaAtual } = await client
    .from('nota_fiscal_entregas')
    .select('id')
    .eq('nota_fiscal_id', resolucao.notaFiscalVendaId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (entregaAtual) {
    const { data: canhotoAprovado } = await client
      .from('canhotos')
      .select('id')
      .eq('nota_fiscal_entrega_id', entregaAtual.id)
      .eq('status', 'aprovado')
      .maybeSingle()
    if (canhotoAprovado) {
      await removerObjetoDocumento(input.path).catch(() => {})
      // bucket/path nulos -- evidencia_retida (calculada nas RPCs admin a
      // partir de bucket/path) passa a refletir que o arquivo NAO existe
      // mais. sha256/mime/tamanho/persisted_at ficam intactos para
      // auditoria (prova de que o arquivo chegou a ser recebido).
      return finalizar('IGNORADO_CANHOTO_JA_APROVADO', {
        nota_fiscal_venda_id: resolucao.notaFiscalVendaId,
        nota_fiscal_remessa_id: resolucao.notaFiscalRemessaId,
        tipo_vinculo: resolucao.tipoVinculo,
        match_metodo: resolucao.metodo,
        canhoto_id: canhotoAprovado.id,
        bucket: null,
        path: null,
      })
    }
  }

  // Nunca envolve esta chamada num try/catch que apague o arquivo -- se a
  // RPC falhar, o arquivo fica retido (bucket/path ja gravados no evento)
  // para a proxima tentativa de reprocessamento. So propaga o erro; quem
  // chamou decide como finalizar (ERRO_REPROCESSAVEL), sem tocar no Storage.
  const { data: rpcData, error: rpcError } = await client.rpc('registrar_comprovante_entrega_webhook', {
    p_integracao_id: input.integracaoId,
    p_webhook_evento_id: webhookEventoId,
    p_nota_fiscal_venda_id: resolucao.notaFiscalVendaId,
    p_nota_fiscal_remessa_id: resolucao.notaFiscalRemessaId,
    p_tipo_vinculo: resolucao.tipoVinculo,
    p_bucket: input.bucket,
    p_path: input.path,
    p_nome_original: input.nomeOriginal,
    p_mime_type: input.mimeType,
    p_tamanho_bytes: input.tamanhoBytes,
    p_sha256: input.sha256,
    p_provider: input.provider,
  })
  if (rpcError) throw new Error(rpcError.message)
  const rpcResult = rpcData as RpcRegistrarComprovanteResultado

  const ignoradoNaRpc = rpcResult.status === 'IGNORADO_CANHOTO_JA_APROVADO'
  if (ignoradoNaRpc) {
    await removerObjetoDocumento(input.path).catch(() => {})
  }

  return finalizar(rpcResult.status as ResultadoWebhookComprovante['status'], {
    nota_fiscal_venda_id: resolucao.notaFiscalVendaId,
    nota_fiscal_remessa_id: resolucao.notaFiscalRemessaId,
    tipo_vinculo: resolucao.tipoVinculo,
    match_metodo: resolucao.metodo,
    canhoto_id: rpcResult.canhoto_id ?? null,
    // bucket/path nulos so quando o arquivo foi de fato removido (race:
    // RPC encontrou aprovado apesar da pre-checagem em TS ter passado) --
    // nunca para PROCESSADO/AGUARDANDO_ENTREGA, que ainda referenciam o
    // arquivo.
    ...(ignoradoNaRpc ? { bucket: null, path: null } : {}),
  })
}

/**
 * Orquestra o processamento sincrono de um evento de webhook ja autenticado
 * e com payload ja validado (a rota faz as duas coisas antes de chamar
 * isto). Nao ha infraestrutura de fila/outbox neste repositorio (ver
 * docs/integracoes/webhook-comprovante-transportadora.md) -- por isso o
 * processamento e inteiramente sincrono, dentro da mesma requisicao.
 *
 * Ordem canonica (P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora):
 * 1) idempotencia (grava o inbox / detecta duplicado);
 * 2) MIME real valido (senao ERRO_FINAL, sem upload -- nada a reter);
 * 3) salva o arquivo e grava bucket/path/tamanho/persisted_at no evento;
 * 4) so ENTAO roda o matching. Nunca depende do resultado do matching
 * para preservar a evidencia -- por isso NAO_IDENTIFICADO, REVISAO_MATCH
 * e ERRO_REPROCESSAVEL sempre retem o arquivo (podem ser reprocessados de
 * verdade depois).
 */
export type WebhookHttpMeta = {
  bodyBytes: number
  headers: { contentType: string | null; contentLength: string | null; userAgent: string | null }
}

const HTTP_META_VAZIO: WebhookHttpMeta = {
  bodyBytes: 0,
  headers: { contentType: null, contentLength: null, userAgent: null },
}

export async function processarWebhookComprovanteTransportadora(
  integracao: IntegracaoTransportadora,
  payload: PayloadComprovanteWebhookValidado,
  payloadHash: string,
  client: AdminClient = createAdminClient(),
  httpMeta: WebhookHttpMeta = HTTP_META_VAZIO,
): Promise<ResultadoWebhookComprovante> {
  const imagem = decodificarImagemBase64(payload.imagemBase64)
  const idempotencyKey = calcularIdempotencyKey({
    integracaoId: integracao.id,
    externalEventId: payload.externalEventId,
    chaveCte: payload.chaveCte,
    chaveNfe: payload.chaveNfe,
    dataEntregaNfe: payload.dataEntregaNfe,
    imagemSha256: imagem.sha256,
  })
  const requestPayload = construirRequestPayloadSanitizado({
    payload,
    bodyBytes: httpMeta.bodyBytes,
    imagemBase64Length: payload.imagemBase64.length,
    imagemDecodificada: imagem,
    headers: httpMeta.headers,
  })

  const { data: inserted, error: insertError } = await client
    .from('integracao_logistica_webhook_eventos')
    .insert({
      integracao_id: integracao.id,
      fundo_id: integracao.fundoId,
      provider: integracao.provider,
      external_event_id: payload.externalEventId,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
      imagem_sha256: imagem.sha256,
      chave_nfe: payload.chaveNfe,
      chave_cte: payload.chaveCte,
      cnpj_cliente: payload.cnpjCliente,
      cnpj_emitente: payload.cnpjEmitente,
      cnpj_transportadora: payload.cnpjTransportadora,
      data_emissao_nfe: payload.dataEmissaoNfe,
      data_entrega_nfe: payload.dataEntregaNfe,
      content_type: payload.contentType,
      status: 'RECEBIDO',
      request_payload: requestPayload,
    })
    .select('id')
    .single()

  if (insertError) {
    // 23505 = unique_violation -- ja recebemos este evento antes (mesma
    // idempotency_key ou mesmo external_event_id desta integracao).
    // Nunca cria uma segunda inbox, nunca reenvia o arquivo, nunca duplica
    // documento/canhoto -- mas um retry externo NUNCA deveria ficar
    // bloqueado por um evento que ainda esta em erro/pendente de match:
    // se o evento existente esta em NAO_IDENTIFICADO/REVISAO_MATCH/
    // ERRO_REPROCESSAVEL, reprocessa o MESMO evento (reusando o arquivo
    // ja retido) em vez de so devolver DUPLICADO. Para qualquer outro
    // status (PROCESSADO/AGUARDANDO_ENTREGA/IGNORADO_CANHOTO_JA_APROVADO/
    // ERRO_FINAL) devolve o resultado existente, sem reprocessar.
    if (insertError.code === '23505') {
      const { data: existente } = await client
        .from('integracao_logistica_webhook_eventos')
        .select('id, status, canhoto_id')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (!existente) {
        return { status: 'DUPLICADO', webhookEventoId: '', canhotoId: null, detalhe: 'Evento ja processado anteriormente (idempotency_key), mas o registro existente nao pode ser carregado.' }
      }
      if ((STATUSES_REPROCESSAVEIS as readonly string[]).includes(existente.status)) {
        try {
          return await reprocessarWebhookComprovanteTransportadora(existente.id, client)
        } catch {
          return { status: 'DUPLICADO', webhookEventoId: existente.id, canhotoId: existente.canhoto_id ?? null, detalhe: 'Evento ja processado anteriormente (idempotency_key).' }
        }
      }
      return { status: 'DUPLICADO', webhookEventoId: existente.id, canhotoId: existente.canhoto_id ?? null, detalhe: 'Evento ja processado anteriormente (idempotency_key).' }
    }
    throw new Error(`Nao foi possivel registrar o evento do webhook: ${insertError.message}`)
  }

  const webhookEventoId = inserted.id as string

  try {
    await client.from('integracao_logistica_webhook_eventos').update({ status: 'PROCESSANDO' }).eq('id', webhookEventoId)

    // MIME real precisa bater com o declarado ANTES de qualquer upload --
    // um arquivo invalido nunca e enviado ao Storage nem retido (reenviar
    // o mesmo Base64 sempre vai falhar do mesmo jeito -- nao e
    // reprocessavel, por isso ERRO_FINAL fica fora da lista de retencao).
    if (!mimeDeclaradoCompativel(imagem.mimeReal, payload.contentType)) {
      return finalizarComErro(
        client, webhookEventoId, 'ERRO_FINAL', 'MIME_REAL_INCOMPATIVEL',
        `content_type declarado (${payload.contentType}) nao corresponde ao conteudo real do arquivo.`,
        null,
      )
    }

    // Salva o arquivo e grava a referencia no proprio evento ANTES do
    // matching -- nunca depende do resultado do matching para preservar
    // a evidencia (o cerne deste ticket).
    const extensao = extensaoPorContentType(payload.contentType)
    const nomeOriginal = `comprovante-${webhookEventoId}.${extensao}`
    const path = gerarCaminhoEvidenciaWebhookTransportadora({ integracaoId: integracao.id, webhookEventoId, nomeOriginal })
    const arquivo = new File([new Uint8Array(imagem.buffer)], nomeOriginal, { type: payload.contentType })
    await enviarObjetoDocumento(path, arquivo, payload.contentType)
    await client
      .from('integracao_logistica_webhook_eventos')
      .update({ bucket: DOCUMENTO_V2_BUCKET, path, tamanho_bytes: imagem.buffer.byteLength, persisted_at: new Date().toISOString() })
      .eq('id', webhookEventoId)

    return await resolverEFinalizarComprovante({
      client,
      webhookEventoId,
      fundoId: integracao.fundoId,
      provider: integracao.provider,
      integracaoId: integracao.id,
      cnpjTransportadoraIntegracao: integracao.cnpjTransportadora,
      chaveNfe: payload.chaveNfe,
      chaveCte: payload.chaveCte,
      cnpjCliente: payload.cnpjCliente,
      cnpjEmitente: payload.cnpjEmitente,
      cnpjTransportadora: payload.cnpjTransportadora,
      dataEmissaoNfe: payload.dataEmissaoNfe,
      dataEntregaNfe: payload.dataEntregaNfe,
      bucket: DOCUMENTO_V2_BUCKET,
      path,
      nomeOriginal,
      mimeType: payload.contentType,
      tamanhoBytes: imagem.buffer.byteLength,
      sha256: imagem.sha256,
      tentativaCountAtual: null,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : 'Erro inesperado ao processar o webhook.'
    return finalizarComErro(client, webhookEventoId, 'ERRO_REPROCESSAVEL', 'ERRO_INESPERADO', detalhe, null)
  }
}

/**
 * Reprocessamento REAL (P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora):
 * usa o MESMO arquivo persistido no recebimento original (bucket/path/
 * tamanho/mime gravados no proprio evento) -- refaz a resolucao de
 * venda/remessa/CT-e e as validacoes cruzadas contra o estado ATUAL do
 * banco, e, se resolver, chama a MESMA RPC de persistencia do fluxo em
 * tempo real. Atualiza a MESMA linha do evento (nunca cria um novo inbox,
 * nunca duplica documento/canhoto). `EVIDENCIA_INDISPONIVEL` so acontece
 * como fallback de um evento legado (recebido antes desta correcao) que
 * genuinamente nao tem arquivo retido -- nunca e o resultado normal de um
 * reprocessamento hoje.
 */
export async function reprocessarWebhookComprovanteTransportadora(
  webhookEventoId: string,
  client: AdminClient = createAdminClient(),
): Promise<ResultadoWebhookComprovante> {
  const { data: evento, error: eventoError } = await client
    .from('integracao_logistica_webhook_eventos')
    .select('*')
    .eq('id', webhookEventoId)
    .maybeSingle()
  if (eventoError || !evento) {
    throw new Error('Evento de webhook nao encontrado.')
  }
  if (!(STATUSES_REPROCESSAVEIS as readonly string[]).includes(evento.status)) {
    throw new Error(`Evento em status '${evento.status}' nao pode ser reprocessado.`)
  }
  if (!evento.chave_nfe) {
    throw new Error('Evento sem chave_nfe registrada -- nao ha o que reprocessar.')
  }

  const tentativaCountAtual = (evento.tentativa_count as number | null) ?? 0

  // Legado: eventos recebidos antes desta correcao podem nao ter arquivo
  // retido. Nunca inventa nem recupera o arquivo -- fallback explicito,
  // nunca o caminho normal.
  if (!evento.bucket || !evento.path || !evento.tamanho_bytes || !evento.content_type) {
    return finalizarComErro(
      client, webhookEventoId, 'EVIDENCIA_INDISPONIVEL', 'ARQUIVO_LEGADO_NAO_RETIDO',
      'Este evento e anterior a correcao de retencao de evidencia e nao tem arquivo salvo -- solicite o reenvio do comprovante pela transportadora.',
      tentativaCountAtual,
    )
  }

  try {
    const { data: integracaoRow } = await client
      .from('integracoes_transportadoras')
      .select('cnpj_transportadora')
      .eq('id', evento.integracao_id)
      .maybeSingle()

    const extensao = extensaoPorContentType(evento.content_type)
    const nomeOriginal = `comprovante-${webhookEventoId}.${extensao}`

    return await resolverEFinalizarComprovante({
      client,
      webhookEventoId,
      fundoId: evento.fundo_id,
      provider: evento.provider,
      integracaoId: evento.integracao_id,
      cnpjTransportadoraIntegracao: integracaoRow?.cnpj_transportadora ?? null,
      chaveNfe: evento.chave_nfe,
      chaveCte: evento.chave_cte,
      cnpjCliente: evento.cnpj_cliente as string,
      cnpjEmitente: evento.cnpj_emitente as string,
      cnpjTransportadora: evento.cnpj_transportadora as string,
      dataEmissaoNfe: evento.data_emissao_nfe as string,
      dataEntregaNfe: evento.data_entrega_nfe as string,
      bucket: evento.bucket,
      path: evento.path,
      nomeOriginal,
      mimeType: evento.content_type,
      tamanhoBytes: evento.tamanho_bytes,
      sha256: evento.imagem_sha256 as string,
      tentativaCountAtual,
    })
  } catch (error) {
    const detalhe = error instanceof Error ? error.message : 'Erro inesperado ao reprocessar o webhook.'
    return finalizarComErro(client, webhookEventoId, 'ERRO_REPROCESSAVEL', 'ERRO_INESPERADO', detalhe, tentativaCountAtual)
  }
}

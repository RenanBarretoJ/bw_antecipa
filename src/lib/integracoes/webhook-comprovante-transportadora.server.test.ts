import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documentos-v2/storage', () => ({
  enviarObjetoDocumento: vi.fn(async () => undefined),
  removerObjetoDocumento: vi.fn(async () => undefined),
  gerarCaminhoEvidenciaWebhookTransportadora: vi.fn(() => 'webhooks-transportadora/integracao-1/evt-1/arquivo.png'),
}))

const {
  processarWebhookComprovanteTransportadora,
  reprocessarWebhookComprovanteTransportadora,
  resolverIntegracaoPorToken,
} = await import('./webhook-comprovante-transportadora.server')
const { enviarObjetoDocumento, removerObjetoDocumento } = await import('@/lib/documentos-v2/storage')

type FakeAdminClient = Parameters<typeof processarWebhookComprovanteTransportadora>[3]

type Eq = { column: string; value: unknown }
type Ctx = { table: string; method: 'maybeSingle' | 'single' | 'default'; eqs: Eq[]; insertPayload?: Record<string, unknown>; updatePayload?: Record<string, unknown> }
type Resposta = { data: unknown; error: unknown }

function criarClienteFake(input: { responder: (ctx: Ctx) => Resposta; rpc?: (name: string, params: unknown) => Promise<Resposta> }) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []

  function query(table: string) {
    const eqs: Eq[] = []
    let insertPayload: Record<string, unknown> | undefined
    let updatePayload: Record<string, unknown> | undefined
    const q = {
      select(...args: unknown[]) { calls.push({ table, method: 'select', args }); return q },
      eq(column: string, value: unknown) { calls.push({ table, method: 'eq', args: [column, value] }); eqs.push({ column, value }); return q },
      order(...args: unknown[]) { calls.push({ table, method: 'order', args }); return q },
      limit(...args: unknown[]) { calls.push({ table, method: 'limit', args }); return q },
      insert(payload: Record<string, unknown>) { calls.push({ table, method: 'insert', args: [payload] }); insertPayload = payload; return q },
      update(payload: Record<string, unknown>) { calls.push({ table, method: 'update', args: [payload] }); updatePayload = payload; updates.push({ table, payload }); return q },
      maybeSingle() {
        calls.push({ table, method: 'maybeSingle', args: [] })
        return Promise.resolve(input.responder({ table, method: 'maybeSingle', eqs, insertPayload, updatePayload }))
      },
      single() {
        calls.push({ table, method: 'single', args: [] })
        return Promise.resolve(input.responder({ table, method: 'single', eqs, insertPayload, updatePayload }))
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(input.responder({ table, method: 'default', eqs, insertPayload, updatePayload })).then(resolve, reject)
      },
    }
    return q
  }

  const client = {
    from(table: string) { calls.push({ table, method: 'from', args: [] }); return query(table) },
    rpc(name: string, params: unknown) { return input.rpc ? input.rpc(name, params) : Promise.resolve({ data: null, error: null }) },
  }
  return { client: client as unknown as FakeAdminClient, calls, updates }
}

const integracao = { id: 'integracao-1', fundoId: 'fundo-1', provider: 'exemplo', cnpjTransportadora: null }

const vendaRow = { id: 'venda-1', fundo_id: 'fundo-1', cedente_id: 'cedente-1', cnpj_emitente: '11222333000181', cnpj_destinatario: '99888777000155' }
const remessaRow = { id: 'remessa-1', nota_fiscal_venda_id: 'venda-1', status_validacao: 'VALIDADA', emitente_cnpj: '22333444000199' }

function payloadBase(overrides: Record<string, unknown> = {}) {
  return {
    externalEventId: null,
    chaveNfe: '1'.repeat(44),
    chaveCte: null,
    cnpjCliente: '99888777000155',
    cnpjEmitente: '11222333000181',
    cnpjTransportadora: '33444555000122',
    contentType: 'image/png',
    dataEmissaoNfe: '2026-08-20T10:00:00Z',
    dataEntregaNfe: '2026-08-22T10:00:00Z',
    imagemBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64'),
    ...overrides,
  }
}

function respostaPadraoInsertEUpdate(ctx: Ctx): Resposta | undefined {
  if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.insertPayload) return { data: { id: 'evt-1' }, error: null }
  if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processarWebhookComprovanteTransportadora', () => {
  it('DIRETO_VENDA: chave_nfe bate direto com a NF de venda -> PROCESSADO, arquivo enviado antes do matching', async () => {
    const { client, updates } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'PROCESSADO', canhoto_id: 'canhoto-1', requisito_id: null }, error: null }),
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-1', client)

    expect(resultado.status).toBe('PROCESSADO')
    expect(resultado.canhotoId).toBe('canhoto-1')
    expect(resultado.webhookEventoId).toBe('evt-1')
    expect(enviarObjetoDocumento).toHaveBeenCalledTimes(1)
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
    const persistUpdate = updates.find((u) => u.payload.persisted_at !== undefined)
    expect(persistUpdate?.payload.bucket).toBeDefined()
    expect(persistUpdate?.payload.path).toBeDefined()
    expect(persistUpdate?.payload.tamanho_bytes).toBeDefined()
  })

  it('VIA_REMESSA: chave_nfe bate com remessa VALIDADA -> PROCESSADO', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') {
          const porId = ctx.eqs.some((e) => e.column === 'id')
          return { data: porId ? vendaRow : null, error: null }
        }
        if (ctx.table === 'nota_fiscal_remessas') return { data: remessaRow, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'PROCESSADO', canhoto_id: 'canhoto-2', requisito_id: null }, error: null }),
    })

    const resultado = await processarWebhookComprovanteTransportadora(
      integracao,
      payloadBase({ cnpjEmitente: remessaRow.emitente_cnpj }),
      'hash-2',
      client,
    )

    expect(resultado.status).toBe('PROCESSADO')
    expect(resultado.canhotoId).toBe('canhoto-2')
  })

  it('evento duplicado (23505 na idempotency_key) -> DUPLICADO, nunca envia arquivo', async () => {
    const { client, calls } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.insertPayload) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') {
          return { data: { id: 'evt-existente', canhoto_id: 'canhoto-existente' }, error: null }
        }
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-3', client)

    expect(resultado).toEqual({ status: 'DUPLICADO', webhookEventoId: 'evt-existente', canhotoId: 'canhoto-existente', detalhe: 'Evento ja processado anteriormente (idempotency_key).' })
    expect(calls.some((c) => c.table === 'nota_fiscal_entregas')).toBe(false)
    expect(enviarObjetoDocumento).not.toHaveBeenCalled()
  })

  function eventoExistenteComArquivo(overrides: Record<string, unknown> = {}) {
    return {
      id: 'evt-retry',
      status: 'RECEBIDO' as string,
      integracao_id: 'integracao-1',
      fundo_id: 'fundo-1',
      provider: 'exemplo',
      chave_nfe: '1'.repeat(44),
      chave_cte: null,
      cnpj_cliente: '99888777000155',
      cnpj_emitente: '11222333000181',
      cnpj_transportadora: '33444555000122',
      data_emissao_nfe: '2026-08-20T10:00:00Z',
      data_entrega_nfe: '2026-08-22T10:00:00Z',
      tentativa_count: 1,
      canhoto_id: null,
      bucket: 'documentos-v2',
      path: 'webhooks-transportadora/integracao-1/evt-retry/arquivo.png',
      tamanho_bytes: 999,
      imagem_sha256: 'b'.repeat(64),
      content_type: 'image/png',
      ...overrides,
    }
  }

  function clienteFakeParaRetry(eventoExistente: ReturnType<typeof eventoExistenteComArquivo>, extra: (ctx: Ctx) => Resposta | undefined, rpc?: (name: string, params: unknown) => Promise<Resposta>) {
    return criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.insertPayload) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.eqs.some((e) => e.column === 'idempotency_key')) {
          return { data: { id: eventoExistente.id, status: eventoExistente.status, canhoto_id: eventoExistente.canhoto_id }, error: null }
        }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.eqs.some((e) => e.column === 'id') && ctx.method === 'maybeSingle') {
          return { data: eventoExistente, error: null }
        }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        const resultado = extra(ctx)
        if (resultado) return resultado
        return { data: null, error: null }
      },
      rpc,
    })
  }

  it('retry externo de evento ERRO_REPROCESSAVEL -> reprocessa o MESMO evento e pode chegar a PROCESSADO, sem reenviar o arquivo', async () => {
    const eventoExistente = eventoExistenteComArquivo({ status: 'ERRO_REPROCESSAVEL' })
    const { client } = clienteFakeParaRetry(
      eventoExistente,
      (ctx) => {
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return undefined
      },
      async () => ({ data: { status: 'PROCESSADO', canhoto_id: 'canhoto-retry', requisito_id: null }, error: null }),
    )

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-retry-erro', client)

    expect(resultado.status).toBe('PROCESSADO')
    expect(resultado.canhotoId).toBe('canhoto-retry')
    expect(enviarObjetoDocumento).not.toHaveBeenCalled()
  })

  it('retry externo de evento NAO_IDENTIFICADO ainda sem match -> permanece NAO_IDENTIFICADO (nunca cria nova inbox)', async () => {
    const eventoExistente = eventoExistenteComArquivo({ status: 'NAO_IDENTIFICADO' })
    const { client, calls } = clienteFakeParaRetry(eventoExistente, () => undefined)

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-retry-nid', client)

    expect(resultado.status).toBe('NAO_IDENTIFICADO')
    expect(calls.filter((c) => c.table === 'integracao_logistica_webhook_eventos' && c.method === 'insert')).toHaveLength(1)
    expect(enviarObjetoDocumento).not.toHaveBeenCalled()
  })

  it('retry externo de evento REVISAO_MATCH corrigido -> PROCESSADO', async () => {
    const eventoExistente = eventoExistenteComArquivo({ status: 'REVISAO_MATCH' })
    const { client } = clienteFakeParaRetry(
      eventoExistente,
      (ctx) => {
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return undefined
      },
      async () => ({ data: { status: 'PROCESSADO', canhoto_id: 'canhoto-revisado', requisito_id: null }, error: null }),
    )

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-retry-revisao', client)

    expect(resultado.status).toBe('PROCESSADO')
    expect(resultado.canhotoId).toBe('canhoto-revisado')
  })

  it.each(['PROCESSADO', 'AGUARDANDO_ENTREGA', 'IGNORADO_CANHOTO_JA_APROVADO', 'ERRO_FINAL'])(
    'retry externo de evento em %s -> so devolve o resultado existente, nunca reprocessa',
    async (statusExistente) => {
      const eventoExistente = eventoExistenteComArquivo({ status: statusExistente, canhoto_id: 'canhoto-ja-existente' })
      const { client } = clienteFakeParaRetry(eventoExistente, () => undefined)

      const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), `hash-retry-${statusExistente}`, client)

      expect(resultado).toEqual({ status: 'DUPLICADO', webhookEventoId: 'evt-retry', canhotoId: 'canhoto-ja-existente', detalhe: 'Evento ja processado anteriormente (idempotency_key).' })
      expect(enviarObjetoDocumento).not.toHaveBeenCalled()
  })

  it('MIME real incompativel -> ERRO_FINAL, nunca envia o arquivo (nada a reter)', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        return { data: null, error: null }
      },
    })

    // PDF magic bytes ("%PDF") declarado como image/png -- mimeReal (pdf) != content_type (png).
    const payload = payloadBase({ imagemBase64: Buffer.from('%PDF-1.4 conteudo').toString('base64') })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payload, 'hash-mime', client)

    expect(resultado.status).toBe('ERRO_FINAL')
    expect(enviarObjetoDocumento).not.toHaveBeenCalled()
  })

  it('sem match por chave_nfe nem chave_cte -> NAO_IDENTIFICADO, arquivo retido (nao remove)', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-4', client)

    expect(resultado.status).toBe('NAO_IDENTIFICADO')
    expect(enviarObjetoDocumento).toHaveBeenCalledTimes(1)
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('chave_cte com mais de um vinculo (CT-e multi-NF) -> REVISAO_MATCH, arquivo retido, nunca escolhe um lado sozinho', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'ctes') return { data: { id: 'cte-1', cnpj_transportadora: '33444555000122' }, error: null }
        if (ctx.table === 'cte_notas_fiscais') {
          return {
            data: [
              { nota_fiscal_id: 'venda-1', nota_fiscal_remessa_id: null, tipo_vinculo: 'DIRETO_VENDA' },
              { nota_fiscal_id: 'venda-2', nota_fiscal_remessa_id: null, tipo_vinculo: 'DIRETO_VENDA' },
            ],
            error: null,
          }
        }
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(
      integracao,
      payloadBase({ chaveCte: '2'.repeat(44) }),
      'hash-5',
      client,
    )

    expect(resultado.status).toBe('REVISAO_MATCH')
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('canhoto ja aprovado para a entrega -> IGNORADO_CANHOTO_JA_APROVADO, remove o arquivo com seguranca e zera bucket/path (evidencia_retida coerente)', async () => {
    const { client, updates } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: { id: 'canhoto-aprovado' }, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-6', client)

    expect(resultado.status).toBe('IGNORADO_CANHOTO_JA_APROVADO')
    expect(resultado.canhotoId).toBe('canhoto-aprovado')
    expect(enviarObjetoDocumento).toHaveBeenCalledTimes(1)
    expect(removerObjetoDocumento).toHaveBeenCalledTimes(1)
    const finalUpdate = updates.find((u) => u.payload.status === 'IGNORADO_CANHOTO_JA_APROVADO')
    expect(finalUpdate?.payload.bucket).toBeNull()
    expect(finalUpdate?.payload.path).toBeNull()
  })

  it('NF resolvida mas ainda sem nota_fiscal_entregas -> AGUARDANDO_ENTREGA, evidencia preservada (nao remove o arquivo)', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'AGUARDANDO_ENTREGA', canhoto_id: null, requisito_id: null }, error: null }),
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-7', client)

    expect(resultado.status).toBe('AGUARDANDO_ENTREGA')
    expect(resultado.canhotoId).toBeNull()
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('race: RPC encontra canhoto ja aprovado apesar da pre-checagem em TS ter passado -> remove o arquivo orfao e zera bucket/path', async () => {
    const { client, updates } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'IGNORADO_CANHOTO_JA_APROVADO', canhoto_id: 'canhoto-race', requisito_id: null }, error: null }),
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-race', client)

    expect(resultado.status).toBe('IGNORADO_CANHOTO_JA_APROVADO')
    expect(removerObjetoDocumento).toHaveBeenCalled()
    const finalUpdate = updates.find((u) => u.payload.status === 'IGNORADO_CANHOTO_JA_APROVADO')
    expect(finalUpdate?.payload.bucket).toBeNull()
    expect(finalUpdate?.payload.path).toBeNull()
  })

  it('PROCESSADO nao zera bucket/path (arquivo continua referenciado pelo documento)', async () => {
    const { client, updates } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'PROCESSADO', canhoto_id: 'canhoto-ok', requisito_id: null }, error: null }),
    })

    await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-processado-bucket', client)

    const finalUpdate = updates.find((u) => u.payload.status === 'PROCESSADO')
    expect(finalUpdate?.payload.bucket).toBeUndefined()
    expect(finalUpdate?.payload.path).toBeUndefined()
  })

  it('NF resolvida pertence a outro fundo (cross-fund) -> NAO_IDENTIFICADO, nunca revela o match, arquivo retido', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: { ...vendaRow, fundo_id: 'outro-fundo' }, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-8', client)

    expect(resultado.status).toBe('NAO_IDENTIFICADO')
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('CNPJ do cliente divergente do destinatario da venda -> REVISAO_MATCH, arquivo retido', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(
      integracao,
      payloadBase({ cnpjCliente: '00000000000000' }),
      'hash-9',
      client,
    )

    expect(resultado.status).toBe('REVISAO_MATCH')
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })

  it('falha inesperada apos o arquivo ja ter sido persistido -> ERRO_REPROCESSAVEL, nunca apaga o arquivo', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        const padrao = respostaPadraoInsertEUpdate(ctx)
        if (padrao) return padrao
        if (ctx.table === 'notas_fiscais') throw new Error('falha transitoria de rede')
        return { data: null, error: null }
      },
    })

    const resultado = await processarWebhookComprovanteTransportadora(integracao, payloadBase(), 'hash-10', client)

    expect(resultado.status).toBe('ERRO_REPROCESSAVEL')
    expect(enviarObjetoDocumento).toHaveBeenCalledTimes(1)
    expect(removerObjetoDocumento).not.toHaveBeenCalled()
  })
})

describe('reprocessarWebhookComprovanteTransportadora', () => {
  const eventoComArquivo = {
    id: 'evt-1',
    integracao_id: 'integracao-1',
    fundo_id: 'fundo-1',
    provider: 'exemplo',
    chave_nfe: '1'.repeat(44),
    chave_cte: null,
    cnpj_cliente: '99888777000155',
    cnpj_emitente: '11222333000181',
    cnpj_transportadora: '33444555000122',
    data_emissao_nfe: '2026-08-20T10:00:00Z',
    data_entrega_nfe: '2026-08-22T10:00:00Z',
    status: 'NAO_IDENTIFICADO',
    tentativa_count: 0,
    bucket: 'documentos-v2',
    path: 'webhooks-transportadora/integracao-1/evt-1/arquivo.png',
    tamanho_bytes: 1234,
    imagem_sha256: 'a'.repeat(64),
    content_type: 'image/png',
  }

  it('venda passou a existir -> PROCESSADO, reusa o arquivo original (nunca envia de novo)', async () => {
    const { client, updates } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') return { data: eventoComArquivo, error: null }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'PROCESSADO', canhoto_id: 'canhoto-reprocessado', requisito_id: null }, error: null }),
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('PROCESSADO')
    expect(resultado.canhotoId).toBe('canhoto-reprocessado')
    expect(enviarObjetoDocumento).not.toHaveBeenCalled()
    const finalUpdate = updates.find((u) => u.payload.status === 'PROCESSADO')
    expect(finalUpdate?.payload.tentativa_count).toBe(1)
  })

  it('remessa validada depois do recebimento original -> resolve VIA_REMESSA e supre a NF de venda principal', async () => {
    const eventoComRemessa = { ...eventoComArquivo, cnpj_emitente: remessaRow.emitente_cnpj }
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') return { data: eventoComRemessa, error: null }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        if (ctx.table === 'notas_fiscais') {
          const porId = ctx.eqs.some((e) => e.column === 'id')
          return { data: porId ? vendaRow : null, error: null }
        }
        if (ctx.table === 'nota_fiscal_remessas') return { data: remessaRow, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async (_name, params) => {
        const p = params as Record<string, unknown>
        expect(p.p_tipo_vinculo).toBe('VIA_REMESSA')
        expect(p.p_nota_fiscal_venda_id).toBe('venda-1')
        expect(p.p_nota_fiscal_remessa_id).toBe('remessa-1')
        return { data: { status: 'PROCESSADO', canhoto_id: 'canhoto-via-remessa', requisito_id: null }, error: null }
      },
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('PROCESSADO')
    expect(resultado.canhotoId).toBe('canhoto-via-remessa')
  })

  it('ainda sem match -> permanece NAO_IDENTIFICADO, tentativa_count incrementa', async () => {
    const { client, updates } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') return { data: eventoComArquivo, error: null }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('NAO_IDENTIFICADO')
    const finalUpdate = updates.find((u) => u.payload.status === 'NAO_IDENTIFICADO')
    expect(finalUpdate?.payload.tentativa_count).toBe(1)
  })

  it('sem entrega ainda -> AGUARDANDO_ENTREGA', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') return { data: eventoComArquivo, error: null }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: null, error: null }
        return { data: null, error: null }
      },
      rpc: async () => ({ data: { status: 'AGUARDANDO_ENTREGA', canhoto_id: null, requisito_id: null }, error: null }),
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('AGUARDANDO_ENTREGA')
  })

  it('canhoto ja aprovado -> IGNORADO_CANHOTO_JA_APROVADO', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') return { data: eventoComArquivo, error: null }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        if (ctx.table === 'notas_fiscais') return { data: vendaRow, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        if (ctx.table === 'nota_fiscal_entregas') return { data: { id: 'entrega-1' }, error: null }
        if (ctx.table === 'canhotos') return { data: { id: 'canhoto-aprovado' }, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('IGNORADO_CANHOTO_JA_APROVADO')
    expect(removerObjetoDocumento).toHaveBeenCalledTimes(1)
  })

  it('cross-fund na reresolucao -> NAO_IDENTIFICADO, nunca revela o match', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') return { data: eventoComArquivo, error: null }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: { cnpj_transportadora: null }, error: null }
        if (ctx.table === 'notas_fiscais') return { data: { ...vendaRow, fundo_id: 'outro-fundo' }, error: null }
        if (ctx.table === 'nota_fiscal_remessas') return { data: null, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('NAO_IDENTIFICADO')
  })

  it('evento legado sem arquivo retido -> EVIDENCIA_INDISPONIVEL (fallback, nunca o caminho normal)', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') {
          return { data: { ...eventoComArquivo, bucket: null, path: null, tamanho_bytes: null }, error: null }
        }
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.updatePayload) return { data: null, error: null }
        return { data: null, error: null }
      },
    })

    const resultado = await reprocessarWebhookComprovanteTransportadora('evt-1', client)

    expect(resultado.status).toBe('EVIDENCIA_INDISPONIVEL')
  })

  it('rejeita reprocessar um evento em status nao elegivel (ex.: PROCESSADO)', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracao_logistica_webhook_eventos' && ctx.method === 'maybeSingle') {
          return { data: { ...eventoComArquivo, status: 'PROCESSADO' }, error: null }
        }
        return { data: null, error: null }
      },
    })

    await expect(reprocessarWebhookComprovanteTransportadora('evt-1', client)).rejects.toThrow(/nao pode ser reprocessado/)
  })

  it('rejeita quando o evento nao existe', async () => {
    const { client } = criarClienteFake({ responder: () => ({ data: null, error: null }) })

    await expect(reprocessarWebhookComprovanteTransportadora('evt-inexistente', client)).rejects.toThrow(/nao encontrado/)
  })
})

describe('resolverIntegracaoPorToken', () => {
  it('retorna null quando o token nao existe na tabela de historico', async () => {
    const { client } = criarClienteFake({ responder: () => ({ data: null, error: null }) })
    expect(await resolverIntegracaoPorToken('token-qualquer', 'exemplo', client)).toBeNull()
  })

  it('retorna null quando o hash existe mas o token nao esta ativo (substituido/revogado)', async () => {
    const { client, calls } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracoes_transportadoras_tokens') return { data: null, error: null }
        return { data: null, error: null }
      },
    })
    const resultado = await resolverIntegracaoPorToken('token-revogado', 'exemplo', client)
    expect(resultado).toBeNull()
    expect(calls.some((c) => c.table === 'integracoes_transportadoras_tokens' && c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'ativo')).toBe(true)
  })

  it('resolve a integracao quando ha um token ativo, integracao ativa e provider correspondente', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracoes_transportadoras_tokens') return { data: { integracao_id: 'integracao-1' }, error: null }
        if (ctx.table === 'integracoes_transportadoras') {
          return { data: { id: 'integracao-1', fundo_id: 'fundo-1', provider: 'exemplo', cnpj_transportadora: null }, error: null }
        }
        return { data: null, error: null }
      },
    })
    const resultado = await resolverIntegracaoPorToken('token-ativo', 'exemplo', client)
    expect(resultado).toEqual({ id: 'integracao-1', fundoId: 'fundo-1', provider: 'exemplo', cnpjTransportadora: null })
  })

  it('retorna null quando o provider da rota nao corresponde ao da integracao', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracoes_transportadoras_tokens') return { data: { integracao_id: 'integracao-1' }, error: null }
        if (ctx.table === 'integracoes_transportadoras') {
          return { data: { id: 'integracao-1', fundo_id: 'fundo-1', provider: 'outro-provider', cnpj_transportadora: null }, error: null }
        }
        return { data: null, error: null }
      },
    })
    expect(await resolverIntegracaoPorToken('token-ativo', 'exemplo', client)).toBeNull()
  })

  it('retorna null quando a integracao esta inativa mesmo com token ativo (nao autentica webhook de integracao desativada)', async () => {
    const { client } = criarClienteFake({
      responder: (ctx) => {
        if (ctx.table === 'integracoes_transportadoras_tokens') return { data: { integracao_id: 'integracao-1' }, error: null }
        if (ctx.table === 'integracoes_transportadoras') return { data: null, error: null }
        return { data: null, error: null }
      },
    })
    expect(await resolverIntegracaoPorToken('token-ativo', 'exemplo', client)).toBeNull()
  })

  it('retorna null para token vazio sem consultar o banco', async () => {
    const { client, calls } = criarClienteFake({ responder: () => ({ data: null, error: null }) })
    expect(await resolverIntegracaoPorToken('', 'exemplo', client)).toBeNull()
    expect(calls).toEqual([])
  })
})

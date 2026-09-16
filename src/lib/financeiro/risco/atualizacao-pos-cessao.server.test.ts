import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('server-only', () => ({}))
vi.mock('./processor.server', () => ({ executarGateRisco: vi.fn() }))

import { executarGateRisco } from './processor.server'
import { atualizarRiscoAposCessao } from './atualizacao-pos-cessao.server'

const executar = vi.mocked(executarGateRisco)
const input = {
  fundoId: 'fundo-1',
  operacaoId: 'operacao-1',
  atorUsuarioId: 'usuario-1',
  dataOperacional: '2026-09-16',
}

describe('atualizacao automatica do risco apos a cessao', () => {
  beforeEach(() => {
    executar.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => vi.restoreAllMocks())

  it('recalcula o gate consolidado do fundo para a data operacional', async () => {
    executar.mockResolvedValue({ classification: { technicalStatus: 'CONCLUIDA' }, correlationId: 'corr-1' } as unknown as Awaited<ReturnType<typeof executarGateRisco>>)

    await expect(atualizarRiscoAposCessao(input)).resolves.toBe(true)
    expect(executar).toHaveBeenCalledExactlyOnceWith({
      fundoId: input.fundoId,
      atorUsuarioId: input.atorUsuarioId,
      dataOperacional: input.dataOperacional,
      origem: 'CENTRAL_RISCO',
    })
  })

  it('sinaliza avaliacao indisponivel sem afirmar que o risco foi atualizado', async () => {
    executar.mockResolvedValue({ classification: { technicalStatus: 'AVALIACAO_RISCO_INDISPONIVEL' }, correlationId: 'corr-2' } as unknown as Awaited<ReturnType<typeof executarGateRisco>>)

    await expect(atualizarRiscoAposCessao(input)).resolves.toBe(false)
    expect(console.error).toHaveBeenCalledWith('[desembolsarOperacao][atualizar_risco]', expect.objectContaining({
      operacao_id: input.operacaoId, fundo_id: input.fundoId, correlation_id: 'corr-2',
    }))
  })

  it('nao exige refresh de risco quando o gate nao se aplica a politica', async () => {
    executar.mockResolvedValue({ classification: { technicalStatus: 'NAO_APLICAVEL' }, correlationId: 'corr-3' } as unknown as Awaited<ReturnType<typeof executarGateRisco>>)

    await expect(atualizarRiscoAposCessao(input)).resolves.toBe(true)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('sinaliza falha tecnica sem propagar excecao para o desembolso ja confirmado', async () => {
    executar.mockRejectedValue(new Error('falha de rede'))

    await expect(atualizarRiscoAposCessao(input)).resolves.toBe(false)
    expect(console.error).toHaveBeenCalledWith('[desembolsarOperacao][atualizar_risco]', expect.objectContaining({
      operacao_id: input.operacaoId, erro: 'falha de rede',
    }))
  })

  it('nao consulta o fundo sem identificador', async () => {
    await expect(atualizarRiscoAposCessao({ ...input, fundoId: '' })).resolves.toBe(false)
    expect(executar).not.toHaveBeenCalled()
  })

  it('somente inicia o refresh depois de a RPC de desembolso retornar sucesso e preserva o botao manual', () => {
    const action = readFileSync(join(process.cwd(), 'src/lib/actions/operacao.ts'), 'utf8')
    const trecho = action.slice(action.indexOf('export async function desembolsarOperacao'), action.indexOf('export async function reprovarOperacao'))
    expect(trecho.indexOf("rpc('desembolsar_operacao_com_logistica'")).toBeLessThan(trecho.indexOf('atualizarRiscoAposCessao({'))
    expect(trecho.indexOf('if (error) return { success: false')).toBeLessThan(trecho.indexOf('atualizarRiscoAposCessao({'))
    expect(trecho).toContain('data: { riscoAtualizado }')
    expect(trecho).toContain("revalidatePath('/gestor/operacoes/[id]', 'page')")

    const client = readFileSync(join(process.cwd(), 'src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx'), 'utf8')
    expect(client).toContain('result.data?.riscoAtualizado === false')
    expect(client).toContain('notifications.warning(')
    const central = readFileSync(join(process.cwd(), 'src/app/gestor/conciliacao/conciliacao-financeira-client.tsx'), 'utf8')
    expect(central).toContain('executarGateRiscoAction({ dataReferencia: dashboard.filtros.dataReferencia })')
  })
})

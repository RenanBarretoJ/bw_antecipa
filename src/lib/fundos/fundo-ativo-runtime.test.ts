import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('fundo ativo no runtime server-side', () => {
  it('mantem a resolucao de leitura sem escrita ou exclusao de cookies', () => {
    const readOnly = source('src/lib/fundos/fundo-ativo.server.ts')

    expect(readOnly).toContain('carregarContextoFundoAtivoReadOnly')
    expect(readOnly).toContain(".get(FUNDO_ATIVO_COOKIE)")
    expect(readOnly).toContain('escolherFundoInicial({ fundos, cookieFundoId })')
    expect(readOnly).not.toMatch(/cookieStore\.(set|delete)\s*\(/)
    expect(readOnly).not.toMatch(/\(await cookies\(\)\)\.(set|delete)\s*\(/)
  })

  it('persiste o fundo apenas na Server Action de selecao explicita', () => {
    const action = source('src/lib/actions/fundo-ativo.ts')
    const readAt = action.indexOf('export async function carregarContextoFundoAtivo')
    const writeAt = action.indexOf('export async function selecionarFundoAtivo')
    const cookieWriteAt = action.indexOf('cookieStore.set(FUNDO_ATIVO_COOKIE')

    expect(readAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(readAt)
    expect(cookieWriteAt).toBeGreaterThan(writeAt)
    expect(action.slice(readAt, writeAt)).not.toMatch(/\.set\s*\(|\.delete\s*\(/)
    expect(action).not.toContain('cookieStore.delete(FUNDO_ATIVO_COOKIE)')
  })

  it('impede loaders server-side de importar o modulo mutavel de actions', () => {
    const consumers = [
      'src/lib/financeiro/conciliacao/loaders.server.ts',
      'src/lib/logistica/acompanhamento-operacao.server.ts',
      'src/lib/operacoes/listagem.server.ts',
    ]

    for (const path of consumers) {
      const content = source(path)
      expect(content).toContain("@/lib/fundos/fundo-ativo.server")
      expect(content).not.toContain("@/lib/actions/fundo-ativo")
    }
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const resolver = readFileSync('src/lib/financeiro/pl-referencia.server.ts', 'utf8')
const exposicao = readFileSync('src/lib/financeiro/exposicao/processor.server.ts', 'utf8')
const risco = readFileSync('src/lib/financeiro/risco/processor.server.ts', 'utf8')
const conciliacao = readFileSync('src/lib/financeiro/conciliacao/loaders.server.ts', 'utf8')
const preview = readFileSync('src/lib/financeiro/risco/visao-operacional.server.ts', 'utf8')

describe('integracao do resolvedor canonico de PL de referencia', () => {
  it('restringe fundo e validade e escolhe a data-base mais recente anterior a data operacional', () => {
    expect(resolver).toContain(".eq('fundo_id', input.fundoId)")
    expect(resolver).toContain(".lt('data_referencia', input.dataOperacional)")
    expect(resolver).toContain(".eq('vigente', true)")
    expect(resolver).toContain(".gt('patrimonio_liquido', 0)")
    expect(resolver).toContain(".eq('importacao.status', 'PUBLICADA')")
    expect(resolver).toContain(".order('data_referencia', { ascending: false })")
  })

  it('e consumido por P2.5, P2.6, preview e Conciliacao sem formula paralela de D-2', () => {
    expect(exposicao).toContain('resolverPlReferencia(client')
    expect(risco).toContain('resolverPlReferencia(client')
    expect(conciliacao).toContain('resolverPlReferencia(supabase')
    expect(preview).toContain('resolverPlReferencia(admin')
    expect(exposicao).not.toContain(".eq('data_referencia', d2)")
  })

  it('mantem historico por risco/exposicao vinculados e nao reescreve execucoes antigas', () => {
    expect(preview).toContain(".eq('id', input.riscoExecucaoId)")
    expect(preview).toContain(".eq('id', String(execucao.exposicao_execucao_id))")
    expect(preview).not.toContain("from('risco_execucoes').update")
    expect(preview).not.toContain("from('exposicao_execucoes').update")
  })
})

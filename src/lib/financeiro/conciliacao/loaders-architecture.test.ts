import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const loader = readFileSync(join(process.cwd(), 'src/lib/financeiro/conciliacao/loaders.server.ts'), 'utf8')
const client = readFileSync(join(process.cwd(), 'src/app/gestor/conciliacao/conciliacao-financeira-client.tsx'), 'utf8')

describe('arquitetura temporal e estados da Central de Conciliacao', () => {
  it('consulta os pipelines D-1 pela base canonica e risco por data operacional', () => {
    expect(loader).toContain("exact('matching_execucoes', 'data_referencia', base.dataD1)")
    expect(loader).toContain("exact('conciliacao_execucoes', 'data_referencia', base.dataD1)")
    expect(loader).toContain("exact('posicao_logistica_execucoes', 'data_referencia', base.dataD1)")
    expect(loader).toContain(".eq('escopo', 'FUNDO').eq('data_operacional', base.dataOperacional)")
  })

  it('isola falhas por bloco em vez de derrubar a pagina inteira', () => {
    expect(loader).toContain("errors[block] = 'Nao foi possivel carregar este bloco. Tente novamente.'")
    expect(client).toContain('dashboard.erros.logistica ? <BlockError')
    expect(client).toContain('dashboard.erros.exposicao ? <BlockError')
    expect(client).toContain('dashboard.erros.risco ? <BlockError')
  })

  it('executa matching, conciliacao e logistica com a data D-1 resolvida no servidor', () => {
    expect(client.match(/dashboard\.baseFinanceira!\.dataD1/g)).toHaveLength(3)
    expect(client).toContain('executarExposicaoAction({ dataReferencia: dashboard.filtros.dataReferencia })')
    expect(client).toContain('executarGateRiscoAction({ dataReferencia: dashboard.filtros.dataReferencia })')
  })

  it('nao converte valor financeiro ausente em zero na formatacao global', () => {
    expect(client).toContain("if (value === null || value === undefined || value === '') return 'Indisponivel'")
    expect(client).not.toContain('Number(value || 0)')
    expect(client).toContain('QA SYNTHETIC')
  })
})

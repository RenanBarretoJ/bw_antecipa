import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const resolver = read('src/lib/financeiro/conciliacao/pipeline-status.server.ts')
const loader = read('src/lib/financeiro/conciliacao/loaders.server.ts')
const client = read('src/app/gestor/conciliacao/conciliacao-financeira-client.tsx')

describe('arquitetura do cockpit de conciliacao', () => {
  it('resolve o grafo no servidor e entrega um DTO pronto ao client', () => {
    expect(resolver).toContain("import 'server-only'")
    expect(loader).toContain('resolverStatusEsteiraFinanceira({')
    expect(loader).toContain('esteira,')
    expect(client).toContain('<PipelineCockpit pipeline={dashboard.esteira}')
  })

  it('nao persiste status nem acessa Supabase pelo resolvedor', () => {
    expect(resolver).not.toMatch(/\.from\(|\.rpc\(|createAdminClient|\.insert\(|\.update\(|\.delete\(/)
  })

  it('preserva a independencia real entre Matching e Conciliacao', () => {
    const matchingBody = resolver.slice(resolver.indexOf('function resolverMatching'), resolver.indexOf('function conciliacaoCompativel'))
    expect(matchingBody).not.toContain('execucoes.conciliacao')
    expect(matchingBody).not.toContain("id: 'conciliacao'")
  })

  it('nao transforma Conciliação em dependencia dura da Exposicao', () => {
    const exposureBody = resolver.slice(resolver.indexOf('function resolverExposicao'), resolver.indexOf('function riscoCompativel'))
    expect(exposureBody).not.toContain('execucoes.conciliacao')
    expect(exposureBody).toContain("id: 'exposicao'")
  })

  it('mantem no client apenas o roteamento para as Server Actions existentes', () => {
    expect(client).toContain("if (!pipelineActions.get(action)?.habilitada) return")
    expect(client).toContain("if (action === 'matching')")
    expect(client).toContain("if (action === 'conciliacao')")
    expect(client).toContain("if (action === 'logistica')")
    expect(client).toContain("if (action === 'exposicao')")
    expect(client).not.toContain('function resolverStatusEsteiraFinanceira')
  })

  it('usa flags versionados da politica para os modulos opcionais', () => {
    expect(loader).toContain('cria_acompanhamento_entrega')
    expect(resolver).toContain('criaAcompanhamentoEntrega')
    expect(resolver).toContain('controleExposicaoAtivo')
    expect(resolver).toContain('gateRiscoAtivo')
  })
})

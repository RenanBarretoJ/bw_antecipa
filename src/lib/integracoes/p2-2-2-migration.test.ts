import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260814123000_p2_2_2_sinqia_financeiro_envios.sql'), 'utf8')
const page = readFileSync(resolve(process.cwd(), 'src/app/admin/fundos/[id]/page.tsx'), 'utf8')
const operationalDeliveries = readFileSync(resolve(process.cwd(), 'src/components/admin/fundo-envios-operacionais.tsx'), 'utf8')
const integrationEditor = readFileSync(resolve(process.cwd(), 'src/components/admin/fundo-integracoes-tecnicas.tsx'), 'utf8')

describe('P2.2.2 - Sinqia financeiro e Envios Operacionais', () => {
  it('habilita no espelho SQL somente as quatro capacidades comprovadas', () => {
    const helper = migration.slice(migration.indexOf('integracao_adapter_capability_suportada'), migration.indexOf('REVOKE ALL ON FUNCTION private.integracao_adapter_capability_suportada'))
    expect(helper).toContain("'CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'")
    expect(helper).not.toContain('CARTEIRA')
  })

  it('valida CNPJ versionado antes da publicacao financeira', () => {
    expect(migration).toContain("{relatorios_financeiros,cnpj_fundo}")
    expect(migration).toContain("'^[0-9]{14}$'")
  })

  it('usa Envios Operacionais como rota canonica e preserva alias CNAB', () => {
    expect(page).toContain("requestedTab === 'cnab'")
    expect(page).toContain('tab=envios')
    expect(page).toContain('>Envios Operacionais</Link>')
  })

  it('so exibe a configuracao CNAB dentro de uma integracao de cessao resolvida', () => {
    expect(operationalDeliveries).toContain("capability: 'CESSAO_ENVIO'")
    expect(operationalDeliveries).toContain("integration && method === 'CNAB'")
    expect(operationalDeliveries).not.toContain('BAIXA_ENVIO')
  })

  it('nao seleciona capacidades automaticamente e bloqueia Carteira para Sinqia', () => {
    expect(integrationEditor).toContain('setCapabilities((current) => current.filter')
    expect(integrationEditor).not.toMatch(/setCapabilities\(\s*SINQIA_PORTAL_FIDC_CAPABILITIES/)
    expect(integrationEditor).toContain("adapterKey === 'sinqia_portal_fidc'")
  })
})

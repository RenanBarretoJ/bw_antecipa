import { describe, expect, it } from 'vitest'
import { avaliarElegibilidadeSubmissaoNf, type EntradaElegibilidadeSubmissaoNf } from './elegibilidade-submissao'

const baseInput = (): EntradaElegibilidadeSubmissaoNf => ({
  status: 'rascunho',
  contexto: { cedenteFundoAtivo: true, fundoAtivo: true },
  politica: { publicadaVigente: true },
  requisitos: {
    instanciados: true,
    preCessao: [{ nome: 'XML da NF-e', obrigatorio: true, satisfazSubmissao: true }],
    validacaoEstruturalOk: true,
    erroFiscal: null,
  },
  dadosObrigatoriosCompletos: true,
})

describe('avaliarElegibilidadeSubmissaoNf', () => {
  it('marca uma NF completa como pronta para submissao', () => {
    const result = avaliarElegibilidadeSubmissaoNf(baseInput())
    expect(result).toMatchObject({ elegivel: true, estado: 'pronta_para_submissao', obrigatorios: { pendentes: 0 } })
  })

  it('bloqueia rascunho com requisito pre-cessao pendente', () => {
    const input = baseInput()
    input.requisitos.preCessao[0].satisfazSubmissao = false
    const result = avaliarElegibilidadeSubmissaoNf(input)
    expect(result.elegivel).toBe(false)
    expect(result.bloqueios.map((item) => item.codigo)).toContain('documentos_pendentes')
  })

  it('nao deixa documento pos-cessao bloquear a submissao inicial', () => {
    const input = baseInput()
    input.requisitos.posCessao = [{ nome: 'Comprovante de entrega', obrigatorio: true, bloqueiaFluxo: true, satisfazSubmissao: false }]
    expect(avaliarElegibilidadeSubmissaoNf(input).elegivel).toBe(true)
  })

  it('bloqueia requisito nao obrigatorio quando a politica marca bloqueiaFluxo', () => {
    const input = baseInput()
    input.requisitos.preCessao.push({ nome: 'Documento bloqueante', obrigatorio: false, bloqueiaFluxo: true, satisfazSubmissao: false })
    const result = avaliarElegibilidadeSubmissaoNf(input)
    expect(result.elegivel).toBe(false)
    expect(result.obrigatorios).toMatchObject({ total: 2, pendentes: 1 })
  })

  it('bloqueia status diferente de rascunho', () => {
    const input = baseInput()
    input.status = 'submetida'
    const result = avaliarElegibilidadeSubmissaoNf(input)
    expect(result.elegivel).toBe(false)
    expect(result.bloqueios[0]?.codigo).toBe('status_invalido')
  })
})

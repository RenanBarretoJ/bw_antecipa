import { describe, expect, it } from 'vitest'
import {
  derivarBloqueioFluxo,
  derivarCategoriaRequisito,
  normalizarRequisitoDocumental,
  normalizarRequisitoLegadoParaEdicao,
  resolverMomentoObrigatorioLegado,
  type PoliticaMomentoObrigatorio,
  type PoliticaRequisitoInput,
} from './requisitos-documentais'

function requisito(
  overrides: Partial<PoliticaRequisitoInput> = {},
): PoliticaRequisitoInput {
  return {
    codigo: 'nf_xml',
    momento_obrigatorio: 'nf_pre_cessao',
    tipo_documento_codigo: 'nf_xml',
    obrigatorio: true,
    quantidade_minima: 1,
    formatos_aceitos: ['XML', 'xml'],
    nivel_validacao: 'estrutural',
    prazo_dias_corridos: null,
    responsavel_upload: 'cedente',
    responsavel_aprovacao: 'gestor',
    ordem: 0,
    ativo: true,
    ...overrides,
  }
}

describe('requisitos documentais de politica', () => {
  it.each<PoliticaMomentoObrigatorio>([
    'nf_pre_cessao',
    'operacao',
    'pos_cessao',
    'entrega',
  ])('deriva a categoria canonica do momento %s', (momento) => {
    expect(derivarCategoriaRequisito(momento)).toBe(momento)
    expect(normalizarRequisitoDocumental(requisito({ momento_obrigatorio: momento }), 0))
      .toMatchObject({
        momento_obrigatorio: momento,
        escopo: momento,
        categoria: momento,
      })
  })

  it.each([
    [true, true],
    [false, false],
  ])('deriva bloqueio %s da obrigatoriedade', (obrigatorio, bloqueiaFluxo) => {
    expect(derivarBloqueioFluxo(obrigatorio)).toBe(bloqueiaFluxo)
    expect(normalizarRequisitoDocumental(requisito({ obrigatorio }), 0).bloqueia_fluxo)
      .toBe(bloqueiaFluxo)
  })

  it.each([true, false])('aceita nf_remessa como tipo_documento_codigo, obrigatorio=%s definido pela propria politica (nunca global)', (obrigatorio) => {
    const normalizado = normalizarRequisitoDocumental(requisito({
      codigo: 'nf_remessa_pos_cessao',
      tipo_documento_codigo: 'nf_remessa',
      obrigatorio,
      formatos_aceitos: ['xml'],
    }), 0)
    expect(normalizado.tipo_documento_codigo).toBe('nf_remessa')
    expect(normalizado.obrigatorio).toBe(obrigatorio)
    expect(normalizado.bloqueia_fluxo).toBe(obrigatorio)
  })

  it('rejeita momento obrigatorio desconhecido', () => {
    expect(() => normalizarRequisitoDocumental(requisito({
      momento_obrigatorio: 'antes_da_assinatura' as PoliticaMomentoObrigatorio,
    }), 0)).toThrow('Momento obrigatorio')
  })

  it('mantem o payload publico sem categoria, escopo ou bloqueio e deriva na persistencia', () => {
    const input = requisito({ momento_obrigatorio: 'entrega', obrigatorio: false })
    expect(input).not.toHaveProperty('categoria')
    expect(input).not.toHaveProperty('escopo')
    expect(input).not.toHaveProperty('bloqueia_fluxo')

    expect(normalizarRequisitoDocumental(input, 0)).toMatchObject({
      momento_obrigatorio: 'entrega',
      escopo: 'entrega',
      categoria: 'entrega',
      obrigatorio: false,
      bloqueia_fluxo: false,
    })
  })

  it.each([
    ['categoria', 'operacao'],
    ['escopo', 'operacao'],
    ['bloqueia_fluxo', false],
    ['bloqueiaFluxo', false],
  ])('rejeita o campo interno adulterado %s', (campo, valor) => {
    const adulterado = {
      ...requisito(),
      [campo]: valor,
    } as unknown as PoliticaRequisitoInput

    expect(() => normalizarRequisitoDocumental(adulterado, 0))
      .toThrow('campos derivados ou legados')
  })

  it('preserva a leitura legada e normaliza apenas a nova copia', () => {
    const legado = {
      codigo: 'comprovante_entrega',
      momento_obrigatorio: 'entrega',
      escopo: 'pos_cessao',
      categoria: 'operacao',
      tipo_documento_codigo: 'comprovante_entrega',
      obrigatorio: false,
      bloqueia_fluxo: true,
      quantidade_minima: 1,
      formatos_aceitos: ['pdf'],
      nivel_validacao: 'manual',
      prazo_dias_corridos: 3,
      observacoes: null,
      responsavel_upload: 'cedente',
      responsavel_aprovacao: 'gestor',
      ordem: 1,
      ativo: true,
    }
    const original = structuredClone(legado)

    expect(resolverMomentoObrigatorioLegado(legado)).toBe('entrega')
    const copia = normalizarRequisitoLegadoParaEdicao(legado, 0)
    const novaPersistencia = normalizarRequisitoDocumental(copia, 0)

    expect(legado).toEqual(original)
    expect(copia).not.toHaveProperty('categoria')
    expect(copia).not.toHaveProperty('bloqueia_fluxo')
    expect(novaPersistencia).toMatchObject({
      momento_obrigatorio: 'entrega',
      escopo: 'entrega',
      categoria: 'entrega',
      obrigatorio: false,
      bloqueia_fluxo: false,
    })
  })

  it('rejeita legado sem momento, escopo ou categoria reconhecidos', () => {
    expect(() => resolverMomentoObrigatorioLegado({
      momento_obrigatorio: 'desconhecido',
      escopo: null,
      categoria: null,
    })).toThrow('sem momento obrigatorio reconhecido')
  })
})

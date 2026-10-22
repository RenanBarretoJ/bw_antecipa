import { describe, expect, it } from 'vitest'
import { conferirCompletudeCarteiraVortx } from './carteira-completude'
import { ERRO_CONFIGURACAO_COTAS, configuracaoCarteiraConsolidadaSchema, lerConfiguracaoCarteiraVortx, prepararConfiguracaoCarteiraVortx, validarConfiguracaoCarteiraVortx } from './carteira-configuracao'

const lista = { versao: 1, cotas: [
  { codigoCarteira: 'QA-SR', rotulo: 'Sênior' },
  { codigoCarteira: 'QA-MZ', rotulo: 'Mezanino' },
  { codigoCarteira: 'QA-SUB', rotulo: 'Subordinada' },
] }

describe('lista de cotas na configuracao versionada da integracao Vortx', () => {
  it('nao infere lista ausente do codigo VRS, nomes ou Fundo', () => {
    const legado = { codigo_carteira: 'qa-vrs-uuid', nome: 'QA-SR', relatorios_financeiros: { cnpj_fundo: '12345678000190' } }
    expect(lerConfiguracaoCarteiraVortx(legado)).toEqual({ estado: 'NAO_CONFIGURADA' })
    expect(prepararConfiguracaoCarteiraVortx(legado)).toEqual(legado)
    expect(validarConfiguracaoCarteiraVortx(legado)).toBeNull()
  })

  it('salva em chave propria e preserva codigo VRS, Inclusao e demais configuracoes', () => {
    const original = { codigo_carteira: 'qa-vrs-uuid', vrs_inclusao: { termo: 'QA' }, outro: { ativo: true } }
    const configuracao = prepararConfiguracaoCarteiraVortx(original, lista)
    expect(configuracao).toEqual({ ...original, carteira_consolidada: lista })
    expect(original).not.toHaveProperty('carteira_consolidada')
    expect(lerConfiguracaoCarteiraVortx(JSON.parse(JSON.stringify(configuracao)))).toEqual({ estado: 'CONFIGURADA', configuracao: lista })
  })

  it('normaliza somente espacos dos campos e preserva identificadores com zeros', () => {
    expect(prepararConfiguracaoCarteiraVortx({}, { versao: 1, cotas: [{ codigoCarteira: ' 00123 ', rotulo: ' Cota QA ' }] }))
      .toEqual({ carteira_consolidada: { versao: 1, cotas: [{ codigoCarteira: '00123', rotulo: 'Cota QA' }] } })
  })

  it('mantem a lista existente quando o campo nao e enviado e nao muta a versao anterior', () => {
    const anterior = { carteira_consolidada: lista, codigo_carteira: 'QA' }
    const nova = prepararConfiguracaoCarteiraVortx(anterior)
    expect(nova).toEqual(anterior)
    expect(nova.carteira_consolidada).not.toBe(anterior.carteira_consolidada)
    const substituta = prepararConfiguracaoCarteiraVortx(anterior, { versao: 1, cotas: [{ codigoCarteira: 'OUTRA', rotulo: 'Outra' }] })
    expect(substituta).not.toEqual(anterior)
    expect(anterior.carteira_consolidada).toEqual(lista)
  })

  it('remocao explicita nao conserva lista oculta nem habilita consolidacao parcial', () => {
    const anterior = { carteira_consolidada: lista, codigo_carteira: 'QA' }
    const nova = prepararConfiguracaoCarteiraVortx(anterior, null)
    expect(nova).toEqual({ codigo_carteira: 'QA' })
    expect(anterior.carteira_consolidada).toEqual(lista)
    expect(conferirCompletudeCarteiraVortx({ cnpjFundo: '12345678000190', dataReferencia: '2026-10-20', configuracao: nova.carteira_consolidada, resposta: [] }))
      .toEqual({ estado: 'CONFIGURACAO_PENDENTE' })
  })

  it.each([null, {}, [], { versao: 2, cotas: lista.cotas }, { versao: 1, cotas: [] },
    { versao: 1, cotas: [lista.cotas[0], lista.cotas[0]] },
    { versao: 1, cotas: [{ codigoCarteira: 123, rotulo: 'QA' }] },
    { versao: 1, cotas: [{ codigoCarteira: 'A B', rotulo: 'QA' }] },
    { versao: 1, cotas: [{ codigoCarteira: 'QA', rotulo: ' ' }] },
    { ...lista, token: 'nao-permitido' },
  ].map(valor => ({ valor })))('nao descarta configuracao existente invalida: %j', ({ valor }) => {
    const original = { carteira_consolidada: valor }
    expect(lerConfiguracaoCarteiraVortx(original)).toEqual({ estado: 'INVALIDA' })
    expect(validarConfiguracaoCarteiraVortx(original)).toBe(ERRO_CONFIGURACAO_COTAS)
    expect(() => prepararConfiguracaoCarteiraVortx(original)).toThrow(ERRO_CONFIGURACAO_COTAS)
  })

  it('marca os dois codigos duplicados para validacao proxima de cada campo', () => {
    const parsed = configuracaoCarteiraConsolidadaSchema.safeParse({ versao: 1, cotas: [lista.cotas[0], { ...lista.cotas[0], codigoCarteira: ' QA-SR ' }] })
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Esperada lista invalida')
    expect(parsed.error.issues.map(issue => issue.path)).toEqual([['cotas', 0, 'codigoCarteira'], ['cotas', 1, 'codigoCarteira']])
  })

  it('limita a lista sem impor o numero ou o nome de cotas de outro Fundo', () => {
    expect(configuracaoCarteiraConsolidadaSchema.safeParse({ versao: 1, cotas: [lista.cotas[0]] }).success).toBe(true)
    const cotas = Array.from({ length: 101 }, (_, index) => ({ codigoCarteira: `QA-${index}`, rotulo: `Cota ${index}` }))
    expect(configuracaoCarteiraConsolidadaSchema.safeParse({ versao: 1, cotas }).success).toBe(false)
  })
})

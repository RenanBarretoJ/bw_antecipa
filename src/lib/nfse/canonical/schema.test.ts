import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { absentDocument, canonicalSchema, decimalField, textField } from './schema'

const trace = { origem: 'XML', metodo: 'XML_ESTRUTURAL', confianca: null, validacoes: [], alertas: [], derivacao: null,
  evidencias: [{ documento_sha256: 'a'.repeat(64), caminho: '/n:NFSe[1]/n:valor[1]', namespace: 'http://www.sped.fazenda.gov.br/nfse' }] }
describe('contrato NFS-e canônico 1.1', () => {
  it('representa ausência sem zero ou evidência inventada', () => {
    expect(absentDocument().totais.liquido_documental).toMatchObject({ estado: 'AUSENTE', original: null, valor: null, evidencias: [] })
  })
  it('preserva zero explícito', () => {
    expect(decimalField.parse({ ...trace, estado: 'PRESENTE', original: '0.00', valor: '0.00' }).valor).toBe('0.00')
  })
  it('não aceita valor presente sem fonte', () => {
    expect(decimalField.safeParse({ ...trace, estado: 'PRESENTE', original: '0.00', valor: '0.00', evidencias: [] }).success).toBe(false)
  })
  it('não permite preencher ausência com zero', () => {
    expect(decimalField.safeParse({ ...absentDocument().totais.liquido_documental, valor: '0.00' }).success).toBe(false)
  })
  it('exige justificativa e evidência de não aplicabilidade', () => {
    const value = { ...trace, estado: 'NAO_APLICAVEL', original: 'não se aplica', valor: null, justificativa: 'Documento explicita não aplicabilidade.' }
    expect(textField.safeParse(value).success).toBe(true)
    expect(textField.safeParse({ ...value, justificativa: '' }).success).toBe(false)
  })
  it('exige fórmula versionada e referências para derivação', () => {
    const value = { ...trace, estado: 'DERIVADO', original: null, valor: '0.00', origem: 'CALCULO', metodo: 'CALCULO_EVIDENCIADO',
      derivacao: { formula_versao: 'v1', campos_fontes: ['totais.valor_servicos'] } }
    expect(decimalField.safeParse(value).success).toBe(true)
    expect(decimalField.safeParse({ ...value, derivacao: null }).success).toBe(false)
  })
  it('mantém original inválido sem normalizá-lo para zero', () => {
    const value = { ...trace, estado: 'INVALIDO', original: '??', valor: null, validacoes: [{ codigo: 'DECIMAL', resultado: 'FALHOU' }] }
    expect(decimalField.safeParse(value).success).toBe(true)
    expect(decimalField.safeParse({ ...value, validacoes: [] }).success).toBe(false)
  })
  it.each(['1,00', '-1.00', 'NaN', '1.234', '01.00'])('rejeita decimal canônico ambíguo %s', value => {
    expect(decimalField.safeParse({ ...trace, estado: 'PRESENTE', original: value, valor: value }).success).toBe(false)
  })
  it('não contém campos de aprovação ou declaração de elegibilidade', () => {
    expect(canonicalSchema.safeParse({ ...absentDocument(), aprovado: true }).success).toBe(false)
    expect(canonicalSchema.safeParse({ ...absentDocument(), verificacao: { ...absentDocument().verificacao, elegibilidade: 'APTA' } }).success).toBe(false)
  })
  it('gera um JSON Schema a partir da mesma definição de runtime', () => {
    expect(z.toJSONSchema(canonicalSchema, { reused: 'ref' }).$schema).toBe('https://json-schema.org/draft/2020-12/schema')
  })
})

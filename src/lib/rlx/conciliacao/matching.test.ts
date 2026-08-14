import { describe, expect, it } from 'vitest'
import {
  executarMatchDeterministico,
  identidadeExternaDaFonte,
  normalizarChaveNfe,
} from './matching'
import type { RlxExternalSource, RlxKnownCrosswalk, RlxNoteCandidate } from './types'

const FUND_A = '11111111-1111-4111-8111-111111111111'
const FUND_B = '22222222-2222-4222-8222-222222222222'
const KEY_A = '35260883920000000137550020000000011100000011'

function source(overrides: Partial<RlxExternalSource> = {}): RlxExternalSource {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fundoId: FUND_A,
    provedor: 'rlx_golden',
    origem: 'ESTOQUE',
    externalTitleKey: '900719925474099312345',
    idRecebivel: '900719925474099312345',
    seuNumero: 'QA-000001',
    chaveNfe: KEY_A,
    numeroDocumento: '800000001',
    cedenteDocumento: '83920000000137',
    sacadoDocumento: '83930000000622',
    dataVencimento: '2026-08-31',
    valorReferencia: '17618.80',
    tipoRecebivel: 'NOTA_FISCAL',
    ...overrides,
  }
}

function note(overrides: Partial<RlxNoteCandidate> = {}): RlxNoteCandidate {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    fundoId: FUND_A,
    numero: '800000001',
    chaveAcesso: KEY_A,
    cedenteDocumento: '83.920.000/0001-37',
    cedenteNome: 'Cedente QA',
    sacadoDocumento: '83.930.000/0006-22',
    sacadoNome: 'Sacado QA',
    dataVencimento: '2026-08-31',
    valorBruto: '17618.8000',
    ...overrides,
  }
}

function crosswalk(overrides: Partial<RlxKnownCrosswalk> = {}): RlxKnownCrosswalk {
  return {
    vinculoId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    fundoId: FUND_A,
    provedor: 'rlx_golden',
    notaFiscalId: note().id,
    origem: 'AUTOMATICO',
    tipoChave: 'ID_RECEBIVEL',
    valorNormalizado: '900719925474099312345',
    ...overrides,
  }
}

describe('matching financeiro RLX_MATCH_V1', () => {
  it('preserva ID_RECEBIVEL maior que Number.MAX_SAFE_INTEGER como texto', () => {
    const result = executarMatchDeterministico(source({ chaveNfe: null }), [note()], [crosswalk()])
    expect(identidadeExternaDaFonte(result.source)).toBe('900719925474099312345')
    expect(result.metodo).toBe('ID_RECEBIVEL')
    expect(result.notaFiscalId).toBe(note().id)
  })

  it('prioriza CHAVE_NFE sobre crosswalk automatico de identificador', () => {
    const result = executarMatchDeterministico(source(), [note()], [crosswalk()])
    expect(result).toMatchObject({ status: 'MATCH_FORTE', metodo: 'CHAVE_NFE', notaFiscalId: note().id })
  })

  it('preserva match manual ativo como maior precedencia', () => {
    const manualNoteId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    const result = executarMatchDeterministico(source(), [note()], [crosswalk({ origem: 'MANUAL', notaFiscalId: manualNoteId })])
    expect(result).toMatchObject({ status: 'MATCH_FORTE', metodo: 'ID_RECEBIVEL', notaFiscalId: manualNoteId })
  })

  it('marca conflito quando chave forte diverge de crosswalk automatico ativo', () => {
    const result = executarMatchDeterministico(source(), [note()], [crosswalk({ notaFiscalId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })])
    expect(result).toMatchObject({ status: 'CONFLITO', metodo: 'CONFLITO', notaFiscalId: null })
    expect(result.candidates).toHaveLength(2)
  })

  it('faz match forte por chave NF-e valida no mesmo fundo', () => {
    const result = executarMatchDeterministico(source({ idRecebivel: null, seuNumero: null }), [note()])
    expect(normalizarChaveNfe(KEY_A)).toBe(KEY_A)
    expect(result).toMatchObject({ status: 'MATCH_FORTE', metodo: 'CHAVE_NFE', notaFiscalId: note().id })
  })

  it('nunca cruza fundos mesmo com chave e identificadores iguais', () => {
    const result = executarMatchDeterministico(source(), [note({ fundoId: FUND_B })], [crosswalk({ fundoId: FUND_B })])
    expect(result.status).toBe('NAO_CONCILIADO')
    expect(result.notaFiscalId).toBeNull()
  })

  it('marca SEU_NUMERO como ambiguo quando ha duas associacoes no mesmo escopo', () => {
    const input = source({ idRecebivel: null, chaveNfe: null })
    const links = [
      crosswalk({ tipoChave: 'SEU_NUMERO', valorNormalizado: 'QA-000001' }),
      crosswalk({
        vinculoId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        notaFiscalId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        tipoChave: 'SEU_NUMERO',
        valorNormalizado: 'QA-000001',
      }),
    ]
    expect(executarMatchDeterministico(input, [note()], links)).toMatchObject({ status: 'AMBIGUO', metodo: 'AMBIGUO' })
  })

  it('usa composto deterministico e Decimal exato', () => {
    const input = source({ idRecebivel: null, seuNumero: null, chaveNfe: null })
    expect(executarMatchDeterministico(input, [note()])).toMatchObject({ status: 'MATCH_FORTE', metodo: 'COMPOSTO' })
    expect(executarMatchDeterministico({ ...input, valorReferencia: '17618.81' }, [note()]).status).toBe('NAO_CONCILIADO')
  })

  it('rejeita chave ausente ou malformada sem escolher melhor candidata', () => {
    expect(normalizarChaveNfe(null)).toBeNull()
    expect(normalizarChaveNfe('12345')).toBeNull()
    const result = executarMatchDeterministico(source({ idRecebivel: null, seuNumero: null, chaveNfe: '12345', numeroDocumento: 'outro' }), [note()])
    expect(result.status).toBe('NAO_CONCILIADO')
  })
})

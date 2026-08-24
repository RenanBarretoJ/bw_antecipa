import { describe, expect, it } from 'vitest'
import {
  calcularDefasagemPl,
  selecionarPlReferenciaTemporal,
  type PlReferenciaCandidato,
} from './pl-referencia'

const FUNDO_A = '11111111-1111-4111-8111-111111111111'
const FUNDO_B = '22222222-2222-4222-8222-222222222222'

function candidato(overrides: Partial<PlReferenciaCandidato> = {}): PlReferenciaCandidato {
  return {
    fundoId: FUNDO_A,
    snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    importacaoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    dataBase: '2026-08-20',
    patrimonioLiquido: '1000000',
    snapshotVigente: true,
    snapshotPublicadaEm: '2026-08-24T12:00:00Z',
    importacaoPublicadaEm: '2026-08-24T12:00:00Z',
    importacaoStatus: 'PUBLICADA',
    importacaoTipoBase: 'CARTEIRA',
    importacaoCompletude: 'COMPLETO_COM_DADOS',
    importacaoOrigem: 'GOLDEN_DATASET',
    importacaoProvedor: 'qa_synthetic_pl',
    importacaoHashConteudo: 'a'.repeat(64),
    ...overrides,
  }
}

describe('PL de referencia temporal', () => {
  it('faz D-1 vencer D-2 para a data operacional 24/08/2026', () => {
    const result = selecionarPlReferenciaTemporal({
      fundoId: FUNDO_A,
      dataOperacional: '2026-08-24',
      candidatos: [
        candidato({ dataBase: '2026-08-20', snapshotId: 'd2' }),
        candidato({ dataBase: '2026-08-21', snapshotId: 'd1' }),
      ],
    })
    expect(result).toMatchObject({ dataBase: '2026-08-21', defasagem: 'D-1', snapshotId: 'd1' })
  })

  it('usa D-2 quando D-1 nao existe', () => {
    const result = selecionarPlReferenciaTemporal({
      fundoId: FUNDO_A,
      dataOperacional: '2026-08-24',
      candidatos: [candidato({ dataBase: '2026-08-20' })],
    })
    expect(result).toMatchObject({ dataBase: '2026-08-20', defasagem: 'D-2' })
  })

  it('faz fallback para o ultimo PL valido anterior a D-2', () => {
    const result = selecionarPlReferenciaTemporal({
      fundoId: FUNDO_A,
      dataOperacional: '2026-08-24',
      candidatos: [candidato({ dataBase: '2026-08-18' })],
    })
    expect(result).toMatchObject({ dataBase: '2026-08-18', defasagem: 'D-4' })
  })

  it('ignora a propria data, datas futuras, PL invalido e outro fundo', () => {
    const result = selecionarPlReferenciaTemporal({
      fundoId: FUNDO_A,
      dataOperacional: '2026-08-24',
      candidatos: [
        candidato({ dataBase: '2026-08-24', snapshotId: 'mesma-data' }),
        candidato({ dataBase: '2026-08-25', snapshotId: 'futuro' }),
        candidato({ dataBase: '2026-08-21', patrimonioLiquido: '0', snapshotId: 'invalido' }),
        candidato({ fundoId: FUNDO_B, dataBase: '2026-08-21', snapshotId: 'outro-fundo' }),
        candidato({ dataBase: '2026-08-20', snapshotId: 'valido' }),
      ],
    })
    expect(result?.snapshotId).toBe('valido')
  })

  it('preserva a classificacao de defasagem em dias uteis ANBIMA', () => {
    expect(calcularDefasagemPl('2026-08-24', '2026-08-21')).toBe('D-1')
    expect(calcularDefasagemPl('2026-08-24', '2026-08-20')).toBe('D-2')
  })
})

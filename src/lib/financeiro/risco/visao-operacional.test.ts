import { describe, expect, it } from 'vitest'
import {
  montarVisaoExposicaoFundo,
  montarVisaoExposicaoOperacao,
  montarProformaExposicaoSelecao,
  resolverControleExposicaoDoSnapshot,
} from './visao-operacional'

const controle = { ativo: true, limitePct: 40 }

describe('visão operacional canônica da exposição logística', () => {
  it('não cria visão quando o controle não está ativo no snapshot', () => {
    const inativo = resolverControleExposicaoDoSnapshot({
      controle_exposicao_logistica_ativo: false,
      limite_exposicao_em_transito_pct: 40,
    })
    expect(montarVisaoExposicaoOperacao({ controle: inativo, execucao: null })).toBeNull()
  })

  it('habilita a visão somente com flag e limite presentes no próprio snapshot', () => {
    expect(resolverControleExposicaoDoSnapshot({
      controle_exposicao_logistica_ativo: true,
      limite_exposicao_em_transito_pct: '40.000000000',
    })).toEqual({ ativo: true, limitePct: 40 })
    expect(resolverControleExposicaoDoSnapshot({
      controle_exposicao_logistica_ativo: true,
      limite_exposicao_em_transito_pct: null,
    })).toEqual({ ativo: false, limitePct: null })
  })

  it('preserva os mesmos valores persistidos pelo gate na visão do gestor e do cedente', () => {
    const visao = montarVisaoExposicaoOperacao({
      controle,
      fundoNome: 'Fundo A',
      dataBasePl: '2026-08-22',
      origemPl: 'QA SYNTHETIC',
      execucao: {
        status_tecnico: 'CONCLUIDA',
        patrimonio_liquido_d2: '50000000',
        exposicao_atual_valor: '13700000',
        exposicao_atual_pct: '27.4',
        operacao_valor_aquisicao: '2400000',
        operacao_valor_em_transito: '2400000',
        exposicao_projetada_valor: '16100000',
        exposicao_projetada_pct: '32.2',
        limite_pct: '40',
        finalizado_em: '2026-08-24T10:00:00Z',
      },
    })

    expect(visao).toMatchObject({
      fundoNome: 'Fundo A',
      patrimonioLiquido: 50000000,
      origemPl: 'QA SYNTHETIC',
      exposicaoAtualValor: 13700000,
      exposicaoAtualPct: 27.4,
      candidatoValor: 2400000,
      candidatoPct: 4.8,
      candidatoEmTransitoValor: 2400000,
      exposicaoProjetadaValor: 16100000,
      exposicaoProjetadaPct: 32.2,
      limitePct: 40,
      margemValor: 3900000,
      margemPct: 7.8,
      classificacao: 'ABAIXO_LIMITE',
    })
  })

  it('mantém o card indeterminado quando o snapshot exige controle e ainda não há execução', () => {
    const visao = montarVisaoExposicaoOperacao({ controle, execucao: null })
    expect(visao).toMatchObject({ aplicavel: true, classificacao: 'INDETERMINADA' })
  })

  it('não adota retroativamente a configuração de uma política fora do snapshot', () => {
    const snapshotAntigo = resolverControleExposicaoDoSnapshot({ politica_operacional_versao_id: 'versao-antiga' })
    expect(snapshotAntigo).toEqual({ ativo: false, limitePct: null })
    expect(montarVisaoExposicaoOperacao({ controle: snapshotAntigo, execucao: null })).toBeNull()
  })

  it.each([
    ['39.9', 'ABAIXO_LIMITE'],
    ['40', 'NO_LIMITE'],
    ['40.1', 'ACIMA_LIMITE'],
  ] as const)('classifica exposição projetada de %s%%', (percentual, classificacao) => {
    const visao = montarVisaoExposicaoOperacao({
      controle,
      execucao: {
        status_tecnico: 'CONCLUIDA',
        patrimonio_liquido_d2: '1000',
        exposicao_projetada_valor: String(Number(percentual) * 10),
        exposicao_projetada_pct: percentual,
      },
      motivos: classificacao === 'ACIMA_LIMITE' ? ['EXPOSICAO_ACIMA_LIMITE'] : classificacao === 'NO_LIMITE' ? ['NO_LIMITE'] : [],
    })
    expect(visao?.classificacao).toBe(classificacao)
  })

  it('traduz indisponibilidade técnica sem expor código interno', () => {
    const visao = montarVisaoExposicaoOperacao({
      controle,
      execucao: { status_tecnico: 'AVALIACAO_RISCO_INDISPONIVEL' },
      motivos: ['PL_D2_INDISPONIVEL'],
    })
    expect(visao).toMatchObject({ classificacao: 'INDETERMINADA' })
    expect(visao?.motivo).toMatch(/patrimônio líquido oficial/i)
    expect(visao?.motivo).not.toContain('PL_D2_INDISPONIVEL')
  })

  it('combina a exposição corrente com o PL temporal canônico do fundo', () => {
    const visao = montarVisaoExposicaoFundo({
      controle,
      fundoNome: 'Fundo B',
      plReferencia: {
        patrimonioLiquido: '1000000',
        dataBase: '2026-08-22',
        dataOperacional: '2026-08-25',
      },
      execucao: {
        status: 'CALCULADA',
        exposicao_em_transito_total: '390000',
      },
    })
    expect(visao).toMatchObject({
      fundoNome: 'Fundo B',
      exposicaoAtualValor: 390000,
      exposicaoAtualPct: 39,
      statusDashboard: 'PROXIMO_LIMITE',
      candidatoValor: null,
    })
  })

  it('mantem a exposicao atual quando a selecao esta vazia', () => {
    const atual = montarVisaoExposicaoFundo({
      controle,
      fundoNome: 'Fundo A',
      plReferencia: { patrimonioLiquido: '1000', dataBase: '2026-08-22', dataOperacional: '2026-08-25' },
      execucao: {
        status: 'CALCULADA',
        exposicao_em_transito_total: '100',
      },
    })!
    const proforma = montarProformaExposicaoSelecao({
      atual,
      candidatoValor: 0,
      quantidadeNfs: 0,
      quantidadeParcelas: 0,
    })
    expect(proforma).toMatchObject({
      candidatoValor: 0,
      exposicaoProjetadaValor: 100,
      exposicaoProjetadaPct: 10,
      quantidadeNfs: 0,
      quantidadeParcelas: 0,
    })
  })

  it.each([
    [299, 'ABAIXO_LIMITE'],
    [300, 'NO_LIMITE'],
    [301, 'ACIMA_LIMITE'],
  ] as const)('classifica a proforma parcel-aware com candidato %s', (candidato, classificacao) => {
    const atual = montarVisaoExposicaoFundo({
      controle,
      fundoNome: 'Fundo A',
      plReferencia: { patrimonioLiquido: '1000', dataBase: '2026-08-22', dataOperacional: '2026-08-25' },
      execucao: {
        status: 'CALCULADA',
        exposicao_em_transito_total: '100',
      },
    })!
    const proforma = montarProformaExposicaoSelecao({
      atual,
      candidatoValor: candidato,
      quantidadeNfs: 2,
      quantidadeParcelas: 3,
    })
    expect(proforma.classificacao).toBe(classificacao)
    expect(proforma.exposicaoProjetadaValor).toBe(100 + candidato)
    expect(proforma.candidatoValor).toBe(candidato)
    expect(proforma.quantidadeNfs).toBe(2)
    expect(proforma.quantidadeParcelas).toBe(3)
  })

  it('preserva Indeterminada quando o PL/base canonica esta indisponivel', () => {
    const atual = montarVisaoExposicaoFundo({
      controle,
      fundoNome: 'Fundo A',
      plReferencia: null,
      execucao: null,
    })!
    const proforma = montarProformaExposicaoSelecao({
      atual,
      candidatoValor: 100,
      quantidadeNfs: 1,
      quantidadeParcelas: 1,
    })
    expect(proforma).toMatchObject({
      classificacao: 'INDETERMINADA',
      exposicaoProjetadaValor: null,
      exposicaoProjetadaPct: null,
    })
    expect(proforma.motivo).toBeTruthy()
  })

  it('usa o PL temporal atual e nao o PL gravado em uma execucao historica', () => {
    const visao = montarVisaoExposicaoFundo({
      controle,
      fundoNome: 'Fundo A',
      plReferencia: {
        patrimonioLiquido: '1000000',
        dataBase: '2026-08-21',
        dataOperacional: '2026-08-25',
      },
      execucao: {
        status: 'CALCULADA',
        patrimonio_liquido_d2: '10000000',
        data_referencia_pl: '2026-08-18',
        exposicao_em_transito_total: '100000',
        percentual_exposicao: '1',
      },
      origemPl: 'QA SYNTHETIC',
    })

    expect(visao).toMatchObject({
      patrimonioLiquido: 1000000,
      dataBasePl: '2026-08-21',
      exposicaoAtualValor: 100000,
      exposicaoAtualPct: 10,
      margemValor: 300000,
      margemPct: 30,
      origemPl: 'QA SYNTHETIC',
    })
  })
})

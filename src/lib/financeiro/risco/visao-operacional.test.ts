import { describe, expect, it } from 'vitest'
import {
  montarVisaoExposicaoFundo,
  montarVisaoExposicaoOperacao,
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

  it('monta o dashboard somente com a execução canônica do fundo', () => {
    const visao = montarVisaoExposicaoFundo({
      controle,
      fundoNome: 'Fundo B',
      execucao: {
        status: 'CALCULADA',
        patrimonio_liquido_d2: '1000000',
        exposicao_em_transito_total: '390000',
        percentual_exposicao: '39',
        data_referencia_pl: '2026-08-22',
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
})

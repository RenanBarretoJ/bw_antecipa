import { describe, expect, it } from 'vitest'
import { calcularStatusLogisticoDocumental } from './resumo-operacional'

describe('calcularStatusLogisticoDocumental', () => {
  it('exibe aguardando desembolso quando ainda nao existe entrega para NF aprovada', () => {
    expect(calcularStatusLogisticoDocumental({
      entregaStatus: null,
      nfStatus: 'aprovada',
      possuiRequisitosPosCessao: false,
      possuiDocumentoPosCessaoEnviado: false,
      posCessaoVencida: false,
    })).toBe('aguardando_desembolso')
  })

  it('mantem em transito quando existe entrega sem requisitos pendentes visiveis', () => {
    expect(calcularStatusLogisticoDocumental({
      entregaStatus: 'em_transito',
      nfStatus: 'em_antecipacao',
      possuiRequisitosPosCessao: false,
      possuiDocumentoPosCessaoEnviado: false,
      posCessaoVencida: false,
    })).toBe('em_transito')
  })

  it('mostra aguardando comprovante quando a entrega tem requisitos pos-cessao sem arquivo', () => {
    expect(calcularStatusLogisticoDocumental({
      entregaStatus: 'em_transito',
      nfStatus: 'em_antecipacao',
      possuiRequisitosPosCessao: true,
      possuiDocumentoPosCessaoEnviado: false,
      posCessaoVencida: false,
    })).toBe('aguardando_comprovante')
  })

  it('prioriza atraso quando prazo pos-cessao esta vencido', () => {
    expect(calcularStatusLogisticoDocumental({
      entregaStatus: 'em_transito',
      nfStatus: 'em_antecipacao',
      possuiRequisitosPosCessao: true,
      possuiDocumentoPosCessaoEnviado: false,
      posCessaoVencida: true,
    })).toBe('em_atraso')
  })

  it('mostra em analise quando a entrega aguarda validacao documental', () => {
    expect(calcularStatusLogisticoDocumental({
      entregaStatus: 'aguardando_validacao',
      nfStatus: 'em_antecipacao',
      possuiRequisitosPosCessao: true,
      possuiDocumentoPosCessaoEnviado: true,
      posCessaoVencida: false,
    })).toBe('em_analise')
  })
})

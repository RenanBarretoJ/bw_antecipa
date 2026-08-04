import { describe, expect, it } from 'vitest'
import type { NotaFiscalElegibilidadeComDados, RequisitoElegibilidadeComDados } from '@/lib/notas-fiscais/listagem'
import { avaliarElegibilidadeDocumentalParaOperacao, avaliarLoteDocumentalParaOperacao } from './elegibilidade-documental'

const nota: NotaFiscalElegibilidadeComDados = {
  id: 'nf-1',
  status: 'aprovada',
  numero: '123',
  dataEmissao: '2026-07-01',
  dataVencimento: '2026-08-01',
  cnpjEmitente: '00111222000133',
  razaoSocialEmitente: 'Emitente',
  cnpjDestinatario: '00999888000177',
  razaoSocialDestinatario: 'Sacado',
  valorBruto: 1000,
}

function requisito(overrides: Partial<RequisitoElegibilidadeComDados> = {}): RequisitoElegibilidadeComDados {
  return {
    id: 'req-1',
    notaFiscalId: 'nf-1',
    codigo: 'nf_xml',
    escopo: 'nf_pre_cessao',
    obrigatorio: true,
    bloqueiaFluxo: true,
    momentoObrigatorio: 'antes_cessao',
    nivelValidacao: 'hibrido',
    statusInstancia: 'pendente',
    documentoId: null,
    versaoAprovadaId: null,
    versaoAtual: null,
    ...overrides,
  }
}

describe('elegibilidade documental em lote para operacoes', () => {
  it('mantem aprovavel a operacao cujo snapshot nao possui requisitos documentais', () => {
    const resultado = avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal: nota,
      requisitos: [],
    })

    expect(resultado.elegivel).toBe(true)
    expect(resultado.totalObrigatorios).toBe(0)
    expect(resultado.requisitosPendentes).toEqual([])
  })

  it('bloqueia documento ausente', () => {
    const resultado = avaliarElegibilidadeDocumentalParaOperacao({ notaFiscal: nota, requisitos: [requisito()] })
    expect(resultado.elegivel).toBe(false)
    expect(resultado.pendentesObrigatorios).toBe(1)
  })

  it('bloqueia documento enviado e ainda nao aprovado', () => {
    const resultado = avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal: nota,
      requisitos: [requisito({
        documentoId: 'doc-1',
        versaoAtual: { id: 'v1', status: 'enviado', ultimaAnalise: null },
      })],
    })
    expect(resultado.elegivel).toBe(false)
    expect(resultado.requisitosEmAnalise).toEqual(['nf_xml'])
  })

  it('nao bloqueia requisito opcional pendente', () => {
    const resultado = avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal: nota,
      requisitos: [requisito({ obrigatorio: false, bloqueiaFluxo: false })],
    })
    expect(resultado.elegivel).toBe(true)
    expect(resultado.totalObrigatorios).toBe(0)
  })

  it('nao considera requisito pos-cessao na solicitacao', () => {
    const resultado = avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal: nota,
      requisitos: [requisito({ escopo: 'nf_pos_cessao' })],
    })
    expect(resultado.elegivel).toBe(true)
    expect(resultado.requisitosPendentes).toEqual([])
  })

  it('aceita documento aprovado e preserva rejeicao como bloqueio', () => {
    const aprovado = avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal: nota,
      requisitos: [requisito({
        documentoId: 'doc-1',
        versaoAprovadaId: 'v1',
        versaoAtual: { id: 'v1', status: 'aprovado', ultimaAnalise: { resultado: 'aprovado' } },
      })],
    })
    const rejeitado = avaliarElegibilidadeDocumentalParaOperacao({
      notaFiscal: nota,
      requisitos: [requisito({
        documentoId: 'doc-1',
        versaoAtual: { id: 'v2', status: 'rejeitado', ultimaAnalise: { resultado: 'rejeitado' } },
      })],
    })
    expect(aprovado.elegivel).toBe(true)
    expect(rejeitado.elegivel).toBe(false)
    expect(rejeitado.requisitosRejeitados).toEqual(['nf_xml'])
  })

  it('avalia lote de 20 NFs sem alterar a regra individual', () => {
    const notas = Array.from({ length: 20 }, (_, index) => ({ ...nota, id: `nf-${index}` }))
    const requisitosPorNota = new Map(notas.map((item) => [item.id, [requisito({
      notaFiscalId: item.id,
      documentoId: `doc-${item.id}`,
      versaoAprovadaId: `v-${item.id}`,
      versaoAtual: {
        id: `v-${item.id}`,
        status: 'aprovado',
        ultimaAnalise: { resultado: 'aprovado' },
      },
    })]]))
    const lote = avaliarLoteDocumentalParaOperacao({ notas, requisitosPorNota })
    expect(lote).toHaveLength(20)
    expect([...lote.values()].every((item) => item.elegivel)).toBe(true)
  })

  it('mantem o resultado individual e o resultado em lote equivalentes', () => {
    const requisitos = [requisito({
      documentoId: 'doc-1',
      versaoAprovadaId: 'v1',
      versaoAtual: { id: 'v1', status: 'aprovado', ultimaAnalise: { resultado: 'aprovado' } },
    })]
    const individual = avaliarElegibilidadeDocumentalParaOperacao({ notaFiscal: nota, requisitos })
    const lote = avaliarLoteDocumentalParaOperacao({
      notas: [nota],
      requisitosPorNota: new Map([[nota.id, requisitos]]),
    })
    expect(lote.get(nota.id)).toEqual(individual)
  })

  it('uma NF pendente permanece identificada em lote com NFs elegiveis', () => {
    const notaPendente = { ...nota, id: 'nf-pendente' }
    const requisitoAprovado = requisito({
      documentoId: 'doc-1',
      versaoAprovadaId: 'v1',
      versaoAtual: { id: 'v1', status: 'aprovado', ultimaAnalise: { resultado: 'aprovado' } },
    })
    const lote = avaliarLoteDocumentalParaOperacao({
      notas: [nota, notaPendente],
      requisitosPorNota: new Map([
        [nota.id, [requisitoAprovado]],
        [notaPendente.id, [requisito({ notaFiscalId: notaPendente.id })]],
      ]),
    })
    expect(lote.get(nota.id)?.elegivel).toBe(true)
    expect(lote.get(notaPendente.id)?.elegivel).toBe(false)
  })
})

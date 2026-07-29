import { describe, expect, it } from 'vitest'
import {
  resolverSatisfacaoRequisitoParaAprovacao,
  resolverSatisfacaoRequisitoParaSubmissao,
  type EntradaSatisfacaoRequisito,
} from './satisfacao-requisito'

const baseInput = (): EntradaSatisfacaoRequisito => ({
  requisitoId: 'req-1',
  tipoDocumento: 'nf_pedido_compra',
  obrigatorio: true,
  bloqueiaFluxo: true,
  momento: 'nf_pre_cessao',
  regraValidade: 'manual',
  statusInstancia: 'pendente',
  documentoId: 'doc-1',
  versaoAprovadaId: null,
  versoes: [{ id: 'versao-1', status: 'em_analise', ultimaAnalise: null }],
})

describe('satisfacao de requisito documental', () => {
  it('permite submissao com documento manual enviado e ainda nao aprovado', () => {
    const input = baseInput()

    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      documentoPresente: true,
      statusAnalise: 'aguardando_analise',
      satisfazSubmissao: true,
    })
    expect(resolverSatisfacaoRequisitoParaAprovacao(input).aprovado).toBe(false)
  })

  it('bloqueia submissao quando o documento manual esta ausente', () => {
    const input = baseInput()
    input.documentoId = null
    input.versoes = []

    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      documentoPresente: false,
      satisfazSubmissao: false,
    })
  })

  it('bloqueia submissao quando a versao atual foi rejeitada', () => {
    const input = baseInput()
    input.versoes[0] = { id: 'versao-1', status: 'rejeitado', ultimaAnalise: { resultado: 'rejeitado' } }

    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      statusAnalise: 'rejeitado',
      satisfazSubmissao: false,
    })
  })

  it('permite requisito estrutural somente depois da validacao estrutural', () => {
    const input = baseInput()
    input.regraValidade = 'estrutural'

    expect(resolverSatisfacaoRequisitoParaSubmissao(input).satisfazSubmissao).toBe(false)

    input.validacaoEstruturalOk = true
    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      validacaoEstruturalOk: true,
      satisfazSubmissao: true,
    })
  })

  it('permite requisito hibrido estruturalmente valido enquanto aguarda analise manual', () => {
    const input = baseInput()
    input.regraValidade = 'hibrido'
    input.tipoDocumento = 'cte_xml'
    input.validacaoEstruturalOk = true

    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      statusAnalise: 'aguardando_analise',
      validacaoEstruturalOk: true,
      satisfazSubmissao: true,
    })
    expect(resolverSatisfacaoRequisitoParaAprovacao(input).aprovado).toBe(false)
  })

  it('reconhece aprovacao da versao atual sem confundir com submissao da NF', () => {
    const input = baseInput()
    input.versaoAprovadaId = 'versao-1'

    expect(resolverSatisfacaoRequisitoParaSubmissao(input).satisfazSubmissao).toBe(true)
    expect(resolverSatisfacaoRequisitoParaAprovacao(input)).toMatchObject({
      aprovado: true,
      statusAnalise: 'aprovado',
    })
  })
})

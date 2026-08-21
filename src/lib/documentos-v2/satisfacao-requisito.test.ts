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

// Ticket P0_Claude_Integrar_NF_Remessa_Requisito_Politica: nf_remessa nunca
// passa pelo fluxo generico de documento_id/versoes (nunca existirao para
// este tipo) -- sua satisfacao vem inteiramente de statusInstancia, que um
// trigger em nota_fiscal_remessas mantem sincronizado com
// status_validacao='VALIDADA'.
const baseInputNfRemessa = (): EntradaSatisfacaoRequisito => ({
  requisitoId: 'req-nf-remessa',
  tipoDocumento: 'nf_remessa',
  obrigatorio: true,
  bloqueiaFluxo: true,
  momento: 'nf_pre_cessao',
  regraValidade: 'manual',
  statusInstancia: 'pendente',
  documentoId: null,
  versaoAprovadaId: null,
  versoes: [],
})

describe('satisfacao do requisito nf_remessa (fonte real: nota_fiscal_remessas)', () => {
  it('obrigatorio + sem remessa (statusInstancia=pendente) -> nao satisfaz submissao nem aprovacao', () => {
    const input = baseInputNfRemessa()
    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      documentoPresente: false,
      satisfazSubmissao: false,
    })
    expect(resolverSatisfacaoRequisitoParaAprovacao(input).aprovado).toBe(false)
  })

  it('obrigatorio + >=1 remessa VALIDADA (statusInstancia=satisfeito, via trigger) -> satisfaz submissao e aprovacao', () => {
    const input = baseInputNfRemessa()
    input.statusInstancia = 'satisfeito'
    expect(resolverSatisfacaoRequisitoParaSubmissao(input)).toMatchObject({
      documentoPresente: true,
      satisfazSubmissao: true,
    })
    expect(resolverSatisfacaoRequisitoParaAprovacao(input).aprovado).toBe(true)
  })

  it('obrigatorio + remessa REVISAO_MANUAL -> trigger nao marca satisfeito, statusInstancia continua pendente -> nao satisfaz', () => {
    const input = baseInputNfRemessa()
    input.statusInstancia = 'pendente' // trigger so promove para satisfeito com VALIDADA
    expect(resolverSatisfacaoRequisitoParaSubmissao(input).satisfazSubmissao).toBe(false)
    expect(resolverSatisfacaoRequisitoParaAprovacao(input).aprovado).toBe(false)
  })

  it('obrigatorio + remessa REJEITADA -> mesma coisa, permanece pendente -> nao satisfaz', () => {
    const input = baseInputNfRemessa()
    input.statusInstancia = 'pendente'
    expect(resolverSatisfacaoRequisitoParaSubmissao(input).satisfazSubmissao).toBe(false)
  })

  it('opcional + sem remessa -> satisfazSubmissao continua false, mas obrigatorio=false garante que o agregador nao bloqueia', () => {
    const input = baseInputNfRemessa()
    input.obrigatorio = false
    input.bloqueiaFluxo = false
    const resultado = resolverSatisfacaoRequisitoParaSubmissao(input)
    expect(resultado.satisfazSubmissao).toBe(false)
    expect(resultado.obrigatorio).toBe(false)
    expect(resultado.bloqueiaFluxo).toBe(false)
  })

  it('nunca exige documentoId/versoes -- documentoPresente reflete apenas statusInstancia', () => {
    const satisfeito = { ...baseInputNfRemessa(), statusInstancia: 'satisfeito', documentoId: null, versoes: [] }
    expect(resolverSatisfacaoRequisitoParaSubmissao(satisfeito).documentoPresente).toBe(true)
  })

  it('reabertura/reconsulta preserva o resultado (funcao pura, mesma entrada -> mesma saida)', () => {
    const input = baseInputNfRemessa()
    input.statusInstancia = 'satisfeito'
    const primeira = resolverSatisfacaoRequisitoParaSubmissao(input)
    const segunda = resolverSatisfacaoRequisitoParaSubmissao({ ...input })
    expect(primeira).toEqual(segunda)
  })
})

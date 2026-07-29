import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { avaliarElegibilidadeSubmissaoNf } from './elegibilidade-submissao'
import {
  avaliarElegibilidadeSubmissaoNfComDados,
  calcularIntervaloPagina,
  estadoSubmissaoPorStatus,
  normalizarCampoOrdenacaoListagemNf,
  normalizarLimiteListagemNf,
  type RequisitoElegibilidadeComDados,
} from './listagem'

const notaCompleta = {
  id: 'nf-1',
  status: 'rascunho',
  numero: '123',
  dataEmissao: '2026-07-01',
  dataVencimento: '2026-08-01',
  cnpjEmitente: '00262371000575',
  razaoSocialEmitente: 'Cedente Teste',
  cnpjDestinatario: '41985505000130',
  razaoSocialDestinatario: 'Sacado Teste',
  valorBruto: 1000,
}

function requisito(overrides: Partial<RequisitoElegibilidadeComDados> = {}): RequisitoElegibilidadeComDados {
  return {
    id: 'req-1',
    notaFiscalId: 'nf-1',
    codigo: 'pedido_compra',
    escopo: 'nf_pre_cessao',
    obrigatorio: true,
    bloqueiaFluxo: true,
    momentoObrigatorio: 'antes_cessao',
    nivelValidacao: 'manual',
    statusInstancia: 'pendente',
    documentoId: 'doc-1',
    versaoAprovadaId: null,
    versaoAtual: {
      id: 'versao-1',
      status: 'enviado',
      ultimaAnalise: null,
    },
    ...overrides,
  }
}

const contextoValido = {
  cedenteFundoAtivo: true,
  fundoAtivo: true,
  politicaPublicadaVigente: true,
  requisitosInstanciados: true,
  operacaoIncompativel: false,
}

describe('listagem paginada de notas fiscais do cedente', () => {
  it('calcula intervalos reais de 10 itens para uma listagem com 22 NFs', () => {
    expect(calcularIntervaloPagina(1, 10)).toEqual({ inicio: 0, fim: 9 })
    expect(calcularIntervaloPagina(2, 10)).toEqual({ inicio: 10, fim: 19 })
    expect(calcularIntervaloPagina(3, 10)).toEqual({ inicio: 20, fim: 29 })
  })

  it('restringe limite e ordenacao aos valores permitidos', () => {
    expect(normalizarLimiteListagemNf(20)).toBe(20)
    expect(normalizarLimiteListagemNf(500)).toBe(10)
    expect(normalizarCampoOrdenacaoListagemNf('valor_bruto')).toBe('valor_bruto')
    expect(normalizarCampoOrdenacaoListagemNf('sql_injetado')).toBe('created_at')
  })

  it('avalia somente requisitos pre-cessao para liberar a submissao', () => {
    const avaliacao = avaliarElegibilidadeSubmissaoNfComDados({
      notaFiscal: notaCompleta,
      requisitos: [
        requisito(),
        requisito({
          id: 'req-pos',
          codigo: 'comprovante_entrega',
          escopo: 'nf_pos_cessao',
          documentoId: null,
          versaoAtual: null,
        }),
      ],
      contexto: contextoValido,
    })

    expect(avaliacao.elegivel).toBe(true)
    expect(avaliacao.obrigatorios).toEqual({ total: 1, concluidos: 1, pendentes: 0 })
  })

  it('resume multiplos requisitos obrigatorios sem carregar detalhes historicos', () => {
    const avaliacao = avaliarElegibilidadeSubmissaoNfComDados({
      notaFiscal: notaCompleta,
      requisitos: [
        requisito(),
        requisito({
          id: 'req-2',
          codigo: 'contrato',
          documentoId: null,
          versaoAtual: null,
        }),
        requisito({
          id: 'req-opcional',
          codigo: 'boleto',
          obrigatorio: false,
          bloqueiaFluxo: false,
          documentoId: null,
          versaoAtual: null,
        }),
      ],
      contexto: contextoValido,
    })

    expect(avaliacao.elegivel).toBe(false)
    expect(avaliacao.obrigatorios).toEqual({ total: 2, concluidos: 1, pendentes: 1 })
  })

  it('mantem equivalencia com a regra individual para os mesmos dados', () => {
    const emLote = avaliarElegibilidadeSubmissaoNfComDados({
      notaFiscal: notaCompleta,
      requisitos: [requisito()],
      contexto: contextoValido,
    })
    const individual = avaliarElegibilidadeSubmissaoNf({
      status: 'rascunho',
      contexto: { cedenteFundoAtivo: true, fundoAtivo: true },
      politica: { publicadaVigente: true },
      requisitos: {
        instanciados: true,
        preCessao: [{
          nome: 'pedido_compra',
          obrigatorio: true,
          bloqueiaFluxo: true,
          satisfazSubmissao: true,
        }],
        validacaoEstruturalOk: true,
        erroFiscal: null,
      },
      dadosObrigatoriosCompletos: true,
      operacaoIncompativel: false,
    })

    expect(emLote).toEqual(individual)
  })

  it('preserva o estado persistido de NFs que nao sao rascunho', () => {
    expect(estadoSubmissaoPorStatus('submetida', true)).toBe('submetida')
    expect(estadoSubmissaoPorStatus('aprovada', false)).toBe('aprovada')
    expect(estadoSubmissaoPorStatus('em_antecipacao', false)).toBe('antecipada')
  })

  it('nao executa elegibilidade individual nem consultas por linha no componente cliente', () => {
    const clientSource = readFileSync(
      join(process.cwd(), 'src/app/cedente/notas-fiscais/notas-fiscais-listagem.tsx'),
      'utf8',
    )
    const serverSource = readFileSync(
      join(process.cwd(), 'src/lib/notas-fiscais/listagem.server.ts'),
      'utf8',
    )
    const pageSource = readFileSync(
      join(process.cwd(), 'src/app/cedente/notas-fiscais/page.tsx'),
      'utf8',
    )
    const actionSource = readFileSync(
      join(process.cwd(), 'src/lib/actions/nota-fiscal.ts'),
      'utf8',
    )

    expect(clientSource).not.toContain('verificarElegibilidadeSubmissaoDocumental')
    expect(clientSource).not.toMatch(/\.map\(\s*async/)
    expect(serverSource).toContain(".in('nota_fiscal_id', idsRascunho)")
    expect(serverSource).not.toContain('createAdminClient')
    expect(pageSource.match(/carregarNotasFiscaisComResumoDocumental\(filtros\)/g)).toHaveLength(1)
    expect(actionSource).toContain("revalidatePath('/cedente/notas-fiscais')")
  })

  it('amarra a consulta paginada ao cedente, vinculo e fundo autenticados', () => {
    const serverSource = readFileSync(
      join(process.cwd(), 'src/lib/notas-fiscais/listagem.server.ts'),
      'utf8',
    )

    expect(serverSource).toContain(".eq('cedente_id', contexto.cedenteId)")
    expect(serverSource).toContain(".eq('cedente_fundo_id', contexto.cedenteFundoId)")
    expect(serverSource).toContain(".eq('fundo_id', contexto.fundoId)")
    expect(serverSource).toContain('const idsPagina = rows.map((row) => row.id)')
    expect(serverSource).toContain("const rascunhos = rows.filter((row) => row.status === 'rascunho')")
  })
})

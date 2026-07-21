import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  calcularSha256Canonico,
  renderizarTemplate,
  sanitizarTemplateHtml,
  SCHEMAS_POR_TIPO,
  TEMPLATE_TIPOS,
  validarVariaveisTemplate,
} from './resolver-template'

const dadosContrato = {
  cedente: { razao_social: 'Cedente & Cia' },
  contrato: { data_assinatura_extenso: '21 de julho de 2026' },
  testemunha_1: { nome: 'Testemunha 1' },
  testemunha_2: { nome: 'Testemunha 2' },
}

describe('resolver-template', () => {
  it('bloqueia tags e atributos inseguros em templates HTML', () => {
    expect(() => sanitizarTemplateHtml('<script>alert(1)</script>')).toThrow(/proibido/)
    expect(() => sanitizarTemplateHtml('<a href="javascript:alert(1)">x</a>')).toThrow(/proibido/)
    expect(() => sanitizarTemplateHtml('<div onclick="alert(1)">x</div>')).toThrow(/proibido/)
  })

  it('rejeita variaveis fora do schema permitido', () => {
    expect(() =>
      validarVariaveisTemplate(
        '<p>{{cedente.razao_social}} {{segredo.token}}</p>',
        SCHEMAS_POR_TIPO.contrato_mae,
        dadosContrato,
      ),
    ).toThrow(/nao permitidas/)
  })

  it('permite this e paths relativos dentro de loops sem abrir variaveis externas', () => {
    expect(() =>
      validarVariaveisTemplate(
        '{{#each notas_fiscais}}<p>{{this.numero}} {{../termo.numero}}</p>{{/each}}',
        SCHEMAS_POR_TIPO.termo_cessao,
        {
          cedente: {},
          termo: {},
          notas_fiscais: [{ numero: '1' }],
          testemunha_1: {},
          testemunha_2: {},
        },
      ),
    ).not.toThrow()
  })

  it('rejeita variavel obrigatoria ausente', () => {
    expect(() =>
      validarVariaveisTemplate(
        '<p>{{cedente.razao_social}}</p>',
        SCHEMAS_POR_TIPO.contrato_mae,
        { cedente: dadosContrato.cedente },
      ),
    ).toThrow(/Variavel obrigatoria ausente/)
  })

  it('renderiza com escaping HTML habilitado por padrao', () => {
    const html = renderizarTemplate(
      '<p>{{cedente.razao_social}}</p>',
      SCHEMAS_POR_TIPO.contrato_mae,
      dadosContrato,
    )

    expect(html).toContain('Cedente &amp; Cia')
  })

  it('gera hash canonico estavel ignorando espacos nas bordas e CRLF', () => {
    expect(calcularSha256Canonico('  linha 1\r\nlinha 2  ')).toBe(calcularSha256Canonico('linha 1\nlinha 2'))
  })

  it('valida todos os templates juridicos locais importaveis', () => {
    const previewData = {
      cedente: {},
      contrato: {},
      termo: {},
      quitacao: {},
      notas_fiscais: [{}],
      testemunha_1: {},
      testemunha_2: {},
    }

    for (const template of TEMPLATE_TIPOS) {
      const html = fs.readFileSync(path.join(process.cwd(), 'src', 'templates', 'contratos', template.arquivo), 'utf8')
      expect(() => validarVariaveisTemplate(html, SCHEMAS_POR_TIPO[template.tipo], previewData)).not.toThrow()
    }
  })
})

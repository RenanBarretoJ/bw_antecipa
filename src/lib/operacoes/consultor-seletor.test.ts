import { describe, expect, it } from 'vitest'
import {
  LIMITE_CEDENTES_SELETOR,
  deveExecutarBuscaCedentes,
  normalizarTermoBuscaCedente,
  parametrosAoSelecionarCedente,
} from './consultor-seletor'

describe('seletor de Cedente do Consultor', () => {
  it('carrega a lista inicial limitada e nao dispara busca remota com 1, 2 ou 3 caracteres', () => {
    expect(LIMITE_CEDENTES_SELETOR).toBe(10)
    expect(deveExecutarBuscaCedentes('')).toBe(true)
    expect(deveExecutarBuscaCedentes('a')).toBe(false)
    expect(deveExecutarBuscaCedentes('ab')).toBe(false)
    expect(deveExecutarBuscaCedentes('abc')).toBe(false)
    expect(deveExecutarBuscaCedentes('abcd')).toBe(true)
  })

  it('normaliza espacos sem remover acentos ou pontuacao de CNPJ do termo original', () => {
    expect(normalizarTermoBuscaCedente('  São   José  ')).toBe('São José')
    expect(normalizarTermoBuscaCedente('07.312.248/0001-37')).toBe('07.312.248/0001-37')
  })

  it('troca o Cedente e descarta pagina e busca da selecao anterior', () => {
    const atuais = new URLSearchParams('cedente=anterior&q=NF+123&page=4&pageSize=20&sort=valor_bruto')
    const resultado = parametrosAoSelecionarCedente(atuais, 'novo')
    expect(resultado.get('cedente')).toBe('novo')
    expect(resultado.has('q')).toBe(false)
    expect(resultado.has('page')).toBe(false)
    expect(resultado.get('pageSize')).toBe('20')
    expect(resultado.get('sort')).toBe('valor_bruto')
  })
})

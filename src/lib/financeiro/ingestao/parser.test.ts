import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeDecimal, processarArquivoRlx } from './parser'

const fundoId = '61f02178-58af-bbfa-9a33-f97ac5b3dd96'
const bytes = (value: string) => new TextEncoder().encode(value)

describe('parser financeiro RLX V1', () => {
  it('preserva campos opcionais vazios sem substituir pelo fundo da importacao', () => {
    const csv = 'ID_RECEBIVEL;SEU_NUMERO;NU_DOCUMENTO;CHAVE_NFE;VALOR_NOMINAL;DATA_REFERENCIA\n' +
      'TITULO-SEM-ALIAS;;NF-1;;100,00;2026-08-07\n'
    const result = processarArquivoRlx({
      arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-07',
    })

    expect(result.linhas[0].dadosNormalizados.seu_numero).toBe('')
    expect(result.linhas[0].dadosNormalizados.chave_nfe).toBe('')
    expect(result.linhas[0].dadosNormalizados.fundo_id).toBe(fundoId)
  })

  it('preserva identificadores grandes, aceita BOM e normaliza decimal brasileiro', () => {
    const csv = '\uFEFFFUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;NOME_CEDENTE;VALOR_NOMINAL\r\n' +
      `${fundoId};2026-08-09;910000000000000000002;"Empresa; com separador";25.026,74\r\n`
    const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(result.completude).toBe('COMPLETO_COM_DADOS')
    expect(result.linhas[0].dadosNormalizados.id_recebivel).toBe('910000000000000000002')
    expect(result.linhas[0].dadosNormalizados.valor_nominal).toBe('25026.7400')
    expect(result.linhas[0].dadosNormalizados.cedente_nome).toBe('Empresa; com separador')
  })

  it('aceita movimento vazio explicito somente para aquisicoes e liquidacoes', () => {
    const csv = `DATA_MOVIMENTO;FUNDO_ID;STATUS_ARQUIVO;VERSAO\n2026-08-09;${fundoId};SEM_MOVIMENTO;1\n`
    const acquisitions = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'AQUISICOES', fundoId, dataReferencia: '2026-08-09' })
    expect(acquisitions.completude).toBe('COMPLETO_VAZIO')
    expect(acquisitions.linhas).toHaveLength(0)
    const inventory = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(inventory.completude).toBe('INCOMPLETO')
  })

  it('bloqueia fundo divergente, data invalida e campo obrigatorio vazio', () => {
    const csv = 'FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;VALOR_NOMINAL\n00000000-0000-0000-0000-000000000000;31/02/2026;;abc\n'
    const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(result.completude).toBe('INCOMPLETO')
    expect(result.linhas[0].status).toBe('INVALIDA')
    expect(result.linhas[0].erros.join(' ')).toContain('fundo_id')
    expect(result.linhas[0].erros.join(' ')).toContain('data_referencia')
    expect(result.linhas[0].erros.join(' ')).toContain('id_recebivel')
    expect(result.linhas[0].erros.join(' ')).toContain('valor_nominal')
  })

  it('rejeita arquivo sem linhas sem confundir com snapshot vazio', () => {
    const result = processarArquivoRlx({ arquivo: bytes('FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;VALOR_NOMINAL\n'), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(result.completude).toBe('INCOMPLETO')
    expect(result.errosArquivo).toContain('Arquivo sem linhas de dados e sem declaracao explicita de movimento vazio.')
  })

  it('normaliza formatos monetarios brasileiro e norte-americano sem usar number', () => {
    expect(normalizeDecimal('1.000,00')).toBe('1000.0000')
    expect(normalizeDecimal('1,000.00')).toBe('1000.0000')
    expect(() => normalizeDecimal('1,000')).toThrow('formato decimal ambiguo')
  })

  it('rejeita data civil impossivel nos formatos local e ISO', () => {
    for (const data of ['31/02/2026', '2026-02-31']) {
      const csv = `FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;VALOR_NOMINAL\n${fundoId};${data};1;100,00\n`
      const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
      expect(result.linhas[0].status).toBe('INVALIDA')
      expect(result.linhas[0].erros.join(' ')).toContain('data invalida')
    }
  })

  it('registra documento com checksum invalido como warning sem perder o bruto', () => {
    const csv = `FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;DOC_CEDENTE;VALOR_NOMINAL\n${fundoId};2026-08-09;1;11.111.111/1111-11;100,00\n`
    const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(result.completude).toBe('COMPLETO_COM_DADOS')
    expect(result.linhas[0].status).toBe('WARNING')
    expect(result.linhas[0].avisos.join(' ')).toContain('checksum')
    expect(result.linhas[0].dadosBrutos.DOC_CEDENTE).toBe('11.111.111/1111-11')
  })

  it('falha explicitamente ao exceder o limite defensivo de linhas', () => {
    const csv = `FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;VALOR_NOMINAL\n${fundoId};2026-08-09;1;100,00\n${fundoId};2026-08-09;2;200,00\n`
    expect(() => processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09', maxRows: 1 })).toThrow('excede o limite')
  })

  it('preserva identificador externo acima de Number.MAX_SAFE_INTEGER como string', () => {
    const externalId = '900719925474099312345'
    const csv = `FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;VALOR_NOMINAL\n${fundoId};2026-08-09;${externalId};100,00\n`
    const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(result.linhas[0].dadosNormalizados.id_recebivel).toBe(externalId)
    expect(typeof result.linhas[0].dadosNormalizados.id_recebivel).toBe('string')
  })

  it('classifica o fixture golden incompleto e impede que seja elegivel para publicacao', () => {
    const fixture = readFileSync(join(process.cwd(), 'scripts/homologacao/rlx-golden/fixtures/edge-cases/required-blank.csv'))
    const contract = JSON.parse(readFileSync(join(process.cwd(), 'scripts/homologacao/rlx-golden/fixtures/edge-cases/incomplete-snapshot.json'), 'utf8'))
    const result = processarArquivoRlx({ arquivo: fixture, tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09' })
    expect(contract).toMatchObject({ status: 'INCOMPLETO', mustBlock: true })
    expect(result.completude).toBe('INCOMPLETO')
    expect(result.linhas.some((row) => row.status === 'INVALIDA')).toBe(true)
  })

  it('falha explicitamente quando o limite de tempo configurado e invalido', () => {
    expect(() => processarArquivoRlx({ arquivo: bytes('FUNDO_ID;DATA_REFERENCIA;ID_RECEBIVEL;VALOR_NOMINAL\n'), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09', maxParseMs: 0 })).toThrow('Timeout do parser invalido')
  })

  it('aceita estoque Sinqia sem UUID no CSV e ancora o fundo no contexto confiavel', () => {
    const csv = 'SEU_NUMERO;DATA_REFERENCIA;VALOR_NOMINAL\nTITULO-1;2026-08-09;100,00\n'
    const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'ESTOQUE', fundoId, dataReferencia: '2026-08-09', provedor: 'SINQIA' })
    expect(result.completude).toBe('COMPLETO_COM_DADOS')
    expect(result.linhas[0].dadosNormalizados).toMatchObject({ fundo_id: fundoId, id_recebivel: 'TITULO-1' })
  })

  it('aceita ENTRADA como data de movimento comprovada no relatorio de aquisicoes', () => {
    const csv = 'ID_RECEBIVEL;ENTRADA;VALOR_COMPRA\nTITULO-1;09/08/2026;100,00\n'
    const result = processarArquivoRlx({ arquivo: bytes(csv), tipoBase: 'AQUISICOES', fundoId, dataReferencia: '2026-08-09', provedor: 'SINQIA' })
    expect(result.completude).toBe('COMPLETO_COM_DADOS')
    expect(result.linhas[0].dadosNormalizados.data_movimento).toBe('2026-08-09')
  })
})

import { describe, expect, it } from 'vitest'
import { prepararInclusaoVortx } from './inclusao-snapshot'
import { CONTEXTO_CSV_QA, csvVortxQa } from './__fixtures__/relatorios-csv'
const input = (patches: Record<string,string>[] = [{}]) => ({ contexto: CONTEXTO_CSV_QA,
  versaoId: CONTEXTO_CSV_QA.fundoId, arquivo: csvVortxQa('Inclusao',patches) })
describe('native Inclusion preparation',()=>{
  it('preserves original values, receipt date and private lineage without inventing a purchase date',()=>{
    const result=prepararInclusaoVortx(input())
    expect(result.linhas[0].dados_brutos['Valor de Compra']).toBe('90.00')
    expect(result.linhas[0].dados_normalizados).toMatchObject({valor_aquisicao:'90.0000',data_movimento:'2026-10-15'})
    expect(result.linhas[0].dados_normalizados.data_aquisicao).toBeUndefined()
    expect(result.manifesto.arquivo.storage_path).toBe(`${CONTEXTO_CSV_QA.fundoId}/vortx/${result.manifesto.id}/inclusao.csv`)
  })
  it('deduplicates by scoped content, not a random upload id',()=>{
    const first=prepararInclusaoVortx(input()),second=prepararInclusaoVortx(input())
    expect(first.manifesto.id).not.toBe(second.manifesto.id)
    expect(first.manifesto.hash_conteudo).toBe(second.manifesto.hash_conteudo)
    const different=prepararInclusaoVortx({...input(),contexto:{...CONTEXTO_CSV_QA,dataFim:'2026-10-17'}})
    expect(different.manifesto.hash_conteudo).not.toBe(first.manifesto.hash_conteudo)
  })
  it('same keys in different cedentes remain distinct',()=>{
    expect(prepararInclusaoVortx(input([{}, {cedente_documento:'98992300000441'}])).linhas).toHaveLength(2)
  })
  it.each([[{},{}],[{valor_aquisicao:'-1.00'}],[{valor_aquisicao:'NaN'}],[{data_movimento:'14/10/2026'}],[{codigo_carteira:'OTHER'}]].map(patches=>({patches})))('rejects invalid report atomically %j',({patches})=>{
    expect(()=>prepararInclusaoVortx(input(patches))).toThrow()
  })
  it('preserves the canonical rejection of a header-only or empty report without proof of completeness',()=>{
    expect(()=>prepararInclusaoVortx(input([]))).toThrow()
    expect(()=>prepararInclusaoVortx({...input(),arquivo:Buffer.from('')})).toThrow()
    expect(()=>prepararInclusaoVortx({...input(),arquivo:Buffer.from('foo;bar\n')})).toThrow()
  })
})

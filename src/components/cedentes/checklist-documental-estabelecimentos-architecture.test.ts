import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260819150000_p0_catalogo_documental_cadastro_estabelecimento.sql', 'utf8')
const componente = readFileSync('src/components/cedentes/EstabelecimentosGestor.tsx', 'utf8')

describe('correcao P0: catalogo documental correto para checklist de estabelecimento', () => {
  it('reutiliza documento_tipos.dominio em vez de criar coluna paralela', () => {
    expect(migration).toContain('documento_tipos_dominio_check')
    expect(migration).toContain("CHECK (dominio IN ('nf', 'operacao', 'juridico', 'entrega', 'integracao', 'cadastro'))")
    expect(migration).not.toContain('CREATE TABLE')
    expect(migration).not.toMatch(/ADD COLUMN\s+\w*categoria/i)
  })

  it('cadastra os quatro tipos documentais cadastrais aprovados, sem tocar no catalogo de NF/logistica', () => {
    for (const codigo of [
      'estabelecimento_cartao_cnpj',
      'estabelecimento_comprovante_endereco',
      'estabelecimento_contrato_social',
      'estabelecimento_comprovante_faturamento',
    ]) {
      expect(migration).toContain(`'${codigo}'`)
    }
    expect(migration).not.toContain('nf_xml')
    expect(migration).not.toContain('DELETE FROM public.documento_tipos')
  })

  it('o dropdown de requisito filtra por dominio cadastro e nao mostra todo o catalogo ativo', () => {
    expect(componente).toContain("eq('dominio', 'cadastro')")
  })

  it('troca o placeholder generico pelo rotulo cadastral especifico', () => {
    expect(componente).toContain('Adicionar documento cadastral obrigatorio...')
    expect(componente).not.toContain('Adicionar requisito documental...')
  })

  it('exibe obrigatorio/opcional, ativo/inativo e acao de desativar/reativar para requisitos existentes', () => {
    expect(componente).toContain("requisito.obrigatorio ? 'Obrigatorio' : 'Opcional'")
    expect(componente).toContain("requisito.ativo ? 'Ativo' : 'Inativo'")
    expect(componente).toContain("requisito.ativo ? 'Desativar' : 'Reativar'")
  })
})

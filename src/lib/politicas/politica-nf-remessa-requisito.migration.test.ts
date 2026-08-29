import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolverFamiliaDocumentalLogistica, validarUnicidadeFamiliasLogisticas } from '@/lib/logistica/evidencias-logisticas'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821060000_p0_politica_nf_remessa_requisito.sql'),
  'utf8',
)

describe('contrato da migration: NF de Remessa no catalogo de requisitos de politica', () => {
  it('e incremental, transacional e idempotente (DROP IF EXISTS antes do ADD CONSTRAINT)', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS politica_requisitos_tipo_check')
  })

  it('amplia o catalogo existente preservando todos os codigos anteriores', () => {
    const codigosAnteriores = [
      'nf_xml', 'nf_danfe_pdf', 'nf_pedido_compra', 'contrato', 'comprovante_entrega',
      'cte', 'canhoto', 'boleto', 'duplicata', 'comprovante_aceite', 'outro',
    ]
    for (const codigo of codigosAnteriores) {
      expect(migration).toContain(`'${codigo}'`)
    }
    expect(migration).toContain("'nf_remessa'")
  })

  it('nao toca notas_fiscais, nota_fiscal_remessas nem tabelas financeiras', () => {
    expect(migration).not.toMatch(/ALTER TABLE public\.(notas_fiscais|nota_fiscal_remessas|operacoes|parcelas)/)
  })
})

describe('NF de Remessa como requisito de politica nunca interfere no gate logistico oficial (CT-e/Comprovante)', () => {
  it('nf_remessa nao pertence a nenhuma familia documental logistica (cte | comprovante_entrega)', () => {
    expect(resolverFamiliaDocumentalLogistica('nf_remessa')).toBeNull()
  })

  it('um requisito nf_remessa nao colide com o requisito oficial de CT-e/Comprovante na validacao de unicidade de familias', () => {
    expect(() => validarUnicidadeFamiliasLogisticas([
      { codigo: 'nf_remessa_pos_cessao', tipo_documento_codigo: 'nf_remessa', ativo: true },
      { codigo: 'cte_pos_cessao', tipo_documento_codigo: 'cte', ativo: true },
    ])).not.toThrow()
  })
})

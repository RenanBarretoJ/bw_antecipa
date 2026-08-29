import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821050000_p0_ajustes_finais_nf_remessa.sql'),
  'utf8',
)
const migrationLower = migration.toLowerCase()

const enviarCanhotoAction = readFileSync(join(process.cwd(), 'src/lib/actions/logistica.ts'), 'utf8')

describe('contrato da migration de ajustes finais (canhoto -> remessa, item 2 do ticket)', () => {
  it('e incremental e transacional', () => {
    expect(migrationLower).toContain('begin;')
    expect(migrationLower).toContain('commit;')
  })

  it('estende registrar_canhoto_documento apenas com parametro DEFAULT no final (chamadas existentes continuam funcionando)', () => {
    const assinatura = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_canhoto_documento'), migration.indexOf('RETURNS jsonb'))
    expect(assinatura).toContain('p_nota_fiscal_remessa_id uuid DEFAULT NULL')
    const posicaoNovoParam = assinatura.indexOf('p_nota_fiscal_remessa_id')
    const posicaoUltimoParamOriginal = assinatura.indexOf('p_descricao_ressalva')
    expect(posicaoNovoParam).toBeGreaterThan(posicaoUltimoParamOriginal)
  })

  it('quando a remessa e informada, exige que exista, esteja VALIDADA e pertenca a mesma NF de venda da entrega (fail-closed)', () => {
    expect(migrationLower).toContain('nf de remessa informada nao encontrada')
    expect(migrationLower).toContain("remessa.status_validacao <> 'validada'")
    expect(migrationLower).toContain('nf de remessa informada nao esta validada')
    expect(migrationLower).toContain('remessa.nota_fiscal_venda_id <> entrega.nota_fiscal_id')
    expect(migrationLower).toContain('nf de remessa informada nao pertence a esta nf de venda')
  })

  it('a validacao roda mesmo quando p_nota_fiscal_remessa_id e NULL, evitando erro de record nao assinalado, e nao bloqueia o fluxo legado', () => {
    const corpo = migration.slice(migration.indexOf('BEGIN\n'), migration.indexOf('IF p_nota_fiscal_remessa_id IS NOT NULL THEN'))
    expect(corpo).toContain('SELECT * INTO remessa FROM public.nota_fiscal_remessas WHERE id = p_nota_fiscal_remessa_id')
  })

  it('persiste nota_fiscal_remessa_id no INSERT de canhotos', () => {
    const insertCanhotos = migration.slice(migration.indexOf('INSERT INTO public.canhotos'), migration.indexOf('RETURNING id INTO canhoto_id'))
    expect(insertCanhotos).toContain('nota_fiscal_remessa_id')
  })

  it('regrant explicito para o novo tamanho de assinatura (14 parametros)', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid)')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid)')
  })
})

describe('enviarCanhoto (action) repassa notaFiscalRemessaId para a RPC', () => {
  it('le notaFiscalRemessaId do formData e passa como p_nota_fiscal_remessa_id', () => {
    const trecho = enviarCanhotoAction.slice(enviarCanhotoAction.indexOf('export async function enviarCanhoto'))
    expect(trecho).toContain("p_nota_fiscal_remessa_id: String(formData.get('notaFiscalRemessaId')")
  })
})

describe('gate logistico da venda: satisfacao independe de remessa (regra F)', () => {
  it('a classificacao de status logistico pre-cessao (TS) nunca referencia nota_fiscal_remessa_id -- canhoto vinculado a remessa satisfaz o gate exatamente como um canhoto direto', () => {
    const evidenciasLogisticas = readFileSync(join(process.cwd(), 'src/lib/logistica/evidencias-logisticas.ts'), 'utf8')
    expect(evidenciasLogisticas).not.toContain('nota_fiscal_remessa')
  })

  it('a elegibilidade de submissao (TS) nunca referencia nota_fiscal_remessa_id', () => {
    const elegibilidade = readFileSync(join(process.cwd(), 'src/lib/notas-fiscais/elegibilidade-submissao.ts'), 'utf8')
    expect(elegibilidade).not.toContain('nota_fiscal_remessa')
  })

  it('a migration do gate unificado (SQL) nunca referencia nota_fiscal_remessa_id', () => {
    const gateSql = readFileSync(join(process.cwd(), 'supabase/migrations/20260820100000_p0_gate_aprovacao_logistica_fonte_unificada.sql'), 'utf8').toLowerCase()
    expect(gateSql).not.toContain('nota_fiscal_remessa')
  })
})

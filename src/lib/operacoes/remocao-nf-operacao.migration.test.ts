import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260924173100_hotfix_remover_nf_operacao_atomica.sql',
)
const normalizeNewlines = (value: string) => value.replace(/\r\n/g, '\n')
const migration = normalizeNewlines(readFileSync(migrationPath, 'utf8'))
const action = normalizeNewlines(readFileSync(join(process.cwd(), 'src/lib/actions/operacao.ts'), 'utf8'))

describe('remocao atomica de NF da operacao', () => {
  it('substitui o DELETE autenticado sujeito a RLS por RPC atomica', () => {
    const inicio = action.indexOf('export async function removerNfDaOperacao')
    const fim = action.indexOf('export async function salvarTestemunhasOperacao', inicio)
    const bloco = action.slice(inicio, fim)

    expect(bloco).toContain("supabase.rpc(\n    'remover_nf_operacao_gestor_atomica' as never")
    expect(bloco).not.toContain(".from('operacoes_nfs')\n    .delete()")
    expect(bloco).toContain("if (error || !data)")
  })

  it('valida gestor e acesso ao fundo dentro da funcao security definer', () => {
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain("v_actor_role IS DISTINCT FROM 'gestor'")
    expect(migration).toContain('private.usuario_tem_acesso_fundo(v_op.fundo_id)')
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) FROM PUBLIC, anon")
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.remover_nf_operacao_gestor_atomica(uuid, uuid) TO authenticated")
  })

  it('confere a linha removida e mantem dependencias e totais consistentes', () => {
    expect(migration).toContain('FOR UPDATE OF onf, nf')
    expect(migration).toContain('GET DIAGNOSTICS v_vinculos_removidos = ROW_COUNT')
    expect(migration).toContain('IF v_vinculos_removidos <> 1 THEN')
    expect(migration).toContain('UPDATE public.nota_fiscal_parcelas parcela')
    expect(migration).toContain("SET status = 'disponivel'")
    expect(migration).toContain('DELETE FROM public.operacoes_nf_parcelas')
    expect(migration).toContain('DELETE FROM public.operacao_calculo_nfs')
    expect(migration).toContain('DELETE FROM public.operacoes_nfs')
    expect(migration).toContain('private.calcular_memoria_financeira_nf(')
    expect(migration).toContain('valor_bruto_total = round(v_valor_bruto, 2)')
    expect(migration).toContain('valor_liquido_desembolso = CASE')
  })

  it('recompoe o aceite agregado somente com as NFs restantes', () => {
    expect(migration).toContain("count(*) FILTER (WHERE nf.status::text = 'aceita')")
    expect(migration).toContain("count(*) FILTER (WHERE nf.status::text = 'contestada')")
    expect(migration).toContain("v_aceite_status := 'contestado'")
    expect(migration).toContain("v_aceite_status := 'aceito'")
    expect(migration).toContain("v_aceite_status := 'pendente'")
    expect(migration).toContain("tipo_evento,\n    entidade_tipo")
    expect(migration).toContain("'NF_REMOVIDA_OPERACAO'")
  })
})

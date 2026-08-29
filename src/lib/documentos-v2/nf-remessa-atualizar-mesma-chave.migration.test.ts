import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260823150000_p0_nf_remessa_atualizar_mesma_chave.sql'),
  'utf8',
)

describe('contrato da migration: versionamento real (append-only) da NF de Remessa', () => {
  it('e incremental e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('cria a tabela de versoes append-only com UNIQUE(remessa_id, numero_versao) e no maximo 1 vigente por remessa', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.nota_fiscal_remessa_versoes')
    expect(migration).toContain('CONSTRAINT nota_fiscal_remessa_versoes_numero_unique UNIQUE (nota_fiscal_remessa_id, numero_versao)')
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_nota_fiscal_remessa_versoes_vigente')
    expect(migration).toContain('ON public.nota_fiscal_remessa_versoes (nota_fiscal_remessa_id)')
    expect(migration).toContain('WHERE vigente')
  })

  it('a tabela de versoes tem RLS habilitado, e todas as 3 policies de leitura seguem o mesmo criterio de acesso da remessa logica pai (join)', () => {
    expect(migration).toContain('ALTER TABLE public.nota_fiscal_remessa_versoes ENABLE ROW LEVEL SECURITY')
    for (const papel of ['gestor', 'consultor', 'cedente']) {
      expect(migration).toContain(`DROP POLICY IF EXISTS nota_fiscal_remessa_versoes_${papel}_select`)
      expect(migration).toContain(`CREATE POLICY nota_fiscal_remessa_versoes_${papel}_select`)
    }
    expect(migration).toContain('FROM public.nota_fiscal_remessas r')
    expect(migration).toContain('WHERE r.id = nota_fiscal_remessa_versoes.nota_fiscal_remessa_id')
    expect(migration).toContain('REVOKE ALL ON public.nota_fiscal_remessa_versoes FROM PUBLIC, anon')
    expect(migration).toContain('GRANT SELECT ON public.nota_fiscal_remessa_versoes TO authenticated')
    // Somente leitura via RLS -- nenhuma policy de INSERT/UPDATE/DELETE direta,
    // toda escrita passa exclusivamente pelo RPC SECURITY DEFINER. Escopo do
    // regex limitado a uma unica declaracao (ate o ";") para nao confundir
    // com o "FOR UPDATE" de trava de linha usado dentro do RPC.
    expect(migration).not.toMatch(/CREATE POLICY[^;]*?FOR (INSERT|UPDATE|DELETE)/)
  })

  it('recria apenas registrar_nota_fiscal_remessa, com a MESMA assinatura de sempre (nenhum novo parametro/GRANT necessario para essa funcao)', () => {
    expect(migration.match(/CREATE OR REPLACE FUNCTION/g) || []).toHaveLength(1)
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.registrar_nota_fiscal_remessa(')

    const parametros = [
      'p_nota_fiscal_venda_id uuid', 'p_chave_acesso text', 'p_numero text', 'p_serie text',
      'p_emitente_cnpj text', 'p_emitente_razao_social text', 'p_destinatario_cnpj text', 'p_destinatario_razao_social text',
      'p_data_emissao date', 'p_valor_total numeric', 'p_quantidade_total numeric', 'p_itens jsonb',
      'p_status_validacao text', 'p_referencia_nf_venda_confirmada boolean', 'p_motivos_validacao jsonb',
      'p_bucket text', 'p_path text', 'p_nome_original text', 'p_mime_type text', 'p_tamanho_bytes bigint', 'p_sha256 text',
    ]
    for (const parametro of parametros) expect(migration).toContain(parametro)
  })

  it('decide INSERT vs nova versao pela chave (trava FOR UPDATE contra corrida) -- nao bloqueia mais uma chave repetida na MESMA venda', () => {
    expect(migration).toContain('SELECT id, nota_fiscal_venda_id INTO v_existente')
    expect(migration).toContain('FOR UPDATE;')
    expect(migration).toContain("v_existente.id IS NOT NULL AND v_existente.nota_fiscal_venda_id <> p_nota_fiscal_venda_id")
    expect(migration).toContain('Chave de acesso da remessa ja cadastrada para outra NF de venda')
  })

  it('branch de nova versao: nunca insere uma segunda nota_fiscal_remessas, calcula max(numero_versao)+1, desativa a versao anterior e reseta a aprovacao documental', () => {
    const branchUpdate = migration.slice(
      migration.indexOf('IF v_existente.id IS NOT NULL THEN'),
      migration.indexOf('ELSE\n    -- "Enviar outra NF de Remessa"'),
    )
    expect(branchUpdate).toContain('v_atualizacao := true;')
    expect(branchUpdate).toContain('coalesce(max(numero_versao), 0) + 1')
    expect(branchUpdate).toContain('FROM public.nota_fiscal_remessa_versoes')
    expect(branchUpdate).toContain('SET vigente = false')
    expect(branchUpdate).toContain('UPDATE public.nota_fiscal_remessas')
    expect(branchUpdate).not.toContain('INSERT INTO public.nota_fiscal_remessas')
    expect(branchUpdate).toContain('aprovacao_documental = v_aprovacao_documental')
    expect(branchUpdate).toContain('aprovacao_analisado_por = NULL')
    expect(branchUpdate).toContain('aprovacao_analisado_em = NULL')
    expect(branchUpdate).toContain('aprovacao_motivo_rejeicao = NULL')
  })

  it('branch INSERT (chave nova): permanece uma insercao simples da entidade logica, com numero_versao := 1', () => {
    const branchInsert = migration.slice(
      migration.indexOf('ELSE\n    -- "Enviar outra NF de Remessa"'),
      migration.indexOf('END IF;\n\n  -- Historico append-only'),
    )
    expect(branchInsert).toContain('v_numero_versao := 1;')
    expect(branchInsert).toContain('INSERT INTO public.nota_fiscal_remessas')
    expect(branchInsert).toContain('RETURNING id INTO v_id')
    expect(branchInsert).not.toContain('UPDATE public.nota_fiscal_remessas')
  })

  it('SEMPRE insere uma nova linha append-only em nota_fiscal_remessa_versoes (insert ou update), nunca a apaga nem a sobrescreve', () => {
    const insercaoVersao = migration.slice(
      migration.indexOf('INSERT INTO public.nota_fiscal_remessa_versoes ('),
      migration.indexOf('RETURN jsonb_build_object('),
    )
    expect(insercaoVersao).toContain('nota_fiscal_remessa_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,')
    expect(insercaoVersao).toContain('true, actor_id')
    expect(migration).not.toContain('DELETE FROM public.nota_fiscal_remessa_versoes')
    expect(migration).not.toContain('DELETE FROM public.nota_fiscal_remessas')
  })

  it('nunca chama qualquer funcao de remocao de objeto do Storage -- a versao anterior do arquivo e preservada por construcao', () => {
    expect(migration).not.toMatch(/remover|delete.*storage/i)
  })

  it('reexecuta o mesmo calculo de aprovacao_documental (nivel_validacao_snapshot) antes de decidir insert/nova-versao -- compartilhado entre os dois branches', () => {
    const antesDoIf = migration.slice(
      migration.indexOf('SELECT dri.nivel_validacao_snapshot'),
      migration.indexOf('IF v_existente.id IS NOT NULL THEN'),
    )
    expect(antesDoIf).toContain("dri.tipo_documento_codigo_snapshot = 'nf_remessa'")
    expect(antesDoIf).toMatch(/WHEN p_status_validacao <> 'VALIDADA' THEN NULL/)
    expect(antesDoIf).toMatch(/WHEN v_nivel_validacao IN \('manual', 'hibrido'\) THEN 'aguardando_analise'/)
  })

  it('retorna atualizacao e numero_versao (nao mais caminho_anterior -- nada e removido do Storage)', () => {
    const retorno = migration.slice(migration.lastIndexOf('RETURN jsonb_build_object('), migration.lastIndexOf('END;'))
    expect(retorno).toContain("'atualizacao', v_atualizacao")
    expect(retorno).toContain("'numero_versao', v_numero_versao")
    expect(retorno).not.toContain('caminho_anterior')
  })

  it('preserva a checagem preexistente: a remessa nao pode ter a mesma chave da propria NF de venda', () => {
    expect(migration).toContain('A remessa nao pode ter a mesma chave de acesso da NF de venda')
  })

  it('preserva as checagens de autorizacao (cedente/gestor) sem alteracao', () => {
    expect(migration).toContain("actor_role NOT IN ('cedente', 'gestor')")
    expect(migration).toContain('NF de venda fora do cedente autenticado')
    expect(migration).toContain('Fundo nao autorizado para o gestor autenticado')
  })
})

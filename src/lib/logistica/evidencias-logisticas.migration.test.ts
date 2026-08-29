import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260806170000_envio_antecipado_documentos_logisticos.sql'),
  'utf8',
).toLowerCase()

const recordCollisionFixMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260806190000_corrigir_record_nf_upload_logistico_antecipado.sql'),
  'utf8',
).toLowerCase()

const uploader = readFileSync(
  join(process.cwd(), 'src/lib/logistica/upload-antecipado.server.ts'),
  'utf8',
)

const checklistAction = readFileSync(
  join(process.cwd(), 'src/lib/actions/documento-v2.ts'),
  'utf8',
)

describe('contrato do envio antecipado de documentos logisticos', () => {
  it('e incremental, transacional e preserva o legado com gate desabilitado', () => {
    expect(migration).toContain('begin;')
    expect(migration).toContain('commit;')
    expect(migration).toContain('exigir_status_logistico_pre_cessao boolean not null default false')
    expect(migration).not.toMatch(/update\s+public\.politica_operacional_versoes\s+set\s+exigir_status_logistico_pre_cessao/)
  })

  it('mantem um unico requisito oficial por familia sem criar instancia pre-cessao paralela', () => {
    expect(migration).toContain('uq_politica_requisito_familia_logistica_ativa')
    expect(migration).toContain("when 'cte_pdf_dacte' then 'cte'")
    expect(migration).toContain("when 'cte_dacte_pdf' then 'cte'")
    expect(migration).toContain("when 'canhoto' then 'comprovante_entrega'")
    expect(migration).not.toContain('insert into public.documento_requisito_instancias')
  })

  it('preserva compartilhamento n:n de ct-e sem duplicar o arquivo por nf', () => {
    expect(migration).toContain('insert into public.cte_notas_fiscais')
    expect(migration).toContain('on conflict (cte_id, nota_fiscal_id) do update')
    expect(migration).toContain('from (select distinct unnest(p_nota_fiscal_ids) as nf_id) ids')
    expect(migration).toContain('pg_advisory_xact_lock')
  })

  it('congela memoria no ingresso e na aprovacao da operacao', () => {
    expect(migration).toContain('operacao_nf_logistica_memorias')
    expect(migration).toContain("p_etapa text")
    expect(migration).toContain("'criacao'")
    expect(migration).toContain("'aprovacao'")
    expect(migration).toContain('memoria logistica da operacao e imutavel')
  })

  it('reconcilia o mesmo documento com a instancia oficial criada no desembolso', () => {
    expect(migration).toContain('reconciliar_evidencia_logistica_nf')
    expect(migration).toContain('set documento_id = evidencia.documento_id')
    expect(migration).toContain('requisito_instancia_reconciliar_logistica_antecipada')
  })

  it('concentra escrita em rpc protegida e aplica rls por cedente e fundo', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('revoke all on public.evidencias_logisticas_antecipadas from anon, authenticated')
    expect(migration).toContain("public.get_user_role() = 'cedente'")
    expect(migration).toContain("public.get_user_role() = 'gestor'")
    expect(migration).toContain('private.usuario_tem_acesso_fundo(fundo_id)')
  })

  it('compensa o storage se o registro sql falhar', () => {
    expect(uploader).toContain('await enviarObjetoDocumento')
    expect(uploader).toContain('if (error) throw new Error')
    expect(uploader).toContain('if (uploaded) await removerObjetoDocumento(path)')
  })

  it('nao reutiliza o alias sql nf como record plpgsql antes da atribuicao', () => {
    expect(recordCollisionFixMigration).toContain('nf_item record;')
    expect(recordCollisionFixMigration).toContain('for nf_item in')
    expect(recordCollisionFixMigration).toContain('from public.notas_fiscais nf')
    expect(recordCollisionFixMigration).not.toMatch(/\bnf\s+record\s*;/)
    expect(recordCollisionFixMigration).not.toMatch(/\bfor\s+nf\s+in\b/)
  })

  it('carrega o tipo das evidencias pelo repositorio documental canonico', () => {
    expect(checklistAction).toContain("from('documentos_repositorio').select('id, documento_tipo_id')")
    expect(checklistAction).not.toContain("from('documentos').select('id, tipo_id')")
  })

  it('nao implementa exposicao percentual em transito', () => {
    expect(migration).not.toMatch(/40\s*%|0\.4(?:0+)?/)
    expect(uploader).not.toMatch(/40\s*%|0\.4(?:0+)?/)
  })
})

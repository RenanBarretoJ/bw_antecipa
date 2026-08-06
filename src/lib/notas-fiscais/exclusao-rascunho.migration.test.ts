import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260806180000_excluir_nfs_rascunho_cedente.sql'),
  'utf8',
).toLowerCase()

const correctiveMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260806200000_corrigir_exclusao_rascunho_eventos_dominio.sql'),
  'utf8',
).toLowerCase()

const action = readFileSync(
  join(process.cwd(), 'src/lib/actions/nota-fiscal.ts'),
  'utf8',
)

describe('exclusao transacional de NFs em rascunho pelo cedente', () => {
  it('autoriza no servidor somente o proprio cedente e somente rascunhos', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain("public.get_user_role() <> 'cedente'")
    expect(migration).toContain('public.get_user_cedente_id()')
    expect(migration).toContain("nf.status::text <> 'rascunho'")
    expect(migration).toContain('for update')
  })

  it('falha o lote inteiro quando algum ID nao pertence ao cedente ou nao e rascunho', () => {
    expect(migration).toContain('v_total_encontrado <> cardinality(v_ids)')
    expect(migration).toContain('v_total_invalido > 0')
    expect(migration).toContain('v_total_excluido <> cardinality(v_ids)')
    expect(migration).toContain('begin;')
    expect(migration).toContain('commit;')
  })

  it('remove dependencias da NF antes do registro principal sem apagar a trilha documental', () => {
    const requisitoAt = migration.indexOf('delete from public.documento_requisito_instancias')
    const vinculoAt = migration.indexOf('delete from public.documento_vinculos')
    const nfAt = migration.indexOf('delete from public.notas_fiscais')

    expect(requisitoAt).toBeGreaterThan(-1)
    expect(vinculoAt).toBeGreaterThan(requisitoAt)
    expect(nfAt).toBeGreaterThan(vinculoAt)
    expect(migration).toContain("set status = 'cancelado'")
    expect(migration).not.toContain('delete from public.documento_versoes')
    expect(migration).not.toContain('delete from public.documento_analises')
  })

  it('preserva historico operacional e audita a exclusao', () => {
    expect(migration).toContain('public.operacoes_nfs')
    expect(migration).toContain('public.operacao_calculo_nfs')
    expect(migration).toContain('public.operacao_nf_logistica_memorias')
    expect(migration).toContain("'nf_rascunho_excluida'")
    expect(migration).toContain("'rpc_excluir_nf_rascunho_cedente'")
  })

  it('remove eventos exclusivos da NF antes de a FK tentar deixa-los sem entidade', () => {
    expect(correctiveMigration).toContain('before delete on public.notas_fiscais')
    expect(correctiveMigration).toContain('delete from public.eventos_dominio')
    expect(correctiveMigration).toContain('evento.nota_fiscal_id = old.id')
    expect(correctiveMigration).toContain('evento.operacao_id is null')
    expect(correctiveMigration).toContain("set search_path = ''")
  })

  it('preserva eventos que tambem pertencem a uma operacao', () => {
    expect(correctiveMigration).not.toContain('delete from public.eventos_dominio evento\n  where evento.nota_fiscal_id = old.id;')
    expect(correctiveMigration).toContain('evento.operacao_id is null')
  })

  it('executa limpeza do Storage somente depois do commit SQL confirmado', () => {
    const rpcAt = action.indexOf(".rpc('excluir_notas_fiscais_rascunho_cedente'")
    const validationAt = action.indexOf('idsExcluidos.length !== ids.length', rpcAt)
    const storageAt = action.indexOf('.storage.from(bucket).remove(paths)', validationAt)

    expect(rpcAt).toBeGreaterThan(-1)
    expect(validationAt).toBeGreaterThan(rpcAt)
    expect(storageAt).toBeGreaterThan(validationAt)
    expect(action.slice(rpcAt, storageAt)).toContain('createAdminClient()')
  })

  it('restringe a RPC ao papel authenticated', () => {
    expect(migration).toContain('revoke all on function public.excluir_notas_fiscais_rascunho_cedente(uuid[]) from public')
    expect(migration).toContain('revoke all on function public.excluir_notas_fiscais_rascunho_cedente(uuid[]) from anon')
    expect(migration).toContain('grant execute on function public.excluir_notas_fiscais_rascunho_cedente(uuid[]) to authenticated')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(
  resolve(process.cwd(), 'scripts/homologacao/reset-geral-homolog.mjs'),
  'utf8',
)

describe('reset geral de homologacao', () => {
  it('opera em preview por padrao e exige duas confirmacoes vinculadas ao projeto', () => {
    expect(script).toContain("const execute = args.execute === true")
    expect(script).toContain("assertExpectedProjectRef(args['expected-project-ref'], env.projectRef)")
    expect(script).toContain('assertDestructiveConfirmation(args.confirm, confirmation)')
    expect(script).toContain('RESETAR_TODA_HOMOLOGACAO_${projectRef}')
  })

  it('bloqueia ambiente que nao seja homologacao e valida a identidade da conexao do banco', () => {
    expect(script).toContain('assertHomologEnvironment()')
    expect(script).toContain('assertDatabaseMatchesProject(env.dbUrl, env.projectRef)')
  })

  it('preserva schema, buckets e o catalogo tecnico documental', () => {
    expect(script).toContain("'documento_tipos'")
    expect(script).not.toContain('DROP SCHEMA')
    expect(script).not.toContain('deleteBucket(')
  })

  it('remove objetos pela Storage API e usuarios pela API administrativa', () => {
    expect(script).toContain('admin.storage.emptyBucket(bucket.id)')
    expect(script).toContain('admin.auth.admin.deleteUser(user.id, false)')
    expect(script).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i)
    expect(script).not.toMatch(/TRUNCATE\s+TABLE\s+auth\./i)
  })

  it('trunca as tabelas publicas em transacao e verifica residuos', () => {
    expect(script).toContain("await db.query('BEGIN')")
    expect(script).toContain('TRUNCATE TABLE')
    expect(script).toContain('RESTART IDENTITY')
    expect(script).toContain('validateTruncatePlan')
    expect(script).toContain('assertResetCompleted(after)')
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve(process.cwd(), 'scripts/homologacao/bootstrap-super-admin.mjs'), 'utf8')

describe('bootstrap do Super Admin', () => {
  it('usa preview por padrao e exige projeto e confirmacao para executar', () => {
    expect(script).toContain("const execute = args.execute === true")
    expect(script).toContain("assertExpectedProjectRef(args['expected-project-ref'], env.projectRef)")
    expect(script).toContain('assertExecuteConfirmation(args.confirm, confirmation)')
  })

  it('le exclusivamente .env.homolog e bloqueia producao', () => {
    expect(script).toContain("resolve(process.cwd(), '.env.homolog')")
    expect(script).toContain("process.env.NODE_ENV === 'production'")
    expect(script).not.toContain("'.env.local'")
    expect(script).toContain('SUPABASE_PRODUCTION_PROJECT_REF')
    expect(script).toContain('SUPABASE_PRODUCTION_PROJECT_REF deve identificar explicitamente')
    expect(script).not.toContain('--force-production')
  })

  it('nao recebe senha e usa convite administrativo', () => {
    expect(script).toContain('inviteUserByEmail')
    expect(script).not.toMatch(/args\.password|args\.senha/)
    expect(script).not.toContain('createUser({')
  })

  it('persiste papel canonico e auditoria sem usar metadata para autorizar', () => {
    expect(script).toContain(".rpc('provisionar_super_admin_homolog'")
    expect(script).toContain('p_project_ref: env.projectRef')
    expect(script).toContain('promoteInvitedUser: !existingUser')
    expect(script).not.toContain("nome_completo: name || 'Super Admin', role: 'super_admin'")
  })
})

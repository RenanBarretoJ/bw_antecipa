import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const facadePath = 'src/lib/serpro-nfe/trusted-pilot-authorization.server.ts'
const facade = readFileSync(facadePath, 'utf8')
const hardeningMigrationPath = 'supabase/migrations/20261028173558_s2_1a4h_serpro_audit_budget_hardening.sql'
const hardeningMigration = readFileSync(hardeningMigrationPath, 'utf8')

const frozenFiles = new Map([
  ['supabase/migrations/20261028140420_s2_1a1_serpro_selective_pilot_claim.sql', 'ef74d66e70d546fe95c7b8a21b6614e5094989928ebbe560d96425cac2a4e33d'],
  ['src/lib/serpro-nfe/pilot-worker.server.ts', 'c1ab05648807de93345a20e56fc74b57b3af9ec852553909f2cb6ad5cc36fe5e'],
  ['src/lib/serpro-nfe/pilot-worker.server.test.ts', '1f1620385df14c71851a728b30f71f55d9eb4e1cd294efbb837706b46bdb90aa'],
  ['src/lib/serpro-nfe/pilot-architecture.test.ts', '64bead3894b503c183d41600a7623e14d079e2414cd8035b2e48a0990a04138a'],
  ['scripts/qa/serpro/s2-1a1-local-rehearsal.mjs', 'fe7f4ec6a08aced88554e9d0275627b230d621df834bf008728704c10294dad9'],
])

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : [path]
  }).filter(path => /\.(?:ts|tsx)$/.test(path))
}

describe('arquitetura S2.1A.3 da autorizacao manual confiavel', () => {
  it('mantem o facade server-only, sem rota, action ou superficie publica', () => {
    expect(facade).toContain("import 'server-only'")
    expect(facade).not.toContain("'use server'")
    expect(facade).not.toContain('NEXT_PUBLIC')
    expect(facade).not.toContain('process.env')
    expect(facade).not.toContain('console.')
    for (const appFile of sourceFiles('src/app')) {
      expect(readFileSync(appFile, 'utf8'), appFile).not.toContain('trusted-pilot-authorization.server')
    }
  })

  it('aceita somente IDs e TOTP, derivando identidade, sessao, chave e nonce no servidor', () => {
    const requestType = facade.slice(
      facade.indexOf('export type TrustedPilotAuthorizationRequest'),
      facade.indexOf('export type TrustedPilotAuthorizationHandle'),
    )
    expect(requestType).toContain('fundoId: string')
    expect(requestType).toContain('notaFiscalId: string')
    expect(requestType).toContain('consultaId: string')
    expect(requestType).toContain('codigoTotp: string')
    for (const forbidden of ['userId', 'sessionId', 'operadorId', 'chaveAcesso', 'nonceHash', 'capability', 'budget']) {
      expect(requestType).not.toContain(forbidden)
    }
    expect(facade).toContain('requireAuthenticated()')
    expect(facade).toContain('requireSessaoMfaValida(context)')
    expect(facade).toContain('mfa.challenge')
    expect(facade).toContain('mfa.verify')
    expect(facade).toContain("aal?.currentLevel !== 'aal2'")
    expect(facade).toContain("update(randomBytes(32))")
  })

  it('valida role e Fundo canonicos antes de criar o cliente administrativo', () => {
    const access = facade.indexOf('await requireCanonicalRoleAndFund')
    const totp = facade.indexOf('await requireFreshTotp')
    const target = facade.indexOf('await loadCanonicalTarget')
    const privileged = facade.indexOf("admin.rpc('nfe_fiscal_pilot_authorize'")
    expect(facade).toContain(".from('usuario_fundos')")
    expect(facade).toContain("roles.includes('super_admin')")
    expect(facade).toContain("context.profile.role !== 'gestor'")
    expect(access).toBeGreaterThan(-1)
    expect(totp).toBeGreaterThan(access)
    expect(target).toBeGreaterThan(totp)
    expect(privileged).toBeGreaterThan(target)
  })

  it('nao devolve nonce, chave, sessao ou authorization id ao browser', () => {
    expect(facade).toContain("return { status: 'SERVER_ONLY_HANDLE' as const }")
    expect(facade).toContain('let consumed = false')
    expect(facade).toContain("skipped: 'PILOT_HANDLE_ALREADY_USED'")
    expect(facade).not.toContain('return { nonceHash')
    expect(facade).not.toContain('return { authorizationId')
  })

  it('preserva byte a byte os cinco artefatos congelados da S2.1A.2', () => {
    for (const [path, expectedHash] of frozenFiles) {
      const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
      expect(actual, path).toBe(expectedHash)
    }
  })

  it('mantem a nova migration restrita a RPC existente, auditoria atomica e orcamento diario', () => {
    expect(hardeningMigration).toContain('CREATE OR REPLACE FUNCTION public.nfe_fiscal_pilot_authorize(')
    expect(hardeningMigration).toContain("'SERPRO_PILOT_AUTHORIZATION_CREATED'")
    expect(hardeningMigration).toContain('v_provider.budget_date = CURRENT_DATE')
    expect(hardeningMigration).toContain('v_provider.calls_today')
    expect(hardeningMigration).toContain('calls_today = 0')
    expect(hardeningMigration).toContain('budget_date = CURRENT_DATE')
    expect(hardeningMigration).toContain("SECURITY DEFINER\nSET search_path = ''")
    expect(hardeningMigration).toContain('FROM PUBLIC, anon, authenticated, service_role')
    expect(hardeningMigration).toContain('TO service_role')
    expect(hardeningMigration).not.toContain('CREATE TABLE')
    expect(hardeningMigration).not.toContain('CREATE POLICY')
    expect(hardeningMigration).not.toContain("capability_state = 'ENABLED'")
    expect(facade).not.toContain("outcome: 'CREATED'")
  })

  it('nao adiciona endpoint, provider call, cron ou ativacao', () => {
    expect(facade).not.toContain('fetch(')
    expect(facade).not.toContain('querySerproNfe')
    expect(facade).not.toContain('cron')
    expect(facade).not.toContain("capability_state = 'ENABLED'")
    expect(facade).not.toContain('SERPRO_NFE_CONSUMER_KEY')
  })
})

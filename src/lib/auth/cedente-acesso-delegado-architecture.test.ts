import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Incidente real reportado pelo usuario ao vivo em homolog: um usuario
// convidado como acesso delegado a um cedente (cedente_acessos, perfil
// administrador/operador -- distinto do dono, cedentes.user_id) ficava
// travado em "/cedente/cadastro" em toda navegacao (middleware) e via
// menu restrito de onboarding para sempre (CedenteLayout), mesmo com o
// cedente ativo -- porque as duas checagens filtravam cedentes so por
// user_id (o dono), nunca considerando cedente_acessos. Confirmado ao
// vivo com um usuario convidado real e corrigido reaproveitando a RPC
// get_user_cedente_id() (SECURITY DEFINER, ja resolve owner OU delegado).
//
// Achado colateral, mesma raiz: cedente_acessos so tem GRANT para
// service_role desde a canonicalizacao de ACL/RLS (20260817150507) --
// requireCedenteAccess, ehAdministrador, usuarioEhAdministradorCedente e a
// tela "Acessos Vinculados" do gestor liam a tabela direto pelo client
// autenticado (permission denied, descartado em silencio), tratando todo
// usuario convidado como sem acesso/nao administrador, e fazendo a tela do
// gestor mostrar "Nenhum usuario adicional vinculado" mesmo com convites
// ativos -- explica o gestor ter convidado a mesma pessoa varias vezes.

const middleware = readFileSync('src/lib/supabase/middleware.ts', 'utf8')
const cedenteLayout = readFileSync('src/app/cedente/layout.tsx', 'utf8')
const authorization = readFileSync('src/lib/auth/authorization.ts', 'utf8')
const cedenteActions = readFileSync('src/lib/actions/cedente.ts', 'utf8')
const mfa = readFileSync('src/lib/auth/mfa.ts', 'utf8')
const gestorActions = readFileSync('src/lib/actions/gestor.ts', 'utf8')
const gestorCedentePage = readFileSync('src/app/gestor/cedentes/[id]/page.tsx', 'utf8')
const portalShell = readFileSync('src/components/layout/portal-shell.tsx', 'utf8')
const rpcMigration = readFileSync('supabase/migrations/20260820150000_get_user_cedente_acesso_perfil.sql', 'utf8')

describe('P0 (correção real): usuário com acesso delegado (cedente_acessos) travado fora do cedente ativo', () => {
  it('middleware resolve o cedente do onboarding via get_user_cedente_id() (owner OU delegado), não mais só por user_id', () => {
    const indiceBloco = middleware.indexOf("userRole === 'cedente'")
    const indiceFimBloco = middleware.indexOf('resolverRedirectOnboardingCedente', indiceBloco)
    const bloco = middleware.slice(indiceBloco, indiceFimBloco)
    expect(indiceBloco).toBeGreaterThan(-1)
    expect(bloco).toContain("supabase.rpc('get_user_cedente_id')")
    expect(bloco).not.toContain(".eq('user_id', user.id)")
  })

  it('CedenteLayout resolve o menu via get_user_cedente_id(), não mais só por cedentes.user_id', () => {
    expect(cedenteLayout).toContain("supabase.rpc('get_user_cedente_id')")
    expect(cedenteLayout).not.toContain(".eq('user_id', user.id)")
  })

  it('requireCedenteAccess resolve acesso delegado via get_user_cedente_id(), não lê cedente_acessos direto (sem GRANT para authenticated)', () => {
    const indiceFuncao = authorization.indexOf('export async function requireCedenteAccess')
    const indiceFimFuncao = authorization.indexOf('\n}', authorization.indexOf('return { ...context, cedente }', indiceFuncao))
    const corpo = authorization.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("context.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain("from('cedente_acessos')")
  })

  it('ehAdministrador (cedente.ts) usa get_user_cedente_acesso_perfil(), não lê cedente_acessos direto', () => {
    const indiceFuncao = cedenteActions.indexOf('async function ehAdministrador')
    const indiceFimFuncao = cedenteActions.indexOf('\n}', indiceFuncao)
    const corpo = cedenteActions.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("supabase.rpc('get_user_cedente_acesso_perfil')")
    expect(corpo).not.toContain("from('cedente_acessos')")
  })

  it('usuarioEhAdministradorCedente (mfa.ts) usa get_user_cedente_acesso_perfil(), não lê cedente_acessos direto', () => {
    const indiceFuncao = mfa.indexOf('async function usuarioEhAdministradorCedente')
    const indiceFimFuncao = mfa.indexOf('\n}', indiceFuncao)
    const corpo = mfa.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("client.rpc('get_user_cedente_acesso_perfil')")
    expect(corpo).not.toContain("from('cedente_acessos')")
  })

  it('listarAcessosVinculadosCedente (gestor.ts) lê cedente_acessos via admin/service_role, não pelo client autenticado do gestor', () => {
    const indiceFuncao = gestorActions.indexOf('export async function listarAcessosVinculadosCedente')
    const indiceFimFuncao = gestorActions.indexOf('\n}', gestorActions.indexOf('return rows.map', indiceFuncao))
    const corpo = gestorActions.slice(indiceFuncao, indiceFimFuncao)
    expect(indiceFuncao).toBeGreaterThan(-1)
    expect(corpo).toContain('const admin = createAdminClient()')
    const indiceAdmin = corpo.indexOf('const admin = createAdminClient()')
    const indiceFromAcessos = corpo.indexOf("from('cedente_acessos')", indiceAdmin)
    expect(indiceFromAcessos).toBeGreaterThan(indiceAdmin)
  })

  it('tela "Acessos Vinculados" do gestor chama listarAcessosVinculadosCedente, não faz mais leitura direta de cedente_acessos', () => {
    expect(gestorCedentePage).toContain('listarAcessosVinculadosCedente')
    expect(gestorCedentePage).not.toContain("from('cedente_acessos')")
  })

  it('RPC get_user_cedente_acesso_perfil é SECURITY DEFINER, mesmo padrão de get_user_cedente_id(), e GRANTed para authenticated', () => {
    expect(rpcMigration).toContain('CREATE OR REPLACE FUNCTION public.get_user_cedente_acesso_perfil()')
    expect(rpcMigration).toContain('SECURITY DEFINER')
    expect(rpcMigration).toContain('FROM public.cedente_acessos ca')
    expect(rpcMigration).toContain('WHERE ca.user_id = auth.uid()')
    expect(rpcMigration).toContain('AND ca.ativo = true')
    expect(rpcMigration).toContain('GRANT EXECUTE ON FUNCTION public.get_user_cedente_acesso_perfil() TO authenticated')
  })
})

// P0 (achado colateral, não confirmado como causa exata do "Carregando
// portal..." infinito relatado, mas uma falha real e generalizável): se a
// leitura de profiles vier vazia (ex.: corrida entre o signup e o trigger
// que cria a linha em profiles) e o destino calculado por
// requireRoleRedirect for a MESMA rota atual, router.push() e um no-op --
// sem setLoading(false) nesse branch, a tela ficava presa no spinner para
// sempre, sem nenhum erro visivel.
describe('P0 (robustez): PortalShell nunca trava em "Carregando portal..." se o perfil não resolver', () => {
  it('tenta novamente a leitura de profiles antes de desistir (cobre corrida do trigger de signup)', () => {
    const indiceLoop = portalShell.indexOf('for (let attempt = 0; attempt < 3')
    expect(indiceLoop).toBeGreaterThan(-1)
    expect(portalShell).toContain(".eq('id', user.id).maybeSingle()")
  })

  it('sempre chama setLoading(false) antes do redirect por perfil ausente/divergente, mesmo se o push for para a rota atual', () => {
    const indiceCondicao = portalShell.indexOf('if (!profileData || profileData.role !== requiredRole)')
    const indiceFimBloco = portalShell.indexOf('return\n      }', indiceCondicao)
    const bloco = portalShell.slice(indiceCondicao, indiceFimBloco)
    expect(indiceCondicao).toBeGreaterThan(-1)
    expect(bloco.indexOf('setLoading(false)')).toBeGreaterThan(-1)
    expect(bloco.indexOf('setLoading(false)')).toBeLessThan(bloco.indexOf('router.push'))
  })
})

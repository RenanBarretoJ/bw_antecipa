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
const dashboardLoaders = readFileSync('src/lib/analytics/loaders.server.ts', 'utf8')
const notasFiscaisListagem = readFileSync('src/lib/notas-fiscais/listagem.server.ts', 'utf8')
const operacoesListagem = readFileSync('src/lib/operacoes/listagem.server.ts', 'utf8')
const estabelecimentosListagem = readFileSync('src/lib/cedentes/estabelecimentos-listagem.server.ts', 'utf8')
const platformAccess = readFileSync('src/lib/auth/platform-access.ts', 'utf8')
const escrowMovimentos = readFileSync('src/lib/escrow/movimentos.server.ts', 'utf8')
const novaSolicitacaoServer = readFileSync('src/lib/operacoes/nova-solicitacao.server.ts', 'utf8')
const operacaoActions = readFileSync('src/lib/actions/operacao.ts', 'utf8')
const estabelecimentoActions = readFileSync('src/lib/actions/estabelecimento.ts', 'utf8')
const cedenteFundoAtivoActions = readFileSync('src/lib/actions/cedente-fundo-ativo.ts', 'utf8')
const selectorsActions = readFileSync('src/lib/actions/selectors.ts', 'utf8')
const extratoPage = readFileSync('src/app/cedente/extrato/page.tsx', 'utf8')
const cedenteFundoAtivoSelector = readFileSync('src/components/fundos/cedente-fundo-ativo-selector.tsx', 'utf8')
const dashboardRpcMigration = readFileSync('supabase/migrations/20260820160000_dashboard_cedente_resumo_acesso_delegado.sql', 'utf8')

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
    expect(cedenteActions).toContain("requireCedenteOrganizationalAccess('administrativo')")
    expect(cedenteActions).not.toContain('async function ehAdministrador')
    expect(cedenteActions).not.toContain('cedenteUserId === userId')
  })

  it('usuarioEhAdministradorCedente (mfa.ts) usa get_user_cedente_acesso_perfil(), não lê cedente_acessos direto', () => {
    const indiceFuncao = mfa.indexOf('async function usuarioEhAdministradorCedente')
    const indiceFimFuncao = mfa.indexOf('\n}', indiceFuncao)
    const corpo = mfa.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("client.rpc('get_user_cedente_perfil_canonico')")
    expect(corpo).not.toContain("from('cedentes')")
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

// P0 (achado ao vivo, confirmado pelo usuario usando a conta convidada
// real): consertar so o middleware/CedenteLayout deixou o usuario convidado
// chegar ao dashboard, mas "Meus CNPJs"/"Minhas NFs"/"Minhas Operacoes"
// continuavam quebrando ("This page couldn't load") ou vindo vazias, e o
// dashboard em si redirecionava de volta para /cedente/cadastro -- o mesmo
// padrao .eq('user_id', ...) existia em mais 9 pontos de chamada
// (levantados por uma varredura completa do codebase).
describe('P0 (correção real, achado pelo usuário ao vivo): mesmo padrão user_id-only em todo o restante do portal do Cedente', () => {
  it('carregarDashboardCedente (dashboard) resolve via get_user_cedente_id()', () => {
    const indiceFuncao = dashboardLoaders.indexOf('export async function carregarDashboardCedente')
    const indiceFimFuncao = dashboardLoaders.indexOf('\n}', indiceFuncao)
    const corpo = dashboardLoaders.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("auth.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', auth.user.id)")
  })

  it('carregarAcessoPlataforma (platform-access.ts, usado pelo middleware e pelo pos-login) resolve via get_user_cedente_id()', () => {
    const indiceFuncao = platformAccess.indexOf('export async function carregarAcessoPlataforma')
    const indiceFimFuncao = platformAccess.indexOf('\n}', indiceFuncao)
    const corpo = platformAccess.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("client.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', userId)")
  })

  it('resolverContextoCedenteFundo (Minhas NFs) resolve via get_user_cedente_id()', () => {
    const indiceFuncao = notasFiscaisListagem.indexOf('async function resolverContextoCedenteFundo')
    const indiceFimFuncao = notasFiscaisListagem.indexOf('\n}', notasFiscaisListagem.indexOf('return {', indiceFuncao))
    const corpo = notasFiscaisListagem.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', userId)")
  })

  it('resolverEscopo (Minhas Operações) resolve via get_user_cedente_id() para o perfil cedente', () => {
    const indiceFuncao = operacoesListagem.indexOf("if (perfil === 'cedente')")
    const indiceFimFuncao = operacoesListagem.indexOf('}\n', operacoesListagem.indexOf('return {', indiceFuncao))
    const corpo = operacoesListagem.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("client.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', userId)")
  })

  it('carregarMeusEstabelecimentosPaginados (Meus CNPJs) resolve via get_user_cedente_id()', () => {
    const indiceFuncao = estabelecimentosListagem.indexOf('export async function carregarMeusEstabelecimentosPaginados')
    const indiceFimFuncao = estabelecimentosListagem.indexOf('\n}', indiceFuncao)
    const corpo = estabelecimentosListagem.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("context.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', context.user.id)")
  })

  it('cedenteAutenticado (ações de estabelecimento) resolve via get_user_cedente_id()', () => {
    const indiceFuncao = estabelecimentoActions.indexOf('async function cedenteAutenticado')
    const indiceFimFuncao = estabelecimentoActions.indexOf('\n}', indiceFuncao)
    const corpo = estabelecimentoActions.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("context.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', context.user.id)")
  })

  it('autorizarConta (extrato/escrow) resolve via get_user_cedente_id()', () => {
    const indiceFuncao = escrowMovimentos.indexOf('async function autorizarConta')
    const indiceFimFuncao = escrowMovimentos.indexOf('\n}', indiceFuncao)
    const corpo = escrowMovimentos.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("auth.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', auth.user.id)")
  })

  it('pagina de Extrato resolve o cedente via get_user_cedente_id()', () => {
    expect(extratoPage).toContain("auth.supabase.rpc('get_user_cedente_id')")
    expect(extratoPage).not.toContain(".eq('user_id', auth.user.id)")
  })

  it('carregarNovaSolicitacaoOperacao resolve via get_user_cedente_id()', () => {
    const indiceFuncao = novaSolicitacaoServer.indexOf('export async function carregarNovaSolicitacaoOperacao')
    const indiceFimFuncao = novaSolicitacaoServer.indexOf('const contexto = await resolverCedenteFundoAtivo', indiceFuncao)
    const corpo = novaSolicitacaoServer.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("auth.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', auth.user.id)")
  })

  it('solicitarAntecipacao resolve o cedente via get_user_cedente_id()', () => {
    const indiceFuncao = operacaoActions.indexOf('export async function solicitarAntecipacao')
    const indiceFimFuncao = operacaoActions.indexOf('if (!cedente)', indiceFuncao)
    const corpo = operacaoActions.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', user.id)")
  })

  it('selecionarCedenteFundoAtivo resolve via get_user_cedente_id()', () => {
    const indiceFuncao = cedenteFundoAtivoActions.indexOf('export async function selecionarCedenteFundoAtivo')
    const indiceFimFuncao = cedenteFundoAtivoActions.indexOf('\n}', indiceFuncao)
    const corpo = cedenteFundoAtivoActions.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("context.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', context.user.id)")
  })

  it('selector de cedente (combobox) resolve via get_user_cedente_id() para o perfil cedente', () => {
    const indiceFuncao = selectorsActions.indexOf("auth.profile.role === 'cedente'")
    const indiceFimFuncao = selectorsActions.indexOf('}\n', indiceFuncao)
    const corpo = selectorsActions.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain("auth.supabase.rpc('get_user_cedente_id')")
    expect(corpo).not.toContain(".eq('user_id', auth.user.id)")
  })

  it('CedenteFundoAtivoSelector (troca de fundo no header) resolve via get_user_cedente_id()', () => {
    expect(cedenteFundoAtivoSelector).toContain("supabase.rpc('get_user_cedente_id')")
    expect(cedenteFundoAtivoSelector).not.toContain(".eq('user_id', userId)")
  })

  it('dashboard_cedente_resumo (RPC SQL) autoriza via get_user_cedente_id(), não mais só pelo dono', () => {
    const indiceFuncao = dashboardRpcMigration.indexOf('CREATE OR REPLACE FUNCTION public.dashboard_cedente_resumo')
    const indiceFimFuncao = dashboardRpcMigration.indexOf('\nEND;', indiceFuncao)
    const corpo = dashboardRpcMigration.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain('c.id = public.get_user_cedente_id()')
    expect(corpo).not.toContain('c.user_id = auth.uid()')
  })
})

// P0/UI (achado ao vivo, print do usuário): o dropdown "Fundo Vinculado" da
// tela do gestor mostrava o UUID cru em vez do nome do fundo -- Select.Value
// (Base UI) só resolve o label a partir dos SelectItem já REGISTRADOS no
// popup, o que empiricamente não acontece antes da primeira montagem/
// abertura (confirmado inspecionando o DOM ao vivo: o span mostrava o uuid
// no primeiro carregamento). Corrigido resolvendo o label explicitamente
// no componente, via children de SelectValue, em vez de depender da
// resolução automática da biblioteca.
describe('P0/UI (correção real): dropdown "Fundo Vinculado" mostrava UUID em vez do nome do fundo', () => {
  it('SelectValue do fundo vinculado recebe children explícitos que resolvem o nome, não depende da resolução automática', () => {
    const indiceSelect = gestorCedentePage.indexOf('Fundo Vinculado')
    const indiceSelectValue = gestorCedentePage.indexOf('<SelectValue', indiceSelect)
    const indiceFimSelectValue = gestorCedentePage.indexOf('</SelectValue>', indiceSelectValue)
    const bloco = gestorCedentePage.slice(indiceSelectValue, indiceFimSelectValue)
    expect(indiceSelectValue).toBeGreaterThan(-1)
    expect(bloco).toContain('fundos.find((f) => f.id === fundoSelecionado)?.nome')
  })
})
